import type { Job } from 'bullmq';
import type { ReviewJobPayload } from '@happyfeeling/queue';
import type { Finding, PipelineDeps, PipelineResult } from '@happyfeeling/github/pipeline';
import type { PullRequestEvent } from '@happyfeeling/github/webhook/parse';
import { computeDedupHash } from '@happyfeeling/github/review/dedup';
import { prisma } from '@happyfeeling/db';

export interface ProcessJobDeps {
  runPipeline: (event: PullRequestEvent, deps: PipelineDeps) => Promise<PipelineResult>;
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
    dedupHash: computeDedupHash(repoSlug, finding.file, finding.line),
  };
}

export async function processReviewJob(job: Job<ReviewJobPayload>, deps: ProcessJobDeps): Promise<void> {
  const { owner, repo, prNumber, headSha } = job.data;
  const event: PullRequestEvent = { owner, repo, prNumber, headSha, action: 'synchronize' };

  const { posted } = await deps.runPipeline(event, deps.pipelineDeps);

  const repoSlug = `${owner}/${repo}`;
  for (const finding of posted) {
    await prisma.finding.create({ data: toDbFinding(repoSlug, prNumber, finding) });
  }
}
