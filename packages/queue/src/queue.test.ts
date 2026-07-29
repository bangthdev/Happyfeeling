import { afterEach, describe, expect, it } from "vitest";
import { createReviewQueue } from "./queue.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";
import { ONE_DAY_SECONDS } from "./retention.js";

describe("createReviewQueue", () => {
  const queue = createReviewQueue();

  afterEach(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("applies defaultJobOptions with attempts: 1 (no retry)", async () => {
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 42,
      baseSha: "base-abc123",
      headSha: "abc123",
    };

    const job = await queue.add(REVIEW_QUEUE_NAME, payload);

    expect(job.opts.attempts).toBe(1);
  });

  it("removes a failed job's data after 24h, freeing its jobId for redelivery", async () => {
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 44,
      baseSha: "base-ghi789",
      headSha: "ghi789",
    };

    const job = await queue.add(REVIEW_QUEUE_NAME, payload);

    expect(job.opts.removeOnFail).toEqual({ age: ONE_DAY_SECONDS });
  });

  it("removes a completed job's data after 24h (capped at 1000), to bound Redis growth", async () => {
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 45,
      baseSha: "base-jkl012",
      headSha: "jkl012",
    };

    const job = await queue.add(REVIEW_QUEUE_NAME, payload);

    expect(job.opts.removeOnComplete).toEqual({
      age: ONE_DAY_SECONDS,
      count: 1000,
    });
  });
});
