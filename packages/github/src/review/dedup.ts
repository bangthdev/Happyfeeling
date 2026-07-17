import { createHash } from 'node:crypto';

export function computeDedupHash(repo: string, filePath: string, line: number): string {
  return createHash('sha256').update(`${repo}:${filePath}:${line}`).digest('hex');
}
