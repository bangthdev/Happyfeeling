import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { createRedisConnection } from "./connection.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";
import { ONE_DAY_SECONDS } from "./retention.js";

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
      // Without this, a failed job's jobId stays in Redis forever — since the
      // add-job dedup check is a flat "does this jobId exist" (regardless of
      // state), any later legitimate redelivery for the same PR/commit would
      // silently no-op, permanently losing that review. 24h gives a window to
      // investigate a failure before its jobId frees up again.
      removeOnFail: { age: ONE_DAY_SECONDS },
      removeOnComplete: { age: ONE_DAY_SECONDS, count: 1000 },
    },
  });
}
