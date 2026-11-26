#!/usr/bin/env bash
# 星芽学堂 · 一键本机启动（不需要 npm install，不需要数据库）
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "✗ 未找到 Node.js。请安装 Node.js 24 或更高版本：https://nodejs.org" >&2
  exit 1
fi
MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 24 ]; then
  echo "✗ 需要 Node.js 24+（当前 $("$NODE_BIN" -v)）。node:sqlite 与原生 TypeScript 支持依赖 24。" >&2
  exit 1
fi

[ -f .env ] || cp .env.example .env
mkdir -p data

MODE="${1:-}"
if [ "$MODE" = "--demo" ]; then
  export SEED_DEMO=true DEMO_MODE=true ENABLE_SANDBOX=true DATA_DIR="${DATA_DIR:-./data/demo}"
  echo "⚠️  演示模式：会写入演示家庭与演示账号，仅限本机体验，不要对公网开放。"
elif [ "$MODE" = "--real" ]; then
  export SEED_DEMO=false DEMO_MODE=false DATA_DIR="${DATA_DIR:-./data/prod}"
  if [ -z "${SETUP_TOKEN:-}" ]; then SETUP_TOKEN="$(openssl rand -hex 16 2>/dev/null || "$NODE_BIN" -e "console.log(require(\"node:crypto\").randomBytes(16).toString(\"hex\"))")"; export SETUP_TOKEN; fi
  echo "✓ 真实模式：首次打开会要求创建管理员；数据目录 ${DATA_DIR}"
fi

echo "🌱 星芽学堂启动中…"
echo "   家长端: http://localhost:${PORT:-8080}"
echo "   学习端: http://localhost:${PORT:-8080}/device"
  if [ "$MODE" = "--real" ]; then echo "   局域网: 手机/平板请使用 http://<本机局域网 IP>:${PORT:-8080}（配对弹窗会自动识别）"; fi
echo "   文档:   http://localhost:${PORT:-8080}/docs/"
if [ "$MODE" = "--real" ]; then echo "   首次打开: 创建管理员（仅本机；远程需 SETUP_TOKEN）"; echo "   SETUP_TOKEN: ${SETUP_TOKEN}"; fi
exec "$NODE_BIN" src/server.ts
