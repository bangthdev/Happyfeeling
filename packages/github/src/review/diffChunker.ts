import {
  splitDiffByFile,
  filePathOf,
  type ReviewContext,
} from "./contextBuilder.js";

const TOKEN_CHAR_RATIO = 4;

// BPE tokenizers typically split each CJK character into close to one token
// on its own, so the flat length/4 ratio badly underestimates CJK-heavy text.
// Covers: CJK Symbols/Punctuation, Hiragana, Katakana, CJK Ext-A, CJK
// Unified Ideographs, Hangul Syllables, CJK Compatibility Ideographs, and
// Halfwidth/Fullwidth Forms.
const CJK_RANGES = /[　-ヿ㐀-䶿一-鿿가-힣豈-﫿＀-￯]/g;

export function estimateTokens(text: string): number {
  const cjkCount = text.match(CJK_RANGES)?.length ?? 0;
  const otherLength = text.length - cjkCount;
  return Math.ceil(otherLength / TOKEN_CHAR_RATIO) + cjkCount;
}

function splitBlockByHunk(block: string, maxTokens: number): string[] {
  const firstHunkIndex = block.search(/^@@ /m);
  if (firstHunkIndex === -1) return [block];

  const header = block.slice(0, firstHunkIndex);
  const hunks = block
    .slice(firstHunkIndex)
    .split(/(?=^@@ )/m)
    .filter(Boolean);

  const pieces: string[] = [];
  let current = header + hunks[0];
  let currentTokens = estimateTokens(current);

  for (const hunk of hunks.slice(1)) {
    const hunkTokens = estimateTokens(hunk);
    if (currentTokens + hunkTokens <= maxTokens) {
      current += hunk;
      currentTokens += hunkTokens;
    } else {
      pieces.push(current);
      current = header + hunk;
      currentTokens = estimateTokens(current);
    }
  }
  pieces.push(current);
  return pieces;
}

export function chunkDiff(diff: string, maxTokens: number): ReviewContext[] {
  if (!diff) return [];

  const blocks = splitDiffByFile(diff);
  const chunks: ReviewContext[] = [];

  let currentDiff = "";
  let currentFiles: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (currentDiff) chunks.push({ diff: currentDiff, files: currentFiles });
    currentDiff = "";
    currentFiles = [];
    currentTokens = 0;
  };

  for (const block of blocks) {
    const path = filePathOf(block);
    const blockTokens = estimateTokens(block);

    if (blockTokens > maxTokens) {
      flush();
      for (const piece of splitBlockByHunk(block, maxTokens)) {
        chunks.push({ diff: piece, files: path ? [path] : [] });
      }
      continue;
    }

    if (currentDiff && currentTokens + blockTokens > maxTokens) {
      flush();
    }

    currentDiff += block;
    if (path) currentFiles.push(path);
    currentTokens += blockTokens;
  }

  flush();
  return chunks;
}
