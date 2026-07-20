# Epic 3 + Epic 4: Walking Skeleton & Dedup/Idempotency — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ Đây là spec cấp task, KHÔNG phải plan chi tiết để code thẳng.** Mỗi mục dưới đây chỉ nêu Mục tiêu/Interface bắt buộc/Tiêu chí nghiệm thu (giống Epic 1+2 trước) — cách implement do người thực hiện tự quyết. **Trước khi bắt đầu code 1 task, viết 1 plan chi tiết riêng cho task đó** (từng bước cụ thể, viết test trước khi code), dùng đúng mục tương ứng ở đây làm spec/interface đầu vào. Lưu plan chi tiết đó thành file riêng, ví dụ `docs/superpowers/plans/YYYY-MM-DD-<task-slug>.md`.

**Mục tiêu:** Epic 3 — chứng minh nền móng monorepo (Epic 1) + schema (Epic 2) chạy được end-to-end đúng kiến trúc async: webhook trả 200 ngay lập tức, đẩy job vào BullMQ + Redis, worker riêng chạy LLM review 1 lượt đơn giản, post comment đúng vị trí bằng `line`+`side`, ghi kết quả vào Postgres. Epic 4 — không post trùng finding khi review lại cùng PR (dedup nội dung), và không xử lý trùng job khi GitHub gửi lại webhook (idempotency ở tầng hàng đợi).

**Kiến trúc:** Thêm `packages/queue` (contract BullMQ dùng chung giữa producer/consumer) và `apps/worker` (process Node riêng, không phải Next.js — chạy độc lập với `apps/web`). `apps/web` chỉ thêm 1 route nhận webhook + enqueue, không tự chạy pipeline. `packages/github` giữ nguyên logic review hiện có (`pipeline.ts`, `review/*`, `github/*`) nhưng mở thêm **subpath exports** để `apps/web` và `apps/worker` import được từng phần thay vì chỉ import trọn `src/index.ts` (vốn tự khởi động Express server ngay khi import — không dùng được trong worker/route).

**Công nghệ:** BullMQ + ioredis (Redis đã có sẵn trong `docker-compose.yml` từ Epic 1 Task A3), Next.js Route Handler (`apps/web/app/api/webhook/route.ts`), Prisma client dùng chung từ `packages/db` (Epic 2 Task B3).

## Ràng buộc chung

- Package mới đặt tên `@happyfeeling/<tên>` (`@happyfeeling/queue`, `@happyfeeling/worker`), `private: true`, `tsconfig.json` extends `packages/config/tsconfig.base.json` — đúng convention Epic 1.
- Không sửa logic review hiện có (`buildContext`, `reviewDiff`, cách gọi Groq) — Epic 3/4 chỉ đổi **nơi gọi** (Express → worker) và **nơi post** (position → line+side, có dedup).
- Mọi export dùng chéo package phải qua `exports` map trong `package.json` (subpath export), không import thẳng vào đường dẫn `dist/**` hay `src/**` của package khác.
- `docker-compose.yml` (tạo ở Epic 1 Task A3) sẽ được bổ sung service `worker` ở Epic 3 — đúng như note để lại trong Epic 1 ("chưa thêm vì chưa có code worker").

## Tiền đề chặn tiến độ (chưa xong thì chưa bắt đầu được)

Tại thời điểm viết plan này, Epic 1 còn `AIC-20` (Docker Compose) ở trạng thái "In Review" (chưa merge), và Epic 2 còn 3 task Backlog: `AIC-22` (migrate), `AIC-23` (client Prisma dùng chung), `AIC-24` (integration check). Track B (E3-4) không thể viết code ghi DB nếu `AIC-23` chưa merge — đây là phụ thuộc cứng, không phải tùy chọn. Kiểm tra lại trạng thái các issue này trên Linear trước khi bắt đầu Track B.

## Kế hoạch chia song song (2 người, đúng mô hình Epic 1+2)

- **E3-1** và **E3-2** là 2 việc chuẩn bị nhỏ, độc lập với nhau, ai rảnh trước làm trước — không cần đợi nhau, chỉ cần merge trước khi Track A/B bắt đầu phần phụ thuộc vào chúng.
- **Track A (E3-3 → E4-2, Producer):** chỉ đụng `apps/web/**` — route webhook, enqueue job.
- **Track B (E3-4 → E4-1, Consumer):** chỉ đụng `apps/worker/**` — xử lý job, post comment, ghi DB.
- **E3-5** và **E4-3** là bước nghiệm thu chung, làm cuối cùng sau khi cả 2 track merge — không tạo file mới, chỉ verify.
- Track B phụ thuộc thêm vào **Epic 2 Task B3** (`AIC-23`, client Prisma dùng chung) — nếu B3 chưa merge khi Track B tới E3-4, người làm Track B cần tự hoàn thành B3 trước hoặc phối hợp với người đang giữ B3.

---

### E3-1: Đổi comment poster từ `position` sang `line`+`side`

**Branch:** `nhd98z2/epic3-line-side-comment`

**Phạm vi file:** `packages/github/src/github/client.ts`, `packages/github/src/review/commentPoster.ts`, `packages/github/src/github/client.test.ts`, `packages/github/src/review/commentPoster.test.ts`. Xoá `packages/github/src/github/diffPosition.ts` + `diffPosition.test.ts` (sau khi đổi, không còn ai gọi `mapLineToDiffPosition`).

**Vì sao đổi:** `position` (diff-relative) tính lại được mỗi khi diff đổi, dễ lệch dòng khi PR có thêm commit mới. `line`+`side` là field ổn định GitHub API hỗ trợ trực tiếp, không cần tự parse diff.

**Interface bắt buộc:**
- `postReviewComment` (`github/client.ts`): đổi tham số `position: number` → `line: number` + `side: 'LEFT' | 'RIGHT'`. Body gửi GitHub API đổi field `position` → `line` + `side`.
- `postFindings` (`commentPoster.ts`): bỏ tham số `diff` (không cần tính position nữa). `side` luôn là `'RIGHT'` — vì `Finding.line` hiện tại chỉ bao giờ trỏ tới dòng còn tồn tại ở file mới (logic `mapLineToDiffPosition` cũ chỉ advance `newLine` trên dòng `+`/` `, chưa bao giờ trả dòng bị xoá), nên không có case `LEFT` cần xử lý ở bước này.
- **Đổi `PostFindingsResult`:** từ `{ posted: number; skipped: number }` sang `{ posted: Finding[]; skipped: number }` — Track B (E3-4) cần biết **finding nào** đã post thành công để ghi đúng row vào DB, không chỉ đếm số lượng.

**Tiêu chí nghiệm thu:**
- `pnpm --filter @happyfeeling/github test` pass hết (test cũ của `client.test.ts`/`commentPoster.test.ts` cập nhật theo interface mới, test `diffPosition` đã xoá).
- Test mới xác nhận request gửi tới GitHub API chứa `line`+`side`, không còn field `position`.

---

### E3-2: Contract dùng chung — hàng đợi BullMQ + subpath exports

**Branch:** `nhd98z2/epic3-queue-contract`

**Phạm vi file:** Tạo mới `packages/queue/**`. Sửa `packages/github/package.json` (chỉ thêm field `exports`, không đổi gì khác).

**Interface bắt buộc:**
- Package `@happyfeeling/queue` export:
  - `REVIEW_QUEUE_NAME: string`
  - `interface ReviewJobPayload { owner: string; repo: string; prNumber: number; headSha: string }` — **không** có field `installationId`: code hiện tại (`createInstallationTokenProvider` trong `index.ts`) dùng 1 `GITHUB_INSTALLATION_ID` cố định từ env cho mọi request, không có chỗ nào lấy installation theo từng webhook event. Thêm field này vào payload là thừa cho scope Epic 3 (multi-tenant theo nhiều installation không nằm trong yêu cầu Epic 3/4) — nếu sau này thật sự cần, thêm lúc đó.
  - `createReviewQueue(): Queue<ReviewJobPayload>` (đọc `REDIS_URL` từ env, mặc định `redis://localhost:6379`) — set `defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }` khi tạo Queue, để job tự retry tối đa 3 lần khi LLM/GitHub API lỗi tạm thời (network, rate-limit) trước khi rơi vào trạng thái `failed`.
  - `createReviewWorker(processor: (job: Job<ReviewJobPayload>) => Promise<void>): Worker<ReviewJobPayload>`
- `packages/github/package.json` thêm `exports`:
  ```json
  "exports": {
    ".": "./dist/index.js",
    "./webhook/verify": "./dist/webhook/verify.js",
    "./webhook/parse": "./dist/webhook/parse.js",
    "./pipeline": "./dist/pipeline.js",
    "./github/auth": "./dist/github/auth.js",
    "./config": "./dist/config.js",
    "./logger": "./dist/logger.js"
  }
  ```
  (Track A dùng `./webhook/verify`, `./webhook/parse`; Track B dùng `./pipeline`, `./github/auth`, `./config`, `./logger`. Không dùng `.` — entry đó tự chạy Express server khi import.)

**Tiêu chí nghiệm thu:**
- `pnpm --filter @happyfeeling/queue build` exit 0.
- Test round-trip: `createReviewQueue().add(...)` rồi `createReviewWorker` nhận đúng job (chạy với Redis local từ `docker compose up -d redis` của Epic 1).
- Test xác nhận `defaultJobOptions` có `attempts: 3` — cho processor throw lỗi giả 2 lần đầu, lần thứ 3 mới cho qua, job vẫn `completed` (không rơi vào `failed` sớm).

---

### Track A (E3-3): Webhook route Next.js + enqueue

**Branch:** `nhd98z2/epic3-webhook-route`

**Phụ thuộc:** E3-2.

**Phạm vi file:** `apps/web/app/api/webhook/route.ts` (mới), `apps/web/package.json` (thêm dep `@happyfeeling/queue`, `@happyfeeling/github`).

**Interface bắt buộc:**
- `POST /api/webhook`: đọc raw body bằng `req.text()` (KHÔNG `JSON.parse` trước khi verify — HMAC tính trên raw bytes), verify bằng `verifySignature` (từ `@happyfeeling/github/webhook/verify`), parse bằng `parsePullRequestEvent` (từ `@happyfeeling/github/webhook/parse`).
- Nếu verify fail → `401`. Nếu event không liên quan (`parsePullRequestEvent` trả `null`) → `200`.
- Nếu hợp lệ: `await createReviewQueue().add(REVIEW_QUEUE_NAME, payload)` rồi trả `202` ngay — không đợi pipeline chạy xong.

**Tiêu chí nghiệm thu:**
- Test gửi request có chữ ký hợp lệ → response `202` trong <300ms.
- Sau khi gọi route, `createReviewQueue().getWaitingCount()` = 1, payload đúng field đã gửi.

---

### Track B (E3-4): Worker xử lý job + ghi DB

**Branch:** `nhd98z2/epic3-worker-process`

**Phụ thuộc:** E3-2, E3-1 (interface `postFindings` mới), Epic 2 Task B3 (`AIC-23` — client Prisma dùng chung).

**Phạm vi file:** Tạo mới `apps/worker/**` (`package.json`, `tsconfig.json`, `src/index.ts`, `Dockerfile`). Sửa `docker-compose.yml` (thêm service `worker`).

**Interface bắt buộc:**
- `apps/worker/src/index.ts`: `createReviewWorker(processor)` — processor gọi `runReviewPipeline` (từ `@happyfeeling/github/pipeline`) với `deps` dựng từ `createInstallationTokenProvider` (`@happyfeeling/github/github/auth`) + `loadConfig` (`@happyfeeling/github/config`).
- Sau khi `runReviewPipeline` post xong, lấy `result.posted` (mảng `Finding[]`, theo interface mới ở E3-1) và ghi từng finding thành 1 row `Finding` trong Postgres qua Prisma client dùng chung (export từ `@happyfeeling/db`, Epic 2 B3).
- **Giữ lại `logMetrics`** (từ `@happyfeeling/github/logger`, Epic MVP cũ) — gọi đúng như `runReviewPipeline` đang làm hiện tại (đếm `findings_count`, `severity_breakdown`, `latency_ms`, `tokens_used`). Chuyển pipeline sang worker KHÔNG được làm mất log này — nếu bỏ sót, mất luôn observability đang có mà không ai để ý ngay.
- `docker-compose.yml`: thêm service `worker` build từ `apps/worker/Dockerfile`, cùng network với `postgres`/`redis`.

**Tiêu chí nghiệm thu:**
- Enqueue 1 job giả (dùng `createReviewQueue().add(...)` từ test) với `reviewDiff`/`postReviewComment` mock — worker tự pick up, gọi đúng 1 lần, và `prisma.finding.findMany()` sau đó trả về đúng 1 row khớp dữ liệu mock.
- Cùng test trên xác nhận `logMetrics` được gọi đúng 1 lần với `findings_count` khớp số finding mock.

---

### E3-5: Nghiệm thu chung Epic 3 (làm cuối, sau khi E3-3 + E3-4 merge)

**Không tạo file mới — chỉ verify.**

- `docker compose up -d postgres redis web worker`.
- Tạo PR test thật (hoặc dùng ngrok trỏ vào `apps/web` — theo đúng cách bot hiện đang chạy cục bộ), trigger webhook thật.
- Xác nhận: route trả `202` ngay, comment thật xuất hiện đúng dòng trên PR (dùng `line`+`side`), và 1 row `Finding` xuất hiện trong Postgres khớp PR đó.
- Chuyển `AIC-7` (Epic 3) sang Done trên Linear.

**Kết quả nghiệm thu (AIC-31):** Đã verify bằng chính PR #27 (`nhd98z2/Happyfeeling`), qua `docker compose up -d postgres redis web worker` + `ngrok` trỏ vào `apps/web`.

- **Phương pháp trigger:** GitHub App thuộc account của Bằng nên không đổi được Webhook URL của App sang ngrok. Thay vào đó, tự dựng request `POST /api/webhook` có chữ ký HMAC-SHA256 hợp lệ (tính bằng đúng `GITHUB_WEBHOOK_SECRET` thật trong `.env`) trỏ vào PR #27 thật — cùng code path verify chữ ký như request GitHub gửi, chỉ khác nguồn gửi HTTP.
- **Route trả 202 ngay:** xác nhận 2 lần, ~0.27–0.34s.
- **Comment thật đúng dòng:** https://github.com/nhd98z2/Happyfeeling/pull/27#discussion_r3615725531 — dùng `line`+`side` (`scripts/aic31-verify-fixture.js:4`, `side: RIGHT`), không còn field `position`.
- **Row Finding thật trong Postgres:** `repo=nhd98z2/Happyfeeling, prNumber=27, errorType=high, firstSeenAt=2026-07-20 16:09:55`.
- File `scripts/aic31-verify-fixture.js` (bug off-by-one cố ý, chỉ để tạo finding thật cho lần verify này) đã bị xoá trước khi merge.
- Tiện thể phát hiện 2 bug hạ tầng khi bật docker thật lần đầu (đã fix ở commit riêng): `apps/web/Dockerfile` build thiếu workspace deps, `docker-compose.yml` thiếu `REDIS_URL`/`GITHUB_WEBHOOK_SECRET` cho service `web`.

---

### Track B tiếp (E4-1): Dedup theo nội dung finding

**Branch:** `nhd98z2/epic4-content-dedup`

**Phụ thuộc:** E3-4 đã merge.

**Phạm vi file:** `packages/github/src/review/dedup.ts` (mới, export subpath `./review/dedup` — thêm 1 dòng vào `exports` map của `packages/github/package.json`), `apps/worker/src/index.ts` (sửa flow: lọc + upsert thay vì insert thẳng).

**Interface bắt buộc:**
- `computeDedupHash(repo: string, filePath: string, line: number): string` — hash tối thiểu theo (repo, filePath, line), khớp field unique `Finding.dedupHash` đã có sẵn trong schema (Epic 2). Không bắt buộc thêm field phân loại lỗi (`errorType`) cho MVP này — nếu thấy cần phân biệt 2 lỗi khác nhau trùng dòng, đó là quyết định mở rộng sau, không phải yêu cầu bắt buộc của task này.
- Trước khi post 1 finding: query `prisma.finding.findUnique({ where: { dedupHash } })`. Nếu đã tồn tại → **không** gọi `postReviewComment`, chỉ `upsert` để cập nhật `lastSeenAt`. Nếu chưa tồn tại → post rồi tạo row mới.

**Tiêu chí nghiệm thu:**
- Test giả lập 2 lần review liên tiếp cùng PR, cùng 1 finding y hệt (cùng `repo`+`filePath`+`line`) → lần 2 số lần gọi `postReviewComment` (mock) = 0, nhưng `lastSeenAt` trong DB được cập nhật.

---

### Track A tiếp (E4-2): Idempotent theo jobId khi GitHub gửi lại webhook

**Branch:** `nhd98z2/epic4-webhook-idempotency`

**Phụ thuộc:** E3-3 đã merge.

**Phạm vi file:** `apps/web/app/api/webhook/route.ts` (chỉ thêm option `jobId` vào lệnh `.add()` đã có).

**Interface bắt buộc:**
- Khi enqueue: `queue.add(REVIEW_QUEUE_NAME, payload, { jobId: \`${owner}/${repo}#${prNumber}@${headSha}\` })`. BullMQ tự chặn thêm job trùng `jobId` còn active/waiting/completed gần đây — GitHub gửi lại (redeliver) đúng webhook cho cùng commit sẽ không tạo job thứ 2.

**Tiêu chí nghiệm thu:**
- Test gọi route 2 lần liên tiếp với payload y hệt (cùng `headSha`) → `createReviewQueue().getJobCounts()` chỉ thấy 1 job, không tăng lên 2.

---

### E4-3: Nghiệm thu chung Epic 4 (làm cuối, sau khi E4-1 + E4-2 merge)

**Không tạo file mới — chỉ verify.**

- Trên PR test thật: trigger webhook lần 1 (có finding X) → xác nhận có 1 comment + 1 row `Finding`.
- Trigger lại đúng webhook đó lần 2 (dùng nút "Redeliver" trên GitHub App settings, hoặc gọi lại route với payload y hệt) → xác nhận **không** có comment trùng, **không** có row `Finding` trùng.
- Chuyển `AIC-8` (Epic 4) sang Done trên Linear.
