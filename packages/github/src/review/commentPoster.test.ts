import { describe, it, expect, vi } from 'vitest';
import { postFindings } from './commentPoster.js';
import type { Finding } from './llmReviewer.js';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
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

describe('postFindings', () => {
  it('posts mappable findings and skips unmappable ones', async () => {
    const postFn = vi.fn().mockResolvedValue(undefined);
    const findings: Finding[] = [
      { file: 'src/foo.ts', line: 3, severity: 'high', message: 'bug', suggestion: 'fix' },
      { file: 'src/foo.ts', line: 999, severity: 'low', message: 'unreachable', suggestion: 'n/a' },
    ];

    const result = await postFindings(
      { token: 'tok', owner: 'acme', repo: 'widgets', prNumber: 1, commitSha: 'sha1', diff: SAMPLE_DIFF, findings },
      postFn
    );

    expect(result).toEqual({ posted: 1, skipped: 1 });
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'src/foo.ts', position: 4 }));
  });
});
