# AI Code Review Bot — Notes học + Quyết định thiết kế

Nguồn ý tưởng gốc: [2026-07-06-ai-code-review-bot.html](https://gistcdn.githack.com/nhd98z/9b66fe67436de543c5dbf46af7514b32/raw/2c60c6f371773fbc05baa479b1af18e889a0a1b7/2026-07-06-ai-code-review-bot.html)

## Quyết định đã chốt

| Hạng mục               | Quyết định                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| Project                | Riêng biệt, không nằm trong b3-mono                                               |
| Ngôn ngữ               | TypeScript/Node                                                                   |
| LLM                    | Claude API (Anthropic)                                                            |
| Hạ tầng test           | Chạy local + ngrok/tunnel trước, deploy sau                                       |
| GitHub auth            | GitHub App (không dùng PAT cho production)                                        |
| Repo test              | 1 repo cá nhân đã có sẵn                                                          |
| Lưu metrics (MVP)      | Console/file log — **KHÔNG** dùng DB ở giai đoạn MVP                              |
| Context strategy (MVP) | Static Context Builder — bỏ qua Agentic Session (clone + sandbox) ở giai đoạn đầu |

## Checklist khái niệm cần học

### Chung — bắt buộc học dù chọn cách auth nào

- [ ] **Webhook payload** — cấu trúc JSON GitHub gửi khi có PR event (action, PR number, diff_url...)
- [ ] **Webhook signature verification** — verify HMAC-SHA256 để chắc request thật từ GitHub
- [ ] **GitHub REST API cơ bản** — endpoint lấy diff, endpoint post review comment, rate-limit headers
- [ ] **Diff hunk line-position** — GitHub tính vị trí comment theo số dòng trong unified diff hunk, KHÔNG phải số dòng trong file gốc (lỗi hay gặp nhất)

### Riêng cho GitHub App (đã chọn)

- [ ] **JWT (JSON Web Token)** — tự ký bằng private key để chứng minh danh tính app
- [ ] **Installation token** — đổi từ JWT, sống ~1h, dùng để gọi API
- [ ] **Permission scoping** — khai báo app chỉ được quyền gì khi đăng ký
- [ ] **Token refresh** — tự xin cấp lại khi installation token hết hạn

### Bonus — nên biết để test nhanh

- [ ] **PAT (Personal Access Token)** — dùng để test tay bằng `curl` trước khi code chính thức, tránh vừa debug JWT vừa debug API cùng lúc

### Giai đoạn 2 (KHÔNG phải MVP — làm sau khi pipeline chạy ổn)

- [ ] SQLite — lưu metrics có cấu trúc để làm dashboard
- [ ] Agentic Session (clone + sandbox) — agent tự grep/đọc code thay vì static context builder
- [ ] Tích hợp Linear (parse ticket ID, lấy acceptance criteria)
- [ ] Tích hợp Slack (tìm thread liên quan)

## Khái niệm đã giải thích

**MVP (Minimum Viable Product)** = bản tối giản chạy được để test ý tưởng, chưa cần đầy đủ tính năng. Ví dụ ở đây: chỉ làm webhook → lấy diff → gọi Claude review → post 1 comment, bỏ qua dashboard/Linear/Slack/agentic.

**"Finding"** = 1 vấn đề bot tìm thấy trong code, có cấu trúc `{file, line, severity, message, suggestion}` — dùng để post thành comment.

**"Metrics" / instrumentation** = số liệu về quá trình bot chạy (không phải nội dung review): `{pr_number, findings_count, severity_breakdown, latency_ms, tokens_used, reactions}` — dùng để theo dõi bot hoạt động tốt không.

## Câu hỏi đang mở (chưa chốt)

- [ ] Chi tiết pipeline: cấu trúc project (folder layout), package quản lý webhook (Express? Fastify?)

## Tiến độ (2026-07-09) — MVP đã chạy được end-to-end

**Đã xong:**

- 13 task trong `docs/superpowers/plans/2026-07-09-ai-code-review-bot-mvp.md` — code hoàn chỉnh, 38/38 test pass
- Repo GitHub: https://github.com/nhd98z2/Happyfeeling (private)
- Tạo GitHub App thật (App ID `4254577`, installed vào chính repo `Happyfeeling` — dogfooding), cấu hình webhook + private key trong `.env`
- **TẠM THỜI đổi LLM từ Claude sang Groq** (free, chưa mua credit Claude) — xem chi tiết bên dưới
- Test PR thật (#1) → bot chạy đúng: nhận webhook → verify signature → lấy diff → gọi Groq → post comment đúng vị trí dòng trên GitHub

### Quyết định tạm thời: Groq thay Claude

- Lý do: tài khoản Anthropic Console chưa mua credit ($0, chưa add thẻ) — dùng Groq để test free trong lúc học pipeline
- Cách làm: tạo `src/review/llmReviewer.groq.ts` cùng interface `reviewDiff(context, ...)` với bản Claude (`llmReviewer.ts`, **vẫn giữ nguyên, không xoá**) — chỉ khác cách gọi API
- Các chỗ đã đổi tạm (đều có comment `// TEMP:` trong code để dễ tìm): `pipeline.ts`, `config.ts`, `index.ts`, `.env`/`.env.example` (`ANTHROPIC_API_KEY` → `GROQ_API_KEY`)
- **Cách revert về Claude sau này:** đảo ngược đúng 3 chỗ TEMP đó (đổi import về `llmReviewer.js`, đổi `groqApiKey` về `anthropicClient: Anthropic`, đổi lại env var) — không đụng gì đến các phần khác của pipeline

### Phát hiện quan trọng khi test — chất lượng review chưa toàn diện

Test với file `sandbox/sample.ts` (cố tình có 3 lỗi: SQL injection, thiếu type annotation, thiếu `return false`, dùng biến `db` chưa khai báo):

- Bot (Groq) chỉ bắt được **1/3** lỗi: SQL injection (severity `high`, fix đề xuất đúng) — verify bằng `tsc --strict` xác nhận 2 lỗi còn lại (`db` undefined, `role` implicit any) là **lỗi compile thật**, không phải nitpick
- **2 nguyên nhân gốc đã xác định:**
  1. Prompt hiện tại (`buildPrompt` trong `llmReviewer.groq.ts`) có câu "Bỏ qua nitpick về style/format" — LLM có thể đã hiểu nhầm implicit-any là nitpick rồi bỏ qua
  2. Groq (`llama-3.3-70b-versatile`) là model nhỏ/nhanh, không mạnh bằng Claude ở việc suy luận nhiều vấn đề cùng lúc trong 1 lần review

**Việc cần làm khi quay lại (mai):**

- [ ] Khi có credit Claude thật → revert 3 chỗ TEMP, chạy lại đúng PR test trên `sandbox/sample.ts` để so sánh Claude bắt được bao nhiêu/3 lỗi — đây là bằng chứng thực tế cho quyết định "Claude có đáng trả tiền hơn Groq không"
- [ ] Cân nhắc tune lại prompt — câu "bỏ qua nitpick" có thể đang khiến bot bỏ sót bug thật, không chỉ style
- [ ] Dọn PR test #1 + branch `test/trigger-review-bot` khi không cần nữa (`gh pr close 1 --delete-branch`)
- [ ] Nhớ: ngrok URL đổi mỗi lần restart (bản free) — phải cập nhật lại Webhook URL trên GitHub App mỗi lần bật lại `ngrok`
