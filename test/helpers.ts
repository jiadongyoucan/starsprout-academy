import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildApp, type BuiltApp } from '../src/app.ts';

export type TestContext = {
  app: BuiltApp;
  base: string;
  dir: string;
  close: () => Promise<void>;
};

export async function createTestApp(): Promise<TestContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starsprout-test-'));
  const app = buildApp({ dbFile: path.join(dir, 'test.db'), dataDir: dir, seedDemo: false });
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  return {
    app, base, dir,
    close: async () => {
      app.server.closeAllConnections?.();
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type ApiResult = { status: number; ok: boolean; data: any; error: any; text: string };

export async function api(
  base: string, method: string, endpoint: string,
  options: { body?: unknown; token?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* non-json */ }
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300 && parsed?.ok !== false,
    data: parsed?.data,
    error: parsed?.error,
    text,
  };
}

let seq = 0;
export async function newUser(base: string, opts: { email?: string; name?: string; password?: string } = {}) {
  seq += 1;
  const email = opts.email || `parent${seq}-${Date.now()}@test.dev`;
  const password = opts.password || 'Passw0rd!';
  const result = await api(base, 'POST', '/api/auth/register', {
    body: { email, password, name: opts.name || '测试家长' },
  });
  if (!result.ok) throw new Error(`register failed: ${JSON.stringify(result.error)}`);
  return { token: result.data.token as string, user: result.data.user, household: result.data.household, email, password };
}

export async function login(base: string, email: string, password = 'Passw0rd!') {
  const result = await api(base, 'POST', '/api/auth/login', { body: { email, password } });
  return result;
}

export async function promote(app: BuiltApp, userId: string, role: 'teacher' | 'admin') {
  app.db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
}

export async function addChild(base: string, token: string, overrides: Record<string, unknown> = {}) {
  const result = await api(base, 'POST', '/api/children', {
    token,
    body: {
      name: overrides.name || '小米', classCode: overrides.classCode || 'junior',
      birthYear: 2022, consents: { camera: true, ai_processing: true, analytics: true },
      ...overrides,
    },
  });
  if (!result.ok) throw new Error(`add child failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function daysAhead(n: number): string {
  return daysAgo(-n);
}

export async function pairDevice(base: string, parentToken: string, name = '测试平板') {
  const codeResult = await api(base, 'POST', '/api/devices/pairing-code', { token: parentToken, body: { name, kind: 'ipad' } });
  if (!codeResult.ok) throw new Error(`pairing code failed: ${JSON.stringify(codeResult.error)}`);
  const pair = await api(base, 'POST', '/api/device/pair', { body: { code: codeResult.data.code, name, kind: 'ipad' } });
  if (!pair.ok) throw new Error(`pair failed: ${JSON.stringify(pair.error)}`);
  return { token: pair.data.token as string, device: pair.data.device, code: codeResult.data.code as string, expiresAt: codeResult.data.expiresAt };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PNG_DATA_URL = `data:image/png;base64,${Buffer.concat([PNG_SIGNATURE, Buffer.alloc(400, 0x41)]).toString('base64')}`;

export async function completeLesson(base: string, token: string, childId: string, lessonId: string, extra: Record<string, unknown> = {}) {
  return api(base, 'POST', `/api/curriculum/lessons/${lessonId}/progress`, {
    token,
    body: { childId, status: 'completed', score: 90, seconds: 600, ...extra },
  });
}
