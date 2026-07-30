const IGNORED_PATH_PATTERNS = [
  /\.pb\.go$/,
  /(^|\/)vendor\//,
  /(^|\/)node_modules\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
];

export interface ReviewContext {
  diff: string;
  files: string[];
}

export function splitDiffByFile(diff: string): string[] {
  return diff.split(/(?=^diff --git )/m).filter(Boolean);
}

// Git C-style-quotes a header path — wrapping it in double quotes and
// escaping any byte outside the safe printable-ASCII range, which by default
// (core.quotePath=true) includes every non-ASCII filename. It decides that
// per path, so the a/ and b/ sides are quoted independently: a rename that
// crosses the ASCII boundary quotes only one of the two. Only the b/ (new)
// path is captured; the a/ side is matched loosely because it is never used.
const DIFF_HEADER =
  /^diff --git (?:"a\/(?:[^"\\]|\\.)*"|a\/.+?) (?:"b\/((?:[^"\\]|\\.)*)"|b\/(.+?))$/m;

// Bytes git writes as a mnemonic escape rather than as \NNN octal.
const ESCAPED_BYTES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

// fatal so an undecodable path raises instead of silently becoming U+FFFD,
// which would otherwise flow on into finding paths and GitHub API calls.
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function filePathOf(block: string): string {
  const match = block.match(DIFF_HEADER);
  if (!match) return "";

  const [, quotedPath, plainPath] = match;
  if (plainPath !== undefined) return plainPath;

  try {
    return decodeGitQuotedPath(quotedPath);
  } catch {
    // Same "" an unparseable header yields — callers already treat that as
    // unresolvable and drop the finding rather than posting to a bad path.
    return "";
  }
}

// Reverses git's C-style quoting. Escapes decode to raw bytes, and a run of
// them has to be decoded as UTF-8 together since one non-ASCII character
// spans several; an unescaped character is already a correctly-formed JS
// string character and is appended as-is rather than reread as a byte.
function decodeGitQuotedPath(raw: string): string {
  let result = "";
  let byteRun: number[] = [];

  const flushByteRun = () => {
    if (byteRun.length === 0) return;
    result += UTF8_DECODER.decode(new Uint8Array(byteRun));
    byteRun = [];
  };

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      const octal = raw.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(octal)) {
        byteRun.push(parseInt(octal, 8));
        i += 3;
        continue;
      }
      const escaped = ESCAPED_BYTES[raw[i + 1]];
      if (escaped !== undefined) {
        byteRun.push(escaped);
        i += 1;
        continue;
      }
    }
    flushByteRun();
    result += raw[i];
  }
  flushByteRun();

  return result;
}

export function buildContext(rawDiff: string): ReviewContext {
  const parsed = splitDiffByFile(rawDiff).map((block) => ({
    block,
    path: filePathOf(block),
  }));

  const kept = parsed.filter(
    ({ path }) => !IGNORED_PATH_PATTERNS.some((re) => re.test(path)),
  );

  return {
    diff: kept.map(({ block }) => block).join(""),
    files: kept.map(({ path }) => path).filter((path) => path !== ""),
  };
}
