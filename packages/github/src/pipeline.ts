import { getPullRequestDiff } from './github/client.js';
import { buildContext } from './review/contextBuilder.js';
// TEMP: swapped from './review/llmReviewer.js' (Claude) to test free via Groq.
// To revert: import reviewDiff from llmReviewer.js again and change
// PipelineDeps.groqApiKey back to anthropicClient: Anthropic.
import { reviewDiff } from './review/llmReviewer.groq.js';
import { postFindings } from './review/commentPoster.js';
import { logMetrics } from './logger.js';
import type { PullRequestEvent } from './webhook/parse.js';

export interface PipelineDeps {
  getToken: () => Promise<string>;
  groqApiKey: string;
}

export async function runReviewPipeline(event: PullRequestEvent, deps: PipelineDeps): Promise<void> {
  const start = Date.now();

  const token = await deps.getToken();
  const rawDiff = await getPullRequestDiff(token, event.owner, event.repo, event.prNumber);
  const context = buildContext(rawDiff);
  const { findings, tokensUsed } = await reviewDiff(context, deps.groqApiKey);

  const { posted, failed } = await postFindings({
    token,
    owner: event.owner,
    repo: event.repo,
    prNumber: event.prNumber,
    commitSha: event.headSha,
    findings,
  });

  const severityBreakdown: Record<string, number> = {};
  for (const finding of findings) {
    severityBreakdown[finding.severity] = (severityBreakdown[finding.severity] ?? 0) + 1;
  }

  logMetrics({
    pr_number: event.prNumber,
    findings_count: posted.length,
    severity_breakdown: severityBreakdown,
    latency_ms: Date.now() - start,
    tokens_used: tokensUsed,
  });

  if (failed.length > 0) {
    const attempted = posted.length + failed.length;
    throw new Error(`Failed to post ${failed.length} of ${attempted} finding(s) for PR #${event.prNumber}`);
  }
}
