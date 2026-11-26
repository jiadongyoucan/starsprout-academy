import { validation } from '../core/errors.ts';
import type { Db } from '../infra/db.ts';
import type { AuthUser } from '../core/http.ts';
import { assertChildAccess, resolveChildId } from './shared.ts';
import { WARMTH, type WarmthKind } from '../infra/warmth-data.ts';

const CONTEXTS = ['home', 'lesson', 'plan', 'child', 'device', 'report'] as const;
export type WarmthContext = (typeof CONTEXTS)[number];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function categoryFor(audience: string, context: WarmthContext, score?: number): WarmthKind[] {
  if (context === 'lesson') return score !== undefined && score < 70 ? ['lesson_retry'] : ['lesson_praise'];
  if (audience === 'child') {
    if (context === 'child') return ['child_warm', 'child_brave', 'child_humor'];
    return ['child_warm', 'child_brave'];
  }
  if (context === 'report') return ['parent_warm', 'parent_selfcare'];
  return ['parent_warm', 'parent_humor', 'parent_selfcare'];
}

export function pickWarmth(opts: {
  audience: 'parent' | 'child';
  context?: WarmthContext;
  childId?: string;
  score?: number;
  fresh?: boolean;
  exclude?: string[];
  ok?: boolean;
  date?: string;
}): { text: string; kind: WarmthKind; audience: 'parent' | 'child' } {
  const context = opts.context || (opts.audience === 'child' ? 'child' : 'home');
  if (!CONTEXTS.includes(context)) throw validation('未知的文案场景');
  const kinds = categoryFor(opts.audience, context, opts.score);
  const day = opts.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  // Tone kind is stable for the day; refreshing only changes the line within that tone.
  const kindSeed = `${day}:${opts.audience}:${context}:${opts.childId || ''}`;
  let kind = kinds[hash(kindSeed) % kinds.length];
  if (opts.audience === 'parent' && kind === 'parent_humor' && opts.ok === false) {
    kind = hash(`${kindSeed}:safe`) % 2 === 0 ? 'parent_warm' : 'parent_selfcare';
  }
  const excluded = new Set((opts.exclude || []).slice(0, 7));
  const available = WARMTH[kind].filter(line => !excluded.has(line));
  const pool = available.length ? available : WARMTH[kind];
  const lineSeed = `${kindSeed}:${kind}:${opts.fresh ? String(Date.now()) : ''}`;
  return { text: pool[hash(lineSeed) % pool.length], kind, audience: opts.audience };
}

export function warmthForUser(db: Db, user: AuthUser, query: URLSearchParams) {
  const audience = query.get('audience') === 'child' ? 'child' : 'parent';
  const context = (query.get('context') || (audience === 'child' ? 'child' : 'home')) as WarmthContext;
  if (!CONTEXTS.includes(context)) throw validation('未知的文案场景');
  let childId: string | undefined;
  if (query.get('childId')) {
    childId = assertChildAccess(db, user, resolveChildId(db, user, query.get('childId'))).id;
  }
  const scoreRaw = query.get('score');
  const score = scoreRaw === null ? undefined : Math.max(0, Math.min(100, Number(scoreRaw) || 0));
  const exclude = (query.get('exclude') || '').split('|').filter(Boolean).slice(0, 7);
  const ok = query.get('ok') === null ? undefined : query.get('ok') === '1';
  return pickWarmth({ audience, context, childId, score, fresh: query.get('fresh') === '1', exclude, ok });
}

export function warmthForDevice() {
  return pickWarmth({ audience: 'child', context: 'device' });
}

export function lessonWarmth(childId: string, score: number) {
  return pickWarmth({ audience: 'child', context: 'lesson', childId, score }).text;
}
