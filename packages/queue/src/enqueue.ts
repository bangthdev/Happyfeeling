import type { Queue } from "bullmq";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";

// BullMQ's jobId dedup is state-blind: while a job with that id exists in any
// state, add() silently no-ops. So a failed job still sitting inside
// removeOnFail's retention window swallows a manual webhook redelivery — the
// only recovery path left once GitHub has already had its 202 and won't retry.
// Clearing just the failed job keeps that window open for investigating the
// failure; a job in any other state is a genuine duplicate and must still
// no-op, including an active one that a remove() would cut off mid-review.
export async function enqueueReviewJob(
  queue: Queue<ReviewJobPayload>,
  jobId: string,
  payload: ReviewJobPayload,
): Promise<void> {
  const existing = await queue.getJob(jobId);
  if (existing && (await existing.isFailed())) {
    try {
      await existing.remove();
    } catch {
      // The periodic cleanup sweep can remove it first, which is the state
      // this wanted anyway. Falling through to add() is right either way: if
      // the job somehow does still exist, add() no-ops as it always did.
    }
  }

  await queue.add(REVIEW_QUEUE_NAME, payload, { jobId });
}
