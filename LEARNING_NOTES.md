# AI Code Review Bot — Notes học + Quyết định thiết kế

Nguồn ý tưởng gốc: [2026-07-06-ai-code-review-bot.html](https://gistcdn.githack.com/nhd98z/9b66fe67436de543c5dbf46af7514b32/raw/2c60c6f371773fbc05baa479b1af18e889a0a1b7/2026-07-06-ai-code-review-bot.html)

## Quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Project | Riêng biệt, không nằm trong b3-mono |
| Ngôn ngữ | TypeScript/Node |
| LLM | Claude API (Anthropic) |
| Hạ tầng test | Chạy local + ngrok/tunnel trước, deploy sau |
| GitHub auth | GitHub App (không dùng PAT cho production) |
| Repo test | 1 repo cá nhân đã có sẵn |
| Lưu metrics (MVP) | Console/file log — **KHÔNG** dùng DB ở giai đoạn MVP |
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
