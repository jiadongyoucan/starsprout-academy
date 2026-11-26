import type { Db } from '../infra/db.ts';
import { forbidden, notFound } from '../core/errors.ts';
import { newId, nowIso, today, addDays } from '../core/security.ts';
import type { AuthUser } from '../core/http.ts';

export type UserRow = {
  id: string; email: string; name: string; role: 'parent' | 'teacher' | 'admin';
  password_hash: string; must_change_password: number; disabled: number; created_at: string;
};
export type ChildRow = {
  id: string; household_id: string; name: string; class_code: string;
  birth_year: number | null; avatar: string | null; created_at: string;
};
export type HouseholdRow = { id: string; name: string; owner_id: string; created_at: string };

export function audit(
  db: Db,
  input: {
    householdId?: string | null; actorId?: string | null; action: string;
    entity: string; entityId?: string | null; detail?: unknown; ip?: string;
  },
): void {
  db.run(
    'INSERT INTO audit_logs(id, household_id, actor_id, action, entity, entity_id, detail, ip, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [newId(), input.householdId ?? null, input.actorId ?? null, input.action, input.entity,
      input.entityId ?? null, input.detail === undefined ? null : JSON.stringify(input.detail), input.ip ?? null, nowIso()],
  );
}

export function getUserHouseholdId(db: Db, userId: string): string | null {
  const row = db.get<{ household_id: string }>(
    'SELECT household_id FROM household_members WHERE user_id = ? ORDER BY created_at LIMIT 1',
    [userId],
  );
  return row?.household_id ?? null;
}

export function getHousehold(db: Db, householdId: string): HouseholdRow {
  const household = db.get<HouseholdRow>('SELECT * FROM households WHERE id = ?', [householdId]);
  if (!household) throw notFound('家庭不存在');
  return household;
}

export function listChildren(db: Db, householdId: string): ChildRow[] {
  return db.all<ChildRow>('SELECT * FROM children WHERE household_id = ? ORDER BY created_at', [householdId]);
}

export function assertHousehold(db: Db, user: AuthUser, householdId: string): void {
  if (!householdId) throw forbidden('缺少家庭信息');
  const member = db.get('SELECT 1 AS ok FROM household_members WHERE household_id = ? AND user_id = ?', [householdId, user.id]);
  if (!member) throw forbidden('无权访问该家庭的数据');
}

export function assertChildAccess(db: Db, user: AuthUser, childId: string): ChildRow {
  const child = db.get<ChildRow>('SELECT * FROM children WHERE id = ?', [childId]);
  if (!child) throw notFound('孩子档案不存在');
  assertHousehold(db, user, child.household_id);
  return child;
}

export function resolveChildId(db: Db, user: AuthUser, requested?: unknown): string {
  if (typeof requested === 'string' && requested.trim()) return assertChildAccess(db, user, requested.trim()).id;
  const first = listChildren(db, user.householdId)[0];
  if (!first) throw notFound('请先创建孩子档案');
  return first.id;
}

export function assertPlanAccess(db: Db, user: AuthUser, planId: string): Record<string, any> {
  const plan = db.get<any>('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) throw notFound('学习计划不存在');
  assertHousehold(db, user, plan.household_id);
  return plan;
}

export function consentGranted(db: Db, childId: string, kind: 'camera' | 'ai_processing' | 'analytics'): boolean {
  const row = db.get<{ granted: number }>('SELECT granted FROM guardian_consents WHERE child_id = ? AND kind = ?', [childId, kind]);
  return !!row?.granted;
}

export function assertConsent(db: Db, childId: string, kind: 'camera' | 'ai_processing' | 'analytics') {
  if (!consentGranted(db, childId, kind)) {
    const label = kind === 'camera' ? '拍照监督' : kind === 'ai_processing' ? 'AI 处理' : '学习分析';
    throw forbidden(`尚未获得监护人关于「${label}」的授权，请先在隐私设置中开启`);
  }
}

export function subjectMap(db: Db): Record<string, { name: string; icon: string; color: string }> {
  const rows = db.all<{ code: string; name: string; icon: string; color: string }>('SELECT code, name, icon, color FROM subjects');
  return Object.fromEntries(rows.map(r => [r.code, r]));
}

export function classMap(db: Db): Record<string, { name: string; age_min: number; age_max: number }> {
  const rows = db.all<{ code: string; name: string; age_min: number; age_max: number }>('SELECT code, name, age_min, age_max FROM class_levels');
  return Object.fromEntries(rows.map(r => [r.code, r]));
}

export function streakDays(db: Db, childId: string): number {
  const rows = db.all<{ d: string }>(
    `SELECT DISTINCT substr(completed_at, 1, 10) AS d FROM progress
     WHERE child_id = ? AND status = 'completed' AND completed_at IS NOT NULL ORDER BY d DESC LIMIT 400`,
    [childId],
  );
  const days = new Set(rows.map(r => r.d));
  let streak = 0;
  let cursor = today();
  if (!days.has(cursor)) cursor = addDays(cursor, -1);
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function isoWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
