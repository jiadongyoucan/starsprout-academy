import type { Db } from '../infra/db.ts';
import { AppError, forbidden, notFound, validation } from '../core/errors.ts';
import { newId, nowIso } from '../core/security.ts';
import { bool, int, oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { audit } from './shared.ts';
import { moderateComment, moderateContent } from './moderation.ts';

export type PostType = 'insight' | 'course' | 'question';

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function courseRefOf(db: Db, raw: unknown) {
  if (!raw) return { json: null as string | null, lesson: null as Record<string, any> | null };
  const ref = typeof raw === 'string' ? parseJson<Record<string, any>>(raw, {}) : (raw as Record<string, any>);
  const lessonId = typeof ref.lessonId === 'string' ? ref.lessonId : '';
  if (!lessonId) return { json: null, lesson: null };
  const lesson = db.get<any>(
    `SELECT l.id, l.title, l.source_code, f.class_code, f.subject_code, s.name AS subject_name
     FROM lessons l JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
     JOIN subjects s ON s.code = f.subject_code WHERE l.id = ? AND l.is_published = 1`, [lessonId],
  );
  if (!lesson) throw validation('关联的课时不存在或未发布');
  return { json: JSON.stringify({ lessonId, title: lesson.title, subjectCode: lesson.subject_code, classCode: lesson.class_code }), lesson };
}

export function submitPost(db: Db, user: AuthUser, body: any) {
  const type = oneOf(body?.type ?? 'insight', ['insight', 'course', 'question'] as const, '内容类型');
  const title = str(body?.title, { label: '标题', min: 4, max: 60 });
  const content = str(body?.content, { label: '正文', min: 20, max: 5000 });
  const tags = Array.isArray(body?.tags)
    ? body.tags.map((t: unknown) => str(t, { max: 12, label: '标签' })).filter(Boolean).slice(0, 5)
    : [];
  const ref = courseRefOf(db, body?.courseRef);
  if (type === 'course' && !ref.json) throw validation('发布课程必须关联一个已发布的课时，便于审核与追溯');
  const moderation = moderateContent(`${title}\n${content}\n${tags.join(' ')}`, { onTopicHint: type === 'course' && !!ref.json });
  if (moderation.blocked) {
    throw new AppError(422, 'CONTENT_REJECTED', '内容未通过安全审核，请修改后再提交', {
      reasons: moderation.reasons.map(r => r.label),
    });
  }
  const now = nowIso();
  const id = newId();
  const reasons = moderation.reasons.map(r => r.label);
  db.tx(() => {
    db.run(
      `INSERT INTO community_posts(id, household_id, author_id, type, title, content, tags, course_ref, status,
        moderation_score, moderation_reasons, like_count, view_count, created_at, updated_at, published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, user.householdId, user.id, type, title, content, JSON.stringify(tags), ref.json, 'pending',
        moderation.score, JSON.stringify(reasons), 0, 0, now, now, null],
    );
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'community.post.submit', entity: 'post', entityId: id, detail: { type, score: moderation.score } });
  });
  return {
    id, type, title, status: 'pending', moderationScore: moderation.score,
    moderationReasons: reasons,
    message: '已提交审核。审核通过后才会出现在社区广场；审核期间你可以在「我的发布」中查看状态。',
  };
}

export function updatePost(db: Db, user: AuthUser, postId: string, body: any) {
  const post = db.get<any>('SELECT * FROM community_posts WHERE id = ?', [postId]);
  if (!post) throw notFound('内容不存在');
  if (post.author_id !== user.id) throw forbidden('只能编辑自己发布的内容');
  if (post.status === 'hidden') throw forbidden('内容已被隐藏，无法编辑');
  const title = str(body?.title ?? post.title, { label: '标题', min: 4, max: 60 });
  const content = str(body?.content ?? post.content, { label: '正文', min: 20, max: 5000 });
  const tags = Array.isArray(body?.tags) ? body.tags.map((t: unknown) => str(t, { max: 12 })).slice(0, 5) : parseJson(post.tags, []);
  const moderation = moderateContent(`${title}\n${content}\n${tags.join(' ')}`);
  if (moderation.blocked) throw new AppError(422, 'CONTENT_REJECTED', '修改后的内容未通过安全审核', { reasons: moderation.reasons.map(r => r.label) });
  db.run(
    `UPDATE community_posts SET title = ?, content = ?, tags = ?, status = 'pending', moderation_score = ?,
      moderation_reasons = ?, published_at = NULL, updated_at = ? WHERE id = ?`,
    [title, content, JSON.stringify(tags), moderation.score, JSON.stringify(moderation.reasons.map(r => r.label)), nowIso(), postId],
  );
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'community.post.edit', entity: 'post', entityId: postId });
  return { id: postId, status: 'pending', moderationScore: moderation.score, message: '修改已保存，将重新进入审核。' };
}

export function listFeed(db: Db, user: AuthUser, query: URLSearchParams) {
  const type = query.get('type');
  const tag = query.get('tag');
  const limit = Math.min(Math.max(Number(query.get('limit') || 20), 1), 50);
  const params: unknown[] = [];
  let sql = `
    SELECT p.id, p.type, p.title, p.content, p.tags, p.course_ref, p.like_count, p.view_count, p.published_at,
      u.name AS author_name, u.role AS author_role,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') AS comment_count,
      EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked
    FROM community_posts p JOIN users u ON u.id = p.author_id
    WHERE p.status = 'approved'`;
  params.push(user.id);
  if (type && ['insight', 'course', 'question'].includes(type)) { sql += ' AND p.type = ?'; params.push(type); }
  if (tag) { sql += ' AND p.tags LIKE ?'; params.push(`%${tag}%`); }
  sql += ' ORDER BY p.published_at DESC LIMIT ?';
  params.push(limit);
  return db.all<any>(sql, params).map(row => ({
    ...row,
    tags: parseJson(row.tags, []),
    courseRef: row.course_ref ? parseJson(row.course_ref, null) : null,
    liked: !!row.liked,
  }));
}

export function getPost(db: Db, user: AuthUser, postId: string) {
  const post = db.get<any>(
    `SELECT p.*, u.name AS author_name, u.role AS author_role,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') AS comment_count,
      EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked
     FROM community_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`, [user.id, postId],
  );
  if (!post) throw notFound('内容不存在');
  const isStaff = ['teacher', 'admin'].includes(user.role);
  if (post.status !== 'approved' && post.author_id !== user.id && !isStaff) throw notFound('内容不存在');
  if (post.status === 'approved') {
    db.run('UPDATE community_posts SET view_count = view_count + 1 WHERE id = ?', [postId]);
    post.view_count = Number(post.view_count || 0) + 1;
  }
  const comments = db.all<any>(
    `SELECT c.id, c.content, c.created_at, u.name AS author_name FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? AND c.status = 'approved' ORDER BY c.created_at LIMIT 100`, [postId],
  );
  const safePost = { ...post };
  delete safePost.household_id;
  delete safePost.moderation_score;
  if (safePost.author_id !== user.id && !isStaff) delete safePost.moderation_reasons;
  return {
    post: {
      ...safePost, tags: parseJson(post.tags, []), courseRef: post.course_ref ? parseJson(post.course_ref, null) : null,
      liked: !!post.liked, moderationReasons: safePost.moderation_reasons ? parseJson(post.moderation_reasons, []) : [],
    },
    comments,
    canReview: isStaff && post.author_id !== user.id && post.status === 'pending',
  };
}

export function toggleLike(db: Db, user: AuthUser, postId: string) {
  const post = db.get<{ id: string; status: string; author_id: string }>('SELECT id, status, author_id FROM community_posts WHERE id = ?', [postId]);
  if (!post || post.status !== 'approved') throw notFound('内容不存在');
  const existing = db.get('SELECT 1 AS ok FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, user.id]);
  db.tx(() => {
    if (existing) {
      db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, user.id]);
      db.run('UPDATE community_posts SET like_count = MAX(0, like_count - 1) WHERE id = ?', [postId]);
    } else {
      db.run('INSERT INTO post_likes(post_id, user_id, created_at) VALUES(?,?,?)', [postId, user.id, nowIso()]);
      db.run('UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?', [postId]);
    }
  });
  return { liked: !existing, likeCount: db.get<{ c: number }>('SELECT like_count AS c FROM community_posts WHERE id = ?', [postId])?.c ?? 0 };
}

export function addComment(db: Db, user: AuthUser, postId: string, body: any) {
  const post = db.get<{ id: string; status: string }>('SELECT id, status FROM community_posts WHERE id = ?', [postId]);
  if (!post || post.status !== 'approved') throw notFound('内容不存在');
  const content = str(body?.content, { label: '评论', min: 2, max: 500 });
  const moderation = moderateComment(content);
  if (moderation.blocked || moderation.reasons.some(r => r.code === 'CONTACT' || r.code === 'PII')) {
    throw new AppError(422, 'CONTENT_REJECTED', '评论未通过安全审核', { reasons: moderation.reasons.map(r => r.label) });
  }
  const id = newId();
  db.run('INSERT INTO comments(id, post_id, user_id, content, status, created_at) VALUES(?,?,?,?,?,?)',
    [id, postId, user.id, content, 'approved', nowIso()]);
  return { id, status: 'approved' };
}

export function myPosts(db: Db, user: AuthUser) {
  return db.all<any>(
    'SELECT * FROM community_posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 50', [user.id],
  ).map(row => ({
    ...row,
    tags: parseJson(row.tags, []),
    courseRef: row.course_ref ? parseJson(row.course_ref, null) : null,
    moderationReasons: parseJson(row.moderation_reasons, []),
  }));
}

export function deletePost(db: Db, user: AuthUser, postId: string) {
  const post = db.get<{ id: string; author_id: string; status: string }>('SELECT id, author_id, status FROM community_posts WHERE id = ?', [postId]);
  if (!post) throw notFound('内容不存在');
  if (post.author_id !== user.id && user.role !== 'admin') throw forbidden('只能删除自己的内容');
  db.run('DELETE FROM community_posts WHERE id = ?', [postId]);
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'community.post.delete', entity: 'post', entityId: postId });
  return { deleted: true };
}

export function reportPost(db: Db, user: AuthUser, postId: string, body: any) {
  const post = db.get<{ id: string }>('SELECT id FROM community_posts WHERE id = ?', [postId]);
  if (!post) throw notFound('内容不存在');
  const reason = str(body?.reason, { label: '举报原因', min: 2, max: 300 });
  db.run('INSERT INTO post_reports(id, post_id, user_id, reason, status, created_at) VALUES(?,?,?,?,?,?)',
    [newId(), postId, user.id, reason, 'open', nowIso()]);
  audit(db, { householdId: user.householdId, actorId: user.id, action: 'community.post.report', entity: 'post', entityId: postId, detail: { reason } });
  return { reported: true, message: '已收到举报，管理员会尽快处理。' };
}

export function moderationQueue(db: Db, user: AuthUser, statusRaw?: string | null) {
  if (!['teacher', 'admin'].includes(user.role)) throw forbidden('需要审核权限');
  const status = statusRaw && ['pending', 'approved', 'rejected', 'hidden'].includes(statusRaw) ? statusRaw : 'pending';
  return db.all<any>(
    `SELECT p.*, u.name AS author_name, h.name AS household_name FROM community_posts p
     JOIN users u ON u.id = p.author_id JOIN households h ON h.id = p.household_id
     WHERE p.status = ? ORDER BY p.created_at ASC LIMIT 50`, [status],
  ).map(row => ({
    ...row, tags: parseJson(row.tags, []),
    courseRef: row.course_ref ? parseJson(row.course_ref, null) : null,
    moderationReasons: parseJson(row.moderation_reasons, []),
  }));
}

export function reviewPost(db: Db, reviewer: AuthUser, postId: string, body: any) {
  if (!['teacher', 'admin'].includes(reviewer.role)) throw forbidden('需要审核权限');
  const post = db.get<any>('SELECT * FROM community_posts WHERE id = ?', [postId]);
  if (!post) throw notFound('内容不存在');
  if (post.author_id === reviewer.id) throw forbidden('不能审核自己发布的内容');
  if (!['pending', 'approved', 'rejected'].includes(post.status)) throw validation('当前状态不可审核');
  const decision = oneOf(body?.decision, ['approve', 'reject', 'hide'] as const, '审核决定');
  const note = str(body?.note, { optional: true, max: 500, label: '审核意见' });
  if (decision === 'reject' && !note) throw validation('拒绝时需要填写审核意见，便于作者修改');
  const now = nowIso();
  const nextStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'hidden';
  db.tx(() => {
    db.run('UPDATE community_posts SET status = ?, updated_at = ?, published_at = ? WHERE id = ?',
      [nextStatus, now, nextStatus === 'approved' ? (post.published_at || now) : post.published_at, postId]);
    db.run('INSERT INTO post_reviews(id, post_id, reviewer_id, decision, note, created_at) VALUES(?,?,?,?,?,?)',
      [newId(), postId, reviewer.id, decision, note || '内容符合社区规范', now]);
    audit(db, { householdId: post.household_id, actorId: reviewer.id, action: `community.post.${decision}`, entity: 'post', entityId: postId, detail: { note } });
  });
  return { id: postId, status: nextStatus, note };
}

export function communityStats(db: Db) {
  const rows = db.all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM community_posts GROUP BY status');
  return Object.fromEntries(rows.map(r => [r.status, Number(r.c)]));
}

export function listReportsForAdmin(db: Db) {
  return db.all<any>(
    `SELECT r.*, p.title AS post_title, p.status AS post_status FROM post_reports r
     JOIN community_posts p ON p.id = r.post_id ORDER BY r.created_at DESC LIMIT 100`,
  );
}

export function resolveReport(db: Db, reviewer: AuthUser, reportId: string, body: any) {
  if (!['teacher', 'admin'].includes(reviewer.role)) throw forbidden('需要审核权限');
  const decision = oneOf(body?.decision, ['dismiss', 'hide'] as const, '处理决定');
  const report = db.get<any>('SELECT * FROM post_reports WHERE id = ?', [reportId]);
  if (!report) throw notFound('举报记录不存在');
  db.tx(() => {
    db.run('UPDATE post_reports SET status = ? WHERE id = ?', [decision === 'dismiss' ? 'dismissed' : 'resolved', reportId]);
    if (decision === 'hide') {
      db.run("UPDATE community_posts SET status = 'hidden', updated_at = ? WHERE id = ?", [nowIso(), report.post_id]);
      audit(db, { actorId: reviewer.id, action: 'community.post.hide_by_report', entity: 'post', entityId: report.post_id, detail: { reportId } });
    }
  });
  return { resolved: true };
}

export { bool, int };
