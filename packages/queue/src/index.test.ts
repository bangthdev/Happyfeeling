import { describe, expect, it } from "vitest";
import {
  REVIEW_QUEUE_NAME,
  createReviewQueue,
  createReviewWorker,
} from "./index.js";

describe("package barrel export", () => {
  it("exposes REVIEW_QUEUE_NAME, createReviewQueue, createReviewWorker", () => {
    expect(REVIEW_QUEUE_NAME).toBe("review");
    expect(typeof createReviewQueue).toBe("function");
    expect(typeof createReviewWorker).toBe("function");
  });
});
