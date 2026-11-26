import dns from 'node:dns/promises';
import net from 'node:net';
import type { Db } from '../infra/db.ts';
import { config } from '../config.ts';
import { AppError, forbidden, notFound, upstream, validation } from '../core/errors.ts';
import { newId, nowIso, openSecret, maskSecret, sealSecret } from '../core/security.ts';
import { int, jsonArray, jsonObject, oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { moderateContent } from './moderation.ts';
import { audit, listChildren, subjectMap } from './shared.ts';
import { dashboard } from './analytics.ts';
import { searchLessons } from './curriculum.ts';

const SUBJECT_CODES = ['thinking', 'english', 'piano', 'hanzi', 'montessori'] as const;
const CLASS_CODES = ['nursery', 'junior', 'middle', 'senior'] as const;

function parse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function publicStatus(visibility: string): string {
  return visibility === 'public' ? 'pending_review' : 'published';
}

function sanitizeToolManifest(raw: unknown) {
  const list = jsonArray<Record<string, unknown>>(raw, []);
  if (!list.length) throw validation('连接器至少需要声明 1 个工具');
  if (list.length > 10) throw validation('连接器工具不能超过 10 个');
  return list.map(tool => {
    const name = str(tool?.name, { label: '工具名', min: 2, max: 50, pattern: /^[a-z][a-z0-9_.-]{1,49}$/ });
    const description = str(tool?.description, { label: '工具说明', max: 200 });
    const schema = jsonObject(tool?.input_schema, { type: 'object', properties: {} });
    return { name, description, input_schema: schema };
  });
}

export function listExperts(db: Db, user: AuthUser, scopeRaw?: string | null) {
  const scope = scopeRaw === 'mine' ? 'mine' : scopeRaw === 'installed' ? 'installed' : 'public';
  const installed = new Set(db.all<{ item_id: string }>(
    "SELECT item_id FROM installations WHERE household_id = ? AND item_type = 'expert'", [user.householdId],
  ).map(r => r.item_id));
  let sql = `SELECT e.*, u.name AS owner_name FROM experts e JOIN users u ON u.id = e.owner_id WHERE 1 = 1`;
  const params: unknown[] = [];
  if (scope === 'mine') { sql += ' AND e.owner_id = ?'; params.push(user.id); }
  else if (scope === 'installed') {
    const ids = [...installed];
    if (!ids.length) return [];
    sql += ` AND e.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  } else {
    sql += " AND e.visibility = 'public' AND e.status = 'published'";
  }
  sql += ' ORDER BY e.installs DESC, e.rating DESC LIMIT 100';
  return db.all<any>(sql, params).map(row => ({
    ...row,
    subjects: parse(row.subjects, []),
    classCodes: parse(row.class_codes, []),
    installed: installed.has(row.id),
    isMine: row.owner_id === user.id,
  }));
}

export function expertDetail(db: Db, user: AuthUser, expertId: string) {
  const expert = db.get<any>(
    'SELECT e.*, u.name AS owner_name FROM experts e JOIN users u ON u.id = e.owner_id WHERE e.id = ?', [expertId],
  );
  if (!expert) throw notFound('专家不存在');
  const visible = expert.status === 'published' && (expert.visibility === 'public' || expert.household_id === user.householdId)
    || expert.owner_id === user.id || ['teacher', 'admin'].includes(user.role);
  if (!visible) throw notFound('专家不存在');
  const skills = db.all<any>(
    `SELECT s.id, s.name, s.description, s.kind FROM expert_skills es JOIN skills s ON s.id = es.skill_id WHERE es.expert_id = ?`,
    [expertId],
  );
  const installed = !!db.get('SELECT 1 AS ok FROM installations WHERE household_id = ? AND item_type = ? AND item_id = ?',
    [user.householdId, 'expert', expertId]);
  return { expert: { ...expert, subjects: parse(expert.subjects, []), classCodes: parse(expert.class_codes, []) }, skills, installed };
}

export function createExpert(db: Db, user: AuthUser, body: any, ip?: string) {
  const visibility = oneOf(body?.visibility ?? 'household', ['public', 'household'] as const, '可见范围');
  const name = str(body?.name, { label: '专家名称', min: 2, max: 40 });
  const title = str(body?.title, { label: '专长标题', min: 2, max: 60 });
  const description = str(body?.description, { label: '简介', min: 10, max: 600 });
  const systemPrompt = str(body?.systemPrompt, { label: '人格提示词', min: 10, max: 4000 });
  const subjects = jsonArray(body?.subjects, []).filter(s => SUBJECT_CODES.includes(s as any));
  const classCodes = jsonArray(body?.classCodes, []).filter(c => CLASS_CODES.includes(c as any));
  const skillIds = jsonArray(body?.skillIds, []).filter(s => typeof s === 'string').slice(0, 8);
  if (visibility === 'public' && !['teacher', 'admin'].includes(user.role)) {
    throw forbidden('公开专家发布需要教师或管理员身份；你也可以创建仅家庭可用的专家');
  }
  const moderation = moderateContent(`${name}\n${title}\n${description}\n${systemPrompt}`, { onTopicHint: true });
  if (moderation.blocked) throw new AppError(422, 'CONTENT_REJECTED', '公开内容未通过安全审核，请修改后再提交', { reasons: moderation.reasons.map(r => r.label) });
  const id = newId();
  const status = publicStatus(visibility);
  const now = nowIso();
  db.tx(() => {
    db.run(
      `INSERT INTO experts(id, owner_id, household_id, name, title, description, system_prompt, subjects, class_codes,
        status, visibility, installs, rating, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, user.id, user.householdId, name, title, description, systemPrompt, JSON.stringify(subjects), JSON.stringify(classCodes),
        status, visibility, 0, 0, now, now],
    );
    for (const skillId of skillIds) {
      const skill = db.get('SELECT id FROM skills WHERE id = ? AND (household_id = ? OR (status = ? AND visibility = ?))',
        [skillId, user.householdId, 'published', 'public']);
      if (skill) db.run('INSERT OR IGNORE INTO expert_skills(expert_id, skill_id) VALUES(?,?)', [id, skillId]);
    }
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'registry.expert.create', entity: 'expert', entityId: id, detail: { visibility, status }, ip });
  });
  return { id, status, visibility, message: visibility === 'public' ? '已提交审核，通过后会出现在专家市场。' : '已创建，仅本家庭可用。' };
}

export function createSkill(db: Db, user: AuthUser, body: any, ip?: string) {
  const visibility = oneOf(body?.visibility ?? 'household', ['public', 'household'] as const, '可见范围');
  const code = str(body?.code, { label: '技能标识', min: 3, max: 40, pattern: /^[a-z][a-z0-9-]{2,39}$/ });
  const name = str(body?.name, { label: '技能名称', min: 2, max: 40 });
  const description = str(body?.description, { label: '说明', min: 6, max: 300 });
  const kind = oneOf(body?.kind ?? 'prompt', ['prompt', 'workflow'] as const, '技能类型');
  const definition = jsonObject(body?.definition, { template: description });
  if (JSON.stringify(definition).length > 20_000) throw validation('技能定义过长');
  if (db.get('SELECT 1 AS ok FROM skills WHERE household_id = ? AND code = ?', [user.householdId, code])) {
    throw new AppError(409, 'CONFLICT', '该技能标识已存在');
  }
  if (visibility === 'public' && !['teacher', 'admin'].includes(user.role)) {
    throw forbidden('公开技能发布需要教师或管理员身份');
  }
  const moderation = moderateContent(`${name}\n${description}\n${JSON.stringify(definition)}`, { onTopicHint: true });
  if (moderation.blocked) throw new AppError(422, 'CONTENT_REJECTED', '技能内容未通过安全审核', { reasons: moderation.reasons.map(r => r.label) });
  const id = newId();
  const status = publicStatus(visibility);
  db.run(
    `INSERT INTO skills(id, owner_id, household_id, code, name, description, kind, definition, status, visibility, installs, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, user.id, user.householdId, code, name, description, kind, JSON.stringify(definition), status, visibility, 0, nowIso(), nowIso()],
  );
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'registry.skill.create', entity: 'skill', entityId: id, detail: { visibility, status }, ip });
  return { id, status, visibility, message: visibility === 'public' ? '技能已提交审核。' : '技能已创建，仅本家庭可用。' };
}

export function listSkills(db: Db, user: AuthUser, scopeRaw?: string | null) {
  const installed = new Set(db.all<{ item_id: string }>(
    "SELECT item_id FROM installations WHERE household_id = ? AND item_type = 'skill'", [user.householdId],
  ).map(r => r.item_id));
  let where = "(s.visibility = 'public' AND s.status = 'published')";
  const params: unknown[] = [];
  if (scopeRaw === 'mine') { where = 's.owner_id = ?'; params.push(user.id); }
  else if (scopeRaw === 'household') { where = 's.household_id = ?'; params.push(user.householdId); }
  return db.all<any>(
    `SELECT s.*, u.name AS owner_name FROM skills s JOIN users u ON u.id = s.owner_id WHERE ${where}
     ORDER BY s.installs DESC, s.updated_at DESC LIMIT 100`, params,
  ).map(row => ({
    ...row, definition: parse(row.definition, {}), installed: installed.has(row.id),
    isMine: row.owner_id === user.id,
  }));
}

export function listConnectors(db: Db, user: AuthUser) {
  return db.all<any>(
    `SELECT c.*, u.name AS owner_name FROM connectors c JOIN users u ON u.id = c.owner_id
     WHERE c.household_id = ? OR (c.visibility = 'public' AND c.status = 'published')
     ORDER BY c.created_at DESC LIMIT 100`, [user.householdId],
  ).map(row => ({
    ...row, tools: parse(row.tools, []), secretMasked: maskSecret(row.secret_enc),
    secret_enc: undefined, isMine: row.owner_id === user.id,
    installed: !!db.get('SELECT 1 AS ok FROM installations WHERE household_id = ? AND item_type = ? AND item_id = ?',
      [user.householdId, 'connector', row.id]),
  }));
}

export function createConnector(db: Db, user: AuthUser, body: any, ip?: string) {
  const kind = oneOf(body?.kind ?? 'builtin', ['builtin', 'http'] as const, '连接器类型');
  const name = str(body?.name, { label: '连接器名称', min: 2, max: 50 });
  const description = str(body?.description, { label: '说明', min: 5, max: 300 });
  const visibility = oneOf(body?.visibility ?? 'household', ['public', 'household'] as const, '可见范围');
  const tools = sanitizeToolManifest(body?.tools);
  let baseUrl: string | null = null;
  if (kind === 'http') {
    const raw = str(body?.baseUrl, { label: 'Base URL', min: 8, max: 500 });
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw validation('Base URL 不是合法地址'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw validation('连接器只支持 HTTP(S)');
    if (parsed.username || parsed.password) throw validation('Base URL 不能包含账号密码');
    baseUrl = parsed.toString();
  }
  const authType = oneOf(body?.authType ?? 'none', ['none', 'bearer', 'header'] as const, '认证方式');
  const secret = str(body?.secret, { optional: true, max: 500, label: '密钥' });
  if (kind === 'http' && authType !== 'none' && !secret) throw validation('该认证方式需要填写密钥');
  if (visibility === 'public' && !['teacher', 'admin'].includes(user.role)) {
    throw forbidden('公开连接器需要教师或管理员身份');
  }
  const moderation = moderateContent(`${name}\n${description}\n${JSON.stringify(tools)}`, { onTopicHint: true });
  if (moderation.blocked) throw new AppError(422, 'CONTENT_REJECTED', '连接器说明未通过安全审核', { reasons: moderation.reasons.map(r => r.label) });
  const id = newId();
  const status = visibility === 'public' ? 'pending_review' : 'published';
  db.run(
    `INSERT INTO connectors(id, owner_id, household_id, name, kind, base_url, auth_type, secret_enc, tools, description, status, visibility, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, user.id, user.householdId, name, kind, baseUrl, authType, secret ? sealSecret(secret) : null,
      JSON.stringify(tools), description, status, visibility, nowIso(), nowIso()],
  );
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'registry.connector.create', entity: 'connector', entityId: id, ip });
  return { id, status, message: visibility === 'public' ? '已提交审核。' : '连接器已创建。' };
}

export function installItem(db: Db, user: AuthUser, itemType: 'expert' | 'skill' | 'connector', itemId: string) {
  const table = itemType === 'expert' ? 'experts' : itemType === 'skill' ? 'skills' : 'connectors';
  const item = db.get<any>(`SELECT * FROM ${table} WHERE id = ?`, [itemId]);
  if (!item) throw notFound('资源不存在');
  const accessible = item.household_id === user.householdId || item.owner_id === user.id
    || (item.visibility === 'public' && item.status === 'published');
  if (!accessible) throw notFound('资源不存在或未发布');
  db.tx(() => {
    const inserted = db.run(
      `INSERT OR IGNORE INTO installations(id, household_id, user_id, item_type, item_id, config, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      [newId(), user.householdId, user.id, itemType, itemId, '{}', nowIso()],
    );
    if (inserted.changes) db.run(`UPDATE ${table} SET installs = installs + 1 WHERE id = ?`, [itemId]);
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'registry.install', entity: itemType, entityId: itemId });
  });
  return { installed: true, itemType, itemId };
}

export function uninstallItem(db: Db, user: AuthUser, itemType: string, itemId: string) {
  const type = oneOf(itemType, ['expert', 'skill', 'connector'] as const, '资源类型');
  const existing = db.get('SELECT id FROM installations WHERE household_id = ? AND item_type = ? AND item_id = ?',
    [user.householdId, type, itemId]);
  if (existing) {
    db.run('DELETE FROM installations WHERE id = ?', [existing.id]);
    const table = type === 'expert' ? 'experts' : type === 'skill' ? 'skills' : 'connectors';
    db.run(`UPDATE ${table} SET installs = MAX(0, installs - 1) WHERE id = ?`, [itemId]);
  }
  return { installed: false };
}

function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
      || parts[0] >= 224
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 192 && parts[1] === 0)
      || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
      || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
      || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) return privateAddress(lower.slice(7));
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd')
      || lower.startsWith('fe80') || lower.startsWith('ff');
  }
  return true;
}

async function assertSafeUrl(baseUrl: string): Promise<void> {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw forbidden('只允许 HTTP(S) 连接器');
  if (url.username || url.password) throw forbidden('连接器地址不能包含凭据');
  const host = url.hostname.toLowerCase();
  if (!config.connectorAllowedHosts.length) {
    throw forbidden('未配置 CONNECTOR_ALLOWED_HOSTS，HTTP 连接器默认禁用；请联系管理员配置允许域名');
  }
  const allowed = config.connectorAllowedHosts.some(domain => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) throw forbidden(`目标域名 ${host} 不在允许列表中`);
  if (net.isIP(host)) {
    if (privateAddress(host)) throw forbidden('不允许访问私网或回环地址');
    return;
  }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length) throw upstream('连接器域名解析失败');
  for (const record of records) {
    if (privateAddress(record.address)) throw forbidden('连接器域名解析到私网地址，已阻止');
  }
}

async function invokeBuiltin(db: Db, user: AuthUser, tool: string, args: Record<string, unknown>) {
  if (tool === 'curriculum.search') {
    return { lessons: searchLessons(db, str(args.query, { label: 'query', min: 1, max: 40 }), 6) };
  }
  if (tool === 'plan.suggest' || tool === 'report.summary') {
    const children = listChildren(db, user.householdId);
    const child = args.childId ? children.find(c => c.id === args.childId) : children[0];
    if (!child) return { error: '暂无孩子档案' };
    const data = dashboard(db, user, child.id, tool === 'report.summary' ? 'week' : 'day');
    if (tool === 'report.summary') return { child: child.name, metrics: data.metrics, insights: data.insights };
    return { child: child.name, nextLesson: data.nextLesson, todayPlan: data.todayPlan };
  }
  throw validation(`内置连接器不支持工具 ${tool}`);
}

export async function invokeConnector(db: Db, user: AuthUser, connectorId: string, body: any) {
  const connector = db.get<any>('SELECT * FROM connectors WHERE id = ?', [connectorId]);
  if (!connector) throw notFound('连接器不存在');
  const accessible = connector.household_id === user.householdId
    || (connector.visibility === 'public' && connector.status === 'published')
    || !!db.get('SELECT 1 AS ok FROM installations WHERE household_id = ? AND item_type = ? AND item_id = ?',
      [user.householdId, 'connector', connectorId]);
  if (!accessible) throw notFound('连接器不存在或未发布');
  if (connector.status !== 'published') throw forbidden('连接器尚未通过审核，暂不可调用');
  const toolName = str(body?.tool, { label: '工具', min: 1, max: 50 });
  const tools = parse<{ name: string; description: string; input_schema: Record<string, unknown> }[]>(connector.tools, []);
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw validation('该连接器未声明此工具');
  const args = jsonObject(body?.args, {});
  if (JSON.stringify(args).length > 8000) throw validation('工具参数过大');
  const started = Date.now();
  let result: unknown;
  let status = 'ok';
  let caught: unknown = null;
  try {
    if (connector.kind === 'builtin') {
      result = await invokeBuiltin(db, user, toolName, args);
    } else {
      await assertSafeUrl(connector.base_url);
      const secret = openSecret(connector.secret_enc);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (connector.auth_type === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`;
      if (connector.auth_type === 'header' && secret) headers['X-Connector-Secret'] = secret;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(connector.base_url, {
          method: 'POST', headers, body: JSON.stringify({ tool: toolName, arguments: args }),
          signal: controller.signal, redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) throw upstream('连接器返回了重定向，出于安全考虑已阻止');
        const text = (await response.text()).slice(0, 64_000);
        if (!response.ok) throw upstream(`连接器返回 ${response.status}`, { body: text.slice(0, 300) });
        try { result = JSON.parse(text); } catch { result = { raw: text }; }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    status = 'error';
    caught = error;
    result = { error: error instanceof AppError ? error.message : '连接器调用失败' };
  }
  const duration = Date.now() - started;
  db.run(
    `INSERT INTO connector_invocations(id, connector_id, tool, status, duration_ms, user_id, request, response, created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [newId(), connectorId, toolName, status, duration, user.id,
      JSON.stringify({ tool: toolName, args }).slice(0, 4000), JSON.stringify(result).slice(0, 8000), nowIso()],
  );
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'registry.connector.invoke', entity: 'connector', entityId: connectorId, detail: { tool: toolName, status, duration } });
  if (status === 'error') {
    if (caught instanceof AppError) throw caught;
    throw upstream((result as { error?: string }).error || '连接器调用失败');
  }
  return { connectorId, tool: toolName, result, durationMs: duration };
}

export function reviewRegistryItem(db: Db, reviewer: AuthUser, itemType: string, itemId: string, body: any) {
  if (!['teacher', 'admin'].includes(reviewer.role)) throw forbidden('需要审核权限');
  const type = oneOf(itemType, ['expert', 'skill', 'connector'] as const, '资源类型');
  const table = type === 'expert' ? 'experts' : type === 'skill' ? 'skills' : 'connectors';
  const item = db.get<any>(`SELECT * FROM ${table} WHERE id = ?`, [itemId]);
  if (!item) throw notFound('资源不存在');
  if (item.owner_id === reviewer.id) throw forbidden('不能审核自己发布的资源');
  const decision = oneOf(body?.decision, ['approve', 'reject'] as const, '审核决定');
  const note = str(body?.note, { optional: true, max: 400, label: '审核意见' });
  if (decision === 'reject' && !note) throw validation('拒绝时需要填写理由');
  const status = decision === 'approve' ? 'published' : 'rejected';
  if (type === 'connector') {
    db.run('UPDATE connectors SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), itemId]);
  } else {
    db.run(`UPDATE ${table} SET status = ?, reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?`,
      [status, reviewer.id, note, nowIso(), itemId]);
  }
  audit(db, { householdId: item.household_id, actorId: reviewer.id, action: `registry.${type}.review`, entity: type, entityId: itemId, detail: { decision, note } });
  return { id: itemId, status, decision, note };
}

export function registryQueue(db: Db, typeRaw?: string | null) {
  const normalized = String(typeRaw || '').replace(/s$/, '');
  const type = normalized === 'skill' ? 'skill' : normalized === 'connector' ? 'connector' : 'expert';
  const table = type === 'expert' ? 'experts' : type === 'skill' ? 'skills' : 'connectors';
  return db.all<any>(
    `SELECT t.*, u.name AS owner_name FROM ${table} t JOIN users u ON u.id = t.owner_id
     WHERE t.status = 'pending_review' ORDER BY t.created_at ASC LIMIT 50`, [],
  ).map(row => ({
    ...row,
    subjects: row.subjects ? parse(row.subjects, []) : undefined,
    classCodes: row.class_codes ? parse(row.class_codes, []) : undefined,
    tools: row.tools ? parse(row.tools, []) : undefined,
    definition: row.definition ? parse(row.definition, {}) : undefined,
    secret_enc: undefined,
  }));
}

export function invocationLogs(db: Db, user: AuthUser) {
  return db.all<any>(
    `SELECT ci.*, c.name AS connector_name FROM connector_invocations ci JOIN connectors c ON c.id = ci.connector_id
     WHERE c.household_id = ? ORDER BY ci.created_at DESC LIMIT 50`, [user.householdId],
  ).map(row => ({ ...row, request: parse(row.request, {}), response: parse(row.response, {}) }));
}

export function registrySubjects() {
  return { subjects: SUBJECT_CODES, classCodes: CLASS_CODES };
}

export { subjectMap, int };
