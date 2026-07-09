import type Anthropic from '@anthropic-ai/sdk';
import { getPullRequestDiff } from './github/client.js';
import { buildContext } from './review/contextBuilder.js';
import { reviewDiff } from './review/llmReviewer.js';
import { postFindings } from './review/commentPoster.js';
import { logMetrics } from './logger.js';
import type { PullRequestEvent } from './webhook/parse.js';

export interface PipelineDeps {
  getToken: () => Promise<string>;
  anthropicClient: Anthropic;
}

export async function runReviewPipeline(event: PullRequestEvent, deps: PipelineDeps): Promise<void> {
  const start = Date.now();

  const token = await deps.getToken();
  const rawDiff = await getPullRequestDiff(token, event.owner, event.repo, event.prNumber);
  const context = buildContext(rawDiff);
  const { findings, tokensUsed } = await reviewDiff(context, deps.anthropicClient);

  const { posted } = await postFindings({
    token,
    owner: event.owner,
    repo: event.repo,
    prNumber: event.prNumber,
    commitSha: event.headSha,
    diff: context.diff,
    findings,
  });

  const severityBreakdown: Record<string, number> = {};
  for (const finding of findings) {
    severityBreakdown[finding.severity] = (severityBreakdown[finding.severity] ?? 0) + 1;
  }

  logMetrics({
    pr_number: event.prNumber,
    findings_count: posted,
    severity_breakdown: severityBreakdown,
    latency_ms: Date.now() - start,
    tokens_used: tokensUsed,
  });
}
