import { describe, it, expect, vi } from 'vitest';
import type { PullRequestEvent } from './webhook/parse.js';

vi.mock('./github/client.js', () => ({ getPullRequestDiff: vi.fn() }));
vi.mock('./review/commentPoster.js', () => ({ postFindings: vi.fn() }));
vi.mock('./review/llmReviewer.groq.js', () => ({ reviewDiff: vi.fn() }));
vi.mock('./logger.js', () => ({ logMetrics: vi.fn() }));

import { getPullRequestDiff } from './github/client.js';
import { postFindings } from './review/commentPoster.js';
import { reviewDiff } from './review/llmReviewer.groq.js';
import { logMetrics } from './logger.js';
import { runReviewPipeline } from './pipeline.js';

describe('runReviewPipeline', () => {
  it('orchestrates diff fetch, review, comment posting, and metrics logging', async () => {
    const event: PullRequestEvent = {
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      headSha: 'sha1',
      action: 'opened',
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue('diff --git a/src/x.ts b/src/x.ts\n...');
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [{ file: 'src/x.ts', line: 1, severity: 'high', message: 'm', suggestion: 's' }],
      tokensUsed: 300,
    });
    vi.mocked(postFindings).mockResolvedValue({ posted: 1, skipped: 0 });

    const getToken = vi.fn().mockResolvedValue('tok');

    await runReviewPipeline(event, { getToken, groqApiKey: 'fake-groq-key' });

    expect(getPullRequestDiff).toHaveBeenCalledWith('tok', 'acme', 'widgets', 7);
    expect(postFindings).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'widgets', prNumber: 7, commitSha: 'sha1' })
    );
    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ pr_number: 7, findings_count: 1, tokens_used: 300, severity_breakdown: { high: 1 } })
    );
  });
});
