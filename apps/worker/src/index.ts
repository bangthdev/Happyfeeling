import { loadRootEnv } from '@happyfeeling/config';

loadRootEnv(import.meta.url);

import { createReviewWorker } from '@happyfeeling/queue';
import { runReviewPipeline } from '@happyfeeling/github/pipeline';
import { createInstallationTokenProvider } from '@happyfeeling/github/github/auth';
import { loadConfig } from '@happyfeeling/github/config';
import { processReviewJob } from './processJob.js';
import { filterNewFindings } from './dedupFilter.js';

const config = loadConfig();
const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId
);

createReviewWorker((job) =>
  processReviewJob(job, {
    runPipeline: runReviewPipeline,
    pipelineDeps: { getToken: () => tokenProvider.getToken(), groqApiKey: config.groqApiKey, filterNewFindings },
  })
);

console.log('Worker listening for review jobs...');
