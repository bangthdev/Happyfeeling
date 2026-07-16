const IGNORED_PATH_PATTERNS = [/\.pb\.go$/, /(^|\/)vendor\//, /(^|\/)node_modules\//];

export interface ReviewContext {
  diff: string;
  files: string[];
}

export function splitDiffByFile(diff: string): string[] {
  return diff.split(/(?=^diff --git )/m).filter(Boolean);
}

export function filePathOf(block: string): string {
  const match = block.match(/^diff --git a\/(?:.+?) b\/(.+?)$/m);
  return match ? match[1] : '';
}

export function buildContext(rawDiff: string): ReviewContext {
  const fileBlocks = splitDiffByFile(rawDiff);

  const kept = fileBlocks.filter((block) => !IGNORED_PATH_PATTERNS.some((re) => re.test(filePathOf(block))));

  const files = kept.map(filePathOf).filter((path) => path !== '');

  return { diff: kept.join(''), files };
}
