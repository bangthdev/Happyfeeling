import { afterEach, describe, expect, it } from 'vitest';
import { createReviewQueue } from './queue.js';
import { createReviewWorker } from './worker.js';
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from './types.js';

describe('createReviewWorker', () => {
  let queue: ReturnType<typeof createReviewQueue> | undefined;
  let worker: ReturnType<typeof createReviewWorker> | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
  });

  it('receives the job added to the queue', async () => {
    queue = createReviewQueue();
    const payload: ReviewJobPayload = {
      owner: 'octo',
      repo: 'hello-world',
      prNumber: 42,
      headSha: 'abc123',
    };
    let receivedPayload: ReviewJobPayload | undefined;

    worker = createReviewWorker(async (job) => {
      receivedPayload = job.data;
    });

    const completed = new Promise<void>((resolve) => {
      worker!.on('completed', () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, payload);
    await completed;

    expect(receivedPayload).toEqual(payload);
  });

  it('does not retry a failed job (defaultJobOptions.attempts: 1)', async () => {
    queue = createReviewQueue();
    const payload: ReviewJobPayload = {
      owner: 'octo',
      repo: 'hello-world',
      prNumber: 43,
      headSha: 'def456',
    };
    let callCount = 0;

    worker = createReviewWorker(async () => {
      callCount++;
      throw new Error('permanent failure');
    });

    const failed = new Promise<void>((resolve) => {
      worker!.on('failed', () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, payload);
    await failed;

    expect(callCount).toBe(1);
  });
});
