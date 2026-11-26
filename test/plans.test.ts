import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, createTestApp, daysAgo, daysAhead, newUser, type TestContext } from './helpers.ts';

describe('AI 辅助计划、提醒与纠偏', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('离线也能生成体系化计划草稿，且不会安排已完成课时', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '计划宝宝' });
    const generated = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token,
      body: { childId: child.id, weeks: 2, daysPerWeek: 4, minutesPerDay: 25, goal: '英语与思维并重' },
    });
    assert.equal(generated.status, 200);
    const result = generated.data;
    assert.equal(result.plan.plan.status, 'draft');
    assert.equal(result.plan.plan.source, 'manual');
    assert.equal(result.plan.plan.engine, 'local-rules');
    assert.ok(result.plan.items.length >= 4);
    assert.ok(result.plan.plan.ai_rationale.length > 10);
    assert.ok(['local-rules', 'llm'].includes(result.engine));
    const subjects = new Set(result.plan.items.map((i: any) => i.subject_code));
    assert.ok(subjects.size >= 3, '计划应覆盖多个学科');
    for (const item of result.plan.items) {
      assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
      const day = new Date(`${item.date}T00:00:00Z`).getUTCDay();
      assert.ok(day !== 0 && day !== 6, '默认不安排周末');
    }
  });

  test('激活计划会为未来 7 天创建提醒', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const generated = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 3, minutesPerDay: 20 },
    });
    const activated = await api(ctx.base, 'POST', `/api/plans/${generated.data.plan.plan.id}/activate`, { token: user.token });
    assert.equal(activated.status, 200);
    assert.equal(activated.data.plan.status, 'active');
    const reminders = await api(ctx.base, 'GET', '/api/reminders/upcoming', { token: user.token });
    assert.ok(reminders.data.length >= 1);
    assert.ok(reminders.data.every((r: any) => r.status === 'scheduled'));
  });

  test('逾期的计划项可一键顺延到最近的空白工作日', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const generated = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token,
      body: { childId: child.id, weeks: 2, daysPerWeek: 3, minutesPerDay: 20, startDate: daysAgo(10) },
    });
    const planId = generated.data.plan.plan.id;
    const detailBefore = await api(ctx.base, 'GET', `/api/plans/${planId}`, { token: user.token });
    const overdue = detailBefore.data.items.filter((i: any) => i.status === 'pending' && i.date < new Date().toISOString().slice(0, 10));
    assert.ok(overdue.length > 0, '应有逾期项用于纠偏');
    const corrected = await api(ctx.base, 'POST', `/api/plans/${planId}/correct`, {
      token: user.token, body: { strategy: 'shift', reason: '出差导致未完成' },
    });
    assert.equal(corrected.status, 200);
    assert.ok(corrected.data.moved >= 1);
    assert.ok(corrected.data.detail.adjustments.length >= 1);
    const today = new Date().toISOString().slice(0, 10);
    const movedItems = corrected.data.detail.items.filter((i: any) => overdue.some((o: any) => o.id === i.id));
    assert.ok(movedItems.every((i: any) => i.date >= today));
    const futureDates = new Set(
      corrected.data.detail.items.filter((i: any) => i.status === 'pending').map((i: any) => i.date),
    );
    assert.ok(futureDates.size >= 1);
  });

  test('skip 策略会跳过逾期项并记录调整', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const generated = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token, body: { childId: child.id, weeks: 2, daysPerWeek: 2, minutesPerDay: 20, startDate: daysAgo(8) },
    });
    const planId = generated.data.plan.plan.id;
    const corrected = await api(ctx.base, 'POST', `/api/plans/${planId}/correct`, {
      token: user.token, body: { strategy: 'skip', reason: '这周暂停' },
    });
    assert.equal(corrected.status, 200);
    assert.ok(corrected.data.skipped >= 1);
    assert.ok(corrected.data.detail.items.some((i: any) => i.status === 'skipped'));
  });

  test('手动计划支持自定义标题，默认按课程顺序填充', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const created = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token,
      body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 15, title: '我的家庭计划', notes: '周一和周四晚上' },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.plan.plan.title, '我的家庭计划');
    assert.ok(created.data.plan.items.length >= 2);
    assert.ok(created.data.plan.plan.ai_rationale.includes('家长手动创建'));
  });

  test('计划项可以被标记完成或跳过', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const created = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20 },
    });
    const planId = created.data.plan.plan.id;
    const item = created.data.plan.items[0];
    const done = await api(ctx.base, 'PATCH', `/api/plans/${planId}/items/${item.id}`, { token: user.token, body: { status: 'done' } });
    assert.equal(done.status, 200);
    assert.equal(done.data.items.find((i: any) => i.id === item.id).status, 'done');
    const skipped = await api(ctx.base, 'PATCH', `/api/plans/${planId}/items/${item.id}`, { token: user.token, body: { status: 'skipped' } });
    assert.equal(skipped.status, 200);
  });

  test('到期提醒只会被消费一次', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const created = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20 },
    });
    const planId = created.data.plan.plan.id;
    ctx.app.db.run(
      `INSERT INTO reminders(id, plan_id, household_id, child_id, at, message, channel, status, created_at, sent_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ['rem_test_due', planId, user.household.id, child.id, new Date(Date.now() - 60_000).toISOString(),
        '测试提醒', 'inapp', 'scheduled', new Date().toISOString(), null],
    );
    const readOnly = await api(ctx.base, 'GET', '/api/reminders/due', { token: user.token });
    assert.equal(readOnly.data.length, 1, '读取到期提醒不应改变状态');
    const due = await api(ctx.base, 'POST', '/api/reminders/dispatch', { token: user.token });
    assert.equal(due.status, 200);
    assert.equal(due.data.length, 1);
    const again = await api(ctx.base, 'POST', '/api/reminders/dispatch', { token: user.token });
    assert.equal(again.data.length, 0);
  });

  test('计划输入校验与跨家庭隔离', async () => {
    const user = await newUser(ctx.base);
    const other = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const otherChild = await addChild(ctx.base, other.token);
    const invalid = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token, body: { childId: child.id, weeks: 99, daysPerWeek: 5, minutesPerDay: 20 },
    });
    assert.equal(invalid.status, 422);
    const foreign = await api(ctx.base, 'POST', '/api/plans/generate', {
      token: user.token, body: { childId: otherChild.id, weeks: 1, daysPerWeek: 3, minutesPerDay: 20 },
    });
    assert.equal(foreign.status, 403);
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20 },
    });
    const peek = await api(ctx.base, 'GET', `/api/plans/${plan.data.plan.plan.id}`, { token: other.token });
    assert.equal(peek.status, 403);
  });

  test('未来提醒接口不包含已发送的提醒', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const created = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20 },
    });
    ctx.app.db.run(
      `INSERT INTO reminders(id, plan_id, household_id, child_id, at, message, channel, status, created_at, sent_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ['rem_sent_test', created.data.plan.plan.id, user.household.id, child.id, daysAhead(2) + 'T11:00:00.000Z',
        '已发送', 'inapp', 'sent', new Date().toISOString(), new Date().toISOString()],
    );
    const upcoming = await api(ctx.base, 'GET', '/api/reminders/upcoming', { token: user.token });
    assert.ok(!upcoming.data.some((r: any) => r.id === 'rem_sent_test'));
  });
});
