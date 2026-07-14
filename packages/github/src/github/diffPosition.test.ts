import { describe, it, expect } from 'vitest';
import { mapLineToDiffPosition } from './diffPosition.js';

const SINGLE_HUNK_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
 line1
 line2
+line3-new
 line3
 line4
`;

const TWO_HUNK_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 a
-b
+bb
 c
@@ -10,2 +10,3 @@
 x
+y
 z
`;

describe('mapLineToDiffPosition', () => {
  it('maps an added line to its diff position', () => {
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, 'src/foo.ts', 3)).toBe(4);
  });

  it('maps context lines to their diff position', () => {
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, 'src/foo.ts', 1)).toBe(2);
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, 'src/foo.ts', 4)).toBe(5);
  });

  it('keeps counting position across multiple hunks in the same file', () => {
    expect(mapLineToDiffPosition(TWO_HUNK_DIFF, 'src/foo.ts', 11)).toBe(8);
  });

  it('returns null when the file is not in the diff', () => {
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, 'src/other.ts', 1)).toBeNull();
  });

  it('returns null when the target line is not present in the diff', () => {
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, 'src/foo.ts', 999)).toBeNull();
  });
});
