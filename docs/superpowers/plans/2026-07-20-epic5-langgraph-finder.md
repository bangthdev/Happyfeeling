# Epic 5: LangGraph — Node "Người tìm" — Kế hoạch triển khai

> **⚠️ Đây là spec cấp task, KHÔNG phải plan chi tiết để code thẳng.** Mỗi mục dưới đây chỉ nêu Mục tiêu/Interface bắt buộc/Tiêu chí nghiệm thu. **Trước khi bắt đầu code 1 task, viết 1 plan chi tiết riêng cho task đó** (từng bước cụ thể, viết test trước khi code), dùng đúng mục tương ứng ở đây làm spec/interface đầu vào.

**Mục tiêu:** Sinh ra node "tìm rộng" (finder) — lượt LLM đầu tiên trong graph review 2 bước sẽ thay thế `reviewDiff` hiện tại (1 lượt gộp tìm+lọc). Finder chỉ tìm mọi vấn đề có thể, kể cả chưa chắc chắn — ưu tiên không bỏ sót (recall), **chưa** tự đánh giá độ chắc chắn, **chưa** post comment, nên **chưa cần dedup** (Epic 4).

**Phạm vi Epic 5 dừng ở đâu:** Epic 5 chỉ giao node finder độc lập + test xác nhận nó sinh đúng danh sách ứng viên từ 1 diff. **Không** nối vào `pipeline.ts` thật, **không** thay `reviewDiff` đang chạy — bot vẫn dùng pipeline 1-lượt hiện tại cho tới khi Epic 6 (node lọc) xong và nối cả graph vào pipeline thật.

**Kiến trúc:** Package mới `packages/ai-pipeline` (đúng vị trí spec gốc `docs/superpowers/specs/2026-07-13-ai-code-review-bot-design.md` dòng 82), dùng `@langchain/langgraph` (`StateGraph`, `Annotation.Root`). Tái dùng `buildContext`/`chunkDiff` từ `packages/github` qua subpath export mới (không copy lại logic diff-splitting).

**Công nghệ:** `@langchain/langgraph`, `zod` (schema cho structured output). Client gọi Groq: **xem "Quyết định mở, cần cập nhật" bên dưới — chưa chốt**.

## Ràng buộc chung

- Package `@happyfeeling/ai-pipeline`, `private: true`, `tsconfig.json` extends `packages/config/tsconfig.base.json` — đúng convention đã dùng cho `@happyfeeling/queue`.
- **Không sửa `packages/github/src/pipeline.ts` hay `llmReviewer.groq.ts`** trong Epic 5 — pipeline thật giữ nguyên cho tới Epic 6.
- Chunking diff **giữ nguyên logic hiện tại** (`MAX_TOKENS_PER_CHUNK = 6000`, `CHUNK_DELAY_MS = 3000` trong `llmReviewer.groq.ts`) — finder chạy **tuần tự** qua từng chunk, **không** fan-out song song ở bước này (fan-out `Send` chỉ dùng cho node lọc ở Epic 6, theo từng finding, không phải theo chunk — chạy song song nhiều chunk cùng lúc sẽ vượt trần 12k TPM của Groq ngay).
- State graph (`ReviewState`) định nghĩa **đủ 3 field ngay từ Epic 5** dù `findings` chưa dùng tới: `diff` (không reducer, set 1 lần), `candidates` (reducer `concat`, finder ghi), `findings` (reducer `concat`, dành cho Epic 6 ghi — **không ai được ghi field này ở Epic 5**). Tránh việc Epic 6 phải đổi lại shape state đã có.

## ⚠️ Quyết định mở, cần cập nhật trước khi code E5-2

Mentor đã báo sẽ cấp 1 key khác để test (tên/loại chưa xác nhận — key hiện tại là Groq free tier tự đăng ký ở `console.groq.com`, dính giới hạn 12k TPM đã từng gây bug AIC-25). Cần hỏi lại mentor **tên chính xác của key/provider mới** trước khi viết code E5-2, vì nó quyết định:

- **Nếu vẫn là Groq (trả phí hoặc free):** giữ nguyên hướng client — xem 2 phương án dưới, ưu tiên **giữ hand-rolled fetch** (đúng pattern đã lặp lại 2 lần trong repo — `llmReviewer.ts` bản Claude cũ và `llmReviewer.groq.ts` đều tự viết tay tool-calling, không dùng LangChain chat wrapper).
- **Nếu đổi hẳn provider khác (vd quay lại Claude như bản gốc trước khi swap):** cân nhắc lại — provider đó có hỗ trợ structured output "kiểu gốc" (native) không (OpenAI/xAI/Gemini/Anthropic có, Groq không) ảnh hưởng trực tiếp tới việc có nên dùng `withStructuredOutput` của `@langchain/*` hay tiếp tục tool-calling tay.

**Việc cần làm ngay khi biết key:** cập nhật lại mục Interface của E5-2 bên dưới (đang để placeholder `<TBD: client Groq/provider>`), rồi mới viết plan chi tiết + code.

## Tiền đề chặn tiến độ

`AIC-9` (Epic 5) ghi "Depends on: Epic 3". Trên Linear, `AIC-7` (Epic 3) vẫn hiện `Backlog` — nhưng thực tế đã nghiệm thu xong qua `AIC-31` (xem kết quả trong `docs/superpowers/plans/2026-07-15-epic-3-4-walking-skeleton-dedup.md`, mục E3-5) — đây là ticket cha chưa được cập nhật status thủ công, **không phải blocker thật**. Không cần chờ gì thêm để bắt đầu Epic 5.

## Kế hoạch (solo, tuần tự — không chia Track)

---

### E5-1: Scaffold `packages/ai-pipeline` + định nghĩa `ReviewState`

**Branch:** `nhd98z2/AIC-9-epic5-ai-pipeline-scaffold`

**Phạm vi file:** Tạo mới `packages/ai-pipeline/**` (`package.json`, `tsconfig.json`, `src/state.ts`). Sửa `packages/github/package.json` (chỉ thêm `exports`), không đổi logic.

**Interface bắt buộc:**

- `packages/github/package.json` thêm 2 dòng vào `exports` map đã có (theo đúng mẫu E3-2):
  ```json
  "./review/contextBuilder": "./dist/review/contextBuilder.js",
  "./review/diffChunker": "./dist/review/diffChunker.js"
  ```
  Và export thêm type `Finding`/`ReviewResult` (hiện tại `llmReviewer.ts` đã export 2 type này — xác nhận subpath `./review/llmReviewer` type-only đã lộ ra được qua `exports` hiện có, hoặc thêm subpath type riêng nếu chưa).
- `packages/ai-pipeline/src/state.ts`: export `ReviewState = Annotation.Root({...})` đúng 3 field mô tả ở "Ràng buộc chung", dùng type `Finding` import từ `@happyfeeling/github/review/llmReviewer` (type-only import).

**Tiêu chí nghiệm thu:**

- `pnpm --filter @happyfeeling/ai-pipeline build` exit 0.
- Test import `ReviewState` từ package khác (mô phỏng cách E5-2 sẽ dùng), tạo `new StateGraph(ReviewState)` không lỗi type.

---

### E5-2: Node "finder" — prompt tìm rộng + gọi LLM + structured output

**Branch:** `nhd98z2/AIC-9-epic5-finder-node`

**Phụ thuộc:** E5-1, và mục "Quyết định mở" ở trên đã chốt.

**Phạm vi file:** `packages/ai-pipeline/src/finder.ts` (mới), `packages/ai-pipeline/src/finder.test.ts`.

**Interface bắt buộc:**

- `finderNode(state: typeof ReviewState.State): Promise<Partial<typeof ReviewState.State>>` — export named, KHÔNG compile graph trong file này (graph compile để dành Epic 6, khi có đủ 2 node).
- Prompt mới (KHÔNG tái dùng nguyên văn `buildPrompt` trong `llmReviewer.groq.ts` — prompt đó đã thiên về lọc chặt "chỉ ra vấn đề thật sự quan trọng... bỏ qua nitpick"). Prompt finder phải nói rõ: tìm **mọi** vấn đề có thể kể cả chưa chắc chắn, không tự loại trừ — việc loại trừ để dành node lọc (Epic 6).
- Chunking: gọi `chunkDiff` (từ `@happyfeeling/github/review/diffChunker`) với `state.diff`, lặp tuần tự từng chunk (giữ `CHUNK_DELAY_MS` giữa các lần gọi), gộp kết quả `Finding[]` từ mọi chunk thành `candidates`.
- Client gọi LLM: `<TBD: chốt theo mục "Quyết định mở" phía trên trước khi code>`.
- Structured output: schema Zod khớp đúng shape `Finding` hiện có (`file: string, line: number, severity: 'high'|'medium'|'low', message: string, suggestion: string`) — không đổi shape, để Epic 6 dùng lại nguyên vẹn.
- Xử lý lỗi: giữ đúng 2 hành vi đang có trong `llmReviewer.groq.ts` (retry khi 429 theo header `retry-after`, retry khi model trả sai format) — cách khai báo (tay hay qua `retryPolicy`/`error_handler`) phụ thuộc quyết định client ở trên, nhưng **hành vi quan sát được phải giống hệt code cũ**, verify bằng test.

**Tiêu chí nghiệm thu:**

- `pnpm --filter @happyfeeling/ai-pipeline test` pass.
- Test với diff giả có 1 vấn đề rõ ràng (bug thật) và 1 vấn đề mập mờ (borderline, kiểu nitpick) — xác nhận **cả 2** đều xuất hiện trong `candidates` (đúng tinh thần "tìm rộng", không tự lọc bớt).
- Test giả lập Groq trả 429 → xác nhận retry đúng theo `retry-after`, không throw ngay.
- Test giả lập model trả sai format (không gọi tool/schema) → xác nhận retry 1 lần với message sửa lỗi, không throw ngay ở lần đầu.

---

### E5-3: Nghiệm thu Epic 5 (làm cuối)

**Không tạo file mới — chỉ verify.**

- Chạy `finderNode` với 1 diff thật (lấy từ 1 PR cũ trong repo, không cần webhook/worker thật — Epic 5 chưa nối pipeline).
- Xác nhận `candidates` sinh ra hợp lý (đối chiếu bằng mắt, không cần chính xác tuyệt đối — đây là lượt "tìm rộng", chấp nhận có finding sau này bị Epic 6 loại).
- Xác nhận **không** có comment nào được post lên GitHub, **không** có row `Finding` nào ghi vào Postgres — đúng scope Epic 5 (chỉ sinh finding, chưa post).
- Chuyển `AIC-9` (Epic 5) sang Done trên Linear.
