import type { ReviewContext } from './contextBuilder.js';
import type { Finding, ReviewResult } from './llmReviewer.js';
import { chunkDiff } from './diffChunker.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
// Groq's TPM limit is 12k; budget half of it per chunk to leave room for the
// prompt template and the model's response within the same per-minute window.
const MAX_TOKENS_PER_CHUNK = 6000;
// Spacing between chunk calls so consecutive chunks don't land in the same
// rate-limit window and re-trigger a 429.
const CHUNK_DELAY_MS = 3000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 5000;
const MAX_RATE_LIMIT_RETRIES = 3;

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class PartialReviewError extends Error {
  constructor(
    message: string,
    public readonly partialResult: ReviewResult,
    public readonly cause: unknown
  ) {
    super(message);
    this.name = 'PartialReviewError';
  }
}

const FINDINGS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_findings',
    description: 'Submit the list of code review findings found in the diff',
    parameters: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              severity: { type: 'string', enum: ['high', 'medium', 'low'] },
              message: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['file', 'line', 'severity', 'message', 'suggestion'],
          },
        },
      },
      required: ['findings'],
    },
  },
};

function buildPrompt(context: ReviewContext): string {
  return `Bạn là một senior engineer đang review Pull Request. Đọc diff dưới đây và chỉ ra các vấn đề thật sự quan trọng (bug, security, logic sai). Bỏ qua nitpick về style/format. Nếu không có vấn đề gì, trả về findings rỗng.\n\nDiff:\n${context.diff}`;
}

interface GroqMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GroqResponse {
  choices: Array<{
    message: {
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    };
  }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

function parseFindings(response: GroqResponse): Finding[] {
  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall) throw new Error('No tool call in Groq response');

  const args = JSON.parse(toolCall.function.arguments) as { findings: Finding[] };
  if (!Array.isArray(args.findings)) throw new Error('findings is not an array');
  return args.findings;
}

async function callGroq(
  apiKey: string,
  messages: GroqMessage[],
  fetchFn: typeof fetch,
  sleepFn: SleepFn,
  retriesLeft = MAX_RATE_LIMIT_RETRIES
): Promise<GroqResponse> {
  const res = await fetchFn(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      tools: [FINDINGS_TOOL],
      tool_choice: { type: 'function', function: { name: 'submit_findings' } },
    }),
  });

  if (res.status === 429 && retriesLeft > 0) {
    const retryAfterHeader = res.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const delayMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : DEFAULT_RATE_LIMIT_RETRY_MS;
    await sleepFn(delayMs);
    return callGroq(apiKey, messages, fetchFn, sleepFn, retriesLeft - 1);
  }

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<GroqResponse>;
}

async function reviewChunk(
  context: ReviewContext,
  apiKey: string,
  fetchFn: typeof fetch,
  sleepFn: SleepFn
): Promise<ReviewResult> {
  const messages: GroqMessage[] = [{ role: 'user', content: buildPrompt(context) }];

  const response = await callGroq(apiKey, messages, fetchFn, sleepFn);
  const tokensUsed = response.usage.prompt_tokens + response.usage.completion_tokens;

  try {
    return { findings: parseFindings(response), tokensUsed };
  } catch {
    const retryMessages: GroqMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: JSON.stringify(response.choices[0]?.message ?? {}),
      },
      {
        role: 'user',
        content: 'Kết quả không đúng format yêu cầu. Hãy gọi lại tool submit_findings với đúng schema.',
      },
    ];
    const retryResponse = await callGroq(apiKey, retryMessages, fetchFn, sleepFn);
    const retryTokensUsed = tokensUsed + retryResponse.usage.prompt_tokens + retryResponse.usage.completion_tokens;
    return { findings: parseFindings(retryResponse), tokensUsed: retryTokensUsed };
  }
}

export async function reviewDiff(
  context: ReviewContext,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  sleepFn: SleepFn = defaultSleep
): Promise<ReviewResult> {
  const chunks = chunkDiff(context.diff, MAX_TOKENS_PER_CHUNK);
  if (chunks.length === 0) return { findings: [], tokensUsed: 0 };

  const findings: Finding[] = [];
  let tokensUsed = 0;

  for (let i = 0; i < chunks.length; i++) {
    let result: ReviewResult;
    try {
      result = await reviewChunk(chunks[i], apiKey, fetchFn, sleepFn);
    } catch (err) {
      throw new PartialReviewError(
        `Groq review failed on chunk ${i + 1}/${chunks.length} after ${findings.length} finding(s) already collected`,
        { findings, tokensUsed },
        err
      );
    }
    findings.push(...result.findings);
    tokensUsed += result.tokensUsed;

    if (i < chunks.length - 1) {
      await sleepFn(CHUNK_DELAY_MS);
    }
  }

  return { findings, tokensUsed };
}
