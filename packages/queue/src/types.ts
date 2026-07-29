export const REVIEW_QUEUE_NAME = "review";

export interface ReviewJobPayload {
  owner: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
}
