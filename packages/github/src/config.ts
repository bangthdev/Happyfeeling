import { loadRootEnv } from "@happyfeeling/config";

loadRootEnv(import.meta.url);

export interface AppConfig {
  port: number;
  githubAppId: string;
  githubPrivateKey: string;
  githubInstallationId: string;
  githubWebhookSecret: string;
  openrouterApiKey: string;
}

const REQUIRED_ENV_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
] as const;

export function loadConfig(): AppConfig {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    githubAppId: process.env.GITHUB_APP_ID!,
    githubPrivateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    githubInstallationId: process.env.GITHUB_INSTALLATION_ID!,
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
    openrouterApiKey: process.env.OPENROUTER_API_KEY!,
  };
}
