import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedisConnection } from './connection.js';
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from './types.js';

export function createReviewWorker(
  processor: (job: Job<ReviewJobPayload>) => Promise<void>,
  connection: Redis = createRedisConnection(),
): Worker<ReviewJobPayload> {
  return new Worker<ReviewJobPayload>(REVIEW_QUEUE_NAME, processor, {
    connection,
  });
}
