#!/usr/bin/env bash
set -euo pipefail

if ! command -v tilix >/dev/null 2>&1; then
  echo "Không tìm thấy lệnh 'tilix' — script này cần chạy trong terminal Tilix." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOAD_RC='export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use default >/dev/null 2>&1'

echo "Chia pane phải: dev server (pnpm --filter @happyfeeling/github dev)..."
tilix -a session-add-right -e bash -c "$LOAD_RC; cd '$ROOT_DIR' && pnpm --filter @happyfeeling/github dev; exec bash"

echo "Chia pane dưới: ngrok (cổng 3000)..."
tilix -a session-add-down -e bash -c "$LOAD_RC; ngrok http 3000; exec bash"

echo ""
echo "Đã chia 2 pane trong cùng tab: dev server (phải-trên), ngrok (phải-dưới)."
echo "Xem dòng \"Forwarding  https://xxxx.ngrok-free.app -> http://localhost:3000\" ở pane ngrok."
echo "Lấy URL đó, thêm /webhook, dán vào GitHub App settings."
