import crypto from 'node:crypto';
import { config } from '../config.ts';
import { validation } from './errors.ts';

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  // Business timezone is Asia/Shanghai; ISO UTC dates would shift near midnight.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- password ----------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function assertStrongPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw validation('密码长度需为 8–72 位');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw validation('密码需同时包含字母与数字');
  }
}

// ---------- JWT (HS256) ----------
export type TokenPayload = {
  sub: string;
  typ: 'user' | 'device';
  role?: string;
  hid?: string;
  jti?: string;
  did?: string;
  iat: number;
  exp: number;
};

const b64u = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

export function signToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'>,
  ttlSeconds = 60 * 60 * 24 * 7,
): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds }));
  const sig = crypto.createHmac('sha256', config.secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = crypto.createHmac('sha256', config.secret).update(`${header}.${body}`).digest();
    const provided = Buffer.from(sig, 'base64url');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (parsed.typ !== 'user' && parsed.typ !== 'device') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomCode(digits = 6): string {
  let code = '';
  for (let i = 0; i < digits; i++) code += crypto.randomInt(0, 10).toString();
  return code;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- secret sealing (AES-256-GCM) ----------
const secretKey = crypto.createHash('sha256').update(config.secret).digest();

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

export function openSecret(sealed: string | null | undefined): string {
  if (!sealed) return '';
  try {
    const [v, ivB64, tagB64, dataB64] = sealed.split('.');
    if (v !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecret(sealed: string | null | undefined): string {
  const plain = openSecret(sealed);
  if (!plain) return '';
  return `••••••${plain.slice(-4)}`;
}

// ---------- rate limit ----------
export type RateLimiter = { hit(key: string, max: number, windowMs: number): boolean };

export function createRateLimiter(): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();
  return {
    hit(key, max, windowMs) {
      const now = Date.now();
      if (now - lastSweep > 60_000) {
        for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
        lastSweep = now;
      }
      const b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      b.count += 1;
      return b.count <= max;
    },
  };
}
