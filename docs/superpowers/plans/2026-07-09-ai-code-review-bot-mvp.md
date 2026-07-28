# AI Code Review Bot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working MVP bot that receives a GitHub PR webhook, reviews the diff with Claude, and posts review comments at the correct diff position.

**Architecture:** Express server receives and verifies GitHub webhooks, extracts the PR event, then an orchestration pipeline fetches the diff via a GitHub App installation token, filters it (Static Context Builder), sends it to Claude with a forced tool-use schema to get structured findings, maps each finding's line to a diff position, posts review comments back to GitHub, and logs run metrics to console/file.

**Tech Stack:** TypeScript (strict), Node.js >= 18, Express 4, `@anthropic-ai/sdk`, `jsonwebtoken`, Vitest + Supertest.

## Global Constraints

- Ngôn ngữ: TypeScript strict mode, chạy trên Node.js >= 18 (cần global `fetch`)
- Framework: Express
- LLM: Claude API qua `@anthropic-ai/sdk`, model `claude-sonnet-5`, ép structured output bằng forced tool use
- GitHub auth: GitHub App (JWT ký bằng `jsonwebtoken` → đổi installation token), KHÔNG dùng PAT trong code chính thức
- Context strategy: Static Context Builder — KHÔNG implement Agentic Session trong plan này
- Lưu metrics: console + file log dạng JSON dòng — KHÔNG dùng database
- Lọc file trước khi gửi LLM: bỏ qua path khớp `.pb.go`, `vendor/`, `node_modules/`
- Test framework: Vitest + Supertest, mọi logic thuần (pure function) phải có unit test, gọi API ngoài phải mock qua dependency injection (không gọi mạng thật trong test)

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
.env.example
.gitignore
README.md

src/
  server.ts                    # Express app: /health, /webhook
  server.test.ts
  index.ts                     # composition root: đọc config, wire deps, listen
  config.ts                    # đọc & validate env vars
  config.test.ts
  pipeline.ts                  # runReviewPipeline: orchestration
  pipeline.test.ts
  logger.ts                    # logMetrics
  logger.test.ts
  webhook/
    verify.ts                  # verifySignature (HMAC)
    verify.test.ts
    parse.ts                   # parsePullRequestEvent
    parse.test.ts
  github/
    diffPosition.ts            # mapLineToDiffPosition
    diffPosition.test.ts
    auth.ts                    # createAppJWT, createInstallationTokenProvider
    auth.test.ts
    client.ts                  # getPullRequestDiff, postReviewComment
    client.test.ts
  review/
    contextBuilder.ts          # buildContext, ReviewContext
    contextBuilder.test.ts
    llmReviewer.ts              # reviewDiff, Finding, ReviewResult
    llmReviewer.test.ts
    commentPoster.ts            # postFindings
    commentPoster.test.ts
```

---

### Task 1: Project scaffolding + health check endpoint

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/server.ts`
- Test: `src/server.test.ts`

**Interfaces:**

- Produces: `createServer(): express.Express`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ai-code-review-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
logs/
*.log
```

- [ ] **Step 5: Create .env.example**

```
PORT=3000
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_INSTALLATION_ID=
GITHUB_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

- [ ] **Step 7: Write the failing test**

`src/server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createServer } from "./server.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = createServer();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run src/server.test.ts`
Expected: FAIL — `src/server.ts` does not exist / `createServer` is not exported.

- [ ] **Step 9: Write minimal implementation**

`src/server.ts`:

```ts
import express from "express";

export function createServer(): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return app;
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run src/server.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/server.ts src/server.test.ts
git commit -m "Add project scaffolding with health check endpoint"
```

---

### Task 2: Webhook signature verification (HMAC)

**Files:**

- Create: `src/webhook/verify.ts`
- Test: `src/webhook/verify.test.ts`

**Interfaces:**

- Produces: `verifySignature(payload: Buffer | string, signatureHeader: string | undefined, secret: string): boolean`

- [ ] **Step 1: Write the failing test**

`src/webhook/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifySignature } from "./verify.js";

function sign(secret: string, payload: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex")
  );
}

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const secret = "test-secret";
    const payload = '{"hello":"world"}';
    const signature = sign(secret, payload);
    expect(verifySignature(payload, signature, secret)).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const secret = "test-secret";
    const signature = sign(secret, '{"hello":"world"}');
    expect(verifySignature('{"hello":"tampered"}', signature, secret)).toBe(
      false,
    );
  });

  it("returns false when the signature header is missing", () => {
    expect(verifySignature("payload", undefined, "test-secret")).toBe(false);
  });

  it("returns false for a malformed signature of different length", () => {
    expect(verifySignature("payload", "sha256=short", "test-secret")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/webhook/verify.test.ts`
Expected: FAIL — `src/webhook/verify.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/webhook/verify.ts`:

```ts
import crypto from "node:crypto";

export function verifySignature(
  payload: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/webhook/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webhook/verify.ts src/webhook/verify.test.ts
git commit -m "Add webhook HMAC signature verification"
```

---

### Task 3: Webhook payload parsing

**Files:**

- Create: `src/webhook/parse.ts`
- Test: `src/webhook/parse.test.ts`

**Interfaces:**

- Produces: `PullRequestEvent` type `{ owner: string; repo: string; prNumber: number; headSha: string; action: string }`
- Produces: `parsePullRequestEvent(body: unknown): PullRequestEvent | null`

- [ ] **Step 1: Write the failing test**

`src/webhook/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePullRequestEvent } from "./parse.js";

const BASE_PAYLOAD = {
  action: "opened",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: { number: 7, head: { sha: "sha1" } },
};

describe("parsePullRequestEvent", () => {
  it("parses an opened pull_request event", () => {
    const event = parsePullRequestEvent(BASE_PAYLOAD);
    expect(event).toEqual({
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      headSha: "sha1",
      action: "opened",
    });
  });

  it("parses a synchronize pull_request event", () => {
    const event = parsePullRequestEvent({
      ...BASE_PAYLOAD,
      action: "synchronize",
    });
    expect(event?.action).toBe("synchronize");
  });

  it("returns null for irrelevant actions", () => {
    expect(
      parsePullRequestEvent({ ...BASE_PAYLOAD, action: "closed" }),
    ).toBeNull();
  });

  it("returns null for payloads missing pull_request", () => {
    expect(
      parsePullRequestEvent({
        action: "opened",
        repository: BASE_PAYLOAD.repository,
      }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parsePullRequestEvent(null)).toBeNull();
    expect(parsePullRequestEvent("string")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/webhook/parse.test.ts`
Expected: FAIL — `src/webhook/parse.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/webhook/parse.ts`:

```ts
export interface PullRequestEvent {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  action: string;
}

const RELEVANT_ACTIONS = new Set(["opened", "synchronize"]);

export function parsePullRequestEvent(body: unknown): PullRequestEvent | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, any>;

  if (!payload.pull_request || !payload.repository) return null;
  if (!RELEVANT_ACTIONS.has(payload.action)) return null;

  return {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    prNumber: payload.pull_request.number,
    headSha: payload.pull_request.head.sha,
    action: payload.action,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/webhook/parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webhook/parse.ts src/webhook/parse.test.ts
git commit -m "Add pull request webhook payload parsing"
```

---

### Task 4: Wire webhook route into server

**Files:**

- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**

- Consumes: `verifySignature` from `./webhook/verify.js`, `parsePullRequestEvent` and `PullRequestEvent` from `./webhook/parse.js`
- Produces: `ServerConfig` type `{ webhookSecret: string; runPipeline?: (event: PullRequestEvent) => Promise<void> }`
- Produces: `createServer(config: ServerConfig): express.Express` (signature change from Task 1 — `createServer()` now requires a config argument)

- [ ] **Step 1: Write the failing test**

Append to `src/server.test.ts` (replace the whole file content):

```ts
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
  pull_request: { number: 7, head: { sha: "sha1" } },
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
      .send(Buffer.from(body));
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
      .send(Buffer.from(body));
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
      .send(Buffer.from(body));
    expect(res.status).toBe(200);
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server.test.ts`
Expected: FAIL — `createServer()` called with no arguments no longer matches the updated call sites, and `/webhook` route does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace `src/server.ts`:

```ts
import express from "express";
import { verifySignature } from "./webhook/verify.js";
import {
  parsePullRequestEvent,
  type PullRequestEvent,
} from "./webhook/parse.js";

export interface ServerConfig {
  webhookSecret: string;
  runPipeline?: (event: PullRequestEvent) => Promise<void>;
}

export function createServer(config: ServerConfig): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    (req, res) => {
      const signature = req.header("x-hub-signature-256");
      if (!verifySignature(req.body, signature, config.webhookSecret)) {
        res.status(401).send("invalid signature");
        return;
      }

      const payload = JSON.parse((req.body as Buffer).toString("utf8"));
      const event = parsePullRequestEvent(payload);
      if (!event) {
        res.status(200).send("ignored");
        return;
      }

      res.status(202).send("accepted");
      if (config.runPipeline) {
        config
          .runPipeline(event)
          .catch((err) => console.error("Pipeline error:", err));
      }
    },
  );

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "Add webhook route with signature verification and pipeline hook"
```

---

### Task 5: Diff hunk line-position mapping

**Files:**

- Create: `src/github/diffPosition.ts`
- Test: `src/github/diffPosition.test.ts`

**Interfaces:**

- Produces: `mapLineToDiffPosition(diffText: string, filePath: string, targetLine: number): number | null`

- [ ] **Step 1: Write the failing test**

`src/github/diffPosition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapLineToDiffPosition } from "./diffPosition.js";

const SINGLE_HUNK_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
 line1
 line2
+line3-new
 line3
 line4
`;

const TWO_HUNK_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 a
-b
+bb
 c
@@ -10,2 +10,3 @@
 x
+y
 z
`;

describe("mapLineToDiffPosition", () => {
  it("maps an added line to its diff position", () => {
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, "src/foo.ts", 3)).toBe(4);
  });

  it("maps context lines to their diff position", () => {
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, "src/foo.ts", 1)).toBe(2);
    expect(mapLineToDiffPosition(SINGLE_HUNK_DIFF, "src/foo.ts", 4)).toBe(5);
  });

  it("keeps counting position across multiple hunks in the same file", () => {
    expect(mapLineToDiffPosition(TWO_HUNK_DIFF, "src/foo.ts", 11)).toBe(8);
  });

  it("returns null when the file is not in the diff", () => {
    expect(
      mapLineToDiffPosition(SINGLE_HUNK_DIFF, "src/other.ts", 1),
    ).toBeNull();
  });

  it("returns null when the target line is not present in the diff", () => {
    expect(
      mapLineToDiffPosition(SINGLE_HUNK_DIFF, "src/foo.ts", 999),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/diffPosition.test.ts`
Expected: FAIL — `src/github/diffPosition.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/github/diffPosition.ts`:

```ts
interface FileDiff {
  path: string;
  lines: string[];
}

function splitDiffByFile(diffText: string): FileDiff[] {
  const fileBlocks = diffText.split(/^diff --git .*$/m).slice(1);
  const paths = [...diffText.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)].map(
    (m) => m[2],
  );

  return fileBlocks.map((block, i) => {
    const bodyStart = block.indexOf("\n@@");
    const body = bodyStart === -1 ? "" : block.slice(bodyStart + 1);
    return { path: paths[i], lines: body.length ? body.split("\n") : [] };
  });
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function mapLineToDiffPosition(
  diffText: string,
  filePath: string,
  targetLine: number,
): number | null {
  const file = splitDiffByFile(diffText).find((f) => f.path === filePath);
  if (!file) return null;

  let position = 0;
  let newLine = 0;

  for (const line of file.lines) {
    if (line === "") continue;

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      position += 1;
      newLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    position += 1;
    if (line.startsWith("+") || line.startsWith(" ")) {
      newLine += 1;
      if (newLine === targetLine) return position;
    }
    // lines starting with '-' are removed lines: they don't exist in the
    // new file, so they don't advance newLine and can't be a match target.
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/github/diffPosition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/github/diffPosition.ts src/github/diffPosition.test.ts
git commit -m "Add diff hunk line-position mapping"
```

---

### Task 6: GitHub App auth (JWT + installation token)

**Files:**

- Create: `src/github/auth.ts`
- Test: `src/github/auth.test.ts`

**Interfaces:**

- Produces: `createAppJWT(appId: string, privateKey: string): string`
- Produces: `fetchInstallationToken(appJwt: string, installationId: string, fetchFn?: typeof fetch): Promise<{ token: string; expiresAt: Date }>`
- Produces: `createInstallationTokenProvider(appId: string, privateKey: string, installationId: string, deps?: { fetchToken?: typeof fetchInstallationToken; createJwt?: typeof createAppJWT }): { getToken(): Promise<string> }`

- [ ] **Step 1: Write the failing test**

`src/github/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { createAppJWT, createInstallationTokenProvider } from "./auth.js";

describe("createAppJWT", () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    privateKey = keyPair.privateKey;
    publicKey = keyPair.publicKey;
  });

  it("signs a JWT with the app id as issuer and a max-10-minute expiry", () => {
    const token = createAppJWT("12345", privateKey);
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
    }) as jwt.JwtPayload;
    expect(decoded.iss).toBe("12345");
    expect(decoded.exp! - decoded.iat!).toBeLessThanOrEqual(600);
  });
});

describe("createInstallationTokenProvider", () => {
  it("fetches once and caches the token for subsequent calls", async () => {
    const fetchToken = vi.fn().mockResolvedValue({
      token: "installation-token-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const provider = createInstallationTokenProvider(
      "12345",
      "fake-key",
      "999",
      {
        fetchToken,
        createJwt: () => "fake-jwt",
      },
    );

    const token1 = await provider.getToken();
    const token2 = await provider.getToken();

    expect(token1).toBe("installation-token-1");
    expect(token2).toBe("installation-token-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("refetches when the cached token is close to expiry", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({
        token: "token-1",
        expiresAt: new Date(Date.now() + 30_000),
      })
      .mockResolvedValueOnce({
        token: "token-2",
        expiresAt: new Date(Date.now() + 3600_000),
      });
    const provider = createInstallationTokenProvider(
      "12345",
      "fake-key",
      "999",
      {
        fetchToken,
        createJwt: () => "fake-jwt",
      },
    );

    const token1 = await provider.getToken();
    const token2 = await provider.getToken();

    expect(token1).toBe("token-1");
    expect(token2).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/auth.test.ts`
Expected: FAIL — `src/github/auth.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/github/auth.ts`:

```ts
import jwt from "jsonwebtoken";

export function createAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" },
  );
}

export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

export async function fetchInstallationToken(
  appJwt: string,
  installationId: string,
  fetchFn: typeof fetch = fetch,
): Promise<InstallationToken> {
  const res = await fetchFn(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch installation token: ${res.status} ${await res.text()}`,
    );
  }

  const data = await res.json();
  return { token: data.token, expiresAt: new Date(data.expires_at) };
}

export function createInstallationTokenProvider(
  appId: string,
  privateKey: string,
  installationId: string,
  deps: {
    fetchToken?: typeof fetchInstallationToken;
    createJwt?: typeof createAppJWT;
  } = {},
): { getToken(): Promise<string> } {
  const fetchToken = deps.fetchToken ?? fetchInstallationToken;
  const createJwt = deps.createJwt ?? createAppJWT;
  let cached: InstallationToken | null = null;

  return {
    async getToken(): Promise<string> {
      if (cached && cached.expiresAt.getTime() - Date.now() > 60_000) {
        return cached.token;
      }
      const appJwt = createJwt(appId, privateKey);
      cached = await fetchToken(appJwt, installationId);
      return cached.token;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/github/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/github/auth.ts src/github/auth.test.ts
git commit -m "Add GitHub App JWT signing and installation token provider"
```

---

### Task 7: GitHub API client (fetch diff, post comment)

**Files:**

- Create: `src/github/client.ts`
- Test: `src/github/client.test.ts`

**Interfaces:**

- Produces: `getPullRequestDiff(token: string, owner: string, repo: string, prNumber: number, fetchFn?: typeof fetch): Promise<string>`
- Produces: `PostCommentParams` type `{ token: string; owner: string; repo: string; prNumber: number; commitSha: string; filePath: string; position: number; body: string }`
- Produces: `postReviewComment(params: PostCommentParams, fetchFn?: typeof fetch): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/github/client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getPullRequestDiff, postReviewComment } from "./client.js";

describe("getPullRequestDiff", () => {
  it("requests the diff with the correct headers and returns the text", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("diff --git a/x b/x\n..."),
    });

    const diff = await getPullRequestDiff(
      "tok",
      "acme",
      "widgets",
      42,
      fetchFn as unknown as typeof fetch,
    );

    expect(diff).toBe("diff --git a/x b/x\n...");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widgets/pulls/42",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
          Accept: "application/vnd.github.v3.diff",
        }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    await expect(
      getPullRequestDiff(
        "tok",
        "acme",
        "widgets",
        42,
        fetchFn as unknown as typeof fetch,
      ),
    ).rejects.toThrow("404");
  });
});

describe("postReviewComment", () => {
  it("posts a comment with the correct body", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve("") });

    await postReviewComment(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 42,
        commitSha: "abc123",
        filePath: "src/x.ts",
        position: 4,
        body: "nice catch",
      },
      fetchFn as unknown as typeof fetch,
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widgets/pulls/42/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          commit_id: "abc123",
          path: "src/x.ts",
          position: 4,
          body: "nice catch",
        }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("rate limited"),
    });

    await expect(
      postReviewComment(
        {
          token: "tok",
          owner: "acme",
          repo: "widgets",
          prNumber: 42,
          commitSha: "abc123",
          filePath: "src/x.ts",
          position: 4,
          body: "nice catch",
        },
        fetchFn as unknown as typeof fetch,
      ),
    ).rejects.toThrow("403");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/client.test.ts`
Expected: FAIL — `src/github/client.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/github/client.ts`:

```ts
export async function getPullRequestDiff(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch PR diff: ${res.status} ${await res.text()}`,
    );
  }

  return res.text();
}

export interface PostCommentParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  filePath: string;
  position: number;
  body: string;
}

export async function postReviewComment(
  params: PostCommentParams,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const { token, owner, repo, prNumber, commitSha, filePath, position, body } =
    params;

  const res = await fetchFn(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        commit_id: commitSha,
        path: filePath,
        position,
        body,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to post review comment: ${res.status} ${await res.text()}`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/github/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/github/client.ts src/github/client.test.ts
git commit -m "Add GitHub API client for fetching diffs and posting comments"
```

---

### Task 8: Static Context Builder

**Files:**

- Create: `src/review/contextBuilder.ts`
- Test: `src/review/contextBuilder.test.ts`

**Interfaces:**

- Produces: `ReviewContext` type `{ diff: string; files: string[] }`
- Produces: `buildContext(rawDiff: string): ReviewContext`

- [ ] **Step 1: Write the failing test**

`src/review/contextBuilder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildContext } from "./contextBuilder.js";

const DIFF_WITH_VENDOR_FILE = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/vendor/lib.go b/vendor/lib.go
index 111..222 100644
--- a/vendor/lib.go
+++ b/vendor/lib.go
@@ -1,1 +1,1 @@
-old
+new
`;

describe("buildContext", () => {
  it("filters out vendor files and keeps normal files", () => {
    const context = buildContext(DIFF_WITH_VENDOR_FILE);
    expect(context.files).toEqual(["src/foo.ts"]);
    expect(context.diff).toContain("src/foo.ts");
    expect(context.diff).not.toContain("vendor/lib.go");
  });

  it("filters .pb.go and node_modules paths", () => {
    const diff = `diff --git a/api.pb.go b/api.pb.go
--- a/api.pb.go
+++ b/api.pb.go
@@ -1,1 +1,1 @@
-old
+new
diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js
--- a/node_modules/pkg/index.js
+++ b/node_modules/pkg/index.js
@@ -1,1 +1,1 @@
-old
+new
`;
    const context = buildContext(diff);
    expect(context.files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/contextBuilder.test.ts`
Expected: FAIL — `src/review/contextBuilder.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/review/contextBuilder.ts`:

```ts
const IGNORED_PATH_PATTERNS = [
  /\.pb\.go$/,
  /(^|\/)vendor\//,
  /(^|\/)node_modules\//,
];

export interface ReviewContext {
  diff: string;
  files: string[];
}

export function buildContext(rawDiff: string): ReviewContext {
  const fileBlocks = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);

  const kept = fileBlocks.filter((block) => {
    const match = block.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    const path = match ? match[2] : "";
    return !IGNORED_PATH_PATTERNS.some((re) => re.test(path));
  });

  const files = kept
    .map((block) => block.match(/^diff --git a\/(.+?) b\/(.+?)$/m)?.[2])
    .filter((p): p is string => Boolean(p));

  return { diff: kept.join(""), files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/review/contextBuilder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/contextBuilder.ts src/review/contextBuilder.test.ts
git commit -m "Add static context builder with generated/vendor path filtering"
```

---

### Task 9: LLM Reviewer (Claude structured output)

**Files:**

- Create: `src/review/llmReviewer.ts`
- Test: `src/review/llmReviewer.test.ts`

**Interfaces:**

- Consumes: `ReviewContext` from `./contextBuilder.js`
- Produces: `Finding` type `{ file: string; line: number; severity: 'high' | 'medium' | 'low'; message: string; suggestion: string }`
- Produces: `ReviewResult` type `{ findings: Finding[]; tokensUsed: number }`
- Produces: `reviewDiff(context: ReviewContext, client: Anthropic): Promise<ReviewResult>`

- [ ] **Step 1: Write the failing test**

`src/review/llmReviewer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { reviewDiff } from "./llmReviewer.js";

function fakeClient(createImpl: (...args: any[]) => Promise<any>): Anthropic {
  return { messages: { create: vi.fn(createImpl) } } as unknown as Anthropic;
}

describe("reviewDiff", () => {
  it("parses findings from a valid tool_use response", async () => {
    const client = fakeClient(async () => ({
      content: [
        {
          type: "tool_use",
          name: "submit_findings",
          input: {
            findings: [
              {
                file: "src/x.ts",
                line: 10,
                severity: "high",
                message: "bug",
                suggestion: "fix it",
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const result = await reviewDiff(
      { diff: "diff...", files: ["src/x.ts"] },
      client,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("src/x.ts");
    expect(result.tokensUsed).toBe(150);
  });

  it("retries once when the first response has no tool_use block", async () => {
    let callCount = 0;
    const client = fakeClient(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [{ type: "text", text: "oops" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_findings",
            input: { findings: [] },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      };
    });

    const result = await reviewDiff({ diff: "diff...", files: [] }, client);

    expect(result.findings).toEqual([]);
    expect(result.tokensUsed).toBe(45);
    expect(callCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/llmReviewer.test.ts`
Expected: FAIL — `src/review/llmReviewer.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/review/llmReviewer.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { ReviewContext } from "./contextBuilder.js";

export interface Finding {
  file: string;
  line: number;
  severity: "high" | "medium" | "low";
  message: string;
  suggestion: string;
}

export interface ReviewResult {
  findings: Finding[];
  tokensUsed: number;
}

const FINDINGS_TOOL = {
  name: "submit_findings",
  description: "Submit the list of code review findings found in the diff",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "string" },
            line: { type: "number" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            message: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["file", "line", "severity", "message", "suggestion"],
        },
      },
    },
    required: ["findings"],
  },
};

function buildPrompt(context: ReviewContext): string {
  return `Bạn là một senior engineer đang review Pull Request. Đọc diff dưới đây và chỉ ra các vấn đề thật sự quan trọng (bug, security, logic sai). Bỏ qua nitpick về style/format. Nếu không có vấn đề gì, trả về findings rỗng.\n\nDiff:\n${context.diff}`;
}

function parseFindings(response: Anthropic.Message): Finding[] {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) throw new Error("No tool_use block in Claude response");

  const input = toolUse.input as { findings: Finding[] };
  if (!Array.isArray(input.findings))
    throw new Error("findings is not an array");
  return input.findings;
}

export async function reviewDiff(
  context: ReviewContext,
  client: Anthropic,
): Promise<ReviewResult> {
  const baseParams = {
    model: "claude-sonnet-5",
    max_tokens: 4096,
    tools: [FINDINGS_TOOL],
    tool_choice: { type: "tool" as const, name: "submit_findings" },
    messages: [{ role: "user" as const, content: buildPrompt(context) }],
  };

  const response = await client.messages.create(baseParams as any);
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  try {
    return { findings: parseFindings(response), tokensUsed };
  } catch {
    const retryResponse = await client.messages.create({
      ...baseParams,
      messages: [
        ...baseParams.messages,
        { role: "assistant" as const, content: response.content },
        {
          role: "user" as const,
          content:
            "Kết quả không đúng format yêu cầu. Hãy gọi lại tool submit_findings với đúng schema.",
        },
      ],
    } as any);
    const retryTokensUsed =
      tokensUsed +
      retryResponse.usage.input_tokens +
      retryResponse.usage.output_tokens;
    return {
      findings: parseFindings(retryResponse),
      tokensUsed: retryTokensUsed,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/review/llmReviewer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/llmReviewer.ts src/review/llmReviewer.test.ts
git commit -m "Add Claude reviewer with forced tool-use structured output"
```

---

### Task 10: Comment Poster

**Files:**

- Create: `src/review/commentPoster.ts`
- Test: `src/review/commentPoster.test.ts`

**Interfaces:**

- Consumes: `mapLineToDiffPosition` from `../github/diffPosition.js`, `postReviewComment` from `../github/client.js`, `Finding` from `./llmReviewer.js`
- Produces: `PostFindingsParams` type `{ token: string; owner: string; repo: string; prNumber: number; commitSha: string; diff: string; findings: Finding[] }`
- Produces: `PostFindingsResult` type `{ posted: number; skipped: number }`
- Produces: `postFindings(params: PostFindingsParams, postFn?: typeof postReviewComment): Promise<PostFindingsResult>`

- [ ] **Step 1: Write the failing test**

`src/review/commentPoster.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { postFindings } from "./commentPoster.js";
import type { Finding } from "./llmReviewer.js";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
 line1
 line2
+line3-new
 line3
 line4
`;

describe("postFindings", () => {
  it("posts mappable findings and skips unmappable ones", async () => {
    const postFn = vi.fn().mockResolvedValue(undefined);
    const findings: Finding[] = [
      {
        file: "src/foo.ts",
        line: 3,
        severity: "high",
        message: "bug",
        suggestion: "fix",
      },
      {
        file: "src/foo.ts",
        line: 999,
        severity: "low",
        message: "unreachable",
        suggestion: "n/a",
      },
    ];

    const result = await postFindings(
      {
        token: "tok",
        owner: "acme",
        repo: "widgets",
        prNumber: 1,
        commitSha: "sha1",
        diff: SAMPLE_DIFF,
        findings,
      },
      postFn,
    );

    expect(result).toEqual({ posted: 1, skipped: 1 });
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "src/foo.ts", position: 4 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/review/commentPoster.test.ts`
Expected: FAIL — `src/review/commentPoster.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/review/commentPoster.ts`:

```ts
import { mapLineToDiffPosition } from "../github/diffPosition.js";
import { postReviewComment } from "../github/client.js";
import type { Finding } from "./llmReviewer.js";

export interface PostFindingsParams {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  diff: string;
  findings: Finding[];
}

export interface PostFindingsResult {
  posted: number;
  skipped: number;
}

export async function postFindings(
  params: PostFindingsParams,
  postFn: typeof postReviewComment = postReviewComment,
): Promise<PostFindingsResult> {
  const { token, owner, repo, prNumber, commitSha, diff, findings } = params;
  let posted = 0;
  let skipped = 0;

  for (const finding of findings) {
    const position = mapLineToDiffPosition(diff, finding.file, finding.line);
    if (position === null) {
      skipped += 1;
      continue;
    }

    await postFn({
      token,
      owner,
      repo,
      prNumber,
      commitSha,
      filePath: finding.file,
      position,
      body: `**[${finding.severity}]** ${finding.message}\n\n${finding.suggestion}`,
    });
    posted += 1;
  }

  return { posted, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/review/commentPoster.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/commentPoster.ts src/review/commentPoster.test.ts
git commit -m "Add comment poster mapping findings to diff positions"
```

---

### Task 11: Metrics logger

**Files:**

- Create: `src/logger.ts`
- Test: `src/logger.test.ts`

**Interfaces:**

- Produces: `Metrics` type `{ pr_number: number; findings_count: number; severity_breakdown: Record<string, number>; latency_ms: number; tokens_used: number }`
- Produces: `logMetrics(metrics: Metrics, logFilePath?: string): void`

- [ ] **Step 1: Write the failing test**

`src/logger.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logMetrics } from "./logger.js";

describe("logMetrics", () => {
  const tmpFile = path.join(os.tmpdir(), `metrics-test-${process.pid}.log`);

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it("logs to console and appends a JSON line to the log file", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const metrics = {
      pr_number: 12,
      findings_count: 2,
      severity_breakdown: { high: 1, medium: 1 },
      latency_ms: 100,
      tokens_used: 500,
    };

    logMetrics(metrics, tmpFile);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(metrics));
    const fileContent = fs.readFileSync(tmpFile, "utf8");
    expect(fileContent.trim()).toBe(JSON.stringify(metrics));

    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/logger.test.ts`
Expected: FAIL — `src/logger.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/logger.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export interface Metrics {
  pr_number: number;
  findings_count: number;
  severity_breakdown: Record<string, number>;
  latency_ms: number;
  tokens_used: number;
}

export function logMetrics(
  metrics: Metrics,
  logFilePath = "logs/metrics.log",
): void {
  const line = JSON.stringify(metrics);
  console.log(line);

  const dir = path.dirname(logFilePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logFilePath, line + "\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts src/logger.test.ts
git commit -m "Add JSON line metrics logger"
```

---

### Task 12: Pipeline orchestration

**Files:**

- Create: `src/pipeline.ts`
- Test: `src/pipeline.test.ts`

**Interfaces:**

- Consumes: `getPullRequestDiff` from `./github/client.js`, `buildContext` from `./review/contextBuilder.js`, `reviewDiff` from `./review/llmReviewer.js`, `postFindings` from `./review/commentPoster.js`, `logMetrics` from `./logger.js`, `PullRequestEvent` from `./webhook/parse.js`
- Produces: `PipelineDeps` type `{ getToken: () => Promise<string>; anthropicClient: Anthropic }`
- Produces: `runReviewPipeline(event: PullRequestEvent, deps: PipelineDeps): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/pipeline.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { PullRequestEvent } from "./webhook/parse.js";

vi.mock("./github/client.js", () => ({ getPullRequestDiff: vi.fn() }));
vi.mock("./review/commentPoster.js", () => ({ postFindings: vi.fn() }));
vi.mock("./review/llmReviewer.js", () => ({ reviewDiff: vi.fn() }));
vi.mock("./logger.js", () => ({ logMetrics: vi.fn() }));

import { getPullRequestDiff } from "./github/client.js";
import { postFindings } from "./review/commentPoster.js";
import { reviewDiff } from "./review/llmReviewer.js";
import { logMetrics } from "./logger.js";
import { runReviewPipeline } from "./pipeline.js";

describe("runReviewPipeline", () => {
  it("orchestrates diff fetch, review, comment posting, and metrics logging", async () => {
    const event: PullRequestEvent = {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      headSha: "sha1",
      action: "opened",
    };

    vi.mocked(getPullRequestDiff).mockResolvedValue(
      "diff --git a/src/x.ts b/src/x.ts\n...",
    );
    vi.mocked(reviewDiff).mockResolvedValue({
      findings: [
        {
          file: "src/x.ts",
          line: 1,
          severity: "high",
          message: "m",
          suggestion: "s",
        },
      ],
      tokensUsed: 300,
    });
    vi.mocked(postFindings).mockResolvedValue({ posted: 1, skipped: 0 });

    const getToken = vi.fn().mockResolvedValue("tok");
    const anthropicClient = {} as any;

    await runReviewPipeline(event, { getToken, anthropicClient });

    expect(getPullRequestDiff).toHaveBeenCalledWith(
      "tok",
      "acme",
      "widgets",
      7,
    );
    expect(postFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        prNumber: 7,
        commitSha: "sha1",
      }),
    );
    expect(logMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        pr_number: 7,
        findings_count: 1,
        tokens_used: 300,
        severity_breakdown: { high: 1 },
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline.test.ts`
Expected: FAIL — `src/pipeline.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/pipeline.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { getPullRequestDiff } from "./github/client.js";
import { buildContext } from "./review/contextBuilder.js";
import { reviewDiff } from "./review/llmReviewer.js";
import { postFindings } from "./review/commentPoster.js";
import { logMetrics } from "./logger.js";
import type { PullRequestEvent } from "./webhook/parse.js";

export interface PipelineDeps {
  getToken: () => Promise<string>;
  anthropicClient: Anthropic;
}

export async function runReviewPipeline(
  event: PullRequestEvent,
  deps: PipelineDeps,
): Promise<void> {
  const start = Date.now();

  const token = await deps.getToken();
  const rawDiff = await getPullRequestDiff(
    token,
    event.owner,
    event.repo,
    event.prNumber,
  );
  const context = buildContext(rawDiff);
  const { findings, tokensUsed } = await reviewDiff(
    context,
    deps.anthropicClient,
  );

  const { posted } = await postFindings({
    token,
    owner: event.owner,
    repo: event.repo,
    prNumber: event.prNumber,
    commitSha: event.headSha,
    diff: context.diff,
    findings,
  });

  const severityBreakdown: Record<string, number> = {};
  for (const finding of findings) {
    severityBreakdown[finding.severity] =
      (severityBreakdown[finding.severity] ?? 0) + 1;
  }

  logMetrics({
    pr_number: event.prNumber,
    findings_count: posted,
    severity_breakdown: severityBreakdown,
    latency_ms: Date.now() - start,
    tokens_used: tokensUsed,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts src/pipeline.test.ts
git commit -m "Add pipeline orchestration wiring diff, review, post, and metrics"
```

---

### Task 13: Config loading, composition root, and setup docs

**Files:**

- Create: `src/config.ts`
- Test: `src/config.test.ts`
- Create: `src/index.ts`
- Create: `README.md`

**Interfaces:**

- Consumes: `createServer` from `./server.js`, `createInstallationTokenProvider` from `./github/auth.js`, `runReviewPipeline` from `./pipeline.js`
- Produces: `AppConfig` type `{ port: number; githubAppId: string; githubPrivateKey: string; githubInstallationId: string; githubWebhookSecret: string; anthropicApiKey: string }`
- Produces: `loadConfig(): AppConfig`

- [ ] **Step 1: Write the failing test**

`src/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

const REQUIRED_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
];

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of REQUIRED_KEYS) process.env[key] = `test-${key}`;
    process.env.PORT = "4000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads all required env vars", () => {
    const config = loadConfig();
    expect(config.port).toBe(4000);
    expect(config.githubAppId).toBe("test-GITHUB_APP_ID");
    expect(config.anthropicApiKey).toBe("test-ANTHROPIC_API_KEY");
  });

  it("defaults port to 3000 when not set", () => {
    delete process.env.PORT;
    expect(loadConfig().port).toBe(3000);
  });

  it("throws when a required env var is missing", () => {
    delete process.env.GITHUB_APP_ID;
    expect(() => loadConfig()).toThrow("GITHUB_APP_ID");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `src/config.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/config.ts`:

```ts
import "dotenv/config";

export interface AppConfig {
  port: number;
  githubAppId: string;
  githubPrivateKey: string;
  githubInstallationId: string;
  githubWebhookSecret: string;
  anthropicApiKey: string;
}

const REQUIRED_ENV_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
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
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS

- [ ] **Step 5: Create the composition root**

`src/index.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
import { createInstallationTokenProvider } from "./github/auth.js";
import { runReviewPipeline } from "./pipeline.js";

const config = loadConfig();

const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId,
);

const anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });

const app = createServer({
  webhookSecret: config.githubWebhookSecret,
  runPipeline: (event) =>
    runReviewPipeline(event, {
      getToken: () => tokenProvider.getToken(),
      anthropicClient,
    }),
});

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});
```

- [ ] **Step 6: Write README with local setup instructions**

`README.md`:

````markdown
# AI Code Review Bot (MVP)

Bot tự động review Pull Request bằng Claude API. Xem thiết kế đầy đủ tại
`docs/superpowers/specs/2026-07-06-ai-code-review-bot-design.md`.

## Setup

### 1. Tạo GitHub App

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
2. Webhook URL: điền tạm `https://example.com/webhook`, sẽ cập nhật lại sau khi có ngrok URL
3. Webhook secret: tự sinh 1 chuỗi ngẫu nhiên (ví dụ `openssl rand -hex 20`), lưu lại — đây là `GITHUB_WEBHOOK_SECRET`
4. Repository permissions: **Pull requests: Read & write**, **Contents: Read-only**
5. Subscribe to events: **Pull request**
6. Tạo App xong, note lại **App ID** (đây là `GITHUB_APP_ID`)
7. Generate a private key → tải về file `.pem`, nội dung file này là `GITHUB_PRIVATE_KEY`
8. Install App vào 1 repo cá nhân của bạn → vào URL cài đặt, lấy `installation_id` từ URL dạng
   `https://github.com/settings/installations/<installation_id>` (đây là `GITHUB_INSTALLATION_ID`)

### 2. Cấu hình local

```bash
cp .env.example .env
```
````

Điền vào `.env`:

- `GITHUB_APP_ID` — App ID ở bước 6
- `GITHUB_PRIVATE_KEY` — nội dung file `.pem` ở bước 7, giữ nguyên `\n` xuống dòng
- `GITHUB_INSTALLATION_ID` — ở bước 8
- `GITHUB_WEBHOOK_SECRET` — chuỗi bí mật ở bước 3
- `ANTHROPIC_API_KEY` — API key Anthropic của bạn

### 3. Chạy local + expose qua ngrok

```bash
npm install
npm run dev
```

Ở terminal khác:

```bash
ngrok http 3000
```

Copy URL https ngrok trả về, quay lại GitHub App settings → cập nhật Webhook URL thành
`<ngrok-url>/webhook`.

### 4. Test

Mở 1 Pull Request trên repo đã cài App → xem log ở terminal chạy `npm run dev`, và
kiểm tra file `logs/metrics.log`.

## Testing

```bash
npm test
```

````

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/config.test.ts src/index.ts README.md
git commit -m "Add config loading, composition root, and setup instructions"
````

---

## Self-Review

**Spec coverage:**

- Webhook receiver + HMAC verification → Task 2, 4
- GitHub App auth (JWT → installation token) → Task 6
- Static Context Builder (diff + filter generated/vendor) → Task 8
- LLM Reviewer with structured findings → Task 9
- Comment Poster with diff-position mapping → Task 5, 10
- Logger (console/file metrics) → Task 11
- Error handling: rate limit/API errors → Tasks 6, 7 throw on non-ok responses, caught by pipeline caller in `server.ts`'s `.catch()`; JSON-format retry → Task 9
- Testing: manual PR test + unit test for line-position mapping → Task 5 (unit test), README Step 4 (manual test)
- Out of MVP scope (SQLite, agentic session, Linear, Slack) → intentionally not included in any task

**Placeholder scan:** No TBD/TODO markers; all steps contain complete, runnable code.

**Type consistency:** `Finding` (Task 9) is consumed as-is by `commentPoster.ts` (Task 10) and `pipeline.ts` (Task 12). `ReviewContext` (Task 8) is consumed by `llmReviewer.ts` (Task 9) and `pipeline.ts` (Task 12). `PullRequestEvent` (Task 3) is consumed by `server.ts` (Task 4) and `pipeline.ts` (Task 12). `ServerConfig.runPipeline` (Task 4) matches the closure built in `index.ts` (Task 13). Checked — consistent throughout.
