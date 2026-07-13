# Epic 1 + Epic 2: Scaffold Monorepo & Database Schema — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Mục tiêu:** Chuyển repo hiện tại (dạng flat) thành pnpm monorepo (Epic 1: `packages/github` + `apps/web` rỗng + Docker) và dựng schema Postgres/Prisma (Epic 2: `packages/db`) — mà không làm hỏng 38 test của bot MVP đang chạy.

**Kiến trúc:** pnpm workspace gồm `apps/*` và `packages/*`. `src/` hiện tại chuyển nguyên vẹn vào `packages/github` (không cần sửa import — chuyển cả cụm cùng lúc). `apps/web` là 1 Next.js shell rỗng (chưa có logic — Epic 3 mới xây route webhook thật trong đó). `packages/db` chứa Prisma schema và hoàn toàn độc lập với `packages/github`/`apps/web` ở cấp độ file.

**Công nghệ:** pnpm 11 (đã cài sẵn máy), Node >=18, TypeScript (strict), Prisma 7 + `@prisma/client` 7 chạy trên PostgreSQL 16, Docker + Docker Compose, vitest (giữ nguyên test runner đang dùng).

## Ràng buộc chung

- Node >=18 (theo đúng `engines` trong `package.json` hiện tại).
- Package manager: pnpm (thay npm — xoá `package-lock.json`, dùng `pnpm-lock.yaml` làm lockfile chính thức).
- Mọi package mới trong workspace đều private (`"private": true`), đặt tên theo dạng `@happyfeeling/<tên>`.
- TypeScript strict mode ở mọi nơi (khớp `tsconfig.json` gốc hiện tại).
- 38 test hiện có (13 file dưới `src/**/*.test.ts`) phải chạy pass sau khi di chuyển — đây là tiêu chí để coi Epic 1 xong, không chỉ "compile được" là đủ.
- Docker: chỉ định nghĩa service cho code đã thực sự tồn tại. Chưa thêm service `worker` vào Compose — vì chưa có code worker cho tới Epic 3.

## Kế hoạch chia song song (tại sao 2 người không đụng nhau)

- **Task 1** là bước chuẩn bị nhỏ dùng chung (chỉ tạo 3 file mới, không đụng gì đang có sẵn). Ai làm trước cũng được; phải merge vào `main` xong thì Task A1/B1 mới bắt đầu.
- **Track A (Epic 1, Người A):** các Task A1–A3 chỉ đụng vào `packages/github/**`, `apps/web/**`, `docker-compose.yml` ở root, và (chỉ 1 lần, ở A1) việc cutover `package.json`/`pnpm-workspace.yaml` ở root.
- **Track B (Epic 2, Người B):** các Task B1–B3 chỉ đụng vào `packages/db/**`, cộng với 1 container Postgres tạm thời chạy riêng của B (độc lập với file Docker Compose của A — B không bao giờ phải chờ Task Docker của A xong).
- **Task 5** là task duy nhất đụng tới cả 2 track (trỏ `packages/db` sang Postgres thật trong Compose của A thay vì Postgres tạm của B). Làm task này **cuối cùng**, sau khi cả A3 và B3 đã merge. Đây là bước verify, không phải bước build, nên rủi ro đụng nhau rất thấp.
- Nếu 2 người bắt đầu cùng lúc: ai tới Task 1 trước thì làm (mất khoảng 2 phút), người còn lại chỉ cần chờ đúng 1 commit đó rồi bắt đầu track riêng của mình.

---

### Task 1: Khung pnpm workspace (dùng chung, làm trước tiên)

**Branch:** `nhd98z/epic-1-pnpm-workspace-skeleton`

**Tệp:**
- Tạo mới: `pnpm-workspace.yaml`
- Tạo mới: `packages/config/package.json`
- Tạo mới: `packages/config/tsconfig.base.json`

**Interface:**
- Dùng: không cần gì.
- Tạo ra: `packages/config/tsconfig.base.json` — mọi `tsconfig.json` của package khác sau này sẽ `"extends": "../config/tsconfig.base.json"`. `pnpm-workspace.yaml` với glob `apps/*` / `packages/*` — mỗi thư mục package sau này chỉ cần có `package.json` riêng là tự động được pnpm nhận diện.

- [ ] **Bước 1: Tạo `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Bước 2: Tạo `packages/config/package.json`**

```json
{
  "name": "@happyfeeling/config",
  "version": "0.0.0",
  "private": true
}
```

- [ ] **Bước 3: Tạo `packages/config/tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Bước 4: Kiểm tra pnpm đã nhận diện đúng workspace**

Chạy: `pnpm install`
Kỳ vọng: thoát với exit code 0. Sau đó chạy `pnpm -r list --depth -1` và xác nhận có `@happyfeeling/config` trong danh sách package của workspace.

- [ ] **Bước 5: Commit**

```bash
git add pnpm-workspace.yaml packages/config
git commit -m "chore: add pnpm workspace skeleton with shared base tsconfig"
```

---

## Track A — Epic 1: Monorepo Scaffold (Người A)

> Mỗi task dưới đây chỉ nêu **Mục tiêu**, **Interface bắt buộc** (phần giao nhau với Track B hoặc dùng ở Task 5 — không tự đổi), và **Tiêu chí nghiệm thu** (Task 5 sẽ kiểm bằng đúng các lệnh này). Cách implement cụ thể — cấu trúc file, chọn thư viện, cách viết code — do người thực hiện tự quyết định, đúng ý tưởng riêng của mình. Có phần "Gợi ý tham khảo" xếp gọn ở cuối mỗi task, không bắt buộc theo, chỉ dùng khi thấy cần một điểm khởi đầu.

### Task A1: Cutover root sang pnpm + chuyển `src/` vào `packages/github`

**Branch:** `nhd98z/epic-1-cutover-src-to-packages-github`

**Mục tiêu:** Repo chuyển từ npm sang pnpm workspace; code `src/` hiện tại di chuyển nguyên vẹn (không sửa logic) vào `packages/github`.

**Phạm vi file:** `package.json`/`package-lock.json` (root), `tsconfig.json`/`vitest.config.ts` (root), toàn bộ `src/` → `packages/github/**`.

**Interface bắt buộc:**
- Tên package đúng `@happyfeeling/github` — Task A3 (Docker) và các epic sau gọi theo tên này.
- `packages/github/tsconfig.json` phải `"extends": "../config/tsconfig.base.json"` (output của Task 1).
- Có đủ 4 script `dev` / `build` / `start` / `test` — để `pnpm -r test` và `pnpm -r build` ở root (chạy xuyên suốt workspace, kể cả `packages/db` của Track B) không thiếu package.

**Tiêu chí nghiệm thu:**
- `pnpm install` → exit code 0, sinh `pnpm-lock.yaml` ở root.
- `pnpm --filter @happyfeeling/github test` → `Test Files 13 passed (13)`, `Tests 38 passed (38)` — đúng số lượng như trước khi chuyển.

<details>
<summary>Gợi ý tham khảo (không bắt buộc)</summary>

```bash
rm package-lock.json
mkdir -p packages/github
git mv src packages/github/src
git mv tsconfig.json packages/github/tsconfig.json
git mv vitest.config.ts packages/github/vitest.config.ts
```

`package.json` root rút gọn thành manifest workspace-root (`private: true`, `engines.node >=18`, script `test`/`build` gọi `pnpm -r`). `packages/github/package.json` giữ nguyên deps/scripts mà root cũ đang có, chỉ đổi `name` thành `@happyfeeling/github`.

</details>

---

### Task A2: Shell Next.js rỗng cho `apps/web`

**Branch:** `nhd98z/epic-1-apps-web-empty-shell`

**Mục tiêu:** Có 1 app Next.js rỗng, build được, tại `apps/web` — chưa có logic, chỉ là nền để Epic 3 (ngoài phạm vi plan này) xây route webhook/dashboard thật lên trên.

**Phạm vi file:** toàn bộ `apps/web/**` (tạo mới).

**Interface bắt buộc:**
- Tên package đúng `@happyfeeling/web` — Task A3 (Docker) và `docker-compose.yml` gọi theo tên/đường dẫn này.
- `apps/web/tsconfig.json` phải `extends` từ `packages/config/tsconfig.base.json`.
- Có script `build` chạy được — Dockerfile ở Task A3 gọi đúng script này.

**Tiêu chí nghiệm thu:**
- `pnpm install` → exit 0, `@happyfeeling/web` xuất hiện trong `pnpm -r list --depth -1`.
- `pnpm --filter @happyfeeling/web build` → `Compiled successfully`, exit code 0.

<details>
<summary>Gợi ý tham khảo (không bắt buộc)</summary>

Next.js 14 App Router, tối thiểu: `package.json` (deps `next`/`react`/`react-dom`), `tsconfig.json` (extend base + `jsx: preserve`, `moduleResolution: bundler`), `next.config.js` rỗng, `app/layout.tsx` + `app/page.tsx` render text tĩnh.

</details>

---

### Task A3: Docker (Dockerfile + docker-compose)

**Branch:** `nhd98z/epic-1-docker-compose`

**Mục tiêu:** Có Docker Compose chạy được Postgres + Redis + web cho local dev — nền để Task 5 và Track B nối vào.

**Phạm vi file:** `apps/web/Dockerfile`, `docker-compose.yml` (root, tạo mới).

**Interface bắt buộc:**
- Service Postgres trong Compose dùng credentials `happyfeeling`/`happyfeeling`/`happyfeeling`, expose cổng `5432` — Track B (`packages/db/.env`) và Task 5 dựa đúng vào thông tin này để trỏ `DATABASE_URL`.
- Chưa định nghĩa service `worker` (chưa có code — để Epic 3 làm sau).

**Tiêu chí nghiệm thu:**
- `docker compose up -d postgres redis` → cả 2 container `Up` (`docker compose ps`).
- `docker compose build web` → build thành công, exit code 0.

<details>
<summary>Gợi ý tham khảo (không bắt buộc)</summary>

Dockerfile multi-stage `node:20-alpine`: copy `pnpm-lock.yaml` + `packages` + `apps/web`, `pnpm install --frozen-lockfile` rồi `pnpm build`. Compose có 3 service: `postgres` (image `postgres:16`, volume riêng), `redis` (image `redis:7`), `web` (build từ Dockerfile trên, `DATABASE_URL` trỏ tới service `postgres`).

</details>

---

## Track B — Epic 2: Database & Schema (Người B)

> Cùng nguyên tắc như Track A: chỉ **Interface bắt buộc** và **Tiêu chí nghiệm thu** là ràng buộc cứng, cách implement do người thực hiện tự quyết. Có "Gợi ý tham khảo" cuối mỗi task, không bắt buộc theo.

### Task B1: Scaffold `packages/db` + Prisma schema

**Branch:** `nhd98z/epic-2-prisma-schema-scaffold`

**Mục tiêu:** Có schema Prisma định nghĩa nơi lưu trạng thái bền vững thay file log.

**Phạm vi file:** toàn bộ `packages/db/**` (tạo mới, trừ migration — làm ở B2).

**Interface bắt buộc:**
- Tên package đúng `@happyfeeling/db` — các epic sau (4, 6, 9, 10 — ngoài phạm vi plan này) import package này để lấy Prisma client.
- 4 model đúng tên `Finding`, `Metric`, `Config`, `Ticket`, với ràng buộc unique tối thiểu: `Finding.dedupHash` (Epic 4 cần để chống trùng), `Config.key` (Epic 8 đọc threshold động theo key), `Ticket.ticketId` (Epic 9 tra theo mã ticket Linear).
- `packages/db/tsconfig.json` extends `packages/config/tsconfig.base.json`.

**Tiêu chí nghiệm thu:**
- `pnpm --filter @happyfeeling/db exec prisma validate` → `The schema at prisma/schema.prisma is valid 🚀`.

<details>
<summary>Gợi ý tham khảo (không bắt buộc)</summary>

Prisma 7 + `@prisma/client` 7, datasource `postgresql` đọc `DATABASE_URL` từ env. Field gợi ý cho `Finding`: `repo`, `prNumber`, `filePath`, `line`, `errorType`, `dedupHash` (unique), `message`, `firstSeenAt`/`lastSeenAt`. `packages/db/.env.example` ghi sẵn connection string mẫu để B2 copy thành `.env` thật.

</details>

---

### Task B2: Migrate trên Postgres tạm thời chạy local

**Branch:** `nhd98z/epic-2-migrate-local-postgres`

**Mục tiêu:** Có migration SQL đầu tiên áp dụng được lên Postgres thật — vừa để B tự test, vừa để Task 5 áp lại lên Postgres của Track A.

**Phạm vi file:** `packages/db/.env` (local only, gitignore), `packages/db/prisma/migrations/**`.

**Interface bắt buộc:**
- Chạy Postgres tạm **độc lập** với Docker Compose của Track A (không chờ Task A3 xong mới bắt đầu) — dùng đúng credentials như Compose (`happyfeeling`/`happyfeeling`/`happyfeeling`, cổng `5432`) để Task 5 không phải sửa gì khi đổi qua Postgres thật.

**Tiêu chí nghiệm thu:**
- Migration chạy thành công (`Your database is now in sync with your schema.` hoặc tương đương).
- 4 bảng `Finding`/`Metric`/`Config`/`Ticket` xuất hiện khi liệt kê bảng trong Postgres.

<details>
<summary>Gợi ý tham khảo (không bắt buộc)</summary>

`docker run` Postgres 16 tạm (gợi ý tên container `happyfeeling-db-dev`), dùng `prisma migrate dev --name init`.

</details>

---

### Task B3: Script seed + test

**Branch:** `nhd98z/epic-2-seed-script`

**Mục tiêu:** Có cách nạp dữ liệu mẫu và xác nhận bằng test tự động — các epic sau import cùng 1 Prisma client thay vì tự khởi tạo riêng.

**Phạm vi file:** `packages/db/src/**` (client, seed, test — tự đặt tên file).

**Interface bắt buộc:**
- Có 1 điểm export instance `PrismaClient` dùng chung (vd biến `prisma`) — các epic sau (4, 6, 9, 10) import đúng chỗ này thay vì tự tạo `PrismaClient()` riêng.

**Tiêu chí nghiệm thu:**
- Có test tự động chạy pass sau khi seed đã chạy, và fail nếu seed chưa chạy (chứng minh test có tác dụng thật, không phải test giả).

<details>
<summary>Gợi ý tham khảo (không bắt buộc)</summary>

Seed script `upsert` 1 dòng `Config` (vd `filter.confidenceThreshold`) + 1 dòng `Ticket` demo; test đọc lại đúng 2 dòng đó bằng `findUnique`.

</details>

---

## Task 5: Nghiệm thu chung (làm cuối cùng, sau khi cả A3 và B3 đã merge)

**Branch:** `nhd98z/epic-1-2-integration-check`

**Tệp:** không tạo file mới — chỉ verify, do người xong track sau (hoặc cả 2 cùng) làm.

Đây là bước ghép 2 track lại — vì mỗi người tự chọn cách implement riêng cho task của mình, đây cũng là nơi phát hiện nếu có gì lệch Interface bắt buộc đã nêu ở từng task (vd `DATABASE_URL`/credentials không khớp, thiếu script `test` ở 1 package nào đó). Không đạt ở đây thì coi như A3/B3 chưa xong, quay lại sửa track tương ứng.

**Interface:**
- Dùng: `docker-compose.yml` (Task A3), migration + seed của `packages/db` (Task B1–B3).
- Tạo ra: xác nhận Docker của Epic 1 và Prisma schema của Epic 2 thực sự chạy chung được — đây là tiêu chí để đóng cả 2 epic.

- [ ] **Bước 1: Tắt Postgres tạm thời từ Task B2**

```bash
docker stop happyfeeling-db-dev
```

- [ ] **Bước 2: Chạy Postgres của Compose (Track A)**

```bash
docker compose up -d postgres
```

Kỳ vọng: container (tên dạng `happyfeeling-postgres-1` hoặc tương tự do Compose tự đặt) status `Up`. Cùng credentials với `.env` ở Task B2 (`happyfeeling`/`happyfeeling`/`happyfeeling` trên `localhost:5432`) nên `packages/db/.env` không cần sửa gì.

- [ ] **Bước 3: Áp dụng migration đã có sẵn (không tạo migration mới) lên Postgres của Compose**

Chạy: `pnpm --filter @happyfeeling/db run migrate:deploy`
Kỳ vọng: `All migrations have been successfully applied.`

- [ ] **Bước 4: Seed lại và chạy lại test trên Postgres của Compose**

Chạy: `pnpm --filter @happyfeeling/db run seed`
Kỳ vọng: in ra `Seed hoàn tất.`

Chạy: `pnpm --filter @happyfeeling/db test`
Kỳ vọng: `Test Files  1 passed (1)`, `Tests  1 passed (1)`.

- [ ] **Bước 5: Chạy lại toàn bộ test suite của workspace (Epic 1 + Epic 2 cùng lúc)**

Chạy: `pnpm -r test`
Kỳ vọng: `@happyfeeling/github` — 38 passed; `@happyfeeling/db` — 1 passed. Không có test nào fail.

- [ ] **Bước 6: Đánh dấu Epic 1 và Epic 2 hoàn thành trên Linear**

Chuyển `AIC-5` (Epic 1) và `AIC-6` (Epic 2) sang trạng thái Done trên Linear.
