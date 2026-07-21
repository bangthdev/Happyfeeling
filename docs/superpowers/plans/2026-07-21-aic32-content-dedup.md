# AIC-32 (Epic 4, E4-1): Dedup theo nội dung finding — Kế hoạch chi tiết

> Spec gốc: `docs/superpowers/plans/2026-07-15-epic-3-4-walking-skeleton-dedup.md`, mục "Track B tiếp (E4-1)".

**Vấn đề:** `runReviewPipeline` hiện post lại comment cho **mọi** finding Groq trả về ở **mỗi lần review** (mỗi lần push commit mới). Nếu cùng 1 lỗi vẫn còn ở commit mới, bot post trùng comment. Cơ chế chặn hiện có (`apps/worker/src/processJob.ts`, `createMany({ skipDuplicates: true })`) chỉ chặn tạo **row DB trùng**, không chặn **post comment trùng lên GitHub**, và không cập nhật `lastSeenAt` khi gặp lại 1 finding cũ.

**Mục tiêu:** Chặn việc gọi `postReviewComment` cho finding đã từng thấy (cùng `repo`+`prNumber`+`filePath`+`line`, theo `dedupHash` đã có sẵn từ AIC-30), chỉ cập nhật `lastSeenAt`. Finding mới thì post + tạo row như bình thường.

## Thiết kế

Thêm 1 bước lọc (`filterNewFindings`) vào `PipelineDeps`, chạy giữa `reviewDiff` (Groq trả findings) và `postFindings` (gọi GitHub API thật) trong `packages/github/src/pipeline.ts`. Bước lọc là 1 dependency được tiêm vào — bản thật (dùng Prisma) sống ở `apps/worker/`, giữ đúng ranh giới package hiện có (`packages/github` không phụ thuộc `@happyfeeling/db`).

## Việc cần làm

1. **`packages/github/src/pipeline.ts`**
   - Thêm field bắt buộc vào `PipelineDeps`:
     `filterNewFindings: (repo: string, prNumber: number, findings: Finding[]) => Promise<Finding[]>`
   - Gọi ngay sau khi có `findings` (từ `reviewDiff`/partial-review-catch), trước khi build tham số cho `postFindings`:
     `const newFindings = await deps.filterNewFindings(\`${event.owner}/${event.repo}\`, event.prNumber, findings);`
   - Truyền `newFindings` (không phải `findings` gốc) vào `postFindings({..., findings: newFindings})`.
   - `logMetrics`/`severityBreakdown` giữ nguyên logic dùng `posted` — không đổi (đã đúng ý nghĩa "số finding mới thực sự post").

2. **`apps/worker/src/dedupFilter.ts`** (mới)
   - Export `filterNewFindings(prisma: PrismaClient, repo: string, prNumber: number, findings: Finding[]): Promise<Finding[]>`.
   - Với mỗi finding: tính `dedupHash` (dùng `computeDedupHash` từ `@happyfeeling/github/review/dedup`), `prisma.finding.findUnique({ where: { dedupHash } })`.
     - Đã tồn tại → `prisma.finding.update({ where: { dedupHash }, data: {} })` (bump `lastSeenAt` qua `@updatedAt`), loại khỏi kết quả trả về.
     - Chưa tồn tại → giữ lại trong kết quả trả về.
   - Trả về mảng finding mới (chưa từng thấy) — đây là mảng sẽ được post.

3. **`apps/worker/src/index.ts`**
   - Nối `filterNewFindings: (repo, prNumber, findings) => filterNewFindings(prisma, repo, prNumber, findings)` vào `pipelineDeps` khi khởi tạo worker.

4. **`apps/worker/src/processJob.ts`**
   - Sửa lại comment sai ở `persistFindings` (hiện ghi nhầm "Real dedup-or-skip semantics ... are AIC-31's job") — dedup thật đã xảy ra ở bước filter phía trên (AIC-32), `skipDuplicates` giờ chỉ là lớp phòng thủ dự phòng cho race condition, không phải cơ chế chính.

## Test viết trước (TDD)

1. **`apps/worker/src/dedupFilter.test.ts`** (mới):
   - Finding chưa từng thấy (`findUnique` → `null`) → xuất hiện trong kết quả trả về; `update` không được gọi.
   - Finding đã từng thấy (`findUnique` → có row) → **không** xuất hiện trong kết quả trả về; `update` được gọi đúng 1 lần với đúng `where: { dedupHash }`.
   - Danh sách trộn (1 mới + 1 cũ) → kết quả trả về chỉ chứa finding mới; `update` gọi đúng 1 lần (cho finding cũ).

2. **`packages/github/src/pipeline.test.ts`** (sửa):
   - Cập nhật 4 test hiện có: truyền thêm `filterNewFindings: vi.fn().mockImplementation(async (_r, _pr, findings) => findings)` (passthrough) vào `deps` vì giờ là field bắt buộc.
   - Thêm 1 test mới: `filterNewFindings` trả về danh sách đã lọc bớt (ít hơn `findings` gốc từ `reviewDiff`) → xác nhận `postFindings` được gọi với đúng danh sách đã lọc, không phải danh sách gốc.

## Tiêu chí nghiệm thu

- `pnpm --filter @happyfeeling/github test` pass.
- `pnpm --filter @happyfeeling/worker test` pass.
- `pnpm --filter @happyfeeling/github build` và `pnpm --filter @happyfeeling/worker build` đều exit 0.
- Không cần chạy lại Docker/ngrok thật — tiêu chí nghiệm thu gốc của E4-1 (dòng 157-158 trong spec doc) ở mức unit test; verify end-to-end thật (redeliver webhook) thuộc về E4-3, làm sau khi E4-1 + E4-2 đều merge.

## Kết quả thực hiện

Thiết kế thật đi đúng như plan, chỉ khác vài chi tiết implementation (đã ghi rõ ở dưới) so với bản phác thảo ban đầu.

**Khác so với draft ban đầu:**
- `apps/worker/src/dedupFilter.ts`: thay vì tra cứu **từng finding một** (`findUnique`/`update`), bản thật gom thành **1 lần `findMany`** (tra tất cả `dedupHash` cùng lúc) + **1 lần `updateMany`** (bump `lastSeenAt` cho tất cả finding đã biết cùng lúc) — phát hiện ở code-review vòng 1 (N finding = tối đa 2N round-trip DB, không cần thiết).
- Có thêm 1 `Set` theo dõi `dedupHash` **trong cùng 1 batch** — nếu Groq trả 2 finding trùng file+line trong cùng 1 lần review, chỉ finding đầu tiên được giữ lại (phát hiện ở code-review vòng 1, bản draft ban đầu chỉ tính đến trùng giữa các lần review, không tính trùng trong 1 lần).
- Lỗi DB khi tra cứu (`findMany`) và lỗi DB khi bump timestamp (`updateMany`) được xử lý ở **2 try/catch riêng**: lỗi tra cứu → coi tất cả là "mới" (an toàn, vì thật sự không biết); lỗi bump timestamp → chỉ log, không ảnh hưởng tới finding đã biết là trùng (bug thật bị phát hiện ở code-review vòng 2 khi 2 bước này từng gộp chung 1 try/catch).
- `PipelineDeps.filterNewFindings` vẫn giữ **bắt buộc** (không phải optional) — file MVP cũ không có DB (`packages/github/src/index.ts`) dùng lại 1 hàm passthrough có tên rõ ràng (`passthroughFilterNewFindings`, export từ `pipeline.ts`) thay vì tự chế 1 stub ẩn danh.

**Giới hạn đã biết, cố tình không sửa (không phải bỏ sót):**
- `dedupHash` chỉ dựa trên (repo, prNumber, filePath, line), bỏ qua nội dung/mức độ nghiêm trọng — nếu 1 dòng đổi từ lỗi nhẹ sang lỗi nặng ở lần review sau, bot vẫn coi là "đã biết" và không post lại. Đây là giới hạn MVP đã chốt sẵn trong spec gốc (dòng 154, `2026-07-15-epic-3-4-walking-skeleton-dedup.md`), không phải bug của AIC-32.
- Race condition: 2 job xử lý chồng lấn cùng 1 PR trước khi finding nào được ghi DB có thể cùng post trùng comment lên GitHub — `skipDuplicates` chỉ chặn được row DB trùng, không chặn được comment trùng. Đã ghi rõ giới hạn này trong comment code (`processJob.ts`), chưa giải quyết tận gốc (cần lock/transaction, ngoài phạm vi task này).

**Verify:**
- `pnpm --filter @happyfeeling/github test` → 54/54 pass.
- `pnpm --filter @happyfeeling/worker test` (trừ `worker.integration.test.ts`, cần Redis/Postgres thật) → 14/14 pass.
- `pnpm -r build` (toàn repo) → exit 0.
- Trải qua 2 vòng code-review high-effort (workflow-backed, 17 + 16 agent) — tổng 17 finding được verify độc lập, sửa 10, còn 7 là false-positive đã bác bỏ hoặc quyết định/giới hạn đã chốt (ghi rõ ở trên).
