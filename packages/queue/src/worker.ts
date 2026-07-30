import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { createRedisConnection } from "./connection.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";

export function createReviewWorker(
  processor: (job: Job<ReviewJobPayload>) => Promise<void>,
  connection: Redis = createRedisConnection(),
  // Override only exists so tests can isolate themselves onto a distinct
  // real Redis queue instead of colliding on REVIEW_QUEUE_NAME — production
  // callers never pass this.
  queueName: string = REVIEW_QUEUE_NAME,
): Worker<ReviewJobPayload> {
  return new Worker<ReviewJobPayload>(queueName, processor, {
    connection,
    // A stalled job (worker crashed/OOM'd/redeployed mid-job) would otherwise
    // be retried once by BullMQ regardless of defaultJobOptions.attempts: 1,
    // re-posting every finding since postFindings has no idempotency check.
    maxStalledCount: 0,
    // maxStalledCount: 0 fails a job the moment its lock isn't renewed in
    // time — with the 30s default that includes a single transient Redis
    // blip, not just a genuinely dead worker. A generous window gives a
    // renewal retry a chance to succeed first, while still catching a truly
    // dead worker well within the removeOnFail retention window. 15 minutes
    // comfortably covers today's worst case (MAX_CHUNKS=10 chunks *
    // REQUEST_TIMEOUT_MS=60s in llmReviewer.openrouter.ts, plus retries) —
    // if either of those grow enough to approach 15 minutes, this needs
    // raising too.
    lockDuration: 15 * 60 * 1000,
  });
}
