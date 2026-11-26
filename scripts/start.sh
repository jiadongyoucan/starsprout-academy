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

if [ "${1:-}" = "--demo" ]; then
  export SEED_DEMO=true DEMO_MODE=true ENABLE_SANDBOX=true
  echo "⚠️  演示模式：会写入演示家庭与演示账号，仅限本机体验，不要对公网开放。"
fi

echo "🌱 星芽学堂启动中…"
echo "   家长端: http://localhost:${PORT:-8080}"
echo "   学习端: http://localhost:${PORT:-8080}/device"
echo "   文档:   http://localhost:${PORT:-8080}/docs/"
exec "$NODE_BIN" src/server.ts
