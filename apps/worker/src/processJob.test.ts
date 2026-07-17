import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ReviewJobPayload } from '@happyfeeling/queue';

vi.mock('@happyfeeling/db', () => ({
  prisma: { finding: { create: vi.fn() } },
}));

import { prisma } from '@happyfeeling/db';
import { processReviewJob } from './processJob.js';

function fakeJob(data: ReviewJobPayload): Job<ReviewJobPayload> {
  return { data } as Job<ReviewJobPayload>;
}

describe('processReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runPipeline with an event built from the job payload', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = { getToken: vi.fn(), groqApiKey: 'fake-key' };

    await processReviewJob(
      fakeJob({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' }),
      { runPipeline, pipelineDeps }
    );

    expect(runPipeline).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1', action: 'synchronize' },
      pipelineDeps
    );
  });

  it('writes one Finding row per posted finding', async () => {
    const posted = [
      { file: 'src/x.ts', line: 10, severity: 'high' as const, message: 'bug here', suggestion: 'fix it' },
    ];
    const runPipeline = vi.fn().mockResolvedValue({ posted });
    const pipelineDeps = { getToken: vi.fn(), groqApiKey: 'fake-key' };

    await processReviewJob(
      fakeJob({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' }),
      { runPipeline, pipelineDeps }
    );

    expect(prisma.finding.create).toHaveBeenCalledTimes(1);
    expect(prisma.finding.create).toHaveBeenCalledWith({
      data: {
        repo: 'acme/widgets',
        prNumber: 7,
        filePath: 'src/x.ts',
        line: 10,
        errorType: 'high',
        message: 'bug here',
        dedupHash: expect.any(String),
      },
    });
  });

  it('writes no rows when nothing was posted', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = { getToken: vi.fn(), groqApiKey: 'fake-key' };

    await processReviewJob(
      fakeJob({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' }),
      { runPipeline, pipelineDeps }
    );

    expect(prisma.finding.create).not.toHaveBeenCalled();
  });
});
