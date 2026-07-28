import { createReviewQueue, type ReviewJobPayload } from "@happyfeeling/queue";
import type { Queue } from "bullmq";
import "./config";

export const reviewQueue: Queue<ReviewJobPayload> = createReviewQueue();
