import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { buildApp } from './app.ts';
import { log } from './core/logger.ts';
import { purgeExpiredSnapshots } from './modules/analytics.ts';
import { refillActivePlanReminders } from './modules/plans.ts';

const { db, router, server, close } = buildApp();

// Never expose demo credentials from a production database by accident.
if (!config.demoMode) {
  const demoUsers = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE email LIKE '%@demo.com'")?.c || 0);
  if (demoUsers > 0) {
    throw new Error('检测到演示账号。真实模式请使用独立数据目录（./scripts/start.sh --real），演示请用 --demo。');
  }
}

function purgeOldSnapshots(): void {
  try {
    const result = purgeExpiredSnapshots(db, Number(process.env.SNAPSHOT_RETENTION_DAYS || 30));
    for (const file of result.files) {
      fs.promises.unlink(path.join(config.snapshotDir, path.basename(file))).catch(() => {});
    }
    if (result.removed) log.info('snapshots_purged', { removed: result.removed, days: result.cutoffDays });
  } catch (error) {
    log.warn('snapshots_purge_failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

let active = server;
if (config.tls.cert && config.tls.key) {
  active = https.createServer(
    { cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) },
    (req, res) => void router.handle(req, res),
  ) as unknown as typeof server;
  log.info('https_enabled', { cert: config.tls.cert });
}

active.listen(config.port, config.host, () => {
  const scheme = config.tls.cert && config.tls.key ? 'https' : 'http';
  log.info('server_started', { url: `${scheme}://${config.host}:${config.port}`, env: config.env, dataDir: config.dataDir });
  console.log(`\n  🌱 星芽学堂已启动：${scheme}://localhost:${config.port}`);
  console.log(`  📱 平板/学习端：${scheme}://localhost:${config.port}/device`);
  console.log(`  📚 产品文档：${scheme}://localhost:${config.port}/docs/`);
  if (config.demoMode) {
    console.log('  👤 演示账号：parent@demo.com / Parent123!  · teacher@demo.com / Teacher123!  · admin@demo.com / Admin123!');
  }
  console.log('');
});

purgeOldSnapshots();
try {
  const reminding = refillActivePlanReminders(db);
  if (reminding) log.info('reminders_refilled', { created: reminding });
} catch (error) {
  log.warn('reminders_refill_failed', { error: error instanceof Error ? error.message : String(error) });
}
const reminderTimer = setInterval(() => {
  try { refillActivePlanReminders(db); } catch { /* logged at boot */ }
}, 6 * 3600_000);
reminderTimer.unref();
const retentionTimer = setInterval(purgeOldSnapshots, 24 * 3600_000);
retentionTimer.unref();

async function shutdown(signal: string): Promise<void> {
  log.info('shutdown', { signal });
  clearInterval(retentionTimer);
  clearInterval(reminderTimer);
  active.close(() => {
    void close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
