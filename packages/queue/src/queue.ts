import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedisConnection } from './connection.js';
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from './types.js';

export function createReviewQueue(
  connection: Redis = createRedisConnection(),
): Queue<ReviewJobPayload> {
  return new Queue<ReviewJobPayload>(REVIEW_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // No retry: postFindings has no idempotency check against existing PR
      // comments, so retrying a partially-failed job re-posts every finding,
      // including ones already on the PR from the first attempt.
      attempts: 1,
    },
  });
}
