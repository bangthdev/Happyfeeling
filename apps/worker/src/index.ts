import { loadRootEnv } from "@b3-review/config";

loadRootEnv(import.meta.url);

import { createReviewWorker } from "@b3-review/queue";
import { runReviewPipeline } from "@b3-review/github/pipeline";
import { createInstallationTokenProvider } from "@b3-review/github/github/auth";
import { loadConfig } from "@b3-review/github/config";
import { processReviewJob } from "./processJob.js";
import { filterNewFindings } from "./dedupFilter.js";

const config = loadConfig();
const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId,
);

createReviewWorker((job) =>
  processReviewJob(job, {
    runPipeline: runReviewPipeline,
    pipelineDeps: {
      getToken: () => tokenProvider.getToken(),
      openrouterApiKey: config.openrouterApiKey,
      filterNewFindings,
    },
  }),
);

console.log("Worker listening for review jobs...");
