# E3-3 (AIC-29): Webhook Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track A (Producer) của Epic 3 walking skeleton — route `POST /api/webhook` tại `apps/web`: verify chữ ký + parse event (tái dùng từ `@happyfeeling/github`), enqueue job vào BullMQ qua `@happyfeeling/queue`, trả `202` ngay không đợi pipeline chạy xong. Route này **không** gọi `runReviewPipeline` — đó là việc của Track B/worker (AIC-30, chưa làm).

**Architecture:** `apps/web/app/api/webhook/route.ts` nhận request → đọc raw body bằng `req.text()` → verify bằng `verifySignature` (từ `@happyfeeling/github/webhook/verify`) → nếu hợp lệ, parse bằng `parsePullRequestEvent` (từ `@happyfeeling/github/webhook/parse`) → nếu là event liên quan, `add()` job vào `Queue<ReviewJobPayload>` (từ `@happyfeeling/queue`, singleton tạo 1 lần ở module scope, không tạo mới mỗi request) → trả `202`.

**Tech Stack:** Next.js 14 App Router (Web API `Request`/`Response`, không cần `NextRequest`), BullMQ qua `@happyfeeling/queue`, Vitest (mới scaffold cho `apps/web` — package này hiện chưa có test infra).

## Global Constraints — đọc kỹ trước khi code

- **[Prerequisite fix, chặn tất cả các task sau] `packages/queue/package.json` thiếu field `main`/`types`.** Hiện tại package này KHÔNG có `main` trỏ vào `dist/index.js` (khác với `@happyfeeling/config` đã có đúng). Import bare `from '@happyfeeling/queue'` từ `apps/web` sẽ không resolve được nếu không fix trước. Đây là Task 0 của plan này — nhỏ, không liên quan trực tiếp AIC-29 nhưng bắt buộc phải xong trước khi làm tiếp.

- **Đọc raw body bằng `req.text()`, KHÔNG parse JSON trước khi verify** — HMAC tính trên raw bytes, parse trước sẽ đổi whitespace/key order và verify luôn fail dù chữ ký đúng.

- **`loadRootEnv` có giả định cứng về độ sâu thư mục — dễ gãy âm thầm nếu gọi sai chỗ.** `loadRootEnv(callerModuleUrl)` (trong `@happyfeeling/config`) luôn đi lên đúng 3 cấp thư mục từ file gọi nó để tìm `.env` gốc — đúng cho mọi file `packages/X/src/*.ts` (đi lên: `X` → `packages` → root). Nếu gọi trực tiếp trong `apps/web/app/api/webhook/route.ts` (sâu hơn), nó sẽ đi lên chỉ tới `apps/web/.env` (không tồn tại) — `dotenv` sẽ âm thầm không load được gì, `GITHUB_WEBHOOK_SECRET` là `undefined`, mọi webhook hợp lệ đều bị verify fail (401) mà không có lỗi rõ ràng nào báo ra. **Bắt buộc:** gọi `loadRootEnv` từ 1 file ở đúng độ sâu `apps/web/lib/config.ts` (3 cấp: `web` → `apps` → root, khớp với `packages/X/src`), rồi `route.ts` import lại từ đó — không gọi thẳng trong `route.ts`.

- **`createReviewQueue()` phải là singleton ở module scope, không tạo mới mỗi request** — mỗi lần gọi hàm này sẽ tạo 1 kết nối Redis mới (`createRedisConnection()` mặc định); tạo mới mỗi webhook request sẽ rò rỉ kết nối Redis dần theo traffic.

- **`apps/web` hiện chưa có test infra nào** (không có `vitest.config.ts`, không có script `test` trong `package.json`, khác hẳn `packages/github`/`queue`/`config`/`db`) — phải scaffold trước khi viết test cho route.

- **Ngoài phạm vi task này (không sửa ở đây):** `docker-compose.yml`'s service `web` hiện chưa pass `GITHUB_WEBHOOK_SECRET`/`REDIS_URL` vào container, và `.dockerignore` loại `.env` khỏi build context — nghĩa là chạy qua `docker compose up web` sẽ không đọc được các biến này. Đây là việc của E3-5 (nghiệm thu chung, chạy `docker compose up -d postgres redis web worker`) hoặc người làm Track B — không mở rộng scope ở task này, chỉ ghi chú lại để không ai bất ngờ.

- Next.js App Router route handler dùng Web API chuẩn: `export async function POST(req: Request): Promise<Response>` — không cần `NextRequest`/`NextResponse` cho route này (không dùng cookies/`nextUrl`).
- File nội bộ trong `apps/web` dùng `moduleResolution: bundler` (khác `NodeNext` của `packages/*`) — import tương đối **không cần đuôi `.js`** (ví dụ `from '../../../lib/queue'`, không phải `'../../../lib/queue.js'`).

---

### Task 0: Fix `packages/queue/package.json` thiếu `main`/`types`

**Files:**

- Modify: `packages/queue/package.json`

- [ ] **Step 1: Thêm 2 field còn thiếu**

So với `packages/config/package.json` (đã có đúng `"main": "./dist/loadRootEnv.js", "types": "./dist/loadRootEnv.d.ts"`), thêm vào `packages/queue/package.json`:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
```

(đặt sau `"type": "module"`, trước `"engines"` — giữ nguyên mọi field khác)

- [ ] **Step 2: Verify build + resolve**

Run: `pnpm --filter @happyfeeling/queue build` — xác nhận `dist/index.js` + `dist/index.d.ts` tồn tại.
Run thử resolve từ Node: `node -e "console.log(require.resolve('@happyfeeling/queue'))"` (chạy trong `apps/web` sau khi Task 5 thêm dependency) — hoặc đơn giản là để Task 4 tự lộ lỗi nếu vẫn chưa resolve được.

- [ ] **Step 3: Commit riêng**

```bash
git add packages/queue/package.json
git commit -m "fix(queue): add missing main/types to package.json"
```

---

### Task 1: Scaffold Vitest cho `apps/web`

**Files:**

- Modify: `apps/web/package.json` (thêm script `test`, devDependency `vitest`)
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: Thêm vào `apps/web/package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run"
},
```

Thêm `"vitest": "^2.0.0"` vào `devDependencies` (khớp version các package khác trong repo).

- [ ] **Step 2: Tạo `apps/web/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Cài đặt + verify chạy được (chưa có test nào, chỉ cần không lỗi cấu hình)**

Run: `pnpm install` (link devDependency mới), rồi `pnpm --filter @happyfeeling/web test` — expect: "No test files found" (không phải lỗi cấu hình).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(web): scaffold vitest"
```

---

### Task 2: `apps/web/lib/config.ts` — load root `.env` đúng cách

**Files:**

- Create: `apps/web/lib/config.ts`
- Test: `apps/web/lib/config.test.ts`

**Interfaces:**

- Produces: `getWebhookSecret(): string` — đọc `GITHUB_WEBHOOK_SECRET` từ env (đã load qua `loadRootEnv`), throw nếu thiếu.

- [ ] **Step 1: Viết test thất bại**

```typescript
// apps/web/lib/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @happyfeeling/web test` — expect FAIL: `Cannot find module './config'`.

- [ ] **Step 3: Viết implementation**

```typescript
// apps/web/lib/config.ts
import { loadRootEnv } from "@happyfeeling/config";

loadRootEnv(import.meta.url);

export function getWebhookSecret(): string {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret)
    throw new Error("Missing required env var: GITHUB_WEBHOOK_SECRET");
  return secret;
}
```

**Vì sao file này nằm ở `apps/web/lib/` chứ không phải sâu hơn:** `apps/web/lib` có đúng độ sâu 3 cấp từ repo root (`web` → `apps` → root) khớp với giả định cứng trong `loadRootEnv` — xem Global Constraints ở trên.

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/web test` — PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/config.ts apps/web/lib/config.test.ts
git commit -m "feat(web): add root-env-aware webhook secret loader"
```

---

### Task 3: `apps/web/lib/queue.ts` — singleton queue instance

**Files:**

- Create: `apps/web/lib/queue.ts`

**Interfaces:**

- Produces: `reviewQueue: Queue<ReviewJobPayload>` — 1 instance dùng chung cho toàn bộ process, export thẳng (không phải factory) để route handler và test cùng import chung 1 kết nối.

**Không viết test riêng cho file này** — chỉ là 1 dòng khởi tạo singleton, được test gián tiếp qua test của route ở Task 4 (route thực sự add job vào đúng instance này).

- [ ] **Step 1: Viết implementation**

```typescript
// apps/web/lib/queue.ts
import { createReviewQueue } from "@happyfeeling/queue";
import "./config"; // đảm bảo loadRootEnv đã chạy trước khi đọc REDIS_URL

export const reviewQueue = createReviewQueue();
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/queue.ts
git commit -m "feat(web): add singleton review queue instance"
```

---

### Task 4: `apps/web/app/api/webhook/route.ts` — route chính

**Files:**

- Create: `apps/web/app/api/webhook/route.ts`
- Test: `apps/web/app/api/webhook/route.test.ts`

**Interfaces:**

- Consumes: `verifySignature` (`@happyfeeling/github/webhook/verify`), `parsePullRequestEvent` (`@happyfeeling/github/webhook/parse`), `getWebhookSecret` (`../../../lib/config`), `reviewQueue` (`../../../lib/queue`), `REVIEW_QUEUE_NAME` (`@happyfeeling/queue`).
- Produces: `export async function POST(req: Request): Promise<Response>`.

**Test dùng Redis thật** (giống convention `packages/queue` — không mock `reviewQueue`), cần `docker compose up -d redis` trước khi chạy. Dọn queue trước/sau mỗi test bằng `reviewQueue.obliterate({ force: true })` để không rò job giữa các lần chạy test.

- [ ] **Step 1: Viết test thất bại**

```typescript
// apps/web/app/api/webhook/route.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";
import { POST } from "./route";
import { reviewQueue } from "../../../lib/queue";

const SECRET = "test-webhook-secret";

function sign(body: string): string {
  return (
    "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex")
  );
}

function makeRequest(body: string, signature?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("x-hub-signature-256", signature);
  return new Request("http://localhost/api/webhook", {
    method: "POST",
    body,
    headers,
  });
}

const PR_OPENED_PAYLOAD = JSON.stringify({
  action: "opened",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: { number: 7, head: { sha: "sha1" } },
});

describe("POST /api/webhook", () => {
  beforeEach(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    await reviewQueue.obliterate({ force: true });
  });

  afterAll(async () => {
    await reviewQueue.obliterate({ force: true });
    await reviewQueue.close();
  });

  it("rejects a request with an invalid signature", async () => {
    const res = await POST(makeRequest(PR_OPENED_PAYLOAD, "sha256=invalid"));
    expect(res.status).toBe(401);
  });

  it("rejects a request with no signature header", async () => {
    const res = await POST(makeRequest(PR_OPENED_PAYLOAD));
    expect(res.status).toBe(401);
  });

  it("returns 200 without enqueueing for an irrelevant event", async () => {
    const body = JSON.stringify({
      action: "closed",
      repository: PR_OPENED_PAYLOAD.repository,
      pull_request: {},
    });
    const res = await POST(makeRequest(body, sign(body)));
    expect(res.status).toBe(200);
    expect(await reviewQueue.getWaitingCount()).toBe(0);
  });

  it("enqueues the job and returns 202 for a valid pull_request event", async () => {
    const start = Date.now();
    const res = await POST(
      makeRequest(PR_OPENED_PAYLOAD, sign(PR_OPENED_PAYLOAD)),
    );
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(elapsed).toBeLessThan(300);

    expect(await reviewQueue.getWaitingCount()).toBe(1);
    const jobs = await reviewQueue.getWaiting();
    expect(jobs[0].data).toEqual({
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      headSha: "sha1",
    });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `docker compose up -d redis` rồi `pnpm --filter @happyfeeling/web test` — expect FAIL: `Cannot find module './route'`.

- [ ] **Step 3: Viết implementation**

```typescript
// apps/web/app/api/webhook/route.ts
import { verifySignature } from "@happyfeeling/github/webhook/verify";
import { parsePullRequestEvent } from "@happyfeeling/github/webhook/parse";
import { REVIEW_QUEUE_NAME } from "@happyfeeling/queue";
import { getWebhookSecret } from "../../../lib/config";
import { reviewQueue } from "../../../lib/queue";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? undefined;

  if (!verifySignature(rawBody, signature, getWebhookSecret())) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const event = parsePullRequestEvent(payload);
  if (!event) {
    return new Response("ignored", { status: 200 });
  }

  await reviewQueue.add(REVIEW_QUEUE_NAME, {
    owner: event.owner,
    repo: event.repo,
    prNumber: event.prNumber,
    headSha: event.headSha,
  });

  return new Response("accepted", { status: 202 });
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `pnpm --filter @happyfeeling/web test` — PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/webhook/route.ts apps/web/app/api/webhook/route.test.ts
git commit -m "feat(web): add POST /api/webhook route — verify, parse, enqueue"
```

---

### Task 5: Khai báo dependency trong `apps/web/package.json`

**Files:**

- Modify: `apps/web/package.json`

- [ ] **Step 1: Thêm 3 dependency workspace**

```json
"dependencies": {
  "@happyfeeling/config": "workspace:*",
  "@happyfeeling/github": "workspace:*",
  "@happyfeeling/queue": "workspace:*",
  "next": "^14.2.5",
  "react": "^18.3.1",
  "react-dom": "^18.3.1"
}
```

- [ ] **Step 2: `pnpm install`, verify không phá gì**

Run: `pnpm install`, rồi `pnpm --filter @happyfeeling/web build` — exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add queue/github/config workspace dependencies"
```

---

### Task 6: Nghiệm thu toàn bộ E3-3

**Không tạo file mới — chỉ verify.**

- [ ] **Step 1:** `docker compose up -d redis` (nếu chưa chạy).
- [ ] **Step 2:** `pnpm --filter @happyfeeling/web test` — toàn bộ pass (config + route, tổng ~6 test).
- [ ] **Step 3:** `pnpm --filter @happyfeeling/web build` — exit 0.
- [ ] **Step 4:** `pnpm --filter @happyfeeling/github test` + `pnpm --filter @happyfeeling/queue test` — regression, vẫn pass hết (đảm bảo Task 0's package.json fix không phá gì).
- [ ] **Step 5:** Cập nhật Linear AIC-29 sang "In Review" hoặc "Done" tuỳ quy trình — xác nhận với người dùng trước khi đổi status.
