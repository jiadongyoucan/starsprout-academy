import { validation } from './errors.ts';

export type StrOpts = {
  min?: number;
  max?: number;
  pattern?: RegExp;
  optional?: boolean;
  label?: string;
  trim?: boolean;
};
export type IntOpts = { min?: number; max?: number; optional?: boolean; label?: string };

function fail(label: string, message: string): never {
  throw validation(`${label}${message}`);
}

export function str(value: unknown, opts: StrOpts = {}): string {
  const label = opts.label || '字段';
  if (value === undefined || value === null || value === '') {
    if (opts.optional) return '';
    fail(label, '不能为空');
  }
  if (typeof value !== 'string') fail(label, '必须是文本');
  const out = opts.trim === false ? value : value.trim();
  if (!out && !opts.optional) fail(label, '不能为空');
  if (opts.min !== undefined && out.length < opts.min) fail(label, `至少需要 ${opts.min} 个字符`);
  if (opts.max !== undefined && out.length > opts.max) fail(label, `不能超过 ${opts.max} 个字符`);
  if (opts.pattern && !opts.pattern.test(out)) fail(label, '格式不正确');
  return out;
}

export function int(value: unknown, opts: IntOpts = {}): number {
  const label = opts.label || '数字';
  if (value === undefined || value === null || value === '') {
    if (opts.optional) return 0;
    fail(label, '不能为空');
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) fail(label, '必须是整数');
  if (opts.min !== undefined && n < opts.min) fail(label, `不能小于 ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) fail(label, `不能大于 ${opts.max}`);
  return n;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label = '选项'): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(label, `必须是 ${allowed.join(' / ')} 之一`);
  }
  return value as T;
}

export function email(value: unknown): string {
  const s = str(value, { label: '邮箱', max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ });
  return s.toLowerCase();
}

export function isoDate(value: unknown, label = '日期'): string {
  const s = str(value, { label, pattern: /^\d{4}-\d{2}-\d{2}$/ });
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(label, '不是有效日期');
  return s;
}

export function optionalIsoDate(value: unknown, label = '日期'): string {
  if (value === undefined || value === null || value === '') return '';
  return isoDate(value, label);
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

export function jsonObject(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : fallback;
}

export function jsonArray<T = unknown>(value: unknown, fallback: T[] = []): T[] {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return Array.isArray(value) ? (value as T[]) : fallback;
}

export function oneOfOptional<T extends string>(value: unknown, allowed: readonly T[], label?: string): T | '' {
  if (value === undefined || value === null || value === '') return '';
  return oneOf(value, allowed, label);
}

export function parseJsonSafe<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
