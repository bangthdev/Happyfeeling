// TEMP: swapped from '@anthropic-ai/sdk' + anthropicClient to test free via Groq.
// To revert: re-add `import Anthropic from '@anthropic-ai/sdk'`, construct
// `anthropicClient`, and pass it instead of `groqApiKey` below.
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { createInstallationTokenProvider } from './github/auth.js';
import { runReviewPipeline, passthroughFilterNewFindings } from './pipeline.js';

const config = loadConfig();

const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId
);

const app = createServer({
  webhookSecret: config.githubWebhookSecret,
  runPipeline: (event) =>
    runReviewPipeline(event, {
      getToken: () => tokenProvider.getToken(),
      groqApiKey: config.groqApiKey,
      filterNewFindings: passthroughFilterNewFindings,
    }),
});

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});
