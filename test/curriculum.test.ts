import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, completeLesson, createTestApp, newUser, promote, type TestContext } from './helpers.ts';

describe('体系化课程与互动内容', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('四个学段 × 五个学科都有体系化框架，每门 9 个核心课时', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token, { name: '体系测试', classCode: 'junior' });
    const overview = await api(ctx.base, 'GET', '/api/curriculum/overview', { token: user.token });
    assert.equal(overview.status, 200);
    assert.equal(overview.data.frameworks.length, 5);
    for (const framework of overview.data.frameworks) {
      assert.ok(framework.unit_count >= 3, `${framework.subject_name} 至少 3 个单元`);
      assert.ok(framework.lesson_count >= 9, `${framework.subject_name} 至少 9 课时`);
    }
    for (const classCode of ['nursery', 'junior', 'middle', 'senior']) {
      const list = await api(ctx.base, 'GET', `/api/curriculum/frameworks?classCode=${classCode}`, { token: user.token });
      assert.equal(list.data.length, 5, `${classCode} 应有 5 个学科框架`);
    }
  });

  test('不同学段适配不同课程内容（课时 ID 与标题不重复）', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token);
    const nursery = await api(ctx.base, 'GET', '/api/curriculum/frameworks?classCode=nursery&subjectCode=thinking', { token: user.token });
    const senior = await api(ctx.base, 'GET', '/api/curriculum/frameworks?classCode=senior&subjectCode=thinking', { token: user.token });
    assert.notEqual(nursery.data[0].id, senior.data[0].id);
    const nurseryDetail = await api(ctx.base, 'GET', `/api/curriculum/frameworks/${nursery.data[0].id}`, { token: user.token });
    const seniorDetail = await api(ctx.base, 'GET', `/api/curriculum/frameworks/${senior.data[0].id}`, { token: user.token });
    const nurseryTitles = nurseryDetail.data.units.flatMap((u: any) => u.lessons.map((l: any) => l.title));
    const seniorTitles = seniorDetail.data.units.flatMap((u: any) => u.lessons.map((l: any) => l.title));
    assert.notDeepEqual(nurseryTitles, seniorTitles);
    assert.ok(nurseryTitles.includes('圆形朋友'));
    assert.ok(seniorTitles.includes('凑十法'));
  });

  test('互动式课时包含听、说、读、写/弹奏等多样 block', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token);
    const english = await api(ctx.base, 'GET', '/api/curriculum/lessons/lsn_english_junior_u1_l1', { token: user.token });
    assert.equal(english.status, 200);
    const englishTypes = english.data.lesson.blocks.map((b: any) => b.type);
    assert.ok(englishTypes.includes('listen'));
    assert.ok(englishTypes.includes('speak'));
    assert.ok(englishTypes.includes('quiz'));

    const hanzi = await api(ctx.base, 'GET', '/api/curriculum/lessons/lsn_hanzi_junior_u1_l1', { token: user.token });
    assert.ok(hanzi.data.lesson.blocks.some((b: any) => b.type === 'trace' && b.char));
    const piano = await api(ctx.base, 'GET', '/api/curriculum/lessons/lsn_piano_junior_u3_l1', { token: user.token });
    assert.ok(piano.data.lesson.blocks.some((b: any) => b.type === 'piano'));
    const thinking = await api(ctx.base, 'GET', '/api/curriculum/lessons/lsn_thinking_junior_u2_l1', { token: user.token });
    assert.ok(thinking.data.lesson.blocks.some((b: any) => b.type === 'match'));
  });

  test('公开课程包带有来源、许可证与真实资源链接', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token);
    const sources = await api(ctx.base, 'GET', '/api/curriculum/sources', { token: user.token });
    assert.equal(sources.status, 200);
    assert.ok(sources.data.sources.length >= 4);
    const packs = sources.data.packs;
    assert.ok(packs.length >= 4);
    for (const pack of packs) {
      assert.ok(pack.license);
      assert.ok(pack.checksum);
      assert.equal(pack.status, 'active');
    }
    const packLesson = await api(ctx.base, 'GET', '/api/curriculum/lessons/lsn_pack_oer-counting_u1_l1', { token: user.token });
    assert.equal(packLesson.status, 200);
    assert.ok(packLesson.data.lesson.source);
    assert.equal(packLesson.data.lesson.source.name, 'OER Commons 开放教育资源库');
    assert.ok(packLesson.data.lesson.source.license.includes('CC BY'));
    assert.ok(packLesson.data.lesson.blocks.some((b: any) => b.type === 'resource'));
  });

  test('完成课时写入进度，并联动计划项标记完成', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20, title: '联动计划' },
    });
    const item = plan.data.plan.items[0];
    const lessonId = item.lesson_id;
    const before = await api(ctx.base, 'GET', '/api/curriculum/overview', { token: user.token });
    const beforeCompleted = before.data.summary.reduce((sum: number, s: any) => sum + s.completed, 0);
    const result = await completeLesson(ctx.base, user.token, child.id, lessonId, { planItemId: item.id });
    assert.equal(result.status, 200);
    assert.equal(result.data.progress.status, 'completed');
    const after = await api(ctx.base, 'GET', '/api/curriculum/overview', { token: user.token });
    const afterCompleted = after.data.summary.reduce((sum: number, s: any) => sum + s.completed, 0);
    assert.equal(afterCompleted, beforeCompleted + 1);
    const detail = await api(ctx.base, 'GET', `/api/plans/${plan.data.plan.plan.id}`, { token: user.token });
    const updated = detail.data.items.find((i: any) => i.id === item.id);
    assert.equal(updated.status, 'done');
    assert.ok(updated.completed_at);
  });

  test('重复完成不会重复计数，非法分数被校验', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const first = await completeLesson(ctx.base, user.token, child.id, 'lsn_thinking_junior_u1_l1');
    assert.equal(first.status, 200);
    const second = await completeLesson(ctx.base, user.token, child.id, 'lsn_thinking_junior_u1_l1');
    assert.equal(second.status, 200);
    const overview = await api(ctx.base, 'GET', '/api/curriculum/overview', { token: user.token });
    const thinking = overview.data.summary.find((s: any) => s.subjectCode === 'thinking');
    assert.equal(thinking.completed, 1);
    const invalid = await api(ctx.base, 'POST', '/api/curriculum/lessons/lsn_thinking_junior_u1_l1/progress', {
      token: user.token, body: { childId: child.id, status: 'completed', score: 999 },
    });
    assert.equal(invalid.status, 422);
  });

  test('公开课源同步幂等，管理员可查看课程包版本', async () => {
    const user = await newUser(ctx.base);
    await promote(ctx.app, user.user.id, 'admin');
    const sync = await api(ctx.base, 'POST', '/api/admin/sources/sync', { token: user.token });
    assert.equal(sync.status, 200);
    assert.equal(sync.data.length, 4);
    assert.ok(sync.data.every((r: any) => r.status === 'skipped'));
    const packs = await api(ctx.base, 'GET', '/api/admin/packs', { token: user.token });
    assert.ok(packs.data.packs.length >= 4);
    assert.ok(packs.data.sources.every((s: any) => s.license));
  });

  test('不存在的课时返回 404，未授权孩子返回 403', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token);
    const missing = await api(ctx.base, 'GET', '/api/curriculum/lessons/not-a-lesson', { token: user.token });
    assert.equal(missing.status, 404);
    const other = await newUser(ctx.base);
    const otherChild = await addChild(ctx.base, other.token);
    const forbidden = await api(ctx.base, 'GET', `/api/curriculum/lessons/lsn_english_junior_u1_l1?childId=${otherChild.id}`, { token: user.token });
    assert.equal(forbidden.status, 403);
  });
});
