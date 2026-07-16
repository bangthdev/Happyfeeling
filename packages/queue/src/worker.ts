import { Worker, type Job } from 'bullmq';
import { createRedisConnection } from './connection.js';
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from './types.js';

export function createReviewWorker(
  processor: (job: Job<ReviewJobPayload>) => Promise<void>,
): Worker<ReviewJobPayload> {
  return new Worker<ReviewJobPayload>(REVIEW_QUEUE_NAME, processor, {
    connection: createRedisConnection(),
  });
}
