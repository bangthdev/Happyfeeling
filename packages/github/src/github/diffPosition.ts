interface FileDiff {
  path: string;
  lines: string[];
}

function splitDiffByFile(diffText: string): FileDiff[] {
  const fileBlocks = diffText.split(/^diff --git .*$/m).slice(1);
  const paths = [...diffText.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)].map((m) => m[2]);

  return fileBlocks.map((block, i) => {
    const bodyStart = block.indexOf('\n@@');
    const body = bodyStart === -1 ? '' : block.slice(bodyStart + 1);
    return { path: paths[i], lines: body.length ? body.split('\n') : [] };
  });
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function mapLineToDiffPosition(diffText: string, filePath: string, targetLine: number): number | null {
  const file = splitDiffByFile(diffText).find((f) => f.path === filePath);
  if (!file) return null;

  let position = 0;
  let newLine = 0;

  for (const line of file.lines) {
    if (line === '') continue;

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      position += 1;
      newLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    position += 1;
    if (line.startsWith('+') || line.startsWith(' ')) {
      newLine += 1;
      if (newLine === targetLine) return position;
    }
    // lines starting with '-' are removed lines: they don't exist in the
    // new file, so they don't advance newLine and can't be a match target.
  }

  return null;
}
