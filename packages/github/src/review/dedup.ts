import { createHash } from "node:crypto";

export function computeDedupHash(
  repo: string,
  prNumber: number,
  filePath: string,
  line: number,
  codeSnippet: string,
): string {
  return createHash("sha256")
    .update(`${repo}:${prNumber}:${filePath}:${line}:${codeSnippet}`)
    .digest("hex");
}
