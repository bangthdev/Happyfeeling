import type { Job } from "bullmq";
import type { ReviewJobPayload } from "@happyfeeling/queue";
import type {
  Finding,
  PipelineDeps,
  PipelineResult,
} from "@happyfeeling/github/pipeline";
import { PartialPostError } from "@happyfeeling/github/pipeline";
import type { PullRequestEvent } from "@happyfeeling/github/webhook/parse";
import { computeDedupHash } from "@happyfeeling/github/review/dedup";
import { prisma } from "@happyfeeling/db";

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
    dedupHash: computeDedupHash(repoSlug, prNumber, finding.file, finding.line),
  };
}

async function persistFindings(
  repoSlug: string,
  prNumber: number,
  findings: Finding[],
): Promise<void> {
  if (findings.length === 0) return;
  // Real dedup happens upstream in the pipeline (filterNewFindings) before a finding
  // ever reaches here. skipDuplicates only guards against a duplicate DB row (e.g. two
  // workers racing on overlapping jobs) — it does not prevent a duplicate GitHub comment,
  // since posting already happened earlier in the pipeline by the time this code runs.
  const { count } = await prisma.finding.createMany({
    data: findings.map((finding) => toDbFinding(repoSlug, prNumber, finding)),
    skipDuplicates: true,
  });
  if (count < findings.length) {
    console.error(
      `PR #${prNumber}: persisted ${count} of ${findings.length} finding(s) — ${findings.length - count} skipped (dedupHash already existed)`,
    );
  }
}

export async function processReviewJob(
  job: Job<ReviewJobPayload>,
  deps: ProcessJobDeps,
): Promise<void> {
  const { owner, repo, prNumber, headSha } = job.data;
  const event: PullRequestEvent = {
    owner,
    repo,
    prNumber,
    headSha,
    action: "synchronize",
  };
  const repoSlug = `${owner}/${repo}`;

  try {
    const { posted } = await deps.runPipeline(event, deps.pipelineDeps);
    await persistFindings(repoSlug, prNumber, posted);
  } catch (err) {
    if (err instanceof PartialPostError) {
      try {
        await persistFindings(repoSlug, prNumber, err.posted);
      } catch (persistErr) {
        console.error(
          `PR #${prNumber}: failed to persist the ${err.posted.length} finding(s) already posted before a partial-post failure`,
          persistErr,
        );
      }
    }
    throw err;
  }
}
