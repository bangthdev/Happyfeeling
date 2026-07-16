import type { ReviewContext } from './contextBuilder.js';

const TOKEN_CHAR_RATIO = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

function filePathOf(block: string): string {
  const match = block.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
  return match ? match[2] : '';
}

function splitBlockByHunk(block: string, maxTokens: number): string[] {
  const firstHunkIndex = block.search(/^@@ /m);
  if (firstHunkIndex === -1) return [block];

  const header = block.slice(0, firstHunkIndex);
  const hunks = block.slice(firstHunkIndex).split(/(?=^@@ )/m).filter(Boolean);

  const pieces: string[] = [];
  let current = header;
  let hasHunk = false;

  for (const hunk of hunks) {
    if (!hasHunk) {
      current += hunk;
      hasHunk = true;
      continue;
    }
    const candidate = current + hunk;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
    } else {
      pieces.push(current);
      current = hunk;
    }
  }
  pieces.push(current);
  return pieces;
}

export function chunkDiff(diff: string, maxTokens: number): ReviewContext[] {
  if (!diff) return [];

  const blocks = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const chunks: ReviewContext[] = [];

  let currentDiff = '';
  let currentFiles: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (currentDiff) chunks.push({ diff: currentDiff, files: currentFiles });
    currentDiff = '';
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
