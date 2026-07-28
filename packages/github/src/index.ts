import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
import { createInstallationTokenProvider } from "./github/auth.js";
import { runReviewPipeline, passthroughFilterNewFindings } from "./pipeline.js";

const config = loadConfig();

const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId,
);

const app = createServer({
  webhookSecret: config.githubWebhookSecret,
  runPipeline: (event) =>
    runReviewPipeline(event, {
      getToken: () => tokenProvider.getToken(),
      openrouterApiKey: config.openrouterApiKey,
      filterNewFindings: passthroughFilterNewFindings,
    }),
});

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});
