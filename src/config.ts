import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Minimal .env loader (zero dependency). Existing process.env always wins. */
function loadEnvFile(file = path.resolve('.env')): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'snapshots'), { recursive: true });

function resolveSecret(): string {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 16) return process.env.APP_SECRET;
  const keyFile = path.join(dataDir, 'secret.key');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(keyFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  dbFile: path.join(dataDir, 'starsprout.db'),
  snapshotDir: path.join(dataDir, 'snapshots'),
  webDir: path.resolve('src/web'),
  secret: resolveSecret(),
  tls: { cert: process.env.TLS_CERT || '', key: process.env.TLS_KEY || '' },
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`,
  setupToken: process.env.SETUP_TOKEN || '',
  demoMode: process.env.DEMO_MODE === 'true',
  seedDemo: process.env.SEED_DEMO === 'true',
  enableSandbox: process.env.ENABLE_SANDBOX === 'true',
  maxSnapshotBytes: Number(process.env.MAX_SNAPSHOT_BYTES || 2_500_000),
  ai: {
    provider: process.env.AI_PROVIDER || 'deepseek',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'deepseek-chat',
    apiKey: process.env.AI_API_KEY || '',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 45_000),
  },
  connectorAllowedHosts: (process.env.CONNECTOR_ALLOWED_HOSTS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  demo: {
    parent: { email: 'parent@demo.com', password: 'Parent123!' },
    teacher: { email: 'teacher@demo.com', password: 'Teacher123!' },
    admin: { email: 'admin@demo.com', password: 'Admin123!' },
  },
};

export type AppConfig = typeof config;
