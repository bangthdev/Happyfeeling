import { describe, it, expect, vi } from 'vitest';
import { reviewDiff, PartialReviewError } from './llmReviewer.groq.js';

function fakeFetch(impl: (...args: any[]) => Promise<any>): typeof fetch {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('reviewDiff (Groq)', () => {
  it('sets temperature to 0 for deterministic output', async () => {
    const fetchFn = fakeFetch(async () => ({
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
    }));

    await reviewDiff({ diff: 'diff...', files: [] }, 'fake-key', fetchFn);

    const [, requestInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string);
    expect(body.temperature).toBe(0);
  });

  it('drops a finding when codeSnippet cannot be matched in the diff', async () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;
`;
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
                        {
                          file: 'src/x.ts',
                          codeSnippet: 'this text does not exist in the diff',
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
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    }));

    const result = await reviewDiff({ diff, files: ['src/x.ts'] }, 'fake-key', fetchFn);

    expect(result.findings).toEqual([]);
  });

  it('resolves the finding line by matching codeSnippet against the diff', async () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const bug = 1;
 const b = 2;
 const c = 3;
`;
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
                        {
                          file: 'src/x.ts',
                          codeSnippet: 'const bug = 1;',
                          severity: 'high',
                          message: 'bug',
                          suggestion: 'fix it',
                        },
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

    const result = await reviewDiff({ diff, files: ['src/x.ts'] }, 'fake-key', fetchFn);

    expect(result.findings).toEqual([
      { file: 'src/x.ts', line: 2, severity: 'high', message: 'bug', suggestion: 'fix it', codeSnippet: 'const bug = 1;' },
    ]);
    expect(result.tokensUsed).toBe(150);
  });

  it('carries codeSnippet and fixedCode through into the final Finding', async () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const bug = 1;
 const b = 2;
 const c = 3;
`;
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
                        {
                          file: 'src/x.ts',
                          codeSnippet: 'const bug = 1;',
                          fixedCode: 'const notBug = 1;',
                          severity: 'high',
                          message: 'bad name',
                          suggestion: 'rename it',
                        },
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

    const result = await reviewDiff({ diff, files: ['src/x.ts'] }, 'fake-key', fetchFn);

    expect(result.findings).toEqual([
      {
        file: 'src/x.ts',
        line: 2,
        severity: 'high',
        message: 'bad name',
        suggestion: 'rename it',
        codeSnippet: 'const bug = 1;',
        fixedCode: 'const notBug = 1;',
      },
    ]);
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

  it('re-throws the original error, not PartialReviewError, when the very first chunk fails', async () => {
    const fetchFn = fakeFetch(async () => ({ ok: false, status: 401, text: async () => 'invalid key' }));

    const promise = reviewDiff({ diff: 'diff...', files: [] }, 'bad-key', fetchFn);

    await expect(promise).rejects.not.toBeInstanceOf(PartialReviewError);
    await expect(promise).rejects.toThrow('401');
  });

  it('splits an oversized diff into multiple Groq calls, merges findings, sums tokens, and delays between calls', async () => {
    const bigLine = '+'.repeat(30000);
    const bigLineContent = bigLine.slice(1);
    const bigFile = (path: string) => `diff --git a/${path} b/${path}\n@@ -1,1 +1,1 @@\n${bigLine}\n`;
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
                            codeSnippet: bigLineContent,
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
    const bigLine = '+'.repeat(30000);
    const bigLineContent = bigLine.slice(1);
    const bigFile = (path: string) => `diff --git a/${path} b/${path}\n@@ -1,1 +1,1 @@\n${bigLine}\n`;
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
                            { file: 'a.ts', codeSnippet: bigLineContent, severity: 'low', message: 'm', suggestion: 's' },
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
