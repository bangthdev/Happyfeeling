import { Queue } from 'bullmq';
import { createRedisConnection } from './connection.js';
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from './types.js';

export function createReviewQueue(): Queue<ReviewJobPayload> {
  return new Queue<ReviewJobPayload>(REVIEW_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
}
