import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, createTestApp, newUser, type TestContext } from './helpers.ts';
import { moderateContent } from '../src/modules/moderation.ts';

describe('Gap 修复回归：审核、模态、元数据与计划诚实性', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('审核变体：斜杠/软连字符/繁体/分隔手机号全部阻断，正常内容放行', () => {
    for (const text of ['色/情', '加/微信', '138/0013/8000', '色\u00AD情', '賭博網站', '裸/聊', '加 微 信']) {
      assert.equal(moderateContent(text).blocked, true, text);
    }
    for (const text of ['今天带孩子读了绘本，他很喜欢。', '孩子第一次自己系鞋带，我们都很开心。', '请问小班的英语课怎么安排？']) {
      assert.equal(moderateContent(text).blocked, false, text);
    }
  });

  test('每节课都有听/说，思维与蒙氏也有多模态', () => {
    const rows = ctx.app.db.all<{ subject_code: string; blocks: string }>(
      `SELECT f.subject_code, l.blocks FROM lessons l JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id WHERE l.is_published = 1`,
    );
    assert.ok(rows.length >= 192);
    for (const row of rows) {
      const blocks = JSON.parse(row.blocks);
      assert.ok(blocks.some((b: any) => b.type === 'listen'), `${row.subject_code} missing listen`);
      assert.ok(blocks.some((b: any) => b.type === 'speak'), `${row.subject_code} missing speak`);
    }
  });

  test('公开课包 checksum 是真实 sha256，且有版本快照', () => {
    const pack = ctx.app.db.get<{ checksum: string }>('SELECT checksum FROM course_packs LIMIT 1');
    assert.ok(pack);
    assert.match(pack.checksum, /^[a-f0-9]{64}$/);
    assert.ok(Number(ctx.app.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM lesson_versions')?.c || 0) > 0);
  });

  test('课时元数据与前置关系已落地', () => {
    const lesson = ctx.app.db.get<any>('SELECT * FROM lessons WHERE id = ?', ['lsn_thinking_junior_u1_l2']);
    assert.ok(lesson.key_points.length > 0);
    assert.ok(lesson.hard_points.length > 0);
    assert.ok(lesson.home_extension.length > 0);
    assert.equal(lesson.prereq_lesson_id, 'lsn_thinking_junior_u1_l1');
  });

  test('评论进入审核队列，审核通过后才公开', async () => {
    const author = await newUser(ctx.base);
    const child = await addChild(ctx.base, author.token, { name: '评论测试' });
    const post = await api(ctx.base, 'POST', '/api/community/posts', {
      token: author.token, body: { type: 'insight', title: '一条可审核的分享', content: '今天和孩子一起读了绘本，孩子很喜欢，想和大家交流一下。' },
    });
    assert.equal(post.status, 200);
    ctx.app.db.run("UPDATE community_posts SET status = 'approved', published_at = ? WHERE id = ?", [new Date().toISOString(), post.data.id]);
    const comment = await api(ctx.base, 'POST', `/api/community/posts/${post.data.id}/comments`, {
      token: author.token, body: { content: '这是一条正常的评论，应该先审核。' },
    });
    assert.equal(comment.status, 200);
    assert.equal(comment.data.status, 'pending');
    const detail = await api(ctx.base, 'GET', `/api/community/posts/${post.data.id}`, { token: author.token });
    assert.equal(detail.data.comments.length, 0, '待审评论不应公开');
    // 另一位 staff 审核
    const reviewer = await newUser(ctx.base);
    ctx.app.db.run("UPDATE users SET role = 'admin' WHERE id = ?", [reviewer.user.id]);
    const queue = await api(ctx.base, 'GET', '/api/admin/community/comments?status=pending', { token: reviewer.token });
    assert.equal(queue.status, 200);
    assert.ok(queue.data.some((row: any) => row.id === comment.data.id));
    const reviewed = await api(ctx.base, 'POST', `/api/admin/community/comments/${comment.data.id}/review`, {
      token: reviewer.token, body: { decision: 'approve' },
    });
    assert.equal(reviewed.status, 200);
    const after = await api(ctx.base, 'GET', `/api/community/posts/${post.data.id}`, { token: author.token });
    assert.equal(after.data.comments.length, 1);
    void child;
  });

  test('无 AI Key 时计划不冒充 AI，单课超限有诚实标注', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '计划诚实性' });
    const plan = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 3, minutesPerDay: 15 },
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.data.engine, 'local-rules');
    assert.equal(plan.data.plan.plan.engine, 'local-rules');
    const over = plan.data.plan.items.filter((item: any) => item.minutes > 15);
    assert.ok(over.length >= 1, '应排到至少一节超过 15 分钟的课');
    assert.ok(over.every((item: any) => typeof item.note === 'string' && item.note.includes('超过每日')), '超限必须诚实标注');
    assert.ok(!plan.data.plan.plan.ai_rationale.includes('每天不超过 15 分钟'));
  });

  test('星芽披风是计划奖励，不在小铺出售', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '披风测试' });
    const pet = await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'bunny', name: '小云' } });
    assert.equal(pet.status, 200);
    assert.equal(pet.data.shop.some((item: any) => item.code === 'star-cape'), false);
  });
});
