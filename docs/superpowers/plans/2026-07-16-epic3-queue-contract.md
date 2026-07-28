# Epic 3 Queue Contract (AIC-28 / E3-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo package `@happyfeeling/queue` (contract BullMQ dùng chung giữa producer `apps/web` và consumer `apps/worker`), và mở `exports` map subpath trong `packages/github/package.json` — không chạy pipeline gì cả, chỉ chuẩn bị hợp đồng cho Track A (E3-3) và Track B (E3-4).

**Architecture:** `packages/queue/src` chia theo Option C — `connection.ts` (đọc `REDIS_URL`, tạo 1 ioredis connection dùng chung cho cả Queue lẫn Worker, tránh lặp code đọc env), `types.ts` (constant tên queue + interface payload), `queue.ts` (factory tạo Queue), `worker.ts` (factory tạo Worker), `index.ts` (barrel export). `packages/github/package.json` chỉ thêm field `exports`, không đổi logic.

**Tech Stack:** BullMQ `^5.80.5`, ioredis `^5.11.1`, TypeScript (NodeNext module resolution — import nội bộ phải có đuôi `.js`), Vitest, Redis chạy qua `docker compose up -d redis` (đã có sẵn từ Epic 1).

## Global Constraints

- Tên package: `@happyfeeling/queue`, `private: true`, `type: "module"`.
- `tsconfig.json` extends `../config/tsconfig.base.json`, `outDir: "dist"`, `rootDir: "src"` — đúng convention `packages/db`/`packages/github`.
- Mọi import nội bộ giữa các file trong `src/` phải có đuôi `.js` (không phải `.ts`) — bắt buộc vì `tsconfig.base.json` dùng `"moduleResolution": "NodeNext"`.
- `ReviewJobPayload` KHÔNG có field `installationId` (xem lý do trong Linear AIC-28 / doc E3-2).
- Test dùng Redis thật (không mock) — giống convention `packages/db/src/seed.test.ts` dùng Postgres thật. Trước khi chạy test phải có `docker compose up -d redis`.
- **Quan trọng — tránh test collision:** các file test trong `packages/queue` cùng dùng 1 tên queue cố định (`REVIEW_QUEUE_NAME`) trên cùng 1 Redis instance. Nếu Vitest chạy nhiều file test song song (mặc định `fileParallelism: true`), job của file này có thể bị worker của file khác nhặt nhầm. `vitest.config.ts` của package này phải set `test.fileParallelism: false`. Mỗi test phải tự dọn dẹp (`queue.obliterate({ force: true })` + đóng `queue`/`worker`) ở cuối test để không để lại job rác cho test sau.
- BullMQ bắt buộc option `maxRetriesPerRequest: null` trên connection ioredis dùng cho Worker (nếu không set, Worker throw lỗi ngay khi khởi tạo) — đặt trong `connection.ts`, chỉ 1 chỗ.

---

### Task 1: Scaffold package + Redis connection (`connection.ts`)

**Files:**

- Create: `packages/queue/package.json`
- Create: `packages/queue/tsconfig.json`
- Create: `packages/queue/vitest.config.ts`
- Create: `packages/queue/src/connection.ts`
- Test: `packages/queue/src/connection.test.ts`
- Modify: `.env.example` (thêm dòng `REDIS_URL=redis://localhost:6379`)

**Interfaces:**

- Produces: `createRedisConnection(): IORedis` — trả về 1 kết nối ioredis mới mỗi lần gọi, đọc `REDIS_URL` từ env (mặc định `redis://localhost:6379`), luôn set `maxRetriesPerRequest: null`.

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "@happyfeeling/queue",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "bullmq": "^5.80.5",
    "ioredis": "^5.11.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Tạo `tsconfig.json`**

```json
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Tạo `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Thêm `REDIS_URL` vào `.env.example`**

Thêm 1 dòng vào cuối file `.env.example` (giữ nguyên các dòng đang có):

```
REDIS_URL=redis://localhost:6379
```

- [ ] **Step 5: Cài dependencies để package được link vào workspace**

Run: `pnpm install`
Expected: exit 0, `pnpm-lock.yaml` cập nhật thêm `@happyfeeling/queue`.

- [ ] **Step 6: Đảm bảo Redis đang chạy**

Run: `docker compose up -d redis`
Expected: container `happyfeeling-redis-1` (hoặc tên tương tự) ở trạng thái `running`.

- [ ] **Step 7: Viết test thất bại**

```typescript
// packages/queue/src/connection.test.ts
import { describe, expect, it } from "vitest";
import { createRedisConnection } from "./connection.js";

describe("createRedisConnection", () => {
  it("connects to Redis and responds to PING", async () => {
    const connection = createRedisConnection();
    const result = await connection.ping();
    expect(result).toBe("PONG");
    await connection.quit();
  });
});
```

- [ ] **Step 8: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: FAIL — `Cannot find module './connection.js'` (file `connection.ts` chưa tồn tại).

- [ ] **Step 9: Viết implementation tối thiểu**

```typescript
// packages/queue/src/connection.ts
import IORedis from "ioredis";

export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new IORedis(url, { maxRetriesPerRequest: null });
}
```

- [ ] **Step 10: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: PASS — `connection.test.ts (1 test)`.

- [ ] **Step 11: Commit**

```bash
git add packages/queue/package.json packages/queue/tsconfig.json packages/queue/vitest.config.ts packages/queue/src/connection.ts packages/queue/src/connection.test.ts .env.example pnpm-lock.yaml
git commit -m "feat(queue): scaffold package and Redis connection factory"
```

---

### Task 2: Queue contract types (`types.ts`)

**Files:**

- Create: `packages/queue/src/types.ts`
- Test: `packages/queue/src/types.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `REVIEW_QUEUE_NAME: string`, `interface ReviewJobPayload { owner: string; repo: string; prNumber: number; headSha: string }` — Task 3 và Task 4 import cả hai từ đây.

- [ ] **Step 1: Viết test thất bại**

```typescript
// packages/queue/src/types.test.ts
import { describe, expect, it } from "vitest";
import { REVIEW_QUEUE_NAME } from "./types.js";

describe("REVIEW_QUEUE_NAME", () => {
  it("is a non-empty string", () => {
    expect(REVIEW_QUEUE_NAME).toBe("review");
  });
});
```

Ghi chú: `ReviewJobPayload` là 1 `interface` — TypeScript interface không tồn tại lúc runtime nên không viết được test runtime cho riêng nó. Nó sẽ được compiler kiểm tra gián tiếp khi Task 3/4 dùng làm generic type cho `Queue<ReviewJobPayload>`/`Worker<ReviewJobPayload>` (nếu field sai tên/kiểu, `tsc build` ở Task 5 sẽ báo lỗi).

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: FAIL — `Cannot find module './types.js'`.

- [ ] **Step 3: Viết implementation**

```typescript
// packages/queue/src/types.ts
export const REVIEW_QUEUE_NAME = "review";

export interface ReviewJobPayload {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: PASS — 2 test files (`connection.test.ts`, `types.test.ts`), tổng 2 test.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/src/types.ts packages/queue/src/types.test.ts
git commit -m "feat(queue): add REVIEW_QUEUE_NAME and ReviewJobPayload contract"
```

---

### Task 3: Queue factory (`queue.ts`)

**Files:**

- Create: `packages/queue/src/queue.ts`
- Test: `packages/queue/src/queue.test.ts`

**Interfaces:**

- Consumes: `createRedisConnection()` (Task 1), `REVIEW_QUEUE_NAME`, `ReviewJobPayload` (Task 2).
- Produces: `createReviewQueue(): Queue<ReviewJobPayload>` — Task 4 dùng để add job trong test round-trip; Track A (E3-3) sẽ dùng để enqueue từ webhook route.

- [ ] **Step 1: Viết test thất bại**

```typescript
// packages/queue/src/queue.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { createReviewQueue } from "./queue.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";

describe("createReviewQueue", () => {
  const queue = createReviewQueue();

  afterEach(async () => {
    await queue.obliterate({ force: true });
  });

  it("applies defaultJobOptions with attempts: 3 and exponential backoff", async () => {
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 42,
      headSha: "abc123",
    };

    const job = await queue.add(REVIEW_QUEUE_NAME, payload);

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: "exponential", delay: 5000 });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: FAIL — `Cannot find module './queue.js'`.

- [ ] **Step 3: Viết implementation**

```typescript
// packages/queue/src/queue.ts
import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";

export function createReviewQueue(): Queue<ReviewJobPayload> {
  return new Queue<ReviewJobPayload>(REVIEW_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: PASS — 3 test files, tổng 3 test.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/src/queue.ts packages/queue/src/queue.test.ts
git commit -m "feat(queue): add createReviewQueue factory with retry defaults"
```

---

### Task 4: Worker factory + round-trip + retry (`worker.ts`)

**Files:**

- Create: `packages/queue/src/worker.ts`
- Test: `packages/queue/src/worker.test.ts`

**Interfaces:**

- Consumes: `createRedisConnection()` (Task 1), `createReviewQueue()` (Task 3), `REVIEW_QUEUE_NAME`, `ReviewJobPayload` (Task 2).
- Produces: `createReviewWorker(processor: (job: Job<ReviewJobPayload>) => Promise<void>): Worker<ReviewJobPayload>` — Track B (E3-4) sẽ dùng trong `apps/worker/src/index.ts`.

- [ ] **Step 1: Viết test thất bại (round-trip)**

```typescript
// packages/queue/src/worker.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { createReviewQueue } from "./queue.js";
import { createReviewWorker } from "./worker.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";

describe("createReviewWorker", () => {
  let queue: ReturnType<typeof createReviewQueue> | undefined;
  let worker: ReturnType<typeof createReviewWorker> | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    queue = undefined;
    worker = undefined;
  });

  it("receives the job added to the queue", async () => {
    queue = createReviewQueue();
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 42,
      headSha: "abc123",
    };
    let receivedPayload: ReviewJobPayload | undefined;

    worker = createReviewWorker(async (job) => {
      receivedPayload = job.data;
    });

    const completed = new Promise<void>((resolve) => {
      worker!.on("completed", () => resolve());
    });

    await queue.add(REVIEW_QUEUE_NAME, payload);
    await completed;

    expect(receivedPayload).toEqual(payload);
  });

  it("retries up to 3 attempts before completing (defaultJobOptions.attempts)", async () => {
    queue = createReviewQueue();
    const payload: ReviewJobPayload = {
      owner: "octo",
      repo: "hello-world",
      prNumber: 43,
      headSha: "def456",
    };
    let callCount = 0;

    worker = createReviewWorker(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("transient failure");
      }
    });

    const completed = new Promise<void>((resolve) => {
      worker!.on("completed", () => resolve());
    });
    worker.on("failed", () => {
      throw new Error("job should not reach failed state within 3 attempts");
    });

    // backoff ngắn (100ms) chỉ để test chạy nhanh — attempts vẫn lấy từ
    // defaultJobOptions của queue (không override ở đây), nên vẫn đang test
    // đúng field attempts: 3 của Task 3.
    await queue.add(REVIEW_QUEUE_NAME, payload, {
      backoff: { type: "exponential", delay: 100 },
    });
    await completed;

    expect(callCount).toBe(3);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: FAIL — `Cannot find module './worker.js'`.

- [ ] **Step 3: Viết implementation**

```typescript
// packages/queue/src/worker.ts
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "./connection.js";
import { REVIEW_QUEUE_NAME, type ReviewJobPayload } from "./types.js";

export function createReviewWorker(
  processor: (job: Job<ReviewJobPayload>) => Promise<void>,
): Worker<ReviewJobPayload> {
  return new Worker<ReviewJobPayload>(REVIEW_QUEUE_NAME, processor, {
    connection: createRedisConnection(),
  });
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: PASS — 4 test files, tổng 5 test. Lưu ý: test retry mất tối thiểu ~100ms + thời gian 3 lần xử lý, không phải instant — nếu Vitest timeout mặc định (5000ms) không đủ, tăng `it('...', async () => {...}, 10000)`.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/src/worker.ts packages/queue/src/worker.test.ts
git commit -m "feat(queue): add createReviewWorker factory with round-trip and retry tests"
```

---

### Task 5: Barrel export + build verification

**Files:**

- Create: `packages/queue/src/index.ts`
- Test: `packages/queue/src/index.test.ts`

**Interfaces:**

- Consumes: mọi export từ `types.ts`, `queue.ts`, `worker.ts`.
- Produces: entry point `@happyfeeling/queue` — Track A/B sẽ `import { createReviewQueue, createReviewWorker, REVIEW_QUEUE_NAME, type ReviewJobPayload } from '@happyfeeling/queue'`.

- [ ] **Step 1: Viết test thất bại**

```typescript
// packages/queue/src/index.test.ts
import { describe, expect, it } from "vitest";
import {
  REVIEW_QUEUE_NAME,
  createReviewQueue,
  createReviewWorker,
} from "./index.js";

describe("package barrel export", () => {
  it("exposes REVIEW_QUEUE_NAME, createReviewQueue, createReviewWorker", () => {
    expect(REVIEW_QUEUE_NAME).toBe("review");
    expect(typeof createReviewQueue).toBe("function");
    expect(typeof createReviewWorker).toBe("function");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Viết implementation**

```typescript
// packages/queue/src/index.ts
export * from "./types.js";
export * from "./queue.js";
export * from "./worker.js";
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: PASS — 5 test files, tổng 6 test.

- [ ] **Step 5: Verify build (tiêu chí nghiệm thu #1 của E3-2)**

Run: `pnpm --filter @happyfeeling/queue build`
Expected: exit 0, tạo ra `packages/queue/dist/index.js`, `dist/connection.js`, `dist/types.js`, `dist/queue.js`, `dist/worker.js` (+ file `.d.ts` tương ứng).

- [ ] **Step 6: Commit**

```bash
git add packages/queue/src/index.ts packages/queue/src/index.test.ts
git commit -m "feat(queue): add barrel export for @happyfeeling/queue"
```

---

### Task 6: Subpath exports cho `packages/github`

**Files:**

- Modify: `packages/github/package.json` (chỉ thêm field `exports`, không đổi field nào khác)

**Interfaces:**

- Consumes: file build sẵn trong `packages/github/dist/**` (đã tồn tại từ trước, không tạo mới trong task này).
- Produces: subpath `./webhook/verify`, `./webhook/parse`, `./pipeline`, `./github/auth`, `./config`, `./logger` — Track A (E3-3) dùng `webhook/verify` + `webhook/parse`; Track B (E3-4) dùng `pipeline`, `github/auth`, `config`, `logger`.

**Ghi chú:** Task này không có acceptance test riêng trong spec E3-2 (chỉ mục "Tiêu chí nghiệm thu" của E3-2 nói về package `queue`) — Track A/B sẽ là bên thực sự exercise các subpath này khi import ở E3-3/E3-4. Ở đây chỉ cần đảm bảo JSON đúng và build hiện tại không bị hỏng.

- [ ] **Step 1: Đọc `package.json` hiện tại**

Xác nhận field `"exports"` chưa tồn tại (nếu đã tồn tại, dừng lại và báo — nghĩa là có người khác đã thêm, cần merge thủ công thay vì ghi đè).

- [ ] **Step 2: Thêm field `exports`**

Sửa `packages/github/package.json`, thêm field `"exports"` (giữ nguyên mọi field khác: `name`, `version`, `private`, `type`, `engines`, `scripts`, `dependencies`, `devDependencies`):

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./webhook/verify": "./dist/webhook/verify.js",
    "./webhook/parse": "./dist/webhook/parse.js",
    "./pipeline": "./dist/pipeline.js",
    "./github/auth": "./dist/github/auth.js",
    "./config": "./dist/config.js",
    "./logger": "./dist/logger.js"
  }
}
```

- [ ] **Step 3: Verify build không bị hỏng**

Run: `pnpm --filter @happyfeeling/github build`
Expected: exit 0, `packages/github/dist/webhook/verify.js`, `dist/webhook/parse.js`, `dist/pipeline.js`, `dist/github/auth.js`, `dist/config.js`, `dist/logger.js` đều tồn tại (khớp đúng path khai trong `exports`).

- [ ] **Step 4: Verify test hiện có không bị hỏng**

Run: `pnpm --filter @happyfeeling/github test`
Expected: PASS — toàn bộ test cũ (`client.test.ts`, `commentPoster.test.ts`, `auth.test.ts`, `verify.test.ts`, `parse.test.ts`, `pipeline.test.ts`, `config.test.ts`, `logger.test.ts`, `server.test.ts`, `contextBuilder.test.ts`, `llmReviewer.test.ts`) vẫn pass — field `exports` không ảnh hưởng logic, chỉ ảnh hưởng cách package khác import.

- [ ] **Step 5: Commit**

```bash
git add packages/github/package.json
git commit -m "feat(github): add subpath exports for webhook, pipeline, auth, config, logger"
```

---

### Task 7: Nghiệm thu toàn bộ E3-2

**Không tạo file mới — chỉ verify lại toàn bộ tiêu chí nghiệm thu trong Linear AIC-28.**

- [ ] **Step 1: Build toàn bộ package `queue`**

Run: `pnpm --filter @happyfeeling/queue build`
Expected: exit 0.

- [ ] **Step 2: Chạy toàn bộ test package `queue`**

Run: `pnpm --filter @happyfeeling/queue test`
Expected: PASS — 6 test file, đủ cả: round-trip (Task 4), retry attempts:3 (Task 4), defaultJobOptions (Task 3).

- [ ] **Step 3: Chạy toàn bộ test package `github` (regression)**

Run: `pnpm --filter @happyfeeling/github test`
Expected: PASS.

- [ ] **Step 4: Build toàn repo (regression cuối)**

Run: `pnpm build`
Expected: exit 0 cho tất cả package trong workspace.

- [ ] **Step 5: Cập nhật Linear**

Chuyển AIC-28 sang "In Review" hoặc "Done" tuỳ quy trình review của bạn (không tự động chuyển — xác nhận với thb trước khi đổi status).
