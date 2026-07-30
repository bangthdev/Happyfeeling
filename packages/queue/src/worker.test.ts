import { afterEach, describe, expect, it } from "vitest";
import { createReviewQueue } from "./queue.js";
import { createReviewWorker } from "./worker.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";
import { createRedisConnection } from "./connection.js";

// Isolated onto its own queue name — see queue.test.ts for why.
const TEST_QUEUE_NAME = "review-worker-test";

describe("createReviewWorker", () => {
  let queue: ReturnType<typeof createReviewQueue> | undefined;
  let worker: ReturnType<typeof createReviewWorker> | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
  });

  it("receives the job added to the queue", async () => {
    queue = createReviewQueue(createRedisConnection(), TEST_QUEUE_NAME);
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 42,
      baseSha: "base-abc123",
      headSha: "abc123",
    };
    let receivedPayload: ReviewJobPayload | undefined;

    worker = createReviewWorker(
      async (job) => {
        receivedPayload = job.data;
      },
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );

    const completed = new Promise<void>((resolve) => {
      worker!.on("completed", () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, payload);
    await completed;

    expect(receivedPayload).toEqual(payload);
  });

  it("disables stalled-job recovery (maxStalledCount: 0)", () => {
    queue = createReviewQueue(createRedisConnection(), TEST_QUEUE_NAME);
    worker = createReviewWorker(
      async () => {},
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );

    // Default BullMQ behavior retries a stalled job once (worker died mid-job,
    // e.g. crash/OOM/redeploy) regardless of attempts: 1 — that retry would
    // re-post every finding since postFindings has no idempotency check.
    // maxStalledCount: 0 makes a stalled job fail immediately instead.
    expect(worker.opts.maxStalledCount).toBe(0);
  });

  it("uses a generous lockDuration so a brief Redis blip isn't mistaken for a dead worker", () => {
    queue = createReviewQueue(createRedisConnection(), TEST_QUEUE_NAME);
    worker = createReviewWorker(
      async () => {},
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );

    // With maxStalledCount: 0, a job is failed permanently (no retry) the
    // moment it's considered stalled. The default lockDuration (30s) would
    // make a single missed lock renewal — a transient Redis network blip,
    // not necessarily a dead worker — permanently drop that review. A longer
    // window gives a renewal retry time to succeed before that happens.
    expect(worker.opts.lockDuration).toBe(15 * 60 * 1000);
  });

  it("does not retry a failed job (defaultJobOptions.attempts: 1)", async () => {
    queue = createReviewQueue(createRedisConnection(), TEST_QUEUE_NAME);
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 43,
      baseSha: "base-def456",
      headSha: "def456",
    };
    let callCount = 0;

    worker = createReviewWorker(
      async () => {
        callCount++;
        throw new Error("permanent failure");
      },
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );

    const failed = new Promise<void>((resolve) => {
      worker!.on("failed", () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, payload);
    await failed;

    expect(callCount).toBe(1);
  });
});
