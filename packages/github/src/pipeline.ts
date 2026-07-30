import { getPullRequestDiff } from "./github/client.js";
import { buildContext } from "./review/contextBuilder.js";
import {
  reviewDiff,
  PartialReviewError,
} from "./review/llmReviewer.openrouter.js";
import type { Finding } from "./review/llmReviewer.js";
import { postFindings } from "./review/commentPoster.js";
import { logMetrics } from "./logger.js";
import type { PullRequestEvent } from "./webhook/parse.js";

export type { Finding };

export interface PipelineDeps {
  getToken: () => Promise<string>;
  openrouterApiKey: string;
  filterNewFindings: (
    repo: string,
    prNumber: number,
    findings: Finding[],
  ) => Promise<Finding[]>;
  // Called right after each finding is posted to GitHub, before the next one
  // is posted — lets a caller persist it immediately instead of only in one
  // bulk write after the whole batch finishes, narrowing the window where a
  // crash between posting and persisting could cause a finding to be
  // re-posted on a later retry. Optional: callers with no dedup store to
  // persist to (see passthroughFilterNewFindings) can omit it.
  persistFinding?: (
    repo: string,
    prNumber: number,
    finding: Finding,
  ) => Promise<void>;
}

// For callers with no dedup store to check against (e.g. a deployment with no database).
export const passthroughFilterNewFindings: PipelineDeps["filterNewFindings"] =
  async (_repo, _prNumber, findings) => findings;

export interface PipelineResult {
  posted: Finding[];
}

export class PartialPostError extends Error {
  constructor(
    message: string,
    public readonly posted: Finding[],
  ) {
    super(message);
    this.name = "PartialPostError";
  }
}

export class PersistFailedError extends Error {
  constructor(
    message: string,
    public readonly posted: Finding[],
  ) {
    super(message);
    this.name = "PersistFailedError";
  }
}

export async function runReviewPipeline(
  event: PullRequestEvent,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const start = Date.now();

  const token = await deps.getToken();
  const rawDiff = await getPullRequestDiff(
    token,
    event.owner,
    event.repo,
    event.baseSha,
    event.headSha,
  );
  const context = buildContext(rawDiff);

  let findings: Finding[];
  let tokensUsed: number;
  let chunksSkipped = 0;
  try {
    ({ findings, tokensUsed, chunksSkipped } = await reviewDiff(
      context,
      deps.openrouterApiKey,
    ));
  } catch (err) {
    if (!(err instanceof PartialReviewError)) throw err;
    ({ findings, tokensUsed, chunksSkipped } = err.partialResult);
    console.error(
      `PR #${event.prNumber}: OpenRouter review failed partway through — posting the ${findings.length} finding(s) already collected instead of discarding them`,
      err.cause,
    );
  }

  const newFindings = await deps.filterNewFindings(
    `${event.owner}/${event.repo}`,
    event.prNumber,
    findings,
  );

  const { posted, skipped, failed, persistFailed } = await postFindings({
    token,
    owner: event.owner,
    repo: event.repo,
    prNumber: event.prNumber,
    commitSha: event.headSha,
    findings: newFindings,
    onPosted: deps.persistFinding
      ? (finding) =>
          deps.persistFinding!(
            `${event.owner}/${event.repo}`,
            event.prNumber,
            finding,
          )
      : undefined,
  });

  const severityBreakdown: Record<string, number> = {};
  for (const finding of posted) {
    severityBreakdown[finding.severity] =
      (severityBreakdown[finding.severity] ?? 0) + 1;
  }

  logMetrics({
    pr_number: event.prNumber,
    findings_count: posted.length,
    skipped_count: skipped,
    chunks_skipped: chunksSkipped,
    severity_breakdown: severityBreakdown,
    latency_ms: Date.now() - start,
    tokens_used: tokensUsed,
  });

  if (failed.length > 0) {
    const attempted = posted.length + failed.length;
    throw new PartialPostError(
      `Failed to post ${failed.length} of ${attempted} finding(s) for PR #${event.prNumber}`,
      posted,
    );
  }

  if (persistFailed.length > 0) {
    // These findings are live on GitHub but not recorded — letting the job
    // complete "successfully" here would mean a later push silently re-posts
    // them, since filterNewFindings has no DB record to dedup against.
    throw new PersistFailedError(
      `Posted ${posted.length} finding(s) for PR #${event.prNumber} but failed to persist ${persistFailed.length} of them`,
      posted,
    );
  }

  return { posted };
}
