const IGNORED_PATH_PATTERNS = [/\.pb\.go$/, /(^|\/)vendor\//, /(^|\/)node_modules\//];

export interface ReviewContext {
  diff: string;
  files: string[];
}

export function buildContext(rawDiff: string): ReviewContext {
  const fileBlocks = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);

  const kept = fileBlocks.filter((block) => {
    const match = block.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    const path = match ? match[2] : '';
    return !IGNORED_PATH_PATTERNS.some((re) => re.test(path));
  });

  const files = kept
    .map((block) => block.match(/^diff --git a\/(.+?) b\/(.+?)$/m)?.[2])
    .filter((p): p is string => Boolean(p));

  return { diff: kept.join(''), files };
}
