import type { Db } from '../infra/db.ts';
import { AppError } from '../core/errors.ts';
import { newId, nowIso, today, addDays, dateRange } from '../core/security.ts';
import { oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { assertChildAccess, assertConsent, consentGranted, isoWeekKey, resolveChildId, streakDays, subjectMap } from './shared.ts';
import { aiConfigured, assertAiQuota, chat, extractJson, recordAiUsage, resolveModel } from './ai.ts';

type WindowMetrics = {
  completed: number; minutes: number; activeDays: number;
  subjectDist: { code: string; name: string; icon: string; color: string; count: number; minutes: number }[];
  avgScore: number | null;
};

function windowMetrics(db: Db, childId: string, start: string, end: string): WindowMetrics {
  const rows = db.all<{ subject_code: string; minutes: number; score: number | null; day: string }>(
    `SELECT f.subject_code, l.minutes, p.score, substr(p.completed_at, 1, 10) AS day
     FROM progress p JOIN lessons l ON l.id = p.lesson_id JOIN units un ON un.id = l.unit_id
     JOIN frameworks f ON f.id = un.framework_id
     WHERE p.child_id = ? AND p.status = 'completed' AND p.completed_at IS NOT NULL
       AND substr(p.completed_at, 1, 10) BETWEEN ? AND ?`,
    [childId, start, end],
  );
  const subjects = subjectMap(db);
  const bySubject = new Map<string, { count: number; minutes: number }>();
  const days = new Set<string>();
  let minutes = 0;
  const scores: number[] = [];
  for (const row of rows) {
    days.add(row.day);
    minutes += row.minutes;
    const entry = bySubject.get(row.subject_code) || { count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += row.minutes;
    bySubject.set(row.subject_code, entry);
    if (row.score !== null) scores.push(row.score);
  }
  return {
    completed: rows.length,
    minutes,
    activeDays: days.size,
    subjectDist: [...bySubject.entries()].map(([code, value]) => ({
      code, name: subjects[code]?.name || code, icon: subjects[code]?.icon || '📘',
      color: subjects[code]?.color || '#6366f1', ...value,
    })).sort((a, b) => b.count - a.count),
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}

function adherenceFor(db: Db, childId: string): { planned: number; done: number; percent: number } {
  const row = db.get<{ planned: number; done: number }>(
    `SELECT COUNT(*) AS planned, SUM(CASE WHEN pi.status = 'done' THEN 1 ELSE 0 END) AS done
     FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
     WHERE pi.child_id = ? AND p.status = 'active' AND pi.date <= ?`,
    [childId, today()],
  );
  const planned = Number(row?.planned || 0);
  const done = Number(row?.done || 0);
  return { planned, done, percent: planned ? Math.round((done / planned) * 100) : 0 };
}

function subjectOverall(db: Db, childId: string, classCode: string) {
  const rows = db.all<{ code: string; total: number; completed: number }>(
    `SELECT f.subject_code AS code,
      COUNT(l.id) AS total,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM progress p WHERE p.child_id = ? AND p.lesson_id = l.id AND p.status = 'completed') THEN 1 ELSE 0 END) AS completed
     FROM frameworks f JOIN units un ON un.framework_id = f.id JOIN lessons l ON l.unit_id = un.id AND l.is_published = 1
     WHERE f.class_code = ? GROUP BY f.subject_code`,
    [childId, classCode],
  );
  const subjects = subjectMap(db);
  return rows.map(r => ({
    code: r.code, name: subjects[r.code]?.name || r.code, icon: subjects[r.code]?.icon,
    color: subjects[r.code]?.color, total: Number(r.total), completed: Number(r.completed || 0),
    percent: r.total ? Math.round((Number(r.completed || 0) / Number(r.total)) * 100) : 0,
  }));
}

export function dashboard(db: Db, user: AuthUser, childIdRaw: unknown, rangeRaw: unknown) {
  const childId = resolveChildId(db, user, childIdRaw);
  const child = assertChildAccess(db, user, childId);
  if (!consentGranted(db, childId, 'analytics')) throw new AppError(403, 'CONSENT_REQUIRED', '监护人尚未授权学习分析，请在「多端联动 → 监护人授权」中开启');
  const range = oneOf(rangeRaw || 'week', ['day', 'week', 'month'] as const, '时间范围');
  const days = range === 'day' ? 1 : range === 'week' ? 7 : 30;
  const end = today();
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const current = windowMetrics(db, childId, start, end);
  const previous = windowMetrics(db, childId, prevStart, prevEnd);
  const adherence = adherenceFor(db, childId);
  const streak = streakDays(db, childId);
  const delta = (now: number, before: number) => before === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - before) / before) * 100);

  const series = dateRange(start, end).map(date => {
    const rows = db.all<{ count: number; minutes: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(l.minutes), 0) AS minutes FROM progress p
       JOIN lessons l ON l.id = p.lesson_id
       WHERE p.child_id = ? AND p.status = 'completed' AND substr(p.completed_at, 1, 10) = ?`,
      [childId, date],
    );
    return { date, lessons: Number(rows[0]?.count || 0), minutes: Number(rows[0]?.minutes || 0) };
  });

  const todayPlan = db.get<{ id: string; title: string }>("SELECT id, title FROM plans WHERE child_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [childId]);
  const todayItems = todayPlan
    ? db.all<any>(
      `SELECT pi.id, pi.title, pi.subject_code, pi.status, pi.minutes, pi.lesson_id, s.name AS subject_name, s.icon, s.color
       FROM plan_items pi LEFT JOIN subjects s ON s.code = pi.subject_code
       WHERE pi.plan_id = ? AND pi.date = ? ORDER BY pi.seq`, [todayPlan.id, end],
    )
    : [];
  const overall = subjectOverall(db, childId, child.class_code);
  const weakest = [...overall].filter(s => s.completed < s.total).sort((a, b) => a.percent - b.percent)[0];

  const recommendation = weakest
    ? db.get<any>(
      `SELECT l.id, l.title, l.minutes, s.name AS subject_name, s.icon, s.color FROM lessons l
       JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id JOIN subjects s ON s.code = f.subject_code
       WHERE f.class_code = ? AND f.subject_code = ? AND l.is_published = 1
         AND NOT EXISTS(SELECT 1 FROM progress p WHERE p.child_id = ? AND p.lesson_id = l.id AND p.status = 'completed')
       ORDER BY un.seq, l.seq LIMIT 1`, [child.class_code, weakest.code, childId],
    )
    : null;

  const insights: { title: string; text: string; tone: string }[] = [];
  if (current.completed === 0) {
    insights.push({ title: '从一个小活动开始', text: '本周期还没有完成记录。选一个 15 分钟的课时，先让学习发生。', tone: 'gentle' });
  } else {
    const top = current.subjectDist[0];
    insights.push({
      title: '本周期投入',
      text: `完成 ${current.completed} 个活动、累计 ${current.minutes} 分钟，${top ? `最投入的是「${top.name}」` : ''}，较上一周期 ${delta(current.completed, previous.completed)}%。`,
      tone: 'positive',
    });
  }
  if (weakest) {
    insights.push({
      title: '学科均衡建议',
      text: `「${weakest.name}」当前完成 ${weakest.percent}%（${weakest.completed}/${weakest.total} 课时）。可在下周计划中优先补 1–2 次。`,
      tone: 'focus',
    });
  }
  insights.push({
    title: '计划坚持度',
    text: adherence.planned
      ? `到期计划项完成率 ${adherence.percent}%（${adherence.done}/${adherence.planned}）。若有逾期，试试计划页的「一键顺延」。`
      : '还没有激活的计划。生成一份两周计划，能让学习节奏更稳定。',
    tone: adherence.percent >= 70 || !adherence.planned ? 'positive' : 'gentle',
  });

  return {
    child, range, start, end,
    metrics: {
      completed: current.completed, minutes: current.minutes, activeDays: current.activeDays,
      avgScore: current.avgScore, streak, adherence, overall,
      delta: { completed: delta(current.completed, previous.completed), minutes: delta(current.minutes, previous.minutes) },
    },
    series,
    subjects: current.subjectDist,
    overall,
    todayPlan: todayPlan ? { ...todayPlan, items: todayItems } : null,
    nextLesson: recommendation,
    insights,
    ai: {
      engine: aiConfigured(db) ? 'llm-assisted' : 'local-insight',
      configured: aiConfigured(db),
      disclosure: '学习数据仅用于本家庭的分析；仅在获得监护人授权时才会发送必要摘要给第三方模型。',
    },
  };
}

function periodBounds(period: 'daily' | 'weekly' | 'monthly', now = new Date()) {
  const local = new Date(now.getTime() + 8 * 3600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  if (period === 'daily') {
    const key = today();
    return { key, start: key, end: key, label: '今日' };
  }
  if (period === 'weekly') {
    const key = isoWeekKey(now);
    const day = new Date(`${today()}T00:00:00Z`).getUTCDay() || 7;
    const start = addDays(today(), 1 - day);
    return { key, start, end: addDays(start, 6), label: '本周' };
  }
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, '0')}`;
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start, end, label: '本月' };
}

function localReport(db: Db, childId: string, period: string, bounds: ReturnType<typeof periodBounds>) {
  const metrics = windowMetrics(db, childId, bounds.start, bounds.end);
  const adherence = adherenceFor(db, childId);
  const child = db.get<{ name: string; class_code: string }>('SELECT name, class_code FROM children WHERE id = ?', [childId]);
  const top = metrics.subjectDist[0];
  const summary = metrics.completed
    ? `${bounds.label}${child?.name || '孩子'}完成 ${metrics.completed} 个学习活动，共 ${metrics.minutes} 分钟，覆盖 ${metrics.subjectDist.length} 个学科${top ? `，最投入的是「${top.name}」` : ''}。计划到期项完成率 ${adherence.percent}%。`
    : `${bounds.label}${child?.name || '孩子'}还没有完成的学习活动。建议从推荐课时开始，先建立一个小而稳定的节奏。`;
  const highlights = [
    metrics.completed ? `完成 ${metrics.completed} 个活动，累计 ${metrics.minutes} 分钟` : '本周期暂无完成记录',
    metrics.avgScore !== null ? `活动平均得分 ${metrics.avgScore} 分` : '完成第一个活动后即可看到得分趋势',
    adherence.planned ? `计划完成 ${adherence.done}/${adherence.planned} 项（${adherence.percent}%）` : '尚未激活学习计划',
  ];
  const subjects = subjectMap(db);
  const weakest = db.all<{ code: string; total: number; completed: number }>(
    `SELECT f.subject_code AS code, COUNT(l.id) AS total,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM progress p WHERE p.child_id = ? AND p.lesson_id = l.id AND p.status = 'completed') THEN 1 ELSE 0 END) AS completed
     FROM frameworks f JOIN units un ON un.framework_id = f.id JOIN lessons l ON l.unit_id = un.id AND l.is_published = 1
     JOIN children c ON c.class_code = f.class_code AND c.id = ?
     GROUP BY f.subject_code ORDER BY (CAST(SUM(CASE WHEN EXISTS(SELECT 1 FROM progress p WHERE p.child_id = ? AND p.lesson_id = l.id AND p.status = 'completed') THEN 1 ELSE 0 END) AS REAL) / COUNT(l.id)) ASC LIMIT 1`,
    [childId, childId, childId],
  )[0];
  const suggestions = [
    metrics.completed === 0
      ? '今天安排 1 个 15 分钟的入门活动，完成后一起说说是哪一步最有趣。'
      : `保持每天 1 个主活动 + 1 个轻量复习，连续性是关键。`,
    weakest ? `「${subjects[weakest.code]?.name || weakest.code}」进度相对靠后，可在下一份计划中优先安排 2 次。` : '五大模块进度均衡，继续保持。',
    adherence.percent < 70 && adherence.planned
      ? '有逾期计划项时，用「一键顺延」把它们放到最近的空白日，比整周放弃更有效。'
      : '每周日花 5 分钟复盘，和孩子一起选出下周最想做的 3 个活动。',
  ];
  return { summary, highlights, suggestions, metrics: { ...metrics, adherence, engine: 'local-insight' } };
}

export async function generateReport(db: Db, user: AuthUser, body: any) {
  const childId = resolveChildId(db, user, body?.childId);
  const child = assertChildAccess(db, user, childId);
  if (!consentGranted(db, childId, 'analytics')) throw new AppError(403, 'CONSENT_REQUIRED', '监护人尚未授权学习分析，无法生成报告');
  const period = oneOf(body?.period ?? 'weekly', ['daily', 'weekly', 'monthly'] as const, '报告周期');
  const bounds = periodBounds(period);
  const report = localReport(db, childId, period, bounds);
  let engine = 'local-insight';
  if (aiConfigured(db) && consentGranted(db, childId, 'ai_processing')) {
    try {
      assertAiQuota(db, user.householdId, 40);
      const result = await chat(db, {
        messages: [
          { role: 'system', content: '你是幼儿园学习分析师。根据给定的真实数据，输出 JSON：{"summary":"2句中文总结","highlights":["3条"],"suggestions":["2条"]}。不要编造数据，不要提及其他孩子，语气温和具体。' },
          { role: 'user', content: JSON.stringify({ child: { name: child.name, classCode: child.class_code }, period: bounds.label, metrics: report.metrics }) },
        ],
        temperature: 0.4, maxTokens: 500, timeoutMs: 25_000,
      });
      const parsed = extractJson<{ summary?: string; highlights?: string[]; suggestions?: string[] }>(result.content);
      if (parsed?.summary && Array.isArray(parsed.highlights) && Array.isArray(parsed.suggestions)) {
        report.summary = String(parsed.summary).slice(0, 400);
        report.highlights = parsed.highlights.slice(0, 4).map(x => String(x).slice(0, 160));
        report.suggestions = parsed.suggestions.slice(0, 3).map(x => String(x).slice(0, 200));
        report.metrics = { ...report.metrics, engine: 'llm-assisted' };
        engine = 'llm-assisted';
        recordAiUsage(db, user.householdId, 'report.generate');
      }
    } catch {
      // keep grounded local report
    }
  }
  const existing = db.get<{ id: string }>('SELECT id FROM reports WHERE child_id = ? AND period = ? AND period_key = ?',
    [childId, period, bounds.key]);
  const reportId = existing?.id || newId();
  db.run(
    `INSERT INTO reports(id, household_id, child_id, period, period_key, summary, highlights, suggestions, metrics, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(child_id, period, period_key) DO UPDATE SET summary = excluded.summary, highlights = excluded.highlights,
       suggestions = excluded.suggestions, metrics = excluded.metrics, created_at = excluded.created_at`,
    [reportId, user.householdId, childId, period, bounds.key, report.summary,
      JSON.stringify(report.highlights), JSON.stringify(report.suggestions), JSON.stringify(report.metrics), nowIso()],
  );
  return { id: reportId, childId, period, periodKey: bounds.key, start: bounds.start, end: bounds.end, ...report, engine };
}

function parseReport(row: Record<string, any>) {
  return {
    ...row,
    highlights: safeJson(row.highlights, []),
    suggestions: safeJson(row.suggestions, []),
    metrics: safeJson(row.metrics, {}),
  };
}

function safeJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function listReports(db: Db, user: AuthUser, childIdRaw: unknown) {
  const childId = resolveChildId(db, user, childIdRaw);
  assertChildAccess(db, user, childId);
  return db.all<any>(
    'SELECT * FROM reports WHERE child_id = ? ORDER BY created_at DESC LIMIT 20', [childId],
  ).map(parseReport);
}

export function adminOverview(db: Db) {
  const count = (sql: string, params: unknown[] = []) => Number(db.get<{ c: number }>(sql, params)?.c || 0);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  return {
    users: count('SELECT COUNT(*) AS c FROM users'),
    households: count('SELECT COUNT(*) AS c FROM households'),
    children: count('SELECT COUNT(*) AS c FROM children'),
    lessons: count('SELECT COUNT(*) AS c FROM lessons WHERE is_published = 1'),
    sources: count('SELECT COUNT(*) AS c FROM public_sources'),
    pendingPosts: count("SELECT COUNT(*) AS c FROM community_posts WHERE status = 'pending'"),
    pendingExperts: count("SELECT COUNT(*) AS c FROM experts WHERE status = 'pending_review'"),
    pendingSkills: count("SELECT COUNT(*) AS c FROM skills WHERE status = 'pending_review'"),
    pendingPacks: count("SELECT COUNT(*) AS c FROM course_packs WHERE status = 'quarantined'"),
    aiRuns24h: count('SELECT COUNT(*) AS c FROM agent_runs WHERE created_at >= ?', [since]),
    snapshots: count('SELECT COUNT(*) AS c FROM snapshots'),
    reports: count('SELECT COUNT(*) AS c FROM reports'),
  };
}

export function auditLogs(db: Db, limit = 50) {
  return db.all<any>(
    `SELECT a.*, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT ?`, [Math.min(limit, 200)],
  );
}

export function purgeExpiredSnapshots(db: Db, days = Number(process.env.SNAPSHOT_RETENTION_DAYS || 30)) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = db.all<{ id: string; file: string }>('SELECT id, file FROM snapshots WHERE created_at < ?', [cutoff]);
  for (const row of rows) db.run('DELETE FROM snapshots WHERE id = ?', [row.id]);
  return { removed: rows.length, cutoffDays: days, files: rows.map(r => r.file) };
}
