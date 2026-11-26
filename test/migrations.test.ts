import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';

describe('数据库迁移：版本顺序与重启', () => {
  let dir = '';
  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  test('从空库迁移后再次启动不会重复执行 v7', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starsprout-migrate-'));
    const dbFile = path.join(dir, 'test.db');
    const first = buildApp({ dbFile, dataDir: dir, seedDemo: false });
    const version = Number(first.db.get<{ user_version: number }>('PRAGMA user_version')?.user_version || 0);
    assert.equal(version, 7);
    first.db.close();
    const second = buildApp({ dbFile, dataDir: dir, seedDemo: false });
    assert.equal(Number(second.db.get<{ user_version: number }>('PRAGMA user_version')?.user_version || 0), 7);
    second.db.close();
  });
});
