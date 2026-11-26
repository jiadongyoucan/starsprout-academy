import type { Db } from '../infra/db.ts';
import { config } from '../config.ts';
import { AppError, conflict, notFound, unauthorized, validation } from '../core/errors.ts';
import {
  assertStrongPassword, hashPassword, newId, nowIso, randomCode, sha256, signToken, verifyPassword,
} from '../core/security.ts';
import { email as vEmail, oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { audit, getHousehold, getUserHouseholdId, listChildren, type ChildRow, type UserRow } from './shared.ts';
import { moderateContent } from './moderation.ts';

const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

export type AuthResult = {
  token: string;
  user: { id: string; email: string; name: string; role: string; mustChangePassword: boolean };
  household: { id: string; name: string };
  children: ChildRow[];
};

function publicUser(user: UserRow) {
  return {
    id: user.id, email: user.email, name: user.name, role: user.role,
    mustChangePassword: !!user.must_change_password,
  };
}

function issueSession(db: Db, user: UserRow, householdId: string): string {
  const jti = newId();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
  const token = signToken({ sub: user.id, typ: 'user', role: user.role, hid: householdId, jti }, TOKEN_TTL_SECONDS);
  db.run('INSERT INTO sessions(id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES(?,?,?,?,?,?)',
    [jti, user.id, sha256(token), expiresAt, null, nowIso()]);
  return token;
}

export function register(db: Db, body: any): AuthResult {
  const email = vEmail(body?.email);
  const password = str(body?.password, { label: '密码', min: 8, max: 72 });
  const name = str(body?.name, { label: '称呼', min: 1, max: 24 });
  const householdName = str(body?.householdName, { label: '家庭名称', min: 1, max: 30, optional: true }) || `${name}的家`;
  assertStrongPassword(password);
  const nameCheck = moderateContent(name, { onTopicHint: true });
  if (nameCheck.blocked || nameCheck.reasons.some(r => r.code === 'CONTACT' || r.code === 'PII')) {
    throw validation('称呼包含不合适的内容，请修改后再试');
  }
  if (db.get('SELECT 1 AS ok FROM users WHERE email = ?', [email])) throw conflict('该邮箱已注册，请直接登录');

  const userId = newId();
  const householdId = newId();
  const createdAt = nowIso();
  db.tx(() => {
    db.run('INSERT INTO users(id, email, password_hash, name, role, avatar, disabled, created_at, must_change_password) VALUES(?,?,?,?,?,?,?,?,?)',
      [userId, email, hashPassword(password), name, 'parent', null, 0, createdAt, 0]);
    db.run('INSERT INTO households(id, name, owner_id, created_at) VALUES(?,?,?,?)', [householdId, householdName, userId, createdAt]);
    db.run('INSERT INTO household_members(household_id, user_id, role, created_at) VALUES(?,?,?,?)', [householdId, userId, 'parent', createdAt]);
    audit(db, { householdId, actorId: userId, action: 'auth.register', entity: 'user', entityId: userId });
  });

  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId])!;
  const token = issueSession(db, user, householdId);
  return {
    token, user: publicUser(user),
    household: { id: householdId, name: householdName },
    children: [],
  };
}

export function setupAdmin(db: Db, body: any): AuthResult {
  const existing = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c || 0);
  if (existing > 0) throw conflict('系统已完成初始化，请直接登录');
  const email = vEmail(body?.email);
  const password = str(body?.password, { label: '密码', min: 8, max: 72 });
  const name = str(body?.name, { label: '称呼', min: 1, max: 24 });
  const householdName = str(body?.householdName, { label: '家庭名称', min: 1, max: 30, optional: true }) || `${name}的家`;
  assertStrongPassword(password);
  const userId = newId();
  const householdId = newId();
  const now = nowIso();
  db.tx(() => {
    db.run('INSERT INTO users(id, email, password_hash, name, role, avatar, disabled, created_at, must_change_password) VALUES(?,?,?,?,?,?,?,?,?)',
      [userId, email, hashPassword(password), name, 'admin', null, 0, now, 0]);
    db.run('INSERT INTO households(id, name, owner_id, created_at) VALUES(?,?,?,?)', [householdId, householdName, userId, now]);
    db.run('INSERT INTO household_members(household_id, user_id, role, created_at) VALUES(?,?,?,?)', [householdId, userId, 'parent', now]);
    audit(db, { householdId, actorId: userId, action: 'auth.setup_admin', entity: 'user', entityId: userId });
  });
  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId])!;
  const token = issueSession(db, user, householdId);
  return { token, user: publicUser(user), household: { id: householdId, name: householdName }, children: [] };
}

export function login(db: Db, body: any): AuthResult {
  const email = vEmail(body?.email);
  const password = str(body?.password, { label: '密码', max: 72 });
  const user = db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw unauthorized('邮箱或密码不正确');
  }
  if (user.disabled) throw new AppError(403, 'ACCOUNT_DISABLED', '账号已停用，请联系管理员');
  const householdId = getUserHouseholdId(db, user.id);
  if (!householdId) throw notFound('账号未绑定家庭');
  const household = getHousehold(db, householdId);
  db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND expires_at < ?', [nowIso(), user.id, nowIso()]);
  const token = issueSession(db, user, householdId);
  return {
    token, user: publicUser(user),
    household: { id: household.id, name: household.name },
    children: listChildren(db, householdId),
  };
}

export function verifyPasswordForUser(db: Db, user: AuthUser, body: any) {
  const password = str(body?.password, { label: '家长密码', max: 72 });
  const row = db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
  if (!row || !verifyPassword(password, row.password_hash)) throw new AppError(403, 'INVALID_PASSWORD', '密码不正确，请再试一次');
  return { verified: true };
}

export function logout(db: Db, user: AuthUser) {
  db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?', [nowIso(), user.jti, user.id]);
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'auth.logout', entity: 'session', entityId: user.jti });
  return { loggedOut: true };
}

export function changePassword(db: Db, user: AuthUser, body: any): { token: string; user: ReturnType<typeof publicUser> } {
  const oldPassword = str(body?.oldPassword, { label: '原密码', max: 72 });
  const newPassword = str(body?.newPassword, { label: '新密码', min: 8, max: 72 });
  assertStrongPassword(newPassword);
  const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [user.id]);
  if (!row) throw notFound('用户不存在');
  if (!verifyPassword(oldPassword, row.password_hash)) throw validation('原密码不正确');
  if (oldPassword === newPassword) throw validation('新密码不能与原密码相同');
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hashPassword(newPassword), user.id]);
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'auth.password_change', entity: 'user', entityId: user.id });
  });
  const fresh = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [user.id])!;
  const token = issueSession(db, fresh, user.householdId);
  return { token, user: publicUser(fresh) };
}

export function me(db: Db, user: AuthUser) {
  const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [user.id]);
  if (!row) throw unauthorized();
  return {
    user: publicUser(row),
    household: getHousehold(db, user.householdId),
    children: listChildren(db, user.householdId),
  };
}

export function listUsers(db: Db) {
  const users = db.all<UserRow>('SELECT * FROM users ORDER BY created_at ASC');
  const households = db.all<{ user_id: string; household_id: string; name: string }>(
    `SELECT hm.user_id, h.id AS household_id, h.name FROM household_members hm JOIN households h ON h.id = hm.household_id`,
  );
  const byUser = new Map(households.map(h => [h.user_id, h]));
  return users.map(u => ({
    ...publicUser(u), disabled: !!u.disabled, createdAt: u.created_at,
    household: byUser.get(u.id) || null,
  }));
}

export function setUserRole(db: Db, actor: AuthUser, targetUserId: string, body: any, ip?: string) {
  const target = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [targetUserId]);
  if (!target) throw notFound('用户不存在');
  const role = oneOf(body?.role, ['parent', 'teacher', 'admin'] as const, '角色');
  if (target.id === actor.id) throw new AppError(403, 'FORBIDDEN', '不能修改自己的角色，请让其他管理员操作');
  if (target.role === 'admin' && role !== 'admin') {
    const admins = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0")?.c || 0);
    if (admins <= 1) throw conflict('系统至少需要保留一位管理员');
  }
  db.tx(() => {
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
    audit(db, { actorId: actor.id, action: 'admin.user_role', entity: 'user', entityId: target.id, detail: { from: target.role, to: role }, ip });
  });
  return { id: target.id, role };
}

export function adminResetPassword(db: Db, actor: AuthUser, targetUserId: string, ip?: string) {
  const target = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [targetUserId]);
  if (!target) throw notFound('用户不存在');
  if (target.role === 'admin' && target.id !== actor.id) {
    throw new AppError(403, 'FORBIDDEN', '不允许重置其他管理员密码');
  }
  const temporary = `St${randomCode(6)}!`;
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [hashPassword(temporary), target.id]);
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), target.id]);
    audit(db, { actorId: actor.id, action: 'admin.password_reset', entity: 'user', entityId: target.id, ip });
  });
  return { temporaryPassword: temporary, mustChangePassword: true };
}

export function setupRequired(db: Db): boolean {
  return Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')?.c || 0) === 0;
}

export function adjustDemoMode(db: Db): boolean {
  const seeded = !!db.get("SELECT value FROM app_meta WHERE key = 'demo_version'");
  // Demo credentials are only surfaced when the operator explicitly enables demo mode.
  return seeded && config.demoMode;
}
