// How long a failed/completed job's data is kept in Redis before it's
// eligible for cleanup — used by both defaultJobOptions (queue.ts) and the
// periodic sweep (cleanup.ts) so the two stay in sync.
export const ONE_DAY_SECONDS = 24 * 60 * 60;
