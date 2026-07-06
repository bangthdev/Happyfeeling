# AI Code Review Bot — Design Spec

Nguồn ý tưởng gốc: [2026-07-06-ai-code-review-bot.html](https://gistcdn.githack.com/nhd98z/9b66fe67436de543c5dbf46af7514b32/raw/2c60c6f371773fbc05baa479b1af18e889a0a1b7/2026-07-06-ai-code-review-bot.html)

## Mục tiêu (MVP)

Bot tự động review Pull Request bằng Claude API: nhận webhook khi có PR → lấy diff → gọi LLM review → post comment đúng vị trí trên GitHub. Không làm agentic session, dashboard, hay tích hợp Linear/Slack ở giai đoạn này.

## Quyết định thiết kế

| Hạng mục | Quyết định | Lý do |
|---|---|---|
| Project | Riêng biệt, không nằm trong b3-mono | Side project cá nhân để học |
| Ngôn ngữ | TypeScript/Node | Đã quyết định trước |
| Framework | Express | Nhiều tutorial, dễ tìm khi stuck |
| LLM | Claude API (Anthropic) | Đã chọn |
| GitHub auth | GitHub App (JWT → installation token) | Đúng chuẩn production, permission scoping rõ ràng |
| Context strategy | Static Context Builder | Rẻ, nhanh, đủ cho MVP; Agentic Session để giai đoạn sau |
| Lưu metrics | Console/file log | Tránh học DB + JWT cùng lúc; SQLite để giai đoạn 2 |
| Repo test | 1 repo cá nhân đã có sẵn | Test thực tế hơn repo demo trống |
| Hạ tầng | Local + ngrok/tunnel | Setup nhanh, deploy thật để sau |

## Kiến trúc pipeline

```
GitHub PR event
      │
      ▼
[1] Webhook Receiver (Express)
      │  - verify HMAC signature (secret tự đặt khi tạo webhook)
      │  - parse payload → {repo, pr_number, action}
      ▼
[2] GitHub App Auth Module
      │  - ký JWT bằng private key của App
      │  - đổi JWT lấy installation token (cache đến khi hết hạn ~1h)
      ▼
[3] Context Builder (Static)
      │  - gọi GitHub API lấy diff
      │  - (optional, nếu còn thời gian) lấy thêm file liên quan qua import
      ▼
[4] LLM Reviewer (Claude API)
      │  - gửi diff + context vào prompt
      │  - ép Claude trả JSON có cấu trúc: Finding[]
      ▼
[5] Comment Poster
      │  - map Finding.line → vị trí đúng trong unified diff hunk
      │  - post comment qua GitHub API (dùng installation token)
      ▼
[6] Logger
      - ghi metrics ra console/file: {pr_number, findings_count, severity_breakdown, latency_ms, tokens_used}
```

## Components

| Component | Nhiệm vụ | Input → Output |
|---|---|---|
| Webhook Receiver | Nhận POST từ GitHub, verify HMAC signature | raw request → `{repo, pr_number, action}` |
| Auth Module | Ký JWT, đổi installation token | private key → token (cache đến khi hết hạn) |
| Context Builder | Gọi API lấy diff + file liên quan | pr_number → `{diff, files[]}` |
| LLM Reviewer | Gửi prompt, ép Claude trả JSON | diff + context → `Finding[]` |
| Comment Poster | Map dòng diff-hunk, gọi API post comment | `Finding[]` → comment trên GitHub |
| Logger | Ghi metrics ra file/console | run info → dòng log JSON |

## Data structures

**Finding** (nội dung review, sẽ post thành comment):
```json
{
  "file": "src/auth/login.ts",
  "line": 42,
  "severity": "high",
  "message": "Token không được validate trước khi dùng để query DB",
  "suggestion": "Thêm middleware verifyToken() trước dòng này"
}
```

**Metrics** (log về quá trình chạy, không phải nội dung review):
```json
{
  "pr_number": 12,
  "findings_count": 3,
  "severity_breakdown": { "high": 1, "medium": 2 },
  "latency_ms": 4200,
  "tokens_used": 8500
}
```

## Error handling

- Rate limit (GitHub + Claude API) → retry với backoff
- PR có nhiều commit (push thêm) → tránh post trùng comment cũ
- File generated/vendor (`.pb.go`, `vendor/`, `node_modules/`) → lọc bỏ trước khi gửi LLM
- Claude trả JSON sai format → retry 1 lần với prompt nhắc lại format, nếu vẫn lỗi thì skip + log lỗi

## Testing

- Test thủ công: tự mở PR giả trên repo cá nhân, xem bot có post đúng vị trí không
- Unit test riêng cho phần khó nhất: hàm map "dòng trong file" → "vị trí trong diff hunk" (chỗ hay sai nhất theo tài liệu gốc)

## Ngoài phạm vi MVP (giai đoạn 2+)

- SQLite cho metrics có cấu trúc / dashboard
- Agentic Session (clone + sandbox, agent tự grep/đọc code)
- Tích hợp Linear (parse ticket ID, lấy acceptance criteria)
- Tích hợp Slack (tìm thread liên quan)
