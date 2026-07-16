import type Anthropic from '@anthropic-ai/sdk';
import type { ReviewContext } from './contextBuilder.js';

export interface Finding {
  file: string;
  /** Line number in the new (post-diff) version of the file — never a deleted line. commentPoster.ts relies on this to always post comments on the diff's RIGHT side. */
  line: number;
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion: string;
}

export interface ReviewResult {
  findings: Finding[];
  tokensUsed: number;
}

const FINDINGS_TOOL = {
  name: 'submit_findings',
  description: 'Submit the list of code review findings found in the diff',
  input_schema: {
    type: 'object' as const,
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
};

function buildPrompt(context: ReviewContext): string {
  return `Bạn là một senior engineer đang review Pull Request. Đọc diff dưới đây và chỉ ra các vấn đề thật sự quan trọng (bug, security, logic sai). Bỏ qua nitpick về style/format. Nếu không có vấn đề gì, trả về findings rỗng.\n\nDiff:\n${context.diff}`;
}

function parseFindings(response: Anthropic.Message): Finding[] {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );
  if (!toolUse) throw new Error('No tool_use block in Claude response');

  const input = toolUse.input as { findings: Finding[] };
  if (!Array.isArray(input.findings)) throw new Error('findings is not an array');
  return input.findings;
}

export async function reviewDiff(context: ReviewContext, client: Anthropic): Promise<ReviewResult> {
  const baseParams = {
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    tools: [FINDINGS_TOOL],
    tool_choice: { type: 'tool' as const, name: 'submit_findings' },
    messages: [{ role: 'user' as const, content: buildPrompt(context) }],
  };

  const response = await client.messages.create(baseParams as any);
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  try {
    return { findings: parseFindings(response), tokensUsed };
  } catch {
    const retryResponse = await client.messages.create({
      ...baseParams,
      messages: [
        ...baseParams.messages,
        { role: 'assistant' as const, content: response.content },
        {
          role: 'user' as const,
          content: 'Kết quả không đúng format yêu cầu. Hãy gọi lại tool submit_findings với đúng schema.',
        },
      ],
    } as any);
    const retryTokensUsed = tokensUsed + retryResponse.usage.input_tokens + retryResponse.usage.output_tokens;
    return { findings: parseFindings(retryResponse), tokensUsed: retryTokensUsed };
  }
}
