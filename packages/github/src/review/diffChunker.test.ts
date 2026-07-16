import { describe, it, expect } from 'vitest';
import { chunkDiff } from './diffChunker.js';

function fileBlock(path: string, bodyLines: number, charsPerLine = 20): string {
  const body = Array.from({ length: bodyLines }, (_, i) => '+'.padEnd(charsPerLine, `${i % 10}`)).join('\n');
  return `diff --git a/${path} b/${path}\n@@ -1,1 +1,${bodyLines} @@\n${body}\n`;
}

describe('chunkDiff', () => {
  it('packs multiple small files into a single chunk when under the token budget', () => {
    const a = fileBlock('a.ts', 2);
    const b = fileBlock('b.ts', 2);
    const diff = a + b;

    const chunks = chunkDiff(diff, 1000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toEqual(['a.ts', 'b.ts']);
    expect(chunks[0].diff).toBe(diff);
  });

  it('splits files into separate chunks once the token budget is exceeded', () => {
    const a = fileBlock('a.ts', 50, 40);
    const b = fileBlock('b.ts', 50, 40);
    const diff = a + b;

    const perFileTokens = Math.ceil(a.length / 4);
    const chunks = chunkDiff(diff, perFileTokens + 5);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].files).toEqual(['a.ts']);
    expect(chunks[1].files).toEqual(['b.ts']);
    expect(chunks[0].diff + chunks[1].diff).toBe(diff);
  });

  it('splits a single oversized file by hunk boundaries', () => {
    const hunk1 = '@@ -1,1 +1,3 @@\n+aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
    const hunk2 = '@@ -10,1 +10,3 @@\n+bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';
    const header = 'diff --git a/big.ts b/big.ts\n';
    const diff = header + hunk1 + hunk2;

    const headerAndHunk1Tokens = Math.ceil((header + hunk1).length / 4);
    const chunks = chunkDiff(diff, headerAndHunk1Tokens + 2);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c: { files: string[] }) => c.files.includes('big.ts'))).toBe(true);
    expect(chunks.map((c: { diff: string }) => c.diff).join('')).toBe(diff);
  });

  it('keeps a single hunk that alone exceeds the budget as its own chunk instead of dropping content', () => {
    const header = 'diff --git a/huge.ts b/huge.ts\n';
    const giantHunk = '@@ -1,1 +1,1 @@\n' + '+'.repeat(2000) + '\n';
    const diff = header + giantHunk;

    const chunks = chunkDiff(diff, 10);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].diff).toBe(diff);
  });

  it('returns an empty array for an empty diff', () => {
    expect(chunkDiff('', 1000)).toEqual([]);
  });
});
