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
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
}
