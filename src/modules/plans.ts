import type { Db } from '../infra/db.ts';
import { notFound, validation } from '../core/errors.ts';
import { addDays, newId, nowIso, today } from '../core/security.ts';
import { int, isoDate, oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { assertChildAccess, assertPlanAccess, audit, consentGranted, resolveChildId, subjectMap, trackEvent } from './shared.ts';
import { aiConfigured, assertAiQuota, chat, recordAiUsage, resolveModel } from './ai.ts';

export type DraftItem = { lessonId: string; subjectCode: string; title: string; minutes: number; date: string; seq: number; note?: string };
export type PlanDraft = {
  title: string; goal: string; startDate: string; endDate: string;
  daysPerWeek: number; minutesPerDay: number; rationale: string;
  engine: 'llm' | 'local-rules' | 'manual'; items: DraftItem[];
};

const WEEK_PATTERNS: Record<number, number[]> = {
  2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6],
};

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

type CandidateLesson = {
  id: string; title: string; minutes: number; subject_code: string; unit_seq: number; lesson_seq: number;
};

function candidateLessons(db: Db, childId: string, classCode: string): CandidateLesson[] {
  return db.all<CandidateLesson>(
    `SELECT l.id, l.title, l.minutes, f.subject_code, un.seq AS unit_seq, l.seq AS lesson_seq
     FROM lessons l JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
     WHERE f.class_code = ? AND l.is_published = 1
       AND NOT EXISTS(SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.child_id = ? AND p.status = 'completed')
     ORDER BY f.subject_code, un.seq, l.seq`,
    [classCode, childId],
  );
}

function completedCounts(db: Db, childId: string): Record<string, number> {
  const rows = db.all<{ subject_code: string; c: number }>(
    `SELECT f.subject_code, COUNT(*) AS c FROM progress p
     JOIN lessons l ON l.id = p.lesson_id JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
     WHERE p.child_id = ? AND p.status = 'completed' GROUP BY f.subject_code`,
    [childId],
  );
  return Object.fromEntries(rows.map(r => [r.subject_code, r.c]));
}

function buildSchedule(startDate: string, weeks: number, daysPerWeek: number): string[] {
  const pattern = WEEK_PATTERNS[daysPerWeek] || WEEK_PATTERNS[5];
  const target = weeks * daysPerWeek;
  const dates: string[] = [];
  for (let offset = 0; offset <= weeks * 7 + 14 && dates.length < target; offset++) {
    const date = addDays(startDate, offset);
    const weekday = weekdayOf(date);
    if (pattern.includes(weekday)) dates.push(date);
  }
  return dates;
}

function buildDraft(db: Db, child: { id: string; name: string; class_code: string }, input: {
  weeks: number; daysPerWeek: number; minutesPerDay: number; goal: string; startDate?: string;
}): PlanDraft {
  const startDate = input.startDate || today();
  const dates = buildSchedule(startDate, input.weeks, input.daysPerWeek);
  if (!dates.length) throw validation('起始日期过晚，无法生成计划');
  const candidates = candidateLessons(db, child.id, child.class_code);
  if (!candidates.length) throw new Error('该学段暂无可用课时，请先导入课程');
  const completed = completedCounts(db, child.id);
  const subjects = subjectMap(db);
  const queues = new Map<string, CandidateLesson[]>();
  for (const lesson of candidates) {
    if (!queues.has(lesson.subject_code)) queues.set(lesson.subject_code, []);
    queues.get(lesson.subject_code)!.push(lesson);
  }
  const subjectOrder = [...queues.keys()].sort((a, b) => (completed[a] || 0) - (completed[b] || 0));
  let cursor = 0;
  const used = new Set<string>();
  const items: DraftItem[] = [];
  let seq = 0;

  const takeLesson = (): CandidateLesson | null => {
    for (let attempt = 0; attempt < subjectOrder.length; attempt++) {
      const subject = subjectOrder[cursor % subjectOrder.length];
      cursor += 1;
      const queue = queues.get(subject);
      while (queue?.length) {
        const lesson = queue.shift()!;
        if (!used.has(lesson.id)) { used.add(lesson.id); return lesson; }
      }
    }
    return null;
  };

  for (const date of dates) {
    let usedMinutes = 0;
    let count = 0;
    while (count < 2) {
      const lesson = takeLesson();
      if (!lesson) break;
      if (usedMinutes + lesson.minutes > input.minutesPerDay) {
        if (count === 0) {
          // 单课本身超过每日上限：单独安排，但必须诚实标注，而不是宣称“不超过”
          seq += 1;
          items.push({
            lessonId: lesson.id, subjectCode: lesson.subject_code, title: lesson.title,
            minutes: lesson.minutes, date, seq,
            note: `本课 ${lesson.minutes} 分钟，超过每日 ${input.minutesPerDay} 分钟；今天只安排这一节，可分段完成`,
          });
          usedMinutes += lesson.minutes;
          count += 1;
          break;
        }
        itemPoolPushBack(queues, lesson);
        break;
      }
      seq += 1;
      items.push({
        lessonId: lesson.id, subjectCode: lesson.subject_code, title: lesson.title,
        minutes: lesson.minutes, date, seq,
      });
      usedMinutes += lesson.minutes;
      count += 1;
      if (items.length >= dates.length * 2) break;
    }
  }
  if (!items.length) throw validation('没有可安排的课时');

  const lastDate = items[items.length - 1]!.date;
  const subjectNames = [...new Set(items.map(i => subjects[i.subjectCode]?.name || i.subjectCode))];
  const totalCompleted = Object.values(completed).reduce((a, b) => a + b, 0);
  const weakest = subjectOrder[0] ? subjects[subjectOrder[0]]?.name || subjectOrder[0] : '各学科';
  const rationale =
    `已基于${child.name}（${child.class_code === 'nursery' ? '托班' : child.class_code === 'junior' ? '小班' : child.class_code === 'middle' ? '中班' : '大班'}）` +
    `已完成的 ${totalCompleted} 个课时与课程顺序排课：共 ${items.length} 个活动、覆盖 ${subjectNames.length} 个学科，` +
    `优先补充进度较少的「${weakest}」，并跳过已完成课时；每天尽量控制在 ${input.minutesPerDay} 分钟；单课超长时单独安排并标注；${input.daysPerWeek >= 6 ? '周日留白' : '周末留白'}。`;
  return {
    title: `${child.name}的${input.weeks}周学习计划`,
    goal: input.goal || '保持每日稳定学习节奏，五大模块均衡发展',
    startDate, endDate: lastDate, daysPerWeek: input.daysPerWeek, minutesPerDay: input.minutesPerDay,
    rationale, engine: 'local-rules', items,
  };
}

function itemPoolPushBack(queues: Map<string, CandidateLesson[]>, lesson: CandidateLesson): void {
  const queue = queues.get(lesson.subject_code);
  if (queue) queue.unshift(lesson);
}

async function enhanceRationale(db: Db, child: { name: string; class_code: string; id: string }, draft: PlanDraft, user: AuthUser): Promise<'llm' | 'local-rules'> {
  if (!aiConfigured(db)) return 'local-rules';
  if (!consentGranted(db, child.id, 'ai_processing')) return 'local-rules';
  try {
    assertAiQuota(db, user.householdId);
    const model = resolveModel(db);
    const result = await chat(db, {
      messages: [
        { role: 'system', content: '你是资深的幼儿园课程规划师。只输出 2–3 句中文建议，必须基于给出的真实数据，不得编造。语气温和、具体、可执行。' },
        { role: 'user', content: JSON.stringify({
          childName: child.name, classCode: child.class_code,
          lessons: draft.items.length, subjects: [...new Set(draft.items.map(i => i.subjectCode))],
          startDate: draft.startDate, endDate: draft.endDate, minutesPerDay: draft.minutesPerDay,
          localDraft: draft.rationale,
        }) },
      ],
      temperature: 0.4, maxTokens: 220, timeoutMs: 20_000,
    });
    if (result.engine === 'llm' && result.content) {
      recordAiUsage(db, user.householdId, 'plan.rationale');
      draft.rationale = result.content.slice(0, 500);
      draft.engine = 'llm';
      return 'llm';
    }
  } catch {
    // Local planner remains fully functional when AI is unavailable or over quota.
  }
  return 'local-rules';
}

function persistPlan(db: Db, user: AuthUser, childId: string, draft: PlanDraft, source: 'manual' | 'ai', ip?: string) {
  const planId = newId();
  const now = nowIso();
  const engine = source === 'ai' ? 'ai-assisted' : source === 'manual' && draft.engine === 'manual' ? 'manual' : 'local-rules';
  db.tx(() => {
    db.run(
      `INSERT INTO plans(id, household_id, child_id, title, goal, created_by, source, status, start_date, end_date,
        days_per_week, minutes_per_day, ai_rationale, engine, version, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [planId, user.householdId, childId, draft.title, draft.goal, user.id, source, 'draft',
        draft.startDate, draft.endDate, draft.daysPerWeek, draft.minutesPerDay, draft.rationale, engine, 1, now, now],
    );
    for (const item of draft.items) {
      db.run(
        `INSERT INTO plan_items(id, plan_id, household_id, child_id, date, seq, lesson_id, subject_code, title, minutes, status, completed_at, note)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [newId(), planId, user.householdId, childId, item.date, item.seq, item.lessonId, item.subjectCode,
          item.title, item.minutes, 'pending', null, item.note || null],
      );
    }
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'plan.create', entity: 'plan', entityId: planId, detail: { source, engine: draft.engine }, ip });
  });
  return planId;
}

export async function generatePlan(db: Db, user: AuthUser, body: any, ip?: string) {
  const childId = resolveChildId(db, user, body?.childId);
  const child = assertChildAccess(db, user, childId);
  const weeks = int(body?.weeks ?? 2, { min: 1, max: 8, label: '周期（周）' });
  const daysPerWeek = int(body?.daysPerWeek ?? 5, { min: 2, max: 6, label: '每周天数' });
  const minutesPerDay = int(body?.minutesPerDay ?? 25, { min: 15, max: 90, label: '每日分钟' });
  const goal = str(body?.goal, { optional: true, max: 200, label: '目标' }) || '五大模块均衡发展，建立稳定学习节奏';
  const startDate = body?.startDate ? isoDate(body.startDate, '开始日期') : today();
  const draft = buildDraft(db, { id: child.id, name: child.name, class_code: child.class_code },
    { weeks, daysPerWeek, minutesPerDay, goal, startDate });
  await enhanceRationale(db, { name: child.name, class_code: child.class_code, id: childId }, draft, user);
  const planId = persistPlan(db, user, childId, draft, draft.engine === 'llm' ? 'ai' : 'manual', ip);
  trackEvent(db, { householdId: user.householdId, childId, userId: user.id, type: 'plan_generated', meta: { engine: draft.engine, items: draft.items.length } });
  return { plan: planDetail(db, user, planId), engine: draft.engine };
}

export async function createManualPlan(db: Db, user: AuthUser, body: any, ip?: string) {
  const childId = resolveChildId(db, user, body?.childId);
  const child = assertChildAccess(db, user, childId);
  const weeks = int(body?.weeks ?? 2, { min: 1, max: 8, label: '周期（周）' });
  const daysPerWeek = int(body?.daysPerWeek ?? 5, { min: 2, max: 6, label: '每周天数' });
  const minutesPerDay = int(body?.minutesPerDay ?? 25, { min: 15, max: 90, label: '每日分钟' });
  const title = str(body?.title, { label: '计划标题', min: 2, max: 40, optional: true }) || `${child.name}的学习计划`;
  const goal = str(body?.goal, { optional: true, max: 200, label: '目标' }) || '按自己的节奏，每天进步一点点';
  const startDate = body?.startDate ? isoDate(body.startDate, '开始日期') : today();
  const draft = buildDraft(db, { id: child.id, name: child.name, class_code: child.class_code },
    { weeks, daysPerWeek, minutesPerDay, goal, startDate });
  draft.title = title;
  draft.rationale = `家长手动创建：${str(body?.notes, { optional: true, max: 480, label: '备注' }) || '系统按课程顺序与已完成进度自动填充课时，可在计划中调整。'}`;
  draft.engine = 'manual';
  const planId = persistPlan(db, user, childId, draft, 'manual', ip);
  trackEvent(db, { householdId: user.householdId, childId, userId: user.id, type: 'plan_generated', meta: { engine: 'manual', items: draft.items.length } });
  return { plan: planDetail(db, user, planId), engine: 'manual' as const };
}

export function listPlans(db: Db, user: AuthUser, childIdRaw?: unknown) {
  const childId = childIdRaw ? resolveChildId(db, user, childIdRaw) : null;
  const params: unknown[] = [user.householdId];
  let sql = `SELECT p.*, c.name AS child_name, c.class_code FROM plans p JOIN children c ON c.id = p.child_id
    WHERE p.household_id = ?`;
  if (childId) { sql += ' AND p.child_id = ?'; params.push(childId); }
  sql += ' ORDER BY p.created_at DESC';
  const plans = db.all<any>(sql, params);
  return plans.map(row => {
    const stats = planStats(db, row.id, row.child_id);
    return { ...row, ...stats };
  });
}

function planStats(db: Db, planId: string, childId: string) {
  const items = db.all<{ status: string; date: string }>('SELECT status, date FROM plan_items WHERE plan_id = ?', [planId]);
  const todayStr = today();
  const total = items.length;
  const done = items.filter(i => i.status === 'done').length;
  const missed = items.filter(i => i.status === 'missed' || (i.status === 'pending' && i.date < todayStr)).length;
  const pending = items.filter(i => i.status === 'pending').length;
  const due = items.filter(i => i.date <= todayStr).length;
  const adherence = due ? Math.round((done / due) * 100) : 0;
  const minutesDone = db.get<{ m: number | null }>(
    `SELECT COALESCE(SUM(l.minutes), 0) AS m FROM plan_items pi LEFT JOIN lessons l ON l.id = pi.lesson_id
     WHERE pi.plan_id = ? AND pi.status = 'done'`, [planId],
  )?.m || 0;
  return { total, done, missed, pending, adherence, minutesDone, progressPercent: total ? Math.round((done / total) * 100) : 0 };
}

export function planDetail(db: Db, user: AuthUser, planId: string): any {
  const plan = assertPlanAccess(db, user, planId);
  const child = db.get<any>('SELECT id, name, class_code, household_id FROM children WHERE id = ?', [plan.child_id]);
  const items = db.all<any>(
    `SELECT pi.*, l.objective, l.title AS lesson_title, l.minutes AS lesson_minutes, l.source_code
     FROM plan_items pi LEFT JOIN lessons l ON l.id = pi.lesson_id
     WHERE pi.plan_id = ? ORDER BY pi.date, pi.seq`,
    [planId],
  );
  const todayStr = today();
  const deviations = items
    .filter(i => (i.status === 'pending' || i.status === 'missed') && i.date < todayStr)
    .map(i => ({
      itemId: i.id, date: i.date, title: i.title, subjectCode: i.subject_code,
      daysOverdue: Math.floor((Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${i.date}T00:00:00Z`)) / 86400000),
    }));
  const adjustments = db.all<any>(
    'SELECT * FROM plan_adjustments WHERE plan_id = ? ORDER BY created_at DESC LIMIT 20', [planId],
  );
  const reminders = db.all<any>(
    "SELECT * FROM reminders WHERE plan_id = ? AND status != 'cancelled' ORDER BY at LIMIT 20", [planId],
  );
  return {
    plan: { ...plan, engine: plan.engine || (plan.source === 'ai' ? 'ai-assisted' : 'manual') },
    child,
    items,
    stats: planStats(db, planId, plan.child_id),
    deviations,
    adjustments,
    reminders,
  };
}

export function activatePlan(db: Db, user: AuthUser, planId: string, ip?: string) {
  const plan = assertPlanAccess(db, user, planId);
  if (plan.status === 'archived') throw validation('已归档的计划不能激活');
  db.run("UPDATE plans SET status = 'active', updated_at = ? WHERE id = ?", [nowIso(), planId]);
  createPlanReminders(db, planId, plan.household_id, plan.child_id);
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'plan.activate', entity: 'plan', entityId: planId, ip });
  return planDetail(db, user, planId);
}

function reminderAt(date: string): string {
  return new Date(`${date}T19:00:00+08:00`).toISOString();
}

function createPlanReminders(db: Db, planId: string, householdId: string, childId: string): number {
  const planState = db.get<{ status: string }>('SELECT status FROM plans WHERE id = ?', [planId]);
  if (!planState || planState.status !== 'active') return 0;
  const todayStr = today();
  const horizon = addDays(todayStr, 7);
  const items = db.all<{ date: string; title: string; minutes: number }>(
    `SELECT date, title, minutes FROM plan_items WHERE plan_id = ? AND status = 'pending' AND date BETWEEN ? AND ?
     ORDER BY date, seq`, [planId, todayStr, horizon],
  );
  const child = db.get<{ name: string }>('SELECT name FROM children WHERE id = ?', [childId]);
  let created = 0;
  const seen = new Set<string>();
  for (const item of items) {
    const at = reminderAt(item.date);
    if (seen.has(at)) continue;
    seen.add(at);
    const exists = db.get('SELECT id FROM reminders WHERE plan_id = ? AND at = ?', [planId, at]);
    if (exists) continue;
    db.run(
      `INSERT INTO reminders(id, plan_id, household_id, child_id, at, message, channel, status, created_at, sent_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [newId(), planId, householdId, childId, at,
        `提醒：${child?.name || '宝贝'}今天有「${item.title}」的学习计划，约 ${item.minutes || 15} 分钟，一起完成吧。`,
        'inapp', 'scheduled', nowIso(), null],
    );
    created += 1;
  }
  return created;
}

export function updatePlanStatus(db: Db, user: AuthUser, planId: string, body: any) {
  assertPlanAccess(db, user, planId);
  const status = oneOf(body?.status, ['draft', 'active', 'archived'] as const, '计划状态');
  db.run('UPDATE plans SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), planId]);
  if (status === 'active') {
    const plan = assertPlanAccess(db, user, planId);
    createPlanReminders(db, planId, plan.household_id, plan.child_id);
    trackEvent(db, { householdId: plan.household_id, childId: plan.child_id, userId: user.id, type: 'plan_activated' });
  }
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'plan.status', entity: 'plan', entityId: planId, detail: { status } });
  return planDetail(db, user, planId);
}

export function correctPlan(db: Db, user: AuthUser, planId: string, body: any) {
  const plan = assertPlanAccess(db, user, planId);
  const strategy = oneOf(body?.strategy ?? 'shift', ['shift', 'skip'] as const, '纠偏策略');
  const reason = str(body?.reason, { optional: true, max: 200, label: '原因' }) || '部分课时未按时完成，系统建议顺延';
  const todayStr = today();
  const overdue = db.all<any>(
    `SELECT * FROM plan_items WHERE plan_id = ? AND date < ? AND status IN ('pending','missed') ORDER BY date, seq`,
    [planId, todayStr],
  );
  if (!overdue.length) return { moved: 0, skipped: 0, message: '当前没有需要纠偏的课时', detail: planDetail(db, user, planId) };

  if (strategy === 'skip') {
    db.tx(() => {
      for (const item of overdue) db.run("UPDATE plan_items SET status = 'skipped' WHERE id = ?", [item.id]);
      db.run('UPDATE plans SET version = version + 1, updated_at = ? WHERE id = ?', [nowIso(), planId]);
      db.run(
        'INSERT INTO plan_adjustments(id, plan_id, household_id, actor_id, reason, action, detail, created_at) VALUES(?,?,?,?,?,?,?,?)',
        [newId(), planId, plan.household_id, user.id, reason, 'skip_overdue', JSON.stringify({ items: overdue.map(i => i.id) }), nowIso()],
      );
    });
    trackEvent(db, { householdId: plan.household_id, childId: plan.child_id, userId: user.id, type: 'plan_corrected', meta: { strategy, count: overdue.length } });
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'plan.correct', entity: 'plan', entityId: planId, detail: { strategy, count: overdue.length } });
    return { moved: 0, skipped: overdue.length, message: `已跳过 ${overdue.length} 个逾期课时`, detail: planDetail(db, user, planId) };
  }

  const occupied = new Set(
    db.all<{ date: string }>(`SELECT date FROM plan_items WHERE plan_id = ? AND date >= ? AND status != 'moved'`, [planId, todayStr]).map(r => r.date),
  );
  const countByDate = new Map<string, number>();
  for (const row of db.all<{ date: string; c: number }>('SELECT date, COUNT(*) AS c FROM plan_items WHERE plan_id = ? GROUP BY date', [planId])) {
    countByDate.set(row.date, row.c);
  }
  for (const row of db.all<{ date: string; c: number }>(
    `SELECT pi.date, COUNT(*) AS c FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
     WHERE pi.child_id = ? AND p.status = 'active' AND p.id != ? AND pi.date >= ? GROUP BY pi.date`,
    [plan.child_id, planId, todayStr],
  )) countByDate.set(row.date, (countByDate.get(row.date) || 0) + Number(row.c));
  let moved = 0;
  let lastNewDate = plan.end_date;
  const movedDetail: { itemId: string; from: string; to: string }[] = [];
  db.tx(() => {
    for (const item of overdue) {
      let slot: string | null = null;
      for (let offset = 0; offset <= 21; offset++) {
        const candidate = addDays(todayStr, offset);
        const wd = new Date(`${candidate}T00:00:00Z`).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        if (candidate <= todayStr) continue;
        if ((countByDate.get(candidate) || 0) >= 2) continue;
        slot = candidate;
        break;
      }
      if (!slot) break;
      db.run("UPDATE plan_items SET date = ?, status = 'pending' WHERE id = ?", [slot, item.id]);
      countByDate.set(slot, (countByDate.get(slot) || 0) + 1);
      occupied.add(slot);
      if (slot > lastNewDate) lastNewDate = slot;
      movedDetail.push({ itemId: item.id, from: item.date, to: slot });
      moved += 1;
    }
    db.run('UPDATE plans SET end_date = ?, updated_at = ?, version = version + 1 WHERE id = ?', [lastNewDate, nowIso(), planId]);
    db.run(
      'INSERT INTO plan_adjustments(id, plan_id, household_id, actor_id, reason, action, detail, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [newId(), planId, plan.household_id, user.id, reason, 'shift_overdue', JSON.stringify({ moved: movedDetail }), nowIso()],
    );
    createPlanReminders(db, planId, plan.household_id, plan.child_id);
  });
  trackEvent(db, { householdId: plan.household_id, childId: plan.child_id, userId: user.id, type: 'plan_corrected', meta: { strategy, moved } });
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'plan.correct', entity: 'plan', entityId: planId, detail: { strategy, moved } });
  return {
    moved, skipped: 0,
    message: moved ? `已把 ${moved} 个逾期课时顺延到最近的空白日，计划结束日期更新为 ${lastNewDate}` : '未来两周没有可用空档，请延长计划周期',
    detail: planDetail(db, user, planId),
  };
}

export function updateItemStatus(db: Db, user: AuthUser, planId: string, itemId: string, body: any) {
  assertPlanAccess(db, user, planId);
  const item = db.get<any>('SELECT * FROM plan_items WHERE id = ? AND plan_id = ?', [itemId, planId]);
  if (!item) throw notFound('计划项不存在');
  const status = oneOf(body?.status, ['pending', 'done', 'skipped'] as const, '状态');
  db.run('UPDATE plan_items SET status = ?, completed_at = ?, completed_via = ? WHERE id = ?',
    [status, status === 'done' ? nowIso() : null, status === 'done' ? 'manual' : null, itemId]);
  return planDetail(db, user, planId);
}

export function dueReminders(db: Db, user: AuthUser) {
  const now = nowIso();
  return db.all<Record<string, any>>(
    `SELECT r.*, c.name AS child_name, p.title AS plan_title FROM reminders r
     JOIN children c ON c.id = r.child_id JOIN plans p ON p.id = r.plan_id
     WHERE r.household_id = ? AND r.status = 'scheduled' AND r.at <= ? ORDER BY r.at LIMIT 20`,
    [user.householdId, now],
  );
}

export function dispatchDueReminders(db: Db, user: AuthUser) {
  const rows = dueReminders(db, user);
  const now = nowIso();
  for (const row of rows) db.run("UPDATE reminders SET status = 'sent', sent_at = ? WHERE id = ?", [now, row.id]);
  return rows;
}

/** Keep a rolling 7-day reminder horizon for every active plan. Called at boot and every 6h. */
export function refillActivePlanReminders(db: Db): number {
  const plans = db.all<{ id: string; household_id: string; child_id: string }>(
    "SELECT id, household_id, child_id FROM plans WHERE status = 'active' AND end_date >= ?", [today()],
  );
  let created = 0;
  for (const plan of plans) created += createPlanReminders(db, plan.id, plan.household_id, plan.child_id);
  return created;
}

export function upcomingReminders(db: Db, user: AuthUser) {
  return db.all<any>(
    `SELECT r.*, c.name AS child_name, p.title AS plan_title FROM reminders r
     JOIN children c ON c.id = r.child_id JOIN plans p ON p.id = r.plan_id
     WHERE r.household_id = ? AND r.status = 'scheduled' ORDER BY r.at LIMIT 30`,
    [user.householdId],
  );
}
