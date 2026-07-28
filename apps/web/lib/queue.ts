import { createReviewQueue, type ReviewJobPayload } from "@b3-review/queue";
import type { Queue } from "bullmq";
import "./config";

export const reviewQueue: Queue<ReviewJobPayload> = createReviewQueue();
