import { loadRootEnv } from "@b3-review/config";

loadRootEnv(import.meta.url);

import {
  createRedisConnection,
  createReviewQueue,
  createReviewWorker,
  startQueueCleanup,
} from "@b3-review/queue";
import { runReviewPipeline } from "@b3-review/github/pipeline";
import { createInstallationTokenProvider } from "@b3-review/github/github/auth";
import { loadConfig } from "@b3-review/github/config";
import { processReviewJob, persistFinding } from "./processJob.js";
import { filterNewFindings } from "./dedupFilter.js";

const config = loadConfig();
const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId,
);

// Shared by the worker and the cleanup queue below — BullMQ treats a
// caller-provided connection as externally owned and won't close it itself,
// so shutdown() below is responsible for it.
const connection = createRedisConnection();

const worker = createReviewWorker(
  (job) =>
    processReviewJob(job, {
      runPipeline: runReviewPipeline,
      pipelineDeps: {
        getToken: () => tokenProvider.getToken(),
        openrouterApiKey: config.openrouterApiKey,
        filterNewFindings,
        persistFinding,
      },
    }),
  connection,
);

// removeOnFail/removeOnComplete only evict lazily (on the next job of the
// same disposition) — this active sweep keeps a low-traffic queue from
// leaving a single failed job's jobId stuck forever, blocking redelivery.
const cleanupQueue = createReviewQueue(connection);
const stopQueueCleanup = startQueueCleanup(cleanupQueue);

// Without this, a redeploy that sends SIGTERM just kills the process
// mid-job — the job is never released, so it sits stuck until the full
// lockDuration (worker.ts) passes before another worker can pick it up.
// worker.close() waits for the in-flight job to finish first.
async function shutdown(): Promise<void> {
  stopQueueCleanup();
  await worker.close();
  await cleanupQueue.close();
  await connection.quit();
}

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

console.log("Worker listening for review jobs...");
