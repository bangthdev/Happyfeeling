import type { Queue } from "bullmq";
import { ONE_DAY_SECONDS } from "./retention.js";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CLEAN_BATCH_LIMIT = 1000;
const CLEANABLE_STATES = ["failed", "completed"] as const;

async function sweep(queue: Queue): Promise<void> {
  await Promise.all(
    CLEANABLE_STATES.map((state) =>
      queue.clean(ONE_DAY_SECONDS * 1000, CLEAN_BATCH_LIMIT, state),
    ),
  );
}

// removeOnFail/removeOnComplete's age-based eviction is lazy — BullMQ only
// evaluates it when another job of the same disposition finishes afterward,
// so in a low-traffic queue a single failed job's jobId can otherwise block
// redelivery forever. This runs an active sweep on a timer so cleanup
// doesn't depend on queue traffic. Returns a function that stops the sweep.
export function startQueueCleanup(
  queue: Queue,
  intervalMs: number = CLEANUP_INTERVAL_MS,
): () => void {
  const run = (): void => {
    sweep(queue).catch((err: unknown) => {
      console.error("Queue cleanup sweep failed:", err);
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  // A short-lived caller (an admin script, a one-off cleanup CLI) that forgets
  // to call the returned stop() shouldn't have this timer alone keep the
  // process from exiting.
  timer.unref();
  return () => clearInterval(timer);
}
