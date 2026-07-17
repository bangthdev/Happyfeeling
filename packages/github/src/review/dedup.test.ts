import { describe, it, expect } from 'vitest';
import { computeDedupHash } from './dedup.js';

describe('computeDedupHash', () => {
  it('returns the same hash for the same repo/filePath/line', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    expect(a).toBe(b);
  });

  it('returns a different hash when the line differs', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/widgets', 'src/x.ts', 11);
    expect(a).not.toBe(b);
  });

  it('returns a different hash when the file path differs', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/widgets', 'src/y.ts', 10);
    expect(a).not.toBe(b);
  });

  it('returns a different hash when the repo differs', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/other', 'src/x.ts', 10);
    expect(a).not.toBe(b);
  });
});
