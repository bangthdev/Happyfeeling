import { afterEach, describe, expect, it } from 'vitest';
import { createReviewQueue, createReviewWorker, REVIEW_QUEUE_NAME } from '@happyfeeling/queue';
import { prisma } from '@happyfeeling/db';
import { processReviewJob } from './processJob.js';

describe('worker (real Redis + real Postgres)', () => {
  let queue: ReturnType<typeof createReviewQueue> | undefined;
  let worker: ReturnType<typeof createReviewWorker> | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    await prisma.finding.deleteMany({ where: { repo: 'acme/integration-test' } });
  });

  it('picks up an enqueued job and writes exactly one Finding row', async () => {
    queue = createReviewQueue();
    const posted = [
      { file: 'src/x.ts', line: 5, severity: 'medium' as const, message: 'msg', suggestion: 'sugg' },
    ];
    const runPipeline = async () => ({ posted });

    worker = createReviewWorker((job) =>
      processReviewJob(job, { runPipeline, pipelineDeps: { getToken: async () => 'tok', groqApiKey: 'k' } })
    );

    const completed = new Promise<void>((resolve) => {
      worker!.on('completed', () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, {
      owner: 'acme',
      repo: 'integration-test',
      prNumber: 1,
      headSha: 'sha1',
    });
    await completed;

    const rows = await prisma.finding.findMany({ where: { repo: 'acme/integration-test' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ filePath: 'src/x.ts', line: 5, errorType: 'medium', message: 'msg' });
  });
});
