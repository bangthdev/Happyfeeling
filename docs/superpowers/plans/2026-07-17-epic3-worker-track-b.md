# AIC-30 — Epic 3 Track B: Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `apps/worker`, a new Node process that consumes BullMQ review jobs (enqueued by `apps/web`'s webhook route), runs the existing review pipeline, and writes each posted finding as a `Finding` row in Postgres via the shared Prisma client. This is the last missing piece before Epic 3 can be verified end-to-end (E3-5).

**Architecture:** `apps/worker/src/index.ts` is a thin composition root (loads env, builds deps, starts `createReviewWorker`). The actual per-job logic lives in `apps/worker/src/processJob.ts` as a small function that takes `runPipeline` as an injected dependency — this keeps it unit-testable without a real GitHub App/Groq call, while a separate integration test exercises the real BullMQ round-trip against local Redis + Postgres. Two small upstream changes are needed first: `runReviewPipeline` (packages/github) currently returns `void` — it must return the posted findings so the worker can write them to DB — and a `computeDedupHash` helper (needed because the `Finding` table's `dedupHash` column is `@unique` with no default, so any insert needs a value today, even though the full dedup-or-skip logic is a separate ticket, AIC-31/E4-1).

**Tech Stack:** TypeScript (NodeNext/ES2022, strict), BullMQ (`@happyfeeling/queue`), Prisma 7 (`@happyfeeling/db`), Vitest, pnpm workspaces.

## Global Constraints

- Node >= 18, TypeScript `strict: true`, module/moduleResolution `NodeNext` (from `packages/config/tsconfig.base.json` — every package's `tsconfig.json` extends this).
- Workspace dependencies use `workspace:*`.
- TDD: write the failing test before the implementation for every task that has one.
- Commit messages: English, imperative subject ≤72 chars, body explains why/what (not how), no AI-attribution line.
- No ticket IDs in code/test comments (commit messages may reference `AIC-30`).
- **Out of scope for this plan (explicitly deferred, do not implement here):**
  - AIC-31/E4-1's dedup-or-skip logic (querying `dedupHash` before insert, upserting `lastSeenAt` instead of re-posting). This plan only adds the `computeDedupHash` primitive that E4-1 will reuse — inserting a finding whose `dedupHash` already exists in the DB will throw a Prisma unique-constraint error today. That's expected and is AIC-31's job to fix, not this one's.
  - The `web` service's docker-compose gap (missing `REDIS_URL`/`GITHUB_WEBHOOK_SECRET`) flagged in the AIC-29 plan — not touched here. Only the new `worker` service's env is added, correctly, in Task 8.

---

### Task 1: `runReviewPipeline` returns the posted findings

**Files:**
- Modify: `packages/github/src/pipeline.ts`
- Modify: `packages/github/src/pipeline.test.ts`

**Interfaces:**
- Produces: `export interface PipelineResult { posted: Finding[] }`, `runReviewPipeline(event: PullRequestEvent, deps: PipelineDeps): Promise<PipelineResult>` (was `Promise<void>`). Also re-exports `Finding` from this module (`export type { Finding }`) so consumers can import it from `@happyfeeling/github/pipeline` without a new export entry.

- [ ] **Step 1: Update the first test to assert on the return value**

In `packages/github/src/pipeline.test.ts`, change the first test (`'orchestrates diff fetch, review, comment posting, and metrics logging'`) — replace:

```ts
    await runReviewPipeline(event, { getToken, groqApiKey: 'fake-groq-key' });
```

with:

```ts
    const result = await runReviewPipeline(event, { getToken, groqApiKey: 'fake-groq-key' });

    expect(result).toEqual({
      posted: [{ file: 'src/x.ts', line: 1, severity: 'high', message: 'm', suggestion: 's' }],
    });
```

Also update the third test (`'still posts and logs the findings collected before a partial review failure'`) — replace:

```ts
    await runReviewPipeline(event, { getToken, groqApiKey: 'fake-groq-key' });
```

with:

```ts
    const result = await runReviewPipeline(event, { getToken, groqApiKey: 'fake-groq-key' });

    expect(result).toEqual({ posted: partialFindings });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @happyfeeling/github test`
Expected: FAIL — the two updated tests fail because `runReviewPipeline` currently resolves to `undefined`, not `{ posted: [...] }`.

- [ ] **Step 3: Update `pipeline.ts`**

In `packages/github/src/pipeline.ts`, add the re-export and result type, and return `{ posted }` at the end:

```ts
import { getPullRequestDiff } from './github/client.js';
import { buildContext } from './review/contextBuilder.js';
// TEMP: swapped from './review/llmReviewer.js' (Claude) to test free via Groq.
// To revert: import reviewDiff from llmReviewer.js again and change
// PipelineDeps.groqApiKey back to anthropicClient: Anthropic.
import { reviewDiff, PartialReviewError } from './review/llmReviewer.groq.js';
import type { Finding } from './review/llmReviewer.js';
import { postFindings } from './review/commentPoster.js';
import { logMetrics } from './logger.js';
import type { PullRequestEvent } from './webhook/parse.js';

export type { Finding };

export interface PipelineDeps {
  getToken: () => Promise<string>;
  groqApiKey: string;
}

export interface PipelineResult {
  posted: Finding[];
}

export async function runReviewPipeline(event: PullRequestEvent, deps: PipelineDeps): Promise<PipelineResult> {
  const start = Date.now();

  const token = await deps.getToken();
  const rawDiff = await getPullRequestDiff(token, event.owner, event.repo, event.prNumber);
  const context = buildContext(rawDiff);

  let findings: Finding[];
  let tokensUsed: number;
  try {
    ({ findings, tokensUsed } = await reviewDiff(context, deps.groqApiKey));
  } catch (err) {
    if (!(err instanceof PartialReviewError)) throw err;
    ({ findings, tokensUsed } = err.partialResult);
    console.error(
      `PR #${event.prNumber}: Groq review failed partway through — posting the ${findings.length} finding(s) already collected instead of discarding them`,
      err.cause
    );
  }

  const { posted, failed } = await postFindings({
    token,
    owner: event.owner,
    repo: event.repo,
    prNumber: event.prNumber,
    commitSha: event.headSha,
    findings,
  });

  const severityBreakdown: Record<string, number> = {};
  for (const finding of findings) {
    severityBreakdown[finding.severity] = (severityBreakdown[finding.severity] ?? 0) + 1;
  }

  logMetrics({
    pr_number: event.prNumber,
    findings_count: posted.length,
    severity_breakdown: severityBreakdown,
    latency_ms: Date.now() - start,
    tokens_used: tokensUsed,
  });

  if (failed.length > 0) {
    const attempted = posted.length + failed.length;
    throw new Error(`Failed to post ${failed.length} of ${attempted} finding(s) for PR #${event.prNumber}`);
  }

  return { posted };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @happyfeeling/github test`
Expected: PASS — all 4 tests in `pipeline.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add packages/github/src/pipeline.ts packages/github/src/pipeline.test.ts
git commit -m "Return posted findings from runReviewPipeline

The worker (AIC-30) needs to know which findings were actually
posted so it can write matching Finding rows to Postgres."
```

---

### Task 2: `computeDedupHash` helper + export subpath

**Files:**
- Create: `packages/github/src/review/dedup.ts`
- Create: `packages/github/src/review/dedup.test.ts`
- Modify: `packages/github/package.json`

**Interfaces:**
- Produces: `computeDedupHash(repo: string, filePath: string, line: number): string`, importable from `@happyfeeling/github/review/dedup`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/github/src/review/dedup.test.ts
import { describe, it, expect } from 'vitest';
import { computeDedupHash } from './dedup.js';

describe('computeDedupHash', () => {
  it('returns the same hash for the same repo/filePath/line', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    expect(a).toBe(b);
  });

  it('returns a different hash when the line differs', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/widgets', 'src/x.ts', 11);
    expect(a).not.toBe(b);
  });

  it('returns a different hash when the file path differs', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/widgets', 'src/y.ts', 10);
    expect(a).not.toBe(b);
  });

  it('returns a different hash when the repo differs', () => {
    const a = computeDedupHash('acme/widgets', 'src/x.ts', 10);
    const b = computeDedupHash('acme/other', 'src/x.ts', 10);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/github test -- dedup`
Expected: FAIL — `Cannot find module './dedup.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/github/src/review/dedup.ts
import { createHash } from 'node:crypto';

export function computeDedupHash(repo: string, filePath: string, line: number): string {
  return createHash('sha256').update(`${repo}:${filePath}:${line}`).digest('hex');
}
```

- [ ] **Step 4: Add the export subpath**

In `packages/github/package.json`, add one line to `exports`:

```json
  "exports": {
    ".": "./dist/index.js",
    "./webhook/verify": "./dist/webhook/verify.js",
    "./webhook/parse": "./dist/webhook/parse.js",
    "./pipeline": "./dist/pipeline.js",
    "./github/auth": "./dist/github/auth.js",
    "./config": "./dist/config.js",
    "./logger": "./dist/logger.js",
    "./review/dedup": "./dist/review/dedup.js"
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @happyfeeling/github test -- dedup`
Expected: PASS — 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/github/src/review/dedup.ts packages/github/src/review/dedup.test.ts packages/github/package.json
git commit -m "Add computeDedupHash and export it as a subpath

The Finding table's dedupHash column is unique with no default, so
the worker (AIC-30) needs a deterministic hash to insert rows now —
the full dedup-or-skip logic (checking before insert) is AIC-31."
```

---

### Task 3: Make `@happyfeeling/db` an importable package

**Files:**
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/index.test.ts`
- Modify: `packages/db/package.json`

**Interfaces:**
- Produces: `prisma` (the shared Prisma client singleton), importable from `@happyfeeling/db`.

**Context:** `packages/db` currently has no `main`/`exports`/`build` — it's only ever run directly via `tsx`/`vitest` (`seed.ts`, `seed.test.ts`), never imported by another package. `apps/worker` is the first consumer, so it needs a real entry point and a build step, matching the pattern already used by `packages/config`, `packages/queue`, and `packages/github`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from './index.js';

describe('index', () => {
  it('exports the shared prisma client', () => {
    expect(prisma).toBeDefined();
    expect(prisma.finding).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @happyfeeling/db test -- index`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/db/src/index.ts
export { prisma } from './client.js';
```

- [ ] **Step 4: Add build config to `package.json`**

In `packages/db/package.json`, add `main`, `types`, and a `build` script:

```json
{
  "name": "@happyfeeling/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate:deploy": "prisma migrate deploy",
    "seed": "tsx src/seed.ts",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/adapter-pg": "^7.8.0",
    "@prisma/client": "^7.8.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "prisma": "^7.8.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @happyfeeling/db test -- index`
Expected: PASS.

- [ ] **Step 6: Verify the build actually works**

Run: `pnpm --filter @happyfeeling/db generate && pnpm --filter @happyfeeling/db build`
Expected: exit 0, produces `packages/db/dist/index.js` + `dist/client.js` + compiled `dist/generated/prisma/**`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/index.ts packages/db/src/index.test.ts packages/db/package.json
git commit -m "Add a build entry point to @happyfeeling/db

apps/worker (AIC-30) is the first consumer of this package from
outside packages/db itself, so it needs main/types/build like the
other workspace packages already have."
```

---

### Task 4: Scaffold `apps/worker`

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/vitest.config.ts`

**Interfaces:**
- Produces: a new workspace package `@happyfeeling/worker` (no runtime code yet — that's Tasks 5–7).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@happyfeeling/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "pretest": "pnpm --filter @happyfeeling/config build && pnpm --filter @happyfeeling/queue build && pnpm --filter @happyfeeling/db build && pnpm --filter @happyfeeling/github build",
    "test": "vitest run"
  },
  "dependencies": {
    "@happyfeeling/config": "workspace:*",
    "@happyfeeling/db": "workspace:*",
    "@happyfeeling/github": "workspace:*",
    "@happyfeeling/queue": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "bullmq": "^5.80.5",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../packages/config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
  },
});
```

(`fileParallelism: false` because Task 6's test uses the real `review` queue name against a shared local Redis — same reason `packages/queue`'s config sets this.)

- [ ] **Step 4: Install so the new workspace package is linked**

Run: `pnpm install`
Expected: exit 0, `apps/worker` shows up under `Scope: N of N workspace projects` on the next `pnpm -r` command.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/package.json apps/worker/tsconfig.json apps/worker/vitest.config.ts pnpm-lock.yaml
git commit -m "Scaffold apps/worker package (AIC-30)

No runtime code yet — just the workspace package config, so the
next tasks can add source files against a working build/test setup."
```

---

### Task 5: `processReviewJob` — pipeline result to DB rows

**Files:**
- Create: `apps/worker/src/processJob.ts`
- Create: `apps/worker/src/processJob.test.ts`

**Interfaces:**
- Consumes: `PipelineDeps`, `PipelineResult`, `Finding` from `@happyfeeling/github/pipeline`; `PullRequestEvent` from `@happyfeeling/github/webhook/parse`; `computeDedupHash` from `@happyfeeling/github/review/dedup`; `prisma` from `@happyfeeling/db`; `ReviewJobPayload` from `@happyfeeling/queue`.
- Produces: `interface ProcessJobDeps { runPipeline: (event: PullRequestEvent, deps: PipelineDeps) => Promise<PipelineResult>; pipelineDeps: PipelineDeps }`, `processReviewJob(job: Job<ReviewJobPayload>, deps: ProcessJobDeps): Promise<void>` — Task 7 wires this to the real `runReviewPipeline`; Task 6 tests it against a real queue/worker.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/processJob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ReviewJobPayload } from '@happyfeeling/queue';

vi.mock('@happyfeeling/db', () => ({
  prisma: { finding: { create: vi.fn() } },
}));

import { prisma } from '@happyfeeling/db';
import { processReviewJob } from './processJob.js';

function fakeJob(data: ReviewJobPayload): Job<ReviewJobPayload> {
  return { data } as Job<ReviewJobPayload>;
}

describe('processReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runPipeline with an event built from the job payload', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = { getToken: vi.fn(), groqApiKey: 'fake-key' };

    await processReviewJob(
      fakeJob({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' }),
      { runPipeline, pipelineDeps }
    );

    expect(runPipeline).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1', action: 'synchronize' },
      pipelineDeps
    );
  });

  it('writes one Finding row per posted finding', async () => {
    const posted = [
      { file: 'src/x.ts', line: 10, severity: 'high' as const, message: 'bug here', suggestion: 'fix it' },
    ];
    const runPipeline = vi.fn().mockResolvedValue({ posted });
    const pipelineDeps = { getToken: vi.fn(), groqApiKey: 'fake-key' };

    await processReviewJob(
      fakeJob({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' }),
      { runPipeline, pipelineDeps }
    );

    expect(prisma.finding.create).toHaveBeenCalledTimes(1);
    expect(prisma.finding.create).toHaveBeenCalledWith({
      data: {
        repo: 'acme/widgets',
        prNumber: 7,
        filePath: 'src/x.ts',
        line: 10,
        errorType: 'high',
        message: 'bug here',
        dedupHash: expect.any(String),
      },
    });
  });

  it('writes no rows when nothing was posted', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ posted: [] });
    const pipelineDeps = { getToken: vi.fn(), groqApiKey: 'fake-key' };

    await processReviewJob(
      fakeJob({ owner: 'acme', repo: 'widgets', prNumber: 7, headSha: 'sha1' }),
      { runPipeline, pipelineDeps }
    );

    expect(prisma.finding.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @happyfeeling/worker test -- processJob`
Expected: FAIL — `Cannot find module './processJob.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/worker/src/processJob.ts
import type { Job } from 'bullmq';
import type { ReviewJobPayload } from '@happyfeeling/queue';
import type { Finding, PipelineDeps, PipelineResult } from '@happyfeeling/github/pipeline';
import type { PullRequestEvent } from '@happyfeeling/github/webhook/parse';
import { computeDedupHash } from '@happyfeeling/github/review/dedup';
import { prisma } from '@happyfeeling/db';

export interface ProcessJobDeps {
  runPipeline: (event: PullRequestEvent, deps: PipelineDeps) => Promise<PipelineResult>;
  pipelineDeps: PipelineDeps;
}

function toDbFinding(repoSlug: string, prNumber: number, finding: Finding) {
  return {
    repo: repoSlug,
    prNumber,
    filePath: finding.file,
    line: finding.line,
    errorType: finding.severity,
    message: finding.message,
    dedupHash: computeDedupHash(repoSlug, finding.file, finding.line),
  };
}

export async function processReviewJob(job: Job<ReviewJobPayload>, deps: ProcessJobDeps): Promise<void> {
  const { owner, repo, prNumber, headSha } = job.data;
  // `action` isn't read anywhere inside runReviewPipeline — a fixed value satisfies the type.
  const event: PullRequestEvent = { owner, repo, prNumber, headSha, action: 'synchronize' };

  const { posted } = await deps.runPipeline(event, deps.pipelineDeps);

  const repoSlug = `${owner}/${repo}`;
  for (const finding of posted) {
    await prisma.finding.create({ data: toDbFinding(repoSlug, prNumber, finding) });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @happyfeeling/worker test -- processJob`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/processJob.ts apps/worker/src/processJob.test.ts
git commit -m "Add processReviewJob: map pipeline results to Finding rows

Takes runPipeline as an injected dependency so this can be unit
tested without a real GitHub App/Groq call; Task 7 wires it to the
real runReviewPipeline."
```

---

### Task 6: Integration test — real queue + real Postgres

**Files:**
- Create: `apps/worker/src/worker.integration.test.ts`

**Interfaces:**
- Consumes: `createReviewQueue`, `createReviewWorker` from `@happyfeeling/queue`; `prisma` from `@happyfeeling/db`; `processReviewJob` from `./processJob.js` (Task 5).

**Requires running locally:** `docker compose up -d postgres redis` (from the repo root) before this test — it talks to real Redis and real Postgres, not mocks.

- [ ] **Step 1: Write the test**

```ts
// apps/worker/src/worker.integration.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createReviewQueue, createReviewWorker, REVIEW_QUEUE_NAME } from '@happyfeeling/queue';
import { prisma } from '@happyfeeling/db';
import { processReviewJob } from './processJob.js';

describe('worker (real Redis + real Postgres)', () => {
  let queue: ReturnType<typeof createReviewQueue> | undefined;
  let worker: ReturnType<typeof createReviewWorker> | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    await prisma.finding.deleteMany({ where: { repo: 'acme/integration-test' } });
  });

  it('picks up an enqueued job and writes exactly one Finding row', async () => {
    queue = createReviewQueue();
    const posted = [
      { file: 'src/x.ts', line: 5, severity: 'medium' as const, message: 'msg', suggestion: 'sugg' },
    ];
    const runPipeline = async () => ({ posted });

    worker = createReviewWorker((job) =>
      processReviewJob(job, { runPipeline, pipelineDeps: { getToken: async () => 'tok', groqApiKey: 'k' } })
    );

    const completed = new Promise<void>((resolve) => {
      worker!.on('completed', () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, {
      owner: 'acme',
      repo: 'integration-test',
      prNumber: 1,
      headSha: 'sha1',
    });
    await completed;

    const rows = await prisma.finding.findMany({ where: { repo: 'acme/integration-test' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ filePath: 'src/x.ts', line: 5, errorType: 'medium', message: 'msg' });
  });
});
```

- [ ] **Step 2: Start local Postgres + Redis**

Run: `docker compose up -d postgres redis`
Expected: both containers report `healthy`/running (`docker compose ps`).

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @happyfeeling/worker test -- worker.integration`
Expected: PASS — the job is picked up by a real BullMQ worker over real Redis, and the Finding row is confirmed via a real query against local Postgres.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/worker.integration.test.ts
git commit -m "Add worker integration test against real Redis + Postgres

Confirms the walking-skeleton wiring: an enqueued job is picked up
automatically and results in exactly one Finding row, using a fake
runPipeline so no real GitHub/Groq call is made."
```

---

### Task 7: `apps/worker/src/index.ts` — real bootstrap

**Files:**
- Create: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `loadRootEnv` from `@happyfeeling/config`; `createReviewWorker` from `@happyfeeling/queue`; `runReviewPipeline` from `@happyfeeling/github/pipeline`; `createInstallationTokenProvider` from `@happyfeeling/github/github/auth`; `loadConfig` from `@happyfeeling/github/config`; `processReviewJob` from `./processJob.js` (Task 5).

No dedicated test for this file — it's a thin composition root with no branching logic, same as `packages/github/src/index.ts`, which also has none; its behavior is already covered by Task 5's unit tests and Task 6's integration test.

- [ ] **Step 1: Write the implementation**

```ts
// apps/worker/src/index.ts
import { loadRootEnv } from '@happyfeeling/config';

loadRootEnv(import.meta.url);

import { createReviewWorker } from '@happyfeeling/queue';
import { runReviewPipeline } from '@happyfeeling/github/pipeline';
import { createInstallationTokenProvider } from '@happyfeeling/github/github/auth';
import { loadConfig } from '@happyfeeling/github/config';
import { processReviewJob } from './processJob.js';

const config = loadConfig();
const tokenProvider = createInstallationTokenProvider(
  config.githubAppId,
  config.githubPrivateKey,
  config.githubInstallationId
);

createReviewWorker((job) =>
  processReviewJob(job, {
    runPipeline: runReviewPipeline,
    pipelineDeps: { getToken: () => tokenProvider.getToken(), groqApiKey: config.groqApiKey },
  })
);

console.log('Worker listening for review jobs...');
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm --filter @happyfeeling/worker build`
Expected: exit 0, produces `apps/worker/dist/index.js`.

- [ ] **Step 3: Verify it actually starts (manual smoke test)**

With `docker compose up -d postgres redis` still running and the root `.env` populated (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET`, `GROQ_API_KEY`, `DATABASE_URL`, `REDIS_URL`):

Run: `pnpm --filter @happyfeeling/worker dev`
Expected: prints `Worker listening for review jobs...` and stays running (no thrown error on startup). Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "Add apps/worker bootstrap (AIC-30)

Wires the real runReviewPipeline and GitHub App token provider into
processReviewJob and starts consuming the review queue."
```

---

### Task 8: Docker — `apps/worker/Dockerfile` + `docker-compose.yml`

**Files:**
- Create: `apps/worker/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# apps/worker/Dockerfile
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @happyfeeling/db exec prisma generate
RUN pnpm -r build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo ./

CMD ["pnpm", "--filter", "@happyfeeling/worker", "start"]
```

(`pnpm -r build` — not `pnpm --filter @happyfeeling/worker build` — because pnpm's recursive build already runs in dependency-topological order, so `@happyfeeling/config`/`queue`/`db`/`github` are built before `@happyfeeling/worker`; the `prisma generate` step must run first since `@happyfeeling/db`'s build compiles the generated client.)

- [ ] **Step 2: Add the `worker` service to `docker-compose.yml`**

Add this block after the `web` service (before `volumes:`):

```yaml
  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment:
      DATABASE_URL: postgresql://happyfeeling:happyfeeling@postgres:5432/happyfeeling?schema=public
      REDIS_URL: redis://redis:6379
      GITHUB_APP_ID: ${GITHUB_APP_ID}
      GITHUB_PRIVATE_KEY: ${GITHUB_PRIVATE_KEY}
      GITHUB_INSTALLATION_ID: ${GITHUB_INSTALLATION_ID}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
      GROQ_API_KEY: ${GROQ_API_KEY}
    depends_on:
      - postgres
      - redis
```

(Docker Compose substitutes `${VAR}` from the root `.env` file itself at the host level — a separate mechanism from the app's own `dotenv`/`loadRootEnv` loading, and unaffected by `.dockerignore` excluding `.env` from the build context. This matches how `postgres`/`redis`/`web` already get their config today.)

- [ ] **Step 3: Verify the image builds**

Run: `docker compose build worker`
Expected: exit 0.

- [ ] **Step 4: Verify the full stack runs (manual smoke test, ties into E3-5 later)**

Run: `docker compose up -d postgres redis worker` then `docker compose logs worker`
Expected: logs show `Worker listening for review jobs...`, no crash loop.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/Dockerfile docker-compose.yml
git commit -m "Add worker service to docker-compose.yml (AIC-30)

Builds and runs apps/worker alongside postgres/redis, with its own
DATABASE_URL/REDIS_URL pointed at the compose network's service
names and GitHub/Groq secrets passed through from the root .env."
```

---

## Acceptance Criteria (matches the original E3-4 spec)

- `pnpm --filter @happyfeeling/worker test` passes, including the real-Redis/real-Postgres integration test (Task 6): one enqueued job is picked up automatically and results in exactly one matching `Finding` row.
- `logMetrics` behavior is unchanged and already covered by `packages/github/src/pipeline.test.ts` (Task 1 only changes the return value, not the logging call) — not re-asserted at the worker level to avoid duplicating that existing test contract.
- `docker compose up -d postgres redis worker` runs without crashing (Task 8).
- Epic 3 end-to-end verification (E3-5 — real PR, real webhook, real comment + real DB row) is a separate, later step once this plan's tasks are merged.
