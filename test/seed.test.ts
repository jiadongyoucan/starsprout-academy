import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/infra/db.ts';
import { seedDatabase, shouldSeedDemo } from '../src/infra/seed.ts';
import { config } from '../src/config.ts';

test('演示数据必须同时开启 SEED_DEMO 与 DEMO_MODE', () => {
  const original = { seedDemo: config.seedDemo, demoMode: config.demoMode, env: config.env };
  try {
    config.env = 'production';
    config.seedDemo = true;
    config.demoMode = false;
    assert.equal(shouldSeedDemo(), false);
    const singleSwitch = new Db(':memory:');
    seedDatabase(singleSwitch);
    assert.equal(singleSwitch.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c, 0);
    singleSwitch.close();

    config.demoMode = true;
    assert.equal(shouldSeedDemo(), true);
    const dualSwitch = new Db(':memory:');
    seedDatabase(dualSwitch);
    assert.ok(Number(dualSwitch.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c || 0) >= 4);
    dualSwitch.close();
  } finally {
    config.seedDemo = original.seedDemo;
    config.demoMode = original.demoMode;
    config.env = original.env;
  }
});
