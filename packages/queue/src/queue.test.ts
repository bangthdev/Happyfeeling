import { afterEach, describe, expect, it } from 'vitest';
import { createReviewQueue } from './queue.js';
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from './types.js';

describe('createReviewQueue', () => {
  const queue = createReviewQueue();

  afterEach(async () => {
    await queue.obliterate({ force: true });
  });

  it('applies defaultJobOptions with attempts: 3 and exponential backoff', async () => {
    const payload: ReviewJobPayload = {
      owner: 'octo',
      repo: 'hello-world',
      prNumber: 42,
      headSha: 'abc123',
    };

    const job = await queue.add(REVIEW_QUEUE_NAME, payload);

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });
});
