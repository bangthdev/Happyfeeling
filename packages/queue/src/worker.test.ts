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

  it('retries up to 3 attempts before completing (defaultJobOptions.attempts)', async () => {
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
      if (callCount < 3) {
        throw new Error('transient failure');
      }
    });

    const completed = new Promise<void>((resolve) => {
      worker!.on('completed', () => resolve());
    });

    // backoff ngắn (100ms) chỉ để test chạy nhanh — attempts vẫn lấy từ
    // defaultJobOptions của queue (không override ở đây), nên vẫn đang test
    // đúng field attempts: 3 của Task 3.
    await queue.add(REVIEW_QUEUE_NAME, payload, {
      backoff: { type: 'exponential', delay: 100 },
    });
    await completed;

    expect(callCount).toBe(3);
  });
});
