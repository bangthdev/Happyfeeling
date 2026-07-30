import type { Job } from "bullmq";
import type { ReviewJobPayload } from "@b3-review/queue";
import type {
  Finding,
  PipelineDeps,
  PipelineResult,
} from "@b3-review/github/pipeline";
import type { PullRequestEvent } from "@b3-review/github/webhook/parse";
import { computeDedupHash } from "@b3-review/github/review/dedup";
import { prisma } from "@b3-review/db";

export interface ProcessJobDeps {
  runPipeline: (
    event: PullRequestEvent,
    deps: PipelineDeps,
  ) => Promise<PipelineResult>;
  pipelineDeps: PipelineDeps;
}

function toDbFinding(repoSlug: string, prNumber: number, finding: Finding) {
  return {
    repo: repoSlug,
    prNumber,
    filePath: finding.file,
    line: finding.line,
    errorType: finding.severity,
    message: finding.message,
    dedupHash: computeDedupHash(
      repoSlug,
      prNumber,
      finding.file,
      finding.line,
      finding.codeSnippet ?? "",
    ),
  };
}

// Persists one finding right after it's posted (wired into
// PipelineDeps.persistFinding) — narrows the window between a finding
// landing on GitHub and it being recorded, versus only ever persisting in
// one bulk write after the entire batch finishes. This is the only place a
// posted finding gets written to the DB — processReviewJob itself does not
// persist anything, to avoid writing the same finding twice.
export async function persistFinding(
  repoSlug: string,
  prNumber: number,
  finding: Finding,
): Promise<void> {
  // filterNewFindings already excludes findings seen before this call, so a
  // dedupHash collision here means something unexpected raced this write
  // (e.g. two workers processing overlapping jobs) — worth surfacing.
  const { count } = await prisma.finding.createMany({
    data: [toDbFinding(repoSlug, prNumber, finding)],
    skipDuplicates: true,
  });
  if (count === 0) {
    console.error(
      `PR #${prNumber}: skipped persisting a finding — dedupHash already existed (e.g. two workers racing on overlapping jobs)`,
    );
  }
}

export async function processReviewJob(
  job: Job<ReviewJobPayload>,
  deps: ProcessJobDeps,
): Promise<void> {
  const { owner, repo, prNumber, baseSha, headSha } = job.data;
  if (!baseSha) {
    // A queued job's payload may predate the current schema, or come from a
    // producer bug — either way, processing it would hit GitHub's compare
    // API with a literal "undefined" SHA. Fail loudly instead of silently
    // mangling the request; a subsequent push to this PR enqueues a fresh
    // job with the field populated. This guard stays permanently — baseSha
    // is a required field going forward.
    throw new Error(`PR #${prNumber}: job is missing baseSha — skipping`);
  }
  const event: PullRequestEvent = {
    owner,
    repo,
    prNumber,
    baseSha,
    headSha,
    action: "synchronize",
  };

  await deps.runPipeline(event, deps.pipelineDeps);
}
