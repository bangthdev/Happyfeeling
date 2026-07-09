# AI Code Review Bot (MVP)

Bot tự động review Pull Request bằng Claude API. Xem thiết kế đầy đủ tại
`docs/superpowers/specs/2026-07-06-ai-code-review-bot-design.md`.

## Setup

### 1. Tạo GitHub App

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
2. Webhook URL: điền tạm `https://example.com/webhook`, sẽ cập nhật lại sau khi có ngrok URL
3. Webhook secret: tự sinh 1 chuỗi ngẫu nhiên (ví dụ `openssl rand -hex 20`), lưu lại — đây là `GITHUB_WEBHOOK_SECRET`
4. Repository permissions: **Pull requests: Read & write**, **Contents: Read-only**
5. Subscribe to events: **Pull request**
6. Tạo App xong, note lại **App ID** (đây là `GITHUB_APP_ID`)
7. Generate a private key → tải về file `.pem`, nội dung file này là `GITHUB_PRIVATE_KEY`
8. Install App vào 1 repo cá nhân của bạn → vào URL cài đặt, lấy `installation_id` từ URL dạng
   `https://github.com/settings/installations/<installation_id>` (đây là `GITHUB_INSTALLATION_ID`)

### 2. Cấu hình local

```bash
cp .env.example .env
```

Điền vào `.env`:
- `GITHUB_APP_ID` — App ID ở bước 6
- `GITHUB_PRIVATE_KEY` — nội dung file `.pem` ở bước 7, giữ nguyên `\n` xuống dòng
- `GITHUB_INSTALLATION_ID` — ở bước 8
- `GITHUB_WEBHOOK_SECRET` — chuỗi bí mật ở bước 3
- `ANTHROPIC_API_KEY` — API key Anthropic của bạn

### 3. Chạy local + expose qua ngrok

```bash
npm install
npm run dev
```

Ở terminal khác:

```bash
ngrok http 3000
```

Copy URL https ngrok trả về, quay lại GitHub App settings → cập nhật Webhook URL thành
`<ngrok-url>/webhook`.

### 4. Test

Mở 1 Pull Request trên repo đã cài App → xem log ở terminal chạy `npm run dev`, và
kiểm tra file `logs/metrics.log`.

## Testing

```bash
npm test
```
