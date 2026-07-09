import type { ReviewContext } from './contextBuilder.js';
import type { Finding, ReviewResult } from './llmReviewer.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

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
  fetchFn: typeof fetch
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

  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<GroqResponse>;
}

export async function reviewDiff(
  context: ReviewContext,
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<ReviewResult> {
  const messages: GroqMessage[] = [{ role: 'user', content: buildPrompt(context) }];

  const response = await callGroq(apiKey, messages, fetchFn);
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
    const retryResponse = await callGroq(apiKey, retryMessages, fetchFn);
    const retryTokensUsed = tokensUsed + retryResponse.usage.prompt_tokens + retryResponse.usage.completion_tokens;
    return { findings: parseFindings(retryResponse), tokensUsed: retryTokensUsed };
  }
}
