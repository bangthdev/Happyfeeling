import { createHash } from 'node:crypto';

export function computeDedupHash(repo: string, prNumber: number, filePath: string, line: number): string {
  return createHash('sha256').update(`${repo}:${prNumber}:${filePath}:${line}`).digest('hex');
}
