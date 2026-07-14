import { describe, it, expect, vi } from 'vitest';
import { reviewDiff } from './llmReviewer.groq.js';

function fakeFetch(impl: (...args: any[]) => Promise<any>): typeof fetch {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('reviewDiff (Groq)', () => {
  it('parses findings from a valid tool_call response', async () => {
    const fetchFn = fakeFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'submit_findings',
                    arguments: JSON.stringify({
                      findings: [
                        { file: 'src/x.ts', line: 10, severity: 'high', message: 'bug', suggestion: 'fix it' },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    }));

    const result = await reviewDiff({ diff: 'diff...', files: ['src/x.ts'] }, 'fake-key', fetchFn);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe('src/x.ts');
    expect(result.tokensUsed).toBe(150);
  });

  it('retries once when the first response has no tool call', async () => {
    let callCount = 0;
    const fetchFn = fakeFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: {} }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: 'submit_findings', arguments: JSON.stringify({ findings: [] }) } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
      };
    });

    const result = await reviewDiff({ diff: 'diff...', files: [] }, 'fake-key', fetchFn);

    expect(result.findings).toEqual([]);
    expect(result.tokensUsed).toBe(45);
    expect(callCount).toBe(2);
  });

  it('throws when the response is not ok', async () => {
    const fetchFn = fakeFetch(async () => ({ ok: false, status: 401, text: async () => 'invalid key' }));

    await expect(reviewDiff({ diff: 'diff...', files: [] }, 'bad-key', fetchFn)).rejects.toThrow('401');
  });
});
