import type { Db } from '../infra/db.ts';
import { notFound, validation } from '../core/errors.ts';
import { nowIso } from '../core/security.ts';
import { int, oneOf, optionalIsoDate, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { approvePack, syncPublicCourses } from '../infra/public-courses.ts';
import { assertChildAccess, audit, listChildren, resolveChildId, subjectMap, trackEvent } from './shared.ts';
import { awardLessonCompletion } from './pet.ts';
import { scoreLesson } from './scoring.ts';

export type ProgressRow = {
  id: string; child_id: string; lesson_id: string; status: string;
  score: number | null; seconds: number; attempts: number;
  started_at: string | null; completed_at: string | null; updated_at: string;
};

export function listFrameworks(db: Db, opts: { classCode?: string; subjectCode?: string; childId?: string }) {
  const params: unknown[] = [];
  let sql = `
    SELECT f.id, f.subject_code, f.class_code, f.term, f.title, f.objectives, f.source_code, f.version, f.updated_at,
      s.name AS subject_name, s.icon, s.color, s.sort AS subject_sort,
      c.name AS class_name, c.age_min, c.age_max,
      (SELECT COUNT(*) FROM units un WHERE un.framework_id = f.id) AS unit_count,
      (SELECT COUNT(*) FROM lessons l JOIN units un ON un.id = l.unit_id WHERE un.framework_id = f.id AND l.is_published = 1) AS lesson_count,
      (SELECT COUNT(DISTINCT l.id) FROM lessons l JOIN units un ON un.id = l.unit_id
        WHERE un.framework_id = f.id AND l.is_published = 1
        AND EXISTS(SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.child_id = ? AND p.status = 'completed')) AS completed_count,
      (SELECT COUNT(*) FROM units un WHERE un.framework_id = f.id AND un.source_code IS NOT NULL) AS source_unit_count
    FROM frameworks f
    JOIN subjects s ON s.code = f.subject_code
    JOIN class_levels c ON c.code = f.class_code
    WHERE 1 = 1`;
  params.push(opts.childId || '__none__');
  if (opts.classCode) { sql += ' AND f.class_code = ?'; params.push(opts.classCode); }
  if (opts.subjectCode) { sql += ' AND f.subject_code = ?'; params.push(opts.subjectCode); }
  sql += ' ORDER BY c.sort, s.sort';
  return db.all<any>(sql, params).map(row => ({
    ...row,
    objectives: safeParse(row.objectives, []),
    progressPercent: row.lesson_count ? Math.round((row.completed_count / row.lesson_count) * 100) : 0,
  }));
}

function safeParse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function frameworkDetail(db: Db, user: AuthUser, frameworkId: string, childIdRaw?: unknown) {
  const framework = db.get<any>(
    `SELECT f.*, s.name AS subject_name, s.icon, s.color, c.name AS class_name
     FROM frameworks f JOIN subjects s ON s.code = f.subject_code JOIN class_levels c ON c.code = f.class_code
     WHERE f.id = ?`,
    [frameworkId],
  );
  if (!framework) throw notFound('课程框架不存在');
  const childId = resolveChildId(db, user, childIdRaw);
  const child = assertChildAccess(db, user, childId);
  const units = db.all<any>(
    `SELECT un.id, un.code, un.title, un.seq, un.objective, un.source_code, ps.name AS source_name
     FROM units un LEFT JOIN public_sources ps ON ps.code = un.source_code
     WHERE un.framework_id = ? ORDER BY un.seq`,
    [frameworkId],
  );
  const lessons = db.all<any>(
    `SELECT l.id, l.unit_id, l.code, l.title, l.seq, l.minutes, l.objective, l.tags, l.key_points, l.hard_points, l.home_extension, l.prereq_lesson_id, l.source_code, l.version, l.is_published,
       p.status AS progress_status, p.score, p.completed_at
     FROM lessons l JOIN units un ON un.id = l.unit_id
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.child_id = ?
     WHERE un.framework_id = ? AND l.is_published = 1
     ORDER BY un.seq, l.seq`,
    [childId, frameworkId],
  );
  const lessonsByUnit = new Map<string, Record<string, any>[]>();
  for (const lesson of lessons) {
    const list = lessonsByUnit.get(lesson.unit_id) || [];
    list.push({ ...lesson, tags: safeParse(lesson.tags, []) });
    lessonsByUnit.set(lesson.unit_id, list);
  }
  const isForChild = framework.class_code === child.class_code;
  return {
    framework: { ...framework, objectives: safeParse(framework.objectives, []) },
    child, isForChild,
    units: units.map(unit => {
      const list = lessonsByUnit.get(unit.id) || [];
      return {
        ...unit,
        lessons: list,
        completedCount: list.filter(l => l.progress_status === 'completed').length,
        lessonCount: list.length,
      };
    }),
  };
}

export function getLesson(db: Db, user: AuthUser, lessonId: string, childIdRaw?: unknown) {
  const lesson = db.get<any>(
    `SELECT l.*, un.title AS unit_title, un.seq AS unit_seq, un.framework_id,
       f.title AS framework_title, f.subject_code, f.class_code, f.objectives AS framework_objectives,
       s.name AS subject_name, s.icon, s.color, c.name AS class_name,
       ps.name AS source_name, ps.url AS source_url, ps.license AS source_license
     FROM lessons l JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
     JOIN subjects s ON s.code = f.subject_code JOIN class_levels c ON c.code = f.class_code
     LEFT JOIN public_sources ps ON ps.code = l.source_code
     WHERE l.id = ?`,
    [lessonId],
  );
  if (!lesson || !lesson.is_published) throw notFound('课时不存在或尚未发布');
  const childId = resolveChildId(db, user, childIdRaw);
  assertChildAccess(db, user, childId);
  const siblings = db.all<{ id: string; title: string }>(
    `SELECT l.id, l.title FROM lessons l JOIN units un ON un.id = l.unit_id
     WHERE un.framework_id = ? AND l.is_published = 1 ORDER BY un.seq, l.seq`,
    [lesson.framework_id],
  );
  const index = siblings.findIndex(s => s.id === lessonId);
  const progress = db.get<ProgressRow>('SELECT * FROM progress WHERE child_id = ? AND lesson_id = ?', [childId, lessonId]);
  return {
    lesson: {
      id: lesson.id, code: lesson.code, title: lesson.title, minutes: lesson.minutes, objective: lesson.objective,
      blocks: safeParse(lesson.blocks, []), tags: safeParse(lesson.tags, []), version: lesson.version,
      keyPoints: lesson.key_points || '', hardPoints: lesson.hard_points || '', homeExtension: lesson.home_extension || '',
      prereqLessonId: lesson.prereq_lesson_id || null,
      source: lesson.source_code ? { code: lesson.source_code, name: lesson.source_name, url: lesson.source_url, license: lesson.source_license } : null,
      isForChild: lesson.class_code === db.get<{ class_code: string }>('SELECT class_code FROM children WHERE id = ?', [childId])?.class_code,
    },
    unit: { id: lesson.unit_id, title: lesson.unit_title, seq: lesson.unit_seq },
    framework: { id: lesson.framework_id, title: lesson.framework_title, subjectCode: lesson.subject_code, classCode: lesson.class_code, objectives: safeParse(lesson.framework_objectives, []) },
    subject: { code: lesson.subject_code, name: lesson.subject_name, icon: lesson.icon, color: lesson.color },
    classLevel: { code: lesson.class_code, name: lesson.class_name },
    progress: progress || null,
    childId,
    previousLesson: index > 0 ? siblings[index - 1] : null,
    nextLesson: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null,
  };
}

export function saveProgress(db: Db, user: AuthUser, lessonId: string, body: any) {
  const childId = assertChildAccess(db, user, str(body?.childId, { label: '孩子', max: 64 })).id;
  const lesson = db.get<{ id: string; minutes: number; blocks: string }>('SELECT id, minutes, blocks FROM lessons WHERE id = ? AND is_published = 1', [lessonId]);
  if (!lesson) throw notFound('课时不存在');
  const status = oneOf(body?.status, ['in_progress', 'completed'] as const, '学习状态');
  if (body?.score !== undefined && body?.score !== null) int(body.score, { min: 0, max: 100, label: '得分' });
  const answers = Array.isArray(body?.answers) ? body.answers : undefined;
  const dynamic = status === 'completed' ? scoreLesson(JSON.parse(lesson.blocks), answers) : { score: 0, correct: 0, total: 0 };
  const score = status === 'completed' ? dynamic.score : null;
  const seconds = int(body?.seconds ?? 0, { min: 0, max: 7200, label: '学习时长' });
  const planItemId = str(body?.planItemId, { optional: true, max: 64, label: '计划项' }) || null;
  const now = nowIso();

  const existing = db.get<ProgressRow>('SELECT * FROM progress WHERE child_id = ? AND lesson_id = ?', [childId, lessonId]);
  let matchedPlanItem: string | null = null;
  db.tx(() => {
    if (!existing) {
      db.run(
        `INSERT INTO progress(id, child_id, lesson_id, status, score, seconds, attempts, started_at, completed_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), childId, lessonId, status, score, seconds, 1, now, status === 'completed' ? now : null, now],
      );
    } else {
      const keepCompleted = existing.status === 'completed';
      const nextStatus = keepCompleted ? 'completed' : status;
      db.run(
        `UPDATE progress SET status = ?, score = COALESCE(?, score), seconds = seconds + ?, attempts = attempts + 1,
           completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END, updated_at = ?
         WHERE id = ?`,
        [nextStatus, score, seconds, nextStatus, now, now, existing.id],
      );
    }
    if (planItemId && status === 'completed') {
      const item = db.get<{ id: string; child_id: string; lesson_id: string }>('SELECT id, child_id, lesson_id FROM plan_items WHERE id = ?', [planItemId]);
      if (item && item.child_id === childId && item.lesson_id === lessonId) {
        db.run("UPDATE plan_items SET status = 'done', completed_at = ?, completed_via = 'lesson' WHERE id = ?", [now, planItemId]);
        matchedPlanItem = planItemId;
      }
    }
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'learning.progress', entity: 'lesson', entityId: lessonId, detail: { childId, status, score } });
  });
  if (status === 'completed') trackEvent(db, { householdId: user.householdId, childId, userId: user.id, type: 'lesson_completed', meta: { lessonId, score } });
  const rewards = status === 'completed'
    ? awardLessonCompletion(db, childId, lessonId, score ?? 80, matchedPlanItem, dynamic.correct, dynamic.total)
    : null;
  return {
    progress: db.get<ProgressRow>('SELECT * FROM progress WHERE child_id = ? AND lesson_id = ?', [childId, lessonId]),
    childId,
    rewards,
    scoring: dynamic,
  };
}

export function searchLessons(db: Db, query: string, limit = 8, classCode?: string) {
  const q = `%${query.trim()}%`;
  const classFilter = classCode ? ' AND f.class_code = ?' : '';
  return db.all<any>(
    `SELECT l.id, l.title, l.minutes, l.objective, l.tags, f.subject_code, f.class_code, s.name AS subject_name, c.name AS class_name
     FROM lessons l JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
     JOIN subjects s ON s.code = f.subject_code JOIN class_levels c ON c.code = f.class_code
     WHERE l.is_published = 1 AND (l.title LIKE ? OR l.tags LIKE ? OR l.objective LIKE ?)${classFilter}
     ORDER BY f.class_code, f.subject_code LIMIT ?`,
    classCode ? [q, q, q, classCode, Math.min(limit, 20)] : [q, q, q, Math.min(limit, 20)],
  ).map(row => ({ ...row, tags: safeParse(row.tags, []) }));
}

export function publicSources(db: Db) {
  const sources = db.all<any>(
    `SELECT ps.*, (SELECT COUNT(*) FROM course_packs cp WHERE cp.source_code = ps.code) AS pack_count
     FROM public_sources ps ORDER BY ps.name`,
  );
  const packs = db.all<any>(
    `SELECT cp.*, ps.name AS source_name, ps.license, ps.homepage FROM course_packs cp
     JOIN public_sources ps ON ps.code = cp.source_code ORDER BY cp.imported_at DESC`,
  );
  return { sources, packs };
}

export function syncSources(db: Db, actor: AuthUser, ip?: string) {
  const results = syncPublicCourses(db, { autoApprove: false });
  audit(db, { householdId: actor.householdId, actorId: actor.id, action: 'sources.sync', entity: 'public_source', detail: results, ip });
  return results;
}

export function approvePackById(db: Db, actor: AuthUser, packId: string, ip?: string) {
  const result = approvePack(db, packId);
  audit(db, { householdId: actor.householdId, actorId: actor.id, action: 'sources.approve_pack', entity: 'course_pack', entityId: packId, detail: result, ip });
  return result;
}

export function childCurriculumSnapshot(db: Db, user: AuthUser, childIdRaw?: unknown) {
  const childId = resolveChildId(db, user, childIdRaw);
  const child = assertChildAccess(db, user, childId);
  const frameworks = listFrameworks(db, { classCode: child.class_code, childId });
  const subjects = subjectMap(db);
  const summary = frameworks.map(row => ({
    subjectCode: row.subject_code, subjectName: subjects[row.subject_code]?.name || row.subject_code,
    icon: subjects[row.subject_code]?.icon, color: subjects[row.subject_code]?.color,
    completed: row.completed_count, total: row.lesson_count, percent: row.progressPercent,
  }));
  return { child, children: listChildren(db, user.householdId), frameworks, summary };
}

export function lessonMatrix(db: Db) {
  return db.all<{ subject_code: string; class_code: string; count: number }>(
    `SELECT f.subject_code, f.class_code, COUNT(l.id) AS count FROM frameworks f
     JOIN units un ON un.framework_id = f.id JOIN lessons l ON l.unit_id = un.id AND l.is_published = 1
     GROUP BY f.subject_code, f.class_code ORDER BY f.class_code, f.subject_code`,
  );
}

export { optionalIsoDate, validation };
