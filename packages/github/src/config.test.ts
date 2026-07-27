import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

const REQUIRED_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_INSTALLATION_ID',
  'GITHUB_WEBHOOK_SECRET',
  'OPENROUTER_API_KEY',
];

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of REQUIRED_KEYS) process.env[key] = `test-${key}`;
    process.env.PORT = '4000';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads all required env vars', () => {
    const config = loadConfig();
    expect(config.port).toBe(4000);
    expect(config.githubAppId).toBe('test-GITHUB_APP_ID');
    expect(config.openrouterApiKey).toBe('test-OPENROUTER_API_KEY');
  });

  it('defaults port to 3000 when not set', () => {
    delete process.env.PORT;
    expect(loadConfig().port).toBe(3000);
  });

  it('throws when a required env var is missing', () => {
    delete process.env.GITHUB_APP_ID;
    expect(() => loadConfig()).toThrow('GITHUB_APP_ID');
  });
});
