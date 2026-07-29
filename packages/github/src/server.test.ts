import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import { createServer } from "./server.js";

function sign(secret: string, payload: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex")
  );
}

const SECRET = "test-secret";

const PR_PAYLOAD = {
  action: "opened",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: {
    number: 7,
    base: { sha: "basesha1" },
    head: { sha: "sha1" },
  },
};

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = createServer({ webhookSecret: SECRET });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /webhook", () => {
  it("rejects requests with an invalid signature", async () => {
    const app = createServer({ webhookSecret: SECRET });
    const body = JSON.stringify(PR_PAYLOAD);
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", "sha256=invalid")
      .send(body);
    expect(res.status).toBe(401);
  });

  it("accepts a valid PR event and triggers the pipeline", async () => {
    const runPipeline = vi.fn().mockResolvedValue(undefined);
    const app = createServer({ webhookSecret: SECRET, runPipeline });
    const body = JSON.stringify(PR_PAYLOAD);
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", sign(SECRET, body))
      .send(body);
    expect(res.status).toBe(202);
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", repo: "widgets", prNumber: 7 }),
    );
  });

  it("ignores irrelevant actions without calling the pipeline", async () => {
    const runPipeline = vi.fn().mockResolvedValue(undefined);
    const app = createServer({ webhookSecret: SECRET, runPipeline });
    const payload = { ...PR_PAYLOAD, action: "closed" };
    const body = JSON.stringify(payload);
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", sign(SECRET, body))
      .send(body);
    expect(res.status).toBe(200);
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
