import Anthropic from '@anthropic-ai/sdk';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { createInstallationTokenProvider } from './github/auth.js';
import { runReviewPipeline } from './pipeline.js';

const config = loadConfig();

const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId
);

const anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });

const app = createServer({
  webhookSecret: config.githubWebhookSecret,
  runPipeline: (event) =>
    runReviewPipeline(event, { getToken: () => tokenProvider.getToken(), anthropicClient }),
});

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});
