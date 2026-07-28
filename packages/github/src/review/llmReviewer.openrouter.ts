import type { ReviewContext } from "./contextBuilder.js";
import { splitDiffByFile, filePathOf } from "./contextBuilder.js";
import type { Finding, ReviewResult } from "./llmReviewer.js";
import { chunkDiff } from "./diffChunker.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";
// OpenRouter/Claude has nowhere near Groq's punishing 12k TPM free-tier
// limit, so a single chunk comfortably covers almost any real PR diff —
// this is a safety cap against a truly enormous diff, not a routine split.
const MAX_TOKENS_PER_CHUNK = 100000;
// Spacing between chunk calls on the rare diff that needs more than one.
const CHUNK_DELAY_MS = 1000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 5000;
const MAX_RATE_LIMIT_RETRIES = 3;

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class PartialReviewError extends Error {
  constructor(
    message: string,
    public readonly partialResult: ReviewResult,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "PartialReviewError";
  }
}

const FINDINGS_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_findings",
    description: "Submit the list of code review findings found in the diff",
    parameters: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              codeSnippet: { type: "string" },
              fixedCode: { type: "string" },
              severity: { type: "string", enum: ["high", "medium", "low"] },
              message: { type: "string" },
              suggestion: { type: "string" },
            },
            required: [
              "file",
              "codeSnippet",
              "fixedCode",
              "severity",
              "message",
              "suggestion",
            ],
          },
        },
      },
      required: ["findings"],
    },
  },
};

interface RawFinding {
  file: string;
  codeSnippet: string;
  fixedCode: string;
  severity: Finding["severity"];
  message: string;
  suggestion: string;
}

function buildPrompt(context: ReviewContext): string {
  return `Bạn là một senior engineer đang review Pull Request. Đọc diff dưới đây và liệt kê TẤT CẢ các vấn đề thật sự quan trọng (bug, security, logic sai) mà bạn tìm thấy — không chỉ vấn đề nghiêm trọng nhất. Nếu diff có nhiều vấn đề độc lập (kể cả trong cùng 1 file), mỗi vấn đề phải là 1 phần tử riêng trong mảng findings. Bỏ qua nitpick về style/format. Nếu không có vấn đề gì, trả về findings rỗng.\n\nVới mỗi finding, trường "codeSnippet" phải là chép NGUYÊN VĂN (verbatim) đúng 1 dòng code trong diff nơi xảy ra vấn đề — không tự diễn giải, không thêm/bớt khoảng trắng.\n\nTrường "fixedCode" phải là bản đã sửa đúng lỗi mô tả trong "message", giữ nguyên style/indent gốc — 1 dòng nếu fix chỉ cần 1 dòng, nhiều dòng nếu bug thực sự cần sửa nhiều dòng mới hết lỗi.\n\nDiff:\n${context.diff}`;
}

// Finds the line in a single file's diff block whose content matches target
// exactly (new-side line number), or null if there's no match in this block.
function findLineInBlock(block: string, target: string): number | null {
  let newLine = 0;
  let inHunk = false;

  for (const line of block.split("\n")) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]) - 1;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("-")) continue;

    newLine++;
    if (line.slice(1).trim() === target) return newLine;
  }

  return null;
}

// Derives file + line from the diff instead of trusting the model's own
// values, which can be wrong. hintFile (the model's file guess) only breaks
// ties when codeSnippet matches identical content in more than one file —
// it is not authoritative. Ambiguous cases (multiple candidates, hint
// doesn't confidently pick one) are dropped rather than guessed, same as
// the no-match case — a wrong guess posts on the wrong file silently,
// which is worse than not posting at all.
function resolveFileAndLine(
  diff: string,
  codeSnippet: string,
  hintFile: string,
): { file: string; line: number } | null {
  const target = codeSnippet.trim();
  const matches: { file: string; line: number }[] = [];
  let hasUnresolvableMatch = false;

  for (const block of splitDiffByFile(diff)) {
    const line = findLineInBlock(block, target);
    if (line === null) continue;

    const file = filePathOf(block);
    if (file === "") {
      hasUnresolvableMatch = true;
      continue;
    }
    matches.push({ file, line });
  }

  const exactMatch = matches.find((m) => m.file === hintFile);
  if (exactMatch) return exactMatch;

  if (matches.length === 1 && !hasUnresolvableMatch) return matches[0];
  if (hasUnresolvableMatch) return null;

  return matches.find((m) => m.file.endsWith(`/${hintFile}`)) ?? null;
}

function resolveFindings(context: ReviewContext, raw: RawFinding[]): Finding[] {
  const findings: Finding[] = [];
  for (const finding of raw) {
    const resolved = resolveFileAndLine(
      context.diff,
      finding.codeSnippet,
      finding.file,
    );
    if (resolved === null) continue;
    findings.push({
      file: resolved.file,
      line: resolved.line,
      severity: finding.severity,
      message: finding.message,
      suggestion: finding.suggestion,
      codeSnippet: finding.codeSnippet,
      fixedCode: finding.fixedCode,
    });
  }
  return findings;
}

interface OpenRouterMessage {
  role: "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    };
  }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

function parseFindings(response: OpenRouterResponse): RawFinding[] {
  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall) throw new Error("No tool call in OpenRouter response");

  const args = JSON.parse(toolCall.function.arguments) as {
    findings: RawFinding[];
  };
  if (!Array.isArray(args.findings))
    throw new Error("findings is not an array");
  return args.findings;
}

async function callOpenRouter(
  apiKey: string,
  messages: OpenRouterMessage[],
  fetchFn: typeof fetch,
  sleepFn: SleepFn,
  retriesLeft = MAX_RATE_LIMIT_RETRIES,
): Promise<OpenRouterResponse> {
  const res = await fetchFn(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0,
      tools: [FINDINGS_TOOL],
      tool_choice: { type: "function", function: { name: "submit_findings" } },
    }),
  });

  if (res.status === 429 && retriesLeft > 0) {
    const retryAfterHeader = res.headers?.get?.("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : DEFAULT_RATE_LIMIT_RETRY_MS;
    await sleepFn(delayMs);
    return callOpenRouter(apiKey, messages, fetchFn, sleepFn, retriesLeft - 1);
  }

  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<OpenRouterResponse>;
}

async function reviewChunk(
  context: ReviewContext,
  apiKey: string,
  fetchFn: typeof fetch,
  sleepFn: SleepFn,
): Promise<ReviewResult> {
  const messages: OpenRouterMessage[] = [
    { role: "user", content: buildPrompt(context) },
  ];

  const response = await callOpenRouter(apiKey, messages, fetchFn, sleepFn);
  const tokensUsed =
    response.usage.prompt_tokens + response.usage.completion_tokens;

  try {
    return {
      findings: resolveFindings(context, parseFindings(response)),
      tokensUsed,
    };
  } catch {
    const retryMessages: OpenRouterMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: JSON.stringify(response.choices[0]?.message ?? {}),
      },
      {
        role: "user",
        content:
          "Kết quả không đúng format yêu cầu. Hãy gọi lại tool submit_findings với đúng schema.",
      },
    ];
    const retryResponse = await callOpenRouter(
      apiKey,
      retryMessages,
      fetchFn,
      sleepFn,
    );
    const retryTokensUsed =
      tokensUsed +
      retryResponse.usage.prompt_tokens +
      retryResponse.usage.completion_tokens;
    return {
      findings: resolveFindings(context, parseFindings(retryResponse)),
      tokensUsed: retryTokensUsed,
    };
  }
}

export async function reviewDiff(
  context: ReviewContext,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  sleepFn: SleepFn = defaultSleep,
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
      // No chunk has succeeded yet — this is a total failure, not a partial
      // one. Re-throw as-is instead of wrapping it, so callers don't mistake
      // "review never ran" for "review ran and found nothing" (the exact bug
      // this file was written to fix, just for a different trigger).
      if (i === 0) throw err;
      throw new PartialReviewError(
        `OpenRouter review failed on chunk ${i + 1}/${chunks.length} after ${findings.length} finding(s) already collected`,
        { findings, tokensUsed },
        err,
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
