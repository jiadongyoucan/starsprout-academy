#!/usr/bin/env bash
# 备份 SQLite（一致性快照）与上传照片。用法： ./scripts/backup.sh [目标目录]
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-./backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$TARGET"
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const db = new DatabaseSync(process.env.DB_FILE || './data/starsprout.db');
db.exec(\"VACUUM INTO '\" + path.resolve('$TARGET', 'starsprout.db') + \"'\");
db.close();
"
if [ -d data/snapshots ]; then
  tar -C data -czf "$TARGET/snapshots.tar.gz" snapshots
fi
cp -f .env "$TARGET/env.backup" 2>/dev/null || true
echo "✅ 备份完成：$TARGET"
