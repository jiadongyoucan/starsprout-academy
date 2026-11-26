#!/usr/bin/env bash
# 端到端冒烟：健康检查 → 演示登录 → 看板 → 课程 → 设备配对
set -euo pipefail
BASE="${1:-http://localhost:8080}"
say() { printf "\n▸ %s\n" "$1"; }
say "健康检查"
curl -fsS "$BASE/api/health" | head -c 240; echo
say "演示家长登录"
TOKEN=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"parent@demo.com","password":"Parent123!"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!j.ok)process.exit(1);process.stdout.write(j.data.token)})")
AUTH="authorization: Bearer $TOKEN"
say "孩子与课程体系"
curl -fsS "$BASE/api/children" -H "$AUTH" | head -c 200; echo
curl -fsS "$BASE/api/curriculum/overview" -H "$AUTH" | head -c 200; echo
say "AI 计划（本地引擎）"
curl -fsS -X POST "$BASE/api/plans/generate" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"childId":"chi_mili","weeks":1,"daysPerWeek":3,"minutesPerDay":20}' | head -c 220; echo
say "设备配对码"
CODE=$(curl -fsS -X POST "$BASE/api/devices/pairing-code" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"冒烟平板","kind":"ipad"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.data.code)})")
echo "配对码：$CODE"
say "配对并读取收件箱"
DTOKEN=$(curl -fsS -X POST "$BASE/api/device/pair" -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"name\":\"冒烟平板\",\"kind\":\"ipad\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.data.token)})")
curl -fsS "$BASE/api/device/inbox" -H "authorization: Bearer $DTOKEN" | head -c 220; echo
say "全部通过 ✅"
