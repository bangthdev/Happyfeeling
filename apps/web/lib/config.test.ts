import { describe, it, expect, afterEach } from "vitest";
import { getWebhookSecret } from "./config";

describe("getWebhookSecret", () => {
  const original = process.env.GITHUB_WEBHOOK_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = original;
  });

  it("returns the secret from env", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    expect(getWebhookSecret()).toBe("test-secret");
  });

  it("throws when GITHUB_WEBHOOK_SECRET is missing", () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    expect(() => getWebhookSecret()).toThrow("GITHUB_WEBHOOK_SECRET");
  });
});
