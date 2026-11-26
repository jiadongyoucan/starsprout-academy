import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, createTestApp, newUser, type TestContext } from './helpers.ts';

describe('温度文案：稳定、可换、场景相关且不越权', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('同一天同一场景返回稳定的一句，家长/儿童语气不同', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '温度测试' });
    const a = await api(ctx.base, 'GET', `/api/warmth?audience=parent&context=home&childId=${child.id}`, { token: user.token });
    const b = await api(ctx.base, 'GET', `/api/warmth?audience=parent&context=home&childId=${child.id}`, { token: user.token });
    assert.equal(a.status, 200);
    assert.equal(a.data.text, b.data.text);
    assert.equal(a.data.kind, b.data.kind);
    const childLine = await api(ctx.base, 'GET', `/api/warmth?audience=child&context=child&childId=${child.id}`, { token: user.token });
    assert.ok(['child_warm', 'child_brave', 'child_humor'].includes(childLine.data.kind));
    assert.notEqual(childLine.data.audience, 'parent');
  });

  test('低分使用 retry 文案，高分使用 praise；换一句不换语气', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '语气测试' });
    const low = await api(ctx.base, 'GET', `/api/warmth?audience=child&context=lesson&score=30&childId=${child.id}`, { token: user.token });
    const high = await api(ctx.base, 'GET', `/api/warmth?audience=child&context=lesson&score=95&childId=${child.id}`, { token: user.token });
    assert.equal(low.data.kind, 'lesson_retry');
    assert.equal(high.data.kind, 'lesson_praise');
    const before = await api(ctx.base, 'GET', `/api/warmth?audience=parent&context=home&childId=${child.id}`, { token: user.token });
    const fresh = await api(ctx.base, 'GET', `/api/warmth?audience=parent&context=home&childId=${child.id}&fresh=1&exclude=${encodeURIComponent(before.data.text)}`, { token: user.token });
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.data.text, before.data.text);
    assert.equal(fresh.data.kind, before.data.kind);
  });

  test('文案接口需要登录，不能读取别人家的孩子上下文', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '边界测试' });
    const anon = await api(ctx.base, 'GET', '/api/warmth?audience=parent&context=home');
    assert.equal(anon.status, 401);
    const stranger = await newUser(ctx.base);
    const cross = await api(ctx.base, 'GET', `/api/warmth?audience=parent&context=home&childId=${child.id}`, { token: stranger.token });
    assert.equal(cross.status, 403);
  });

  test('活动不足时不说幽默段子，家长密码可用于解锁儿童空间', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '低完成测试' });
    const low = await api(ctx.base, 'GET', `/api/warmth?audience=parent&context=home&childId=${child.id}&ok=0`, { token: user.token });
    assert.ok(['parent_warm', 'parent_selfcare'].includes(low.data.kind));
    const bad = await api(ctx.base, 'POST', '/api/auth/verify-password', { token: user.token, body: { password: 'wrong-pass' } });
    assert.equal(bad.status, 403);
    const good = await api(ctx.base, 'POST', '/api/auth/verify-password', { token: user.token, body: { password: user.password } });
    assert.equal(good.status, 200);
  });

  test('课时完成响应带一句具体鼓励', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '奖励温度' });
    const res = await api(ctx.base, 'POST', '/api/curriculum/lessons/lsn_thinking_junior_u1_l1/progress', {
      token: user.token, body: { childId: child.id, status: 'completed', seconds: 60 },
    });
    assert.equal(res.status, 200);
    assert.ok(typeof res.data.rewards.warmth === 'string' && res.data.rewards.warmth.length > 5);
  });
});
