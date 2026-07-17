import { loadRootEnv } from '@happyfeeling/config';

loadRootEnv(import.meta.url);

export function getWebhookSecret(): string {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error('Missing required env var: GITHUB_WEBHOOK_SECRET');
  return secret;
}
