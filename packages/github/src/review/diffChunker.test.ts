import { describe, it, expect } from "vitest";
import { chunkDiff, estimateTokens } from "./diffChunker.js";

function fileBlock(path: string, bodyLines: number, charsPerLine = 20): string {
  const body = Array.from({ length: bodyLines }, (_, i) =>
    "+".padEnd(charsPerLine, `${i % 10}`),
  ).join("\n");
  return `diff --git a/${path} b/${path}\n@@ -1,1 +1,${bodyLines} @@\n${body}\n`;
}

describe("chunkDiff", () => {
  it("packs multiple small files into a single chunk when under the token budget", () => {
    const a = fileBlock("a.ts", 2);
    const b = fileBlock("b.ts", 2);
    const diff = a + b;

    const chunks = chunkDiff(diff, 1000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toEqual(["a.ts", "b.ts"]);
    expect(chunks[0].diff).toBe(diff);
  });

  it("splits files into separate chunks once the token budget is exceeded", () => {
    const a = fileBlock("a.ts", 50, 40);
    const b = fileBlock("b.ts", 50, 40);
    const diff = a + b;

    const perFileTokens = Math.ceil(a.length / 4);
    const chunks = chunkDiff(diff, perFileTokens + 5);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].files).toEqual(["a.ts"]);
    expect(chunks[1].files).toEqual(["b.ts"]);
    expect(chunks[0].diff + chunks[1].diff).toBe(diff);
  });

  it("splits a single oversized file by hunk boundaries, keeping the file header on every piece", () => {
    const hunk1 =
      "@@ -1,1 +1,3 @@\n+aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    const hunk2 =
      "@@ -10,1 +10,3 @@\n+bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n";
    const header = "diff --git a/big.ts b/big.ts\n";
    const diff = header + hunk1 + hunk2;

    const headerAndHunk1Tokens = Math.ceil((header + hunk1).length / 4);
    const chunks = chunkDiff(diff, headerAndHunk1Tokens + 2);

    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((c: { files: string[] }) => c.files.includes("big.ts")),
    ).toBe(true);
    // every piece must carry its own file header, or the LLM has no idea which
    // file a continuation hunk belongs to
    for (const chunk of chunks) {
      expect(chunk.diff.startsWith(header)).toBe(true);
    }
    // hunks themselves must survive undamaged and in order once the (now
    // repeated) header is stripped back out
    const hunksOnly = chunks
      .map((c: { diff: string }) => c.diff.slice(header.length))
      .join("");
    expect(hunksOnly).toBe(hunk1 + hunk2);
  });

  it("keeps a single hunk that alone exceeds the budget as its own chunk instead of dropping content", () => {
    const header = "diff --git a/huge.ts b/huge.ts\n";
    const giantHunk = "@@ -1,1 +1,1 @@\n" + "+".repeat(2000) + "\n";
    const diff = header + giantHunk;

    const chunks = chunkDiff(diff, 10);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].diff).toBe(diff);
  });

  it("returns an empty array for an empty diff", () => {
    expect(chunkDiff("", 1000)).toEqual([]);
  });

  it("preserves every hunk exactly once across multiple flush cycles", () => {
    const header = "diff --git a/many.ts b/many.ts\n";
    const hunks = Array.from(
      { length: 5 },
      (_, i) => `@@ -${i},1 +${i},3 @@\n+${"x".repeat(40)}\n`,
    );
    const diff = header + hunks.join("");

    const headerAndFirstHunkTokens = Math.ceil((header + hunks[0]).length / 4);
    const chunks = chunkDiff(diff, headerAndFirstHunkTokens + 2);

    expect(chunks.length).toBeGreaterThan(1);
    const hunksOnly = chunks
      .map((c: { diff: string }) => c.diff.slice(header.length))
      .join("");
    expect(hunksOnly).toBe(hunks.join(""));
  });
});

describe("estimateTokens", () => {
  it("estimates CJK-heavy text far above the flat 4-chars-per-token ratio", () => {
    const asciiText = "a".repeat(20);
    const cjkText = "測".repeat(20);

    expect(estimateTokens(asciiText)).toBe(5);
    expect(estimateTokens(cjkText)).toBeGreaterThan(15);
  });

  it("sums each character class separately for mixed CJK and ASCII text", () => {
    const mixed = "測".repeat(10) + "a".repeat(20);

    expect(estimateTokens(mixed)).toBe(15);
  });

  it("counts CJK punctuation and fullwidth forms at close to 1 token per character too", () => {
    const punctuation = "、".repeat(20); // ideographic comma, U+3001
    const fullwidth = "Ａ".repeat(20); // fullwidth "A", U+FF21

    expect(estimateTokens(punctuation)).toBeGreaterThan(15);
    expect(estimateTokens(fullwidth)).toBeGreaterThan(15);
  });
});
