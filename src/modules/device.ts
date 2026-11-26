import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Db } from '../infra/db.ts';
import { config } from '../config.ts';
import { forbidden, notFound, validation } from '../core/errors.ts';
import { newId, nowIso, randomCode, sha256, signToken } from '../core/security.ts';
import { oneOf, str } from '../core/validate.ts';
import type { AuthDevice, AuthUser } from '../core/http.ts';
import { assertChildAccess, audit, consentGranted, getHousehold, listChildren, trackEvent } from './shared.ts';
import { awardLessonCompletion } from './pet.ts';
import { scoreLesson } from './scoring.ts';

const streams = new Map<string, Set<http.ServerResponse>>();

export function hasDeviceStream(deviceId: string): boolean {
  return (streams.get(deviceId)?.size || 0) > 0;
}

export function openDeviceStream(device: AuthDevice, res: http.ServerResponse): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ deviceId: device.id, at: nowIso() })}\n\n`);
  const set = streams.get(device.id) || new Set();
  set.add(res);
  streams.set(device.id, set);
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* closed */ }
  }, 25_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (!set.size) streams.delete(device.id);
  };
  res.on('close', cleanup);
  return cleanup;
}

export function notifyDevice(deviceId: string, payload: unknown): void {
  const set = streams.get(deviceId);
  if (!set) return;
  for (const res of set) {
    try { res.write(`event: push\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* ignore */ }
  }
}

export function createPairingCode(db: Db, user: AuthUser, body: any) {
  const name = str(body?.name, { label: '设备名称', min: 1, max: 30, optional: true }) || '学习平板';
  const kind = oneOf(body?.kind ?? 'ipad', ['ipad', 'mac', 'android', 'web'] as const, '设备类型');
  let code = randomCode(6);
  for (let i = 0; i < 5 && db.get('SELECT 1 AS ok FROM devices WHERE pairing_code = ? AND status = ?', [code, 'pending']); i++) {
    code = randomCode(6);
  }
  const id = newId();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  db.run(
    `INSERT INTO devices(id, household_id, name, kind, pairing_code, code_expires_at, token_hash, status, last_seen_at, created_at, paired_at, code_attempts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, user.householdId, name, kind, code, expiresAt, null, 'pending', null, nowIso(), null, 0],
  );
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'device.pairing_code', entity: 'device', entityId: id });
  return {
    deviceId: id, code, expiresAt, deviceName: name,
    url: `${config.publicUrl}/device`,
    instructions: '在平板或 Mac 浏览器打开该地址，输入 6 位配对码即可；配对码 10 分钟内有效且仅可使用一次。',
    secureContextHint: '摄像头与「添加到主屏幕」需要 HTTPS 或 localhost。局域网请使用 scripts/gen-cert.sh 生成证书并设置 TLS_CERT/TLS_KEY。',
  };
}

export function pairDevice(db: Db, body: any, ip?: string) {
  const code = str(body?.code, { label: '配对码', min: 6, max: 6, pattern: /^\d{6}$/ });
  const name = str(body?.name, { label: '设备名称', min: 1, max: 30, optional: true });
  const kind = oneOf(body?.kind ?? 'ipad', ['ipad', 'mac', 'android', 'web'] as const, '设备类型');
  const device = db.get<any>('SELECT * FROM devices WHERE pairing_code = ? AND status = ?', [code, 'pending']);
  if (!device) throw validation('配对码无效或已使用，请在家长端重新生成');
  if (new Date(String(device.code_expires_at)).getTime() < Date.now()) {
    db.run("UPDATE devices SET status = 'revoked', pairing_code = NULL WHERE id = ?", [device.id]);
    throw validation('配对码已过期，请在家长端重新生成');
  }
  // Wrong codes never resolve a device row. Enumeration is controlled by the
  // per-IP route limiter; codes are 6 digits, single-use and expire in 10 minutes.
  const token = signToken({ sub: device.id, typ: 'device', did: device.id, hid: device.household_id }, 365 * 24 * 3600);
  db.run(
    "UPDATE devices SET status = 'paired', token_hash = ?, pairing_code = NULL, paired_at = ?, last_seen_at = ?, name = COALESCE(NULLIF(?, ''), name), kind = ? WHERE id = ?",
    [sha256(token), nowIso(), nowIso(), name, kind, device.id],
  );
  const household = getHousehold(db, device.household_id);
  const children = listChildren(db, device.household_id).map(c => ({
    id: c.id, name: c.name, class_code: c.class_code,
    cameraConsent: consentGranted(db, c.id, 'camera'),
  }));
  audit(db, { householdId: device.household_id, actorId: null, action: 'device.paired', entity: 'device', entityId: device.id, ip });
  return {
    token,
    device: { id: device.id, name: name || device.name, kind, householdId: device.household_id },
    household: { id: household.id, name: household.name },
    children,
  };
}

export function listDevices(db: Db, user: AuthUser) {
  return db.all<any>(
    `SELECT id, household_id, name, kind, status, last_seen_at, created_at, paired_at, code_expires_at
     FROM devices WHERE household_id = ? ORDER BY created_at DESC`, [user.householdId],
  ).map(row => ({ ...row, online: hasDeviceStream(row.id) }));
}

export function revokeDevice(db: Db, user: AuthUser, deviceId: string) {
  const device = db.get<any>('SELECT * FROM devices WHERE id = ?', [deviceId]);
  if (!device || device.household_id !== user.householdId) throw notFound('设备不存在');
  db.run("UPDATE devices SET status = 'revoked', token_hash = NULL, pairing_code = NULL WHERE id = ?", [deviceId]);
  notifyDevice(deviceId, { type: 'revoked' });
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'device.revoke', entity: 'device', entityId: deviceId });
  return { revoked: true };
}

function pushRow(db: Db, deviceId: string, payload: Record<string, unknown>, message: string, planId: string, householdId: string, childId: string) {
  const id = newId();
  db.run(
    `INSERT INTO device_pushes(id, device_id, household_id, child_id, plan_id, message, payload, status, created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [id, deviceId, householdId, childId, planId, message, JSON.stringify(payload), 'queued', nowIso()],
  );
  return id;
}

export function pushPlan(db: Db, user: AuthUser, deviceId: string, body: any, ip?: string) {
  const device = db.get<any>('SELECT * FROM devices WHERE id = ?', [deviceId]);
  if (!device || device.household_id !== user.householdId) throw notFound('设备不存在');
  if (device.status !== 'paired') throw validation('设备尚未完成配对');
  const child = assertChildAccess(db, user, str(body?.childId, { label: '孩子', max: 64 }));
  const planId = str(body?.planId, { label: '计划', max: 64 });
  const plan = db.get<any>('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan || plan.child_id !== child.id) throw notFound('计划不存在');
  if (plan.status === 'archived') throw validation('已归档的计划不能推送');
  const message = str(body?.message, { optional: true, max: 200, label: '附言' }) || `${child.name}，今天的学习计划已准备好，一起开始吧！`;
  const items = db.all<any>(
    `SELECT id, title, subject_code, date, minutes, status FROM plan_items WHERE plan_id = ? AND status = 'pending'
     ORDER BY date, seq LIMIT 12`, [planId],
  );
  const pushId = pushRow(db, deviceId, {
    kind: 'plan', planId, childId: child.id, title: plan.title, startDate: plan.start_date, endDate: plan.end_date, items,
  }, message, planId, user.householdId, child.id);
  notifyDevice(deviceId, { type: 'push', id: pushId, kind: 'plan', message, planTitle: plan.title, childName: child.name });
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'device.push_plan', entity: 'device', entityId: deviceId, detail: { planId, pushId }, ip });
  return { pushId, deviceId, status: 'queued', message, planTitle: plan.title, itemCount: items.length };
}

export function requestPhoto(db: Db, user: AuthUser, deviceId: string, body: any, ip?: string) {
  const device = db.get<any>('SELECT * FROM devices WHERE id = ?', [deviceId]);
  if (!device || device.household_id !== user.householdId) throw notFound('设备不存在');
  if (device.status !== 'paired') throw validation('设备尚未完成配对');
  const child = assertChildAccess(db, user, str(body?.childId, { label: '孩子', max: 64 }));
  if (!consentGranted(db, child.id, 'camera')) {
    throw forbidden('该孩子尚未开启摄像头监督授权，请先在隐私设置中开启');
  }
  const message = str(body?.message, { optional: true, max: 120, label: '提示' }) || '家长想看看你的学习瞬间，可以拍一张照片吗？';
  const active = db.get<{ id: string }>("SELECT id FROM plans WHERE child_id = ? AND status = 'active' LIMIT 1", [child.id]);
  const pushId = pushRow(db, deviceId, {
    kind: 'photo_request', childId: child.id, message,
  }, message, active?.id || '', user.householdId, child.id);
  notifyDevice(deviceId, { type: 'push', id: pushId, kind: 'photo_request', message, childName: child.name });
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'device.request_photo', entity: 'device', entityId: deviceId, detail: { childId: child.id }, ip });
  return { pushId, status: 'queued', message };
}

export function deviceInbox(db: Db, device: AuthDevice) {
  db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [nowIso(), device.id]);
  const pushes = db.all<any>(
    `SELECT dp.*, c.name AS child_name, p.title AS plan_title FROM device_pushes dp
     LEFT JOIN children c ON c.id = dp.child_id LEFT JOIN plans p ON p.id = dp.plan_id
     WHERE dp.device_id = ? AND dp.status IN ('queued','delivered') ORDER BY dp.created_at DESC LIMIT 20`, [device.id],
  ).map(row => ({ ...row, payload: parse(row.payload, {}) }));
  const queuedIds = pushes.filter(p => p.status === 'queued').map(p => p.id);
  for (const push of pushes) {
    if (push.status !== 'queued') continue;
    db.run("UPDATE device_pushes SET status = 'delivered', delivered_at = ? WHERE id = ?", [nowIso(), push.id]);
    push.status = 'delivered';
  }
  void queuedIds;
  const children = listChildren(db, device.householdId).map(c => {
    const pet = db.get<Record<string, any>>(
      'SELECT species, name, level, mood, equipped FROM pets WHERE child_id = ?', [c.id],
    );
    return {
      id: c.id, name: c.name, class_code: c.class_code,
      cameraConsent: consentGranted(db, c.id, 'camera'),
      pet: pet ? { species: pet.species, name: pet.name, level: pet.level, mood: pet.mood, equipped: JSON.parse(pet.equipped || '[]') } : null,
    };
  });
  return { device: { id: device.id, name: device.name, householdId: device.householdId }, children, pushes };
}

function parse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function ackPush(db: Db, device: AuthDevice, pushId: string, body: any) {
  const status = oneOf(body?.status ?? 'opened', ['opened', 'dismissed'] as const, '状态');
  const push = db.get<any>('SELECT * FROM device_pushes WHERE id = ? AND device_id = ?', [pushId, device.id]);
  if (!push) throw notFound('推送不存在');
  db.run('UPDATE device_pushes SET status = ?, opened_at = ? WHERE id = ?', [status, nowIso(), pushId]);
  return { id: pushId, status };
}

export function devicePlan(db: Db, device: AuthDevice, planId: string) {
  const plan = db.get<any>('SELECT * FROM plans WHERE id = ? AND household_id = ?', [planId, device.householdId]);
  if (!plan) throw notFound('计划不存在');
  const child = db.get<any>('SELECT id, name, class_code FROM children WHERE id = ?', [plan.child_id]);
  const items = db.all<any>(
    `SELECT pi.*, l.objective, l.minutes AS lesson_minutes, l.blocks, s.name AS subject_name, s.icon, s.color
     FROM plan_items pi LEFT JOIN lessons l ON l.id = pi.lesson_id LEFT JOIN subjects s ON s.code = pi.subject_code
     WHERE pi.plan_id = ? ORDER BY pi.date, pi.seq`, [planId],
  ).map(row => ({ ...row, blocks: row.blocks ? parse(row.blocks, []) : [] }));
  return { plan, child, items };
}

export function deviceLesson(db: Db, device: AuthDevice, lessonId: string) {
  const lesson = db.get<any>(
    `SELECT l.*, un.title AS unit_title, f.title AS framework_title, f.subject_code, f.class_code,
       s.name AS subject_name, s.icon, s.color, c.name AS class_name,
       ps.name AS source_name, ps.url AS source_url, ps.license AS source_license
     FROM lessons l JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
     JOIN subjects s ON s.code = f.subject_code JOIN class_levels c ON c.code = f.class_code
     LEFT JOIN public_sources ps ON ps.code = l.source_code
     WHERE l.id = ? AND l.is_published = 1`, [lessonId],
  );
  if (!lesson) throw notFound('课时不存在');
  return {
    lesson: { ...lesson, blocks: parse(lesson.blocks, []), tags: parse(lesson.tags, []),
      source: lesson.source_code ? { name: lesson.source_name, url: lesson.source_url, license: lesson.source_license } : null,
      keyPoints: undefined, hardPoints: undefined, homeExtension: undefined, prereqLessonId: undefined },
    householdId: device.householdId,
  };
}

export function startLearning(db: Db, device: AuthDevice, body: any) {
  const childId = str(body?.childId, { label: '孩子', max: 64 });
  const child = db.get<any>('SELECT * FROM children WHERE id = ? AND household_id = ?', [childId, device.householdId]);
  if (!child) throw notFound('孩子档案不存在');
  const lessonId = str(body?.lessonId, { label: '课时', max: 64 });
  const lesson = db.get('SELECT id FROM lessons WHERE id = ? AND is_published = 1', [lessonId]);
  if (!lesson) throw notFound('课时不存在');
  const planItemId = str(body?.planItemId, { optional: true, max: 64, label: '计划项' }) || null;
  const id = newId();
  db.run(
    'INSERT INTO learning_sessions(id, device_id, household_id, child_id, lesson_id, plan_item_id, status, started_at, ended_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, device.id, device.householdId, childId, lessonId, planItemId, 'active', nowIso(), null],
  );
  db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [nowIso(), device.id]);
  return { sessionId: id, childId, lessonId, startedAt: nowIso() };
}

export function endLearning(db: Db, device: AuthDevice, sessionId: string, body: any) {
  const session = db.get<any>('SELECT * FROM learning_sessions WHERE id = ? AND device_id = ?', [sessionId, device.id]);
  if (!session) throw notFound('学习会话不存在');
  const status = oneOf(body?.status ?? 'completed', ['completed', 'abandoned'] as const, '状态');
  db.run('UPDATE learning_sessions SET status = ?, ended_at = ? WHERE id = ?', [status, nowIso(), sessionId]);
  return { sessionId, status };
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function saveSnapshot(db: Db, device: AuthDevice, body: any) {
  const childId = str(body?.childId, { label: '孩子', max: 64 });
  const child = db.get<any>('SELECT * FROM children WHERE id = ? AND household_id = ?', [childId, device.householdId]);
  if (!child) throw notFound('孩子档案不存在');
  if (!consentGranted(db, childId, 'camera')) throw forbidden('该孩子尚未开启摄像头监督授权');
  const image = str(body?.image, { label: '照片', min: 100 });
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw validation('仅支持 JPEG/PNG/WebP 的 base64 图片');
  const mime = match[1]!;
  const buffer = Buffer.from(match[2]!, 'base64');
  if (buffer.length > config.maxSnapshotBytes) throw validation(`照片大小不能超过 ${Math.round(config.maxSnapshotBytes / 1024)}KB`);
  if (buffer.length < 100) throw validation('照片内容为空');
  const magic = buffer.subarray(0, 12);
  const isJpeg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
  const isPng = magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = magic.subarray(0, 4).toString('ascii') === 'RIFF' && magic.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw validation('图片内容与声明的格式不匹配');
  const id = newId();
  const filename = `${id}.${IMAGE_TYPES[mime]}`;
  await fs.promises.writeFile(path.join(config.snapshotDir, filename), buffer, { mode: 0o600 });
  const learningSessionId = str(body?.learningSessionId, { optional: true, max: 64, label: '学习会话' }) || null;
  const consent = body?.consent === true;
  if (!consent) {
    await fs.promises.unlink(path.join(config.snapshotDir, filename)).catch(() => {});
    throw validation('需要设备端确认「允许拍照」后才能上传');
  }
  db.run(
    'INSERT INTO snapshots(id, household_id, child_id, device_id, learning_session_id, file, note, consent, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, device.householdId, childId, device.id, learningSessionId, filename, str(body?.note, { optional: true, max: 200, label: '备注' }), 1, nowIso()],
  );
  audit(db, { householdId: device.householdId, actorId: null, action: 'snapshot.capture', entity: 'snapshot', entityId: id, detail: { childId, deviceId: device.id } });
  return { id, createdAt: nowIso(), childId };
}

export function listSnapshots(db: Db, user: AuthUser, childIdRaw: unknown, limitRaw?: unknown) {
  const child = assertChildAccess(db, user, str(childIdRaw, { label: '孩子', max: 64 }));
  const limit = Math.min(Math.max(Number(limitRaw || 24), 1), 60);
  return db.all<any>(
    `SELECT s.id, s.child_id, s.device_id, s.learning_session_id, s.note, s.created_at, d.name AS device_name, c.name AS child_name
     FROM snapshots s LEFT JOIN devices d ON d.id = s.device_id LEFT JOIN children c ON c.id = s.child_id
     WHERE s.child_id = ? ORDER BY s.created_at DESC LIMIT ?`, [child.id, limit],
  ).map(row => ({ ...row, imageUrl: `/api/snapshots/${row.id}/image` }));
}

export function snapshotFile(db: Db, user: AuthUser, snapshotId: string) {
  const snapshot = db.get<any>(
    `SELECT s.*, c.household_id FROM snapshots s JOIN children c ON c.id = s.child_id WHERE s.id = ?`, [snapshotId],
  );
  if (!snapshot || snapshot.household_id !== user.householdId) throw notFound('照片不存在');
  const file = path.join(config.snapshotDir, path.basename(snapshot.file));
  if (!fs.existsSync(file)) throw notFound('照片文件已过期');
  const ext = path.extname(file).slice(1).toLowerCase();
  return { file, contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}

export async function deleteSnapshot(db: Db, user: AuthUser, snapshotId: string) {
  const snapshot = db.get<any>(
    `SELECT s.* FROM snapshots s WHERE s.id = ?`, [snapshotId],
  );
  if (!snapshot) throw notFound('照片不存在');
  assertChildAccess(db, user, snapshot.child_id);
  db.run('DELETE FROM snapshots WHERE id = ?', [snapshotId]);
  await fs.promises.unlink(path.join(config.snapshotDir, path.basename(snapshot.file))).catch(() => {});
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'snapshot.delete', entity: 'snapshot', entityId: snapshotId });
  return { deleted: true };
}

export async function purgeChildSnapshots(db: Db, user: AuthUser, childId: string) {
  const child = assertChildAccess(db, user, childId);
  const rows = db.all<{ id: string; file: string }>('SELECT id, file FROM snapshots WHERE child_id = ?', [child.id]);
  db.run('DELETE FROM snapshots WHERE child_id = ?', [child.id]);
  for (const row of rows) await fs.promises.unlink(path.join(config.snapshotDir, path.basename(row.file))).catch(() => {});
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'snapshot.purge', entity: 'child', entityId: child.id, detail: { removed: rows.length } });
  return { removed: rows.length };
}

export function completeLessonOnDevice(db: Db, device: AuthDevice, body: any) {
  const childId = str(body?.childId, { label: '孩子', max: 64 });
  const child = db.get<{ id: string }>('SELECT id FROM children WHERE id = ? AND household_id = ?', [childId, device.householdId]);
  if (!child) throw notFound('孩子档案不存在');
  const lessonId = str(body?.lessonId, { label: '课时', max: 64 });
  const lesson = db.get<{ id: string; minutes: number; blocks: string }>('SELECT id, minutes, blocks FROM lessons WHERE id = ? AND is_published = 1', [lessonId]);
  if (!lesson) throw notFound('课时不存在');
  const answers = Array.isArray(body?.answers) ? body.answers : undefined;
  const dynamic = scoreLesson(JSON.parse(lesson.blocks), answers);
  const score = dynamic.score;
  const seconds = Math.max(0, Math.min(7200, Number(body?.seconds) || 0));
  const planItemId = str(body?.planItemId, { optional: true, max: 64, label: '计划项' }) || null;
  const learningSessionId = str(body?.learningSessionId, { optional: true, max: 64, label: '学习会话' }) || null;
  const now = nowIso();
  const existing = db.get<{ id: string }>('SELECT id FROM progress WHERE child_id = ? AND lesson_id = ?', [childId, lessonId]);
  let matchedPlanItem: string | null = null;
  db.tx(() => {
    if (existing) {
      db.run("UPDATE progress SET status = 'completed', score = COALESCE(?, score), seconds = seconds + ?, attempts = attempts + 1, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?",
        [score, seconds, now, now, existing.id]);
    } else {
      db.run(
        `INSERT INTO progress(id, child_id, lesson_id, status, score, seconds, attempts, started_at, completed_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [newId(), childId, lessonId, 'completed', score, seconds, 1, now, now, now],
      );
    }
    if (planItemId) {
      const item = db.get<{ child_id: string; lesson_id: string }>('SELECT child_id, lesson_id FROM plan_items WHERE id = ?', [planItemId]);
      if (item?.child_id === childId && item.lesson_id === lessonId) {
        db.run("UPDATE plan_items SET status = 'done', completed_at = ?, completed_via = 'lesson' WHERE id = ?", [now, planItemId]);
        matchedPlanItem = planItemId;
      }
    }
    if (learningSessionId) {
      db.run("UPDATE learning_sessions SET status = 'completed', ended_at = ? WHERE id = ? AND device_id = ?", [now, learningSessionId, device.id]);
    }
    audit(db, { householdId: device.householdId, actorId: null, action: 'learning.device_complete', entity: 'lesson', entityId: lessonId, detail: { childId, deviceId: device.id, score } });
  });
  trackEvent(db, { householdId: device.householdId, childId, type: 'lesson_completed', meta: { lessonId, score, deviceId: device.id } });
  const rewards = awardLessonCompletion(db, childId, lessonId, score, matchedPlanItem, dynamic.correct, dynamic.total);
  return { progress: db.get('SELECT * FROM progress WHERE child_id = ? AND lesson_id = ?', [childId, lessonId]), childId, rewards, scoring: dynamic };
}

export function cameraConsentState(db: Db, user: AuthUser, childId: string) {
  const child = assertChildAccess(db, user, childId);
  return { childId: child.id, camera: consentGranted(db, child.id, 'camera'), aiProcessing: consentGranted(db, child.id, 'ai_processing') };
}

export function deviceProfile(db: Db, device: AuthDevice) {
  db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [nowIso(), device.id]);
  const row = db.get<{ id: string; name: string; kind: string; household_id: string }>(
    'SELECT id, name, kind, household_id FROM devices WHERE id = ?', [device.id],
  );
  const household = getHousehold(db, device.householdId);
  const children = listChildren(db, device.householdId).map(c => {
    const pet = db.get<Record<string, any>>(
      'SELECT species, name, level, mood, equipped FROM pets WHERE child_id = ?', [c.id],
    );
    return {
      id: c.id, name: c.name, class_code: c.class_code,
      cameraConsent: consentGranted(db, c.id, 'camera'),
      pet: pet ? { species: pet.species, name: pet.name, level: pet.level, mood: pet.mood, equipped: JSON.parse(pet.equipped || '[]') } : null,
    };
  });
  return { device: row, household, children };
}
