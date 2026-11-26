import type { Db } from '../infra/db.ts';
import { forbidden, notFound, validation } from '../core/errors.ts';
import { newId, nowIso } from '../core/security.ts';
import { int, oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { assertChildAccess, audit, consentGranted, listChildren, streakDays, type ChildRow } from './shared.ts';
import { purgeChildSnapshots } from './device.ts';
import { forbidden as deny } from '../core/errors.ts';

const POLICY_VERSION = '2026-01';
export const CONSENT_KINDS = ['camera', 'ai_processing', 'analytics'] as const;

export function childrenView(db: Db, user: AuthUser) {
  return listChildren(db, user.householdId).map(child => ({
    ...child,
    age: child.birth_year ? new Date().getFullYear() - child.birth_year : null,
    consents: {
      camera: consentGranted(db, child.id, 'camera'),
      ai_processing: consentGranted(db, child.id, 'ai_processing'),
      analytics: consentGranted(db, child.id, 'analytics'),
    },
    stats: {
      completed: Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM progress WHERE child_id = ? AND status = 'completed'", [child.id])?.c || 0),
      minutes: Number(db.get<{ m: number }>(
        `SELECT COALESCE(SUM(l.minutes),0) AS m FROM progress p JOIN lessons l ON l.id = p.lesson_id
         WHERE p.child_id = ? AND p.status = 'completed'`, [child.id])?.m || 0),
      streak: streakDays(db, child.id),
    },
  }));
}

function upsertConsent(db: Db, householdId: string, childId: string, kind: string, granted: boolean, userId: string): void {
  const now = nowIso();
  db.run(
    `INSERT INTO guardian_consents(id, household_id, child_id, kind, granted, granted_by, policy_version, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(child_id, kind) DO UPDATE SET granted = excluded.granted, granted_by = excluded.granted_by,
       policy_version = excluded.policy_version, updated_at = excluded.updated_at`,
    [newId(), householdId, childId, kind, granted ? 1 : 0, userId, POLICY_VERSION, now, now],
  );
}

export function createChild(db: Db, user: AuthUser, body: any) {
  const name = str(body?.name, { label: '孩子昵称', min: 1, max: 12 });
  const classCode = oneOf(body?.classCode, ['nursery', 'junior', 'middle', 'senior'] as const, '学段');
  const birthYear = body?.birthYear ? int(body.birthYear, { min: 2016, max: new Date().getFullYear(), label: '出生年份' }) : null;
  const avatar = str(body?.avatar, { optional: true, max: 4, label: '头像' }) || name.slice(0, 1);
  const consents = body?.consents && typeof body.consents === 'object' ? body.consents : {};
  const id = newId();
  db.tx(() => {
    db.run('INSERT INTO children(id, household_id, name, class_code, birth_year, avatar, created_at) VALUES(?,?,?,?,?,?,?)',
      [id, user.householdId, name, classCode, birthYear, avatar, nowIso()]);
    upsertConsent(db, user.householdId, id, 'ai_processing', consents.ai_processing === true, user.id);
    upsertConsent(db, user.householdId, id, 'camera', consents.camera === true, user.id);
    upsertConsent(db, user.householdId, id, 'analytics', consents.analytics === true, user.id);
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'child.create', entity: 'child', entityId: id, detail: { classCode } });
  });
  return listChildren(db, user.householdId).find(c => c.id === id);
}

export function updateChild(db: Db, user: AuthUser, childId: string, body: any) {
  const child = assertChildAccess(db, user, childId);
  const name = body?.name !== undefined ? str(body.name, { label: '孩子昵称', min: 1, max: 12 }) : child.name;
  const classCode = body?.classCode !== undefined
    ? oneOf(body.classCode, ['nursery', 'junior', 'middle', 'senior'] as const, '学段') : child.class_code;
  const birthYear = body?.birthYear !== undefined
    ? (body.birthYear ? int(body.birthYear, { min: 2016, max: new Date().getFullYear(), label: '出生年份' }) : null)
    : child.birth_year;
  db.run('UPDATE children SET name = ?, class_code = ?, birth_year = ? WHERE id = ?', [name, classCode, birthYear, child.id]);
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'child.update', entity: 'child', entityId: child.id });
  return db.get<ChildRow>('SELECT * FROM children WHERE id = ?', [child.id]);
}

export async function deleteChild(db: Db, user: AuthUser, childId: string, body: any) {
  const child = assertChildAccess(db, user, childId);
  if (body?.confirm !== true) throw validation('删除孩子档案需要 confirm: true');
  await purgeChildSnapshots(db, user, child.id);
  db.tx(() => {
    db.run('DELETE FROM plan_items WHERE child_id = ?', [child.id]);
    db.run('DELETE FROM plans WHERE child_id = ?', [child.id]);
    db.run('DELETE FROM reminders WHERE child_id = ?', [child.id]);
    db.run('DELETE FROM progress WHERE child_id = ?', [child.id]);
    db.run('DELETE FROM guardian_consents WHERE child_id = ?', [child.id]);
    db.run('DELETE FROM learning_sessions WHERE child_id = ?', [child.id]);
    db.run('DELETE FROM children WHERE id = ?', [child.id]);
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'child.delete', entity: 'child', entityId: child.id });
  });
  return { deleted: true, child: child.name };
}

export function listConsents(db: Db, user: AuthUser, childId: string) {
  const child = assertChildAccess(db, user, childId);
  return db.all<any>('SELECT kind, granted, policy_version, updated_at FROM guardian_consents WHERE child_id = ?', [child.id])
    .map(row => ({ ...row, granted: !!row.granted }));
}

export function setConsent(db: Db, user: AuthUser, childId: string, kindRaw: string, body: any) {
  const child = assertChildAccess(db, user, childId);
  const kind = oneOf(kindRaw, CONSENT_KINDS, '授权类型');
  const granted = body?.granted === true;
  upsertConsent(db, user.householdId, child.id, kind, granted, user.id);
  audit(db, {
    householdId: user.householdId, actorId: user.id, action: 'privacy.consent', entity: 'child', entityId: child.id,
    detail: { kind, granted },
  });
  return { childId: child.id, kind, granted, policyVersion: POLICY_VERSION };
}

export function consentSummary(db: Db, user: AuthUser) {
  return listChildren(db, user.householdId).map(child => ({
    childId: child.id, name: child.name,
    camera: consentGranted(db, child.id, 'camera'),
    aiProcessing: consentGranted(db, child.id, 'ai_processing'),
    analytics: consentGranted(db, child.id, 'analytics'),
  }));
}

export function exportChildData(db: Db, user: AuthUser, childId: string) {
  const child = assertChildAccess(db, user, childId);
  const progress = db.all('SELECT * FROM progress WHERE child_id = ?', [child.id]);
  const plans = db.all('SELECT * FROM plans WHERE child_id = ?', [child.id]);
  const planItems = db.all('SELECT * FROM plan_items WHERE child_id = ?', [child.id]);
  const snapshots = db.all('SELECT id, note, created_at, device_id FROM snapshots WHERE child_id = ?', [child.id]);
  const learning = db.all('SELECT * FROM learning_sessions WHERE child_id = ?', [child.id]);
  const consents = listConsents(db, user, child.id);
  const memories = db.all('SELECT key, value, updated_at FROM agent_memory WHERE household_id = ?', [user.householdId]);
  const pet = db.get<Record<string, any>>('SELECT species, name, level, exp, hunger, happiness, energy, bond, adopted_at FROM pets WHERE child_id = ?', [child.id]);
  const wallet = db.get<Record<string, any>>('SELECT coins, total_earned FROM wallets WHERE child_id = ?', [child.id]);
  const petInventory = pet ? db.all('SELECT item_code, qty, equipped, acquired_at FROM pet_inventory WHERE pet_id = (SELECT id FROM pets WHERE child_id = ?)', [child.id]) : [];
  const rewardEvents = db.all('SELECT source_type, source_id, coins, exp, stars, created_at FROM reward_events WHERE child_id = ?', [child.id]);
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'privacy.export', entity: 'child', entityId: child.id });
  return {
    exportedAt: nowIso(), policyVersion: POLICY_VERSION,
    child, consents, progress, plans, planItems, snapshots, learningSessions: learning, memories,
    companion: { pet, wallet, inventory: petInventory, rewards: rewardEvents },
    notice: '这是该孩子的结构化学习数据副本，不包含照片原图；照片可由家长单独下载或删除。',
  };
}

export function deleteHouseholdMemories(db: Db, user: AuthUser) {
  const count = db.run('DELETE FROM agent_memory WHERE household_id = ?', [user.householdId]).changes;
  const runs = db.run('DELETE FROM sandbox_executions WHERE household_id = ?', [user.householdId]).changes;
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'privacy.memory_purge', entity: 'household', entityId: user.householdId, detail: { count, runs } });
  return { memoriesRemoved: count, sandboxRunsRemoved: runs };
}

export function eraseHousehold(db: Db, user: AuthUser) {
  const household = db.get<{ id: string; owner_id: string }>('SELECT id, owner_id FROM households WHERE id = ?', [user.householdId]);
  if (!household) throw notFound('家庭不存在');
  if (household.owner_id !== user.id) throw deny('只有家庭创建者可以删除整个家庭的数据');
  const members = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM household_members WHERE household_id = ?', [user.householdId])?.c || 0);
  if (members > 1) throw deny('家庭还有其他成员，请先移除成员或转让家庭后再删除');
  const snapshots = db.all<{ file: string }>('SELECT file FROM snapshots WHERE household_id = ?', [user.householdId]);
  const counts = {
    children: Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM children WHERE household_id = ?', [user.householdId])?.c || 0),
    plans: Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM plans WHERE household_id = ?', [user.householdId])?.c || 0),
    posts: Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM community_posts WHERE household_id = ?', [user.householdId])?.c || 0),
    devices: Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM devices WHERE household_id = ?', [user.householdId])?.c || 0),
    snapshots: snapshots.length,
  };
  db.tx(() => {
    db.run('DELETE FROM community_posts WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM experts WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM skills WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM connectors WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM reports WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM agent_memory WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM sandbox_executions WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM snapshots WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM devices WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM children WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM plans WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM reminders WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM plan_items WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM household_members WHERE household_id = ?', [user.householdId]);
    db.run('DELETE FROM households WHERE id = ?', [user.householdId]);
    db.run('UPDATE users SET disabled = 1 WHERE id = ?', [user.id]);
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'privacy.household_erase', entity: 'household', entityId: user.householdId, detail: counts });
  });
  return { deleted: counts, files: snapshots.map(s => s.file) };
}

export function disableAccount(db: Db, user: AuthUser) {
  if (user.role === 'admin') throw forbidden('管理员账号不能自助注销，请联系其他管理员');
  db.tx(() => {
    db.run('UPDATE users SET disabled = 1 WHERE id = ?', [user.id]);
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);
    db.run('DELETE FROM household_members WHERE user_id = ?', [user.id]);
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'privacy.account_disable', entity: 'user', entityId: user.id });
  });
  return { disabled: true, message: '账号已停用，所有登录会话已失效。家庭数据保留给其他监护人，可联系管理员恢复。' };
}
