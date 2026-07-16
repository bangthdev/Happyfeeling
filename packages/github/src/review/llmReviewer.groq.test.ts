import { describe, it, expect, vi } from 'vitest';
import { reviewDiff, PartialReviewError } from './llmReviewer.groq.js';

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

  it('throws a PartialReviewError whose cause carries the underlying HTTP error when the response is not ok', async () => {
    const fetchFn = fakeFetch(async () => ({ ok: false, status: 401, text: async () => 'invalid key' }));

    const promise = reviewDiff({ diff: 'diff...', files: [] }, 'bad-key', fetchFn);

    await expect(promise).rejects.toBeInstanceOf(PartialReviewError);
    await expect(promise).rejects.toMatchObject({
      partialResult: { findings: [], tokensUsed: 0 },
      cause: expect.objectContaining({ message: expect.stringContaining('401') }),
    });
  });

  it('splits an oversized diff into multiple Groq calls, merges findings, sums tokens, and delays between calls', async () => {
    const bigFile = (path: string) =>
      `diff --git a/${path} b/${path}\n@@ -1,1 +1,1 @@\n${'+'.repeat(30000)}\n`;
    const diff = bigFile('a.ts') + bigFile('b.ts');

    let callCount = 0;
    const fetchFn = fakeFetch(async () => {
      callCount += 1;
      return {
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
                          {
                            file: `${callCount}.ts`,
                            line: 1,
                            severity: 'low',
                            message: 'm',
                            suggestion: 's',
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      };
    });

    const sleepCalls: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });

    const result = await reviewDiff({ diff, files: ['a.ts', 'b.ts'] }, 'fake-key', fetchFn, sleepFn);

    expect(callCount).toBe(2);
    expect(result.findings).toHaveLength(2);
    expect(result.tokensUsed).toBe(220);
    expect(sleepCalls).toEqual([expect.any(Number)]);
    expect(sleepCalls).toHaveLength(1);
  });

  it('retries after a 429 using the Retry-After header when present', async () => {
    let callCount = 0;
    const fetchFn = fakeFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name: string) => (name === 'retry-after' ? '2' : null) },
          text: async () => 'rate limited',
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
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
      };
    });

    const sleepFn = vi.fn(async () => {});

    const result = await reviewDiff({ diff: 'diff...', files: [] }, 'fake-key', fetchFn, sleepFn);

    expect(callCount).toBe(2);
    expect(result.findings).toEqual([]);
    expect(sleepFn).toHaveBeenCalledWith(2000);
  });

  it('throws a PartialReviewError carrying findings already collected when a later chunk fails', async () => {
    const bigFile = (path: string) =>
      `diff --git a/${path} b/${path}\n@@ -1,1 +1,1 @@\n${'+'.repeat(30000)}\n`;
    const diff = bigFile('a.ts') + bigFile('b.ts');

    let callCount = 0;
    const fetchFn = fakeFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
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
                            { file: 'a.ts', line: 1, severity: 'low', message: 'm', suggestion: 's' },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 10 },
          }),
        };
      }
      return { ok: false, status: 401, text: async () => 'invalid key' };
    });

    const sleepFn = vi.fn(async () => {});

    const promise = reviewDiff({ diff, files: ['a.ts', 'b.ts'] }, 'fake-key', fetchFn, sleepFn);

    await expect(promise).rejects.toBeInstanceOf(PartialReviewError);
    await expect(promise).rejects.toMatchObject({
      partialResult: {
        findings: [{ file: 'a.ts', line: 1, severity: 'low', message: 'm', suggestion: 's' }],
        tokensUsed: 110,
      },
    });
  });

  it('falls back to a default delay on 429 when Retry-After is absent', async () => {
    let callCount = 0;
    const fetchFn = fakeFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () => 'rate limited',
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
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
      };
    });

    const sleepFn = vi.fn(async () => {});

    await reviewDiff({ diff: 'diff...', files: [] }, 'fake-key', fetchFn, sleepFn);

    expect(callCount).toBe(2);
    expect(sleepFn).toHaveBeenCalledWith(5000);
  });
});
