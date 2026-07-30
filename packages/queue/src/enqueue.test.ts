import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Queue, Worker } from "bullmq";
import { createReviewQueue } from "./queue.js";
import { createReviewWorker } from "./worker.js";
import { enqueueReviewJob } from "./enqueue.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";
import { createRedisConnection } from "./connection.js";

// Isolated onto its own queue name for the same reason queue.test.ts is — the
// queue test files all hit a real Redis and would otherwise race on
// REVIEW_QUEUE_NAME when their files run concurrently.
const TEST_QUEUE_NAME = "review-queue-enqueue-test";

const JOB_ID = "acme/widgets#7@sha1";
const PAYLOAD: ReviewJobPayload = {
  owner: "acme",
  repo: "widgets",
  prNumber: 7,
  baseSha: "basesha1",
  headSha: "sha1",
};

describe("enqueueReviewJob", () => {
  let queue: Queue<ReviewJobPayload>;
  let worker: Worker<ReviewJobPayload> | undefined;

  beforeEach(async () => {
    queue = createReviewQueue(createRedisConnection(), TEST_QUEUE_NAME);
    await queue.obliterate({ force: true });
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("enqueues the job when no job with the same id exists", async () => {
    await enqueueReviewJob(queue, JOB_ID, PAYLOAD);

    expect(await queue.getWaitingCount()).toBe(1);
    const [job] = await queue.getWaiting();
    expect(job.id).toBe(JOB_ID);
    expect(job.data).toEqual(PAYLOAD);
  });

  it("replaces a failed job with the same id so a manual redelivery runs again", async () => {
    worker = createReviewWorker(
      async () => {
        throw new Error("permanent failure");
      },
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );
    const failed = new Promise<void>((resolve) => {
      worker!.on("failed", () => resolve());
    });
    await queue.add(REVIEW_QUEUE_NAME, PAYLOAD, { jobId: JOB_ID });
    await failed;
    await worker.close();
    worker = undefined;
    expect(await queue.getFailedCount()).toBe(1);

    await enqueueReviewJob(queue, JOB_ID, PAYLOAD);

    expect(await queue.getFailedCount()).toBe(0);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("leaves a waiting job untouched when the same webhook is delivered twice", async () => {
    await queue.add(REVIEW_QUEUE_NAME, PAYLOAD, { jobId: JOB_ID });

    await enqueueReviewJob(queue, JOB_ID, PAYLOAD);

    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("leaves an active job untouched rather than cutting off a review in flight", async () => {
    let release: () => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    worker = createReviewWorker(
      () => {
        markStarted();
        return new Promise<void>((done) => {
          release = done;
        });
      },
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );
    await queue.add(REVIEW_QUEUE_NAME, PAYLOAD, { jobId: JOB_ID });
    await started;

    await enqueueReviewJob(queue, JOB_ID, PAYLOAD);

    expect(await queue.getActiveCount()).toBe(1);
    expect(await queue.getWaitingCount()).toBe(0);
    release();
  });

  it("does not re-review a commit whose job already completed", async () => {
    worker = createReviewWorker(
      async () => {},
      createRedisConnection(),
      TEST_QUEUE_NAME,
    );
    const completed = new Promise<void>((resolve) => {
      worker!.on("completed", () => resolve());
    });
    await queue.add(REVIEW_QUEUE_NAME, PAYLOAD, { jobId: JOB_ID });
    await completed;
    await worker.close();
    worker = undefined;
    expect(await queue.getCompletedCount()).toBe(1);

    await enqueueReviewJob(queue, JOB_ID, PAYLOAD);

    expect(await queue.getCompletedCount()).toBe(1);
    expect(await queue.getWaitingCount()).toBe(0);
  });
});
