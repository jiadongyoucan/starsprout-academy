import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, createTestApp, login, newUser, promote, type TestContext } from './helpers.ts';

describe('身份认证、RBAC 与家庭隔离', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('空数据库首次初始化：只允许创建一位管理员', async () => {
    const meta = await api(ctx.base, 'GET', '/api/meta');
    assert.equal(meta.data.setupRequired, true);
    assert.equal(meta.data.demoAccounts.length, 0);
    const setup = await api(ctx.base, 'POST', '/api/setup', {
      body: { name: '初始管理员', email: 'root@test.dev', password: 'RootPassw0rd!', householdName: '平台管理' },
    });
    assert.equal(setup.status, 200);
    assert.equal(setup.data.user.role, 'admin');
    const again = await api(ctx.base, 'POST', '/api/setup', {
      body: { name: '第二管理员', email: 'root2@test.dev', password: 'RootPassw0rd!' },
    });
    assert.equal(again.status, 409);
    const metaAfter = await api(ctx.base, 'GET', '/api/meta');
    assert.equal(metaAfter.data.setupRequired, false);
  });

  test('注册后返回令牌、家庭与空孩子列表，并能读取 /me', async () => {
    const user = await newUser(ctx.base, { name: '林妈妈' });
    assert.ok(user.token.length > 30);
    assert.equal(user.user.role, 'parent');
    assert.ok(user.household.id);
    const me = await api(ctx.base, 'GET', '/api/auth/me', { token: user.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, user.email);
    assert.deepEqual(me.data.children, []);
  });

  test('弱密码与重复邮箱被拒绝', async () => {
    const weak = await api(ctx.base, 'POST', '/api/auth/register', { body: { email: 'weak@test.dev', password: '123', name: '弱密码' } });
    assert.equal(weak.status, 422);
    assert.equal(weak.error.code, 'VALIDATION_ERROR');
    const user = await newUser(ctx.base);
    const duplicate = await api(ctx.base, 'POST', '/api/auth/register', {
      body: { email: user.email, password: 'Passw0rd!', name: '重复' },
    });
    assert.equal(duplicate.status, 409);
  });

  test('错误密码登录失败，正确密码可登录', async () => {
    const user = await newUser(ctx.base);
    const bad = await login(ctx.base, user.email, 'WrongPass1!');
    assert.equal(bad.status, 401);
    const good = await login(ctx.base, user.email, user.password);
    assert.equal(good.status, 200);
    assert.ok(good.data.token);
  });

  test('登出后旧令牌立即失效', async () => {
    const user = await newUser(ctx.base);
    const out = await api(ctx.base, 'POST', '/api/auth/logout', { token: user.token });
    assert.equal(out.status, 200);
    const me = await api(ctx.base, 'GET', '/api/auth/me', { token: user.token });
    assert.equal(me.status, 401);
  });

  test('修改密码会吊销全部旧会话，并签发新令牌', async () => {
    const user = await newUser(ctx.base);
    const changed = await api(ctx.base, 'POST', '/api/auth/change-password', {
      token: user.token,
      body: { oldPassword: user.password, newPassword: 'NewPassw0rd!' },
    });
    assert.equal(changed.status, 200);
    assert.ok(changed.data.token);
    const oldMe = await api(ctx.base, 'GET', '/api/auth/me', { token: user.token });
    assert.equal(oldMe.status, 401);
    const newMe = await api(ctx.base, 'GET', '/api/auth/me', { token: changed.data.token });
    assert.equal(newMe.status, 200);
    const oldLogin = await login(ctx.base, user.email, user.password);
    assert.equal(oldLogin.status, 401);
  });

  test('未认证访问用户接口返回 401', async () => {
    const result = await api(ctx.base, 'GET', '/api/children');
    assert.equal(result.status, 401);
  });

  test('家庭隔离：不能读取其他家庭孩子的看板/计划/照片', async () => {
    const alice = await newUser(ctx.base);
    const bob = await newUser(ctx.base);
    const child = await addChild(ctx.base, alice.token, { name: 'Alice宝宝' });
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: alice.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20, title: 'Alice计划' },
    });
    assert.equal(plan.status, 200);

    const dash = await api(ctx.base, 'GET', `/api/analytics/dashboard?childId=${child.id}`, { token: bob.token });
    assert.equal(dash.status, 404);
    const snapshotList = await api(ctx.base, 'GET', `/api/snapshots?childId=${child.id}`, { token: bob.token });
    assert.equal(snapshotList.status, 404);
    const readPlan = await api(ctx.base, 'GET', `/api/plans/${plan.data.plan.plan.id}`, { token: bob.token });
    assert.equal(readPlan.status, 404);
    const curriculum = await api(ctx.base, 'GET', `/api/curriculum/lessons/lsn_thinking_junior_u1_l1?childId=${child.id}`, { token: bob.token });
    assert.equal(curriculum.status, 404);
  });

  test('孩子档案创建、更新与授权开关', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '豆豆', classCode: 'middle', consents: { camera: false } });
    assert.equal(child.class_code, 'middle');
    const consents = await api(ctx.base, 'GET', `/api/children/${child.id}/consents`, { token: user.token });
    const camera = consents.data.find((c: any) => c.kind === 'camera');
    assert.equal(camera.granted, false);
    const toggled = await api(ctx.base, 'PUT', `/api/children/${child.id}/consents/camera`, { token: user.token, body: { granted: true } });
    assert.equal(toggled.status, 200);
    const afterToggle = await api(ctx.base, 'GET', `/api/children/${child.id}/consents`, { token: user.token });
    assert.equal(afterToggle.data.find((c: any) => c.kind === 'camera').granted, true);
    const updated = await api(ctx.base, 'PATCH', `/api/children/${child.id}`, { token: user.token, body: { name: '豆豆宝', classCode: 'senior' } });
    assert.equal(updated.data.name, '豆豆宝');
    assert.equal(updated.data.class_code, 'senior');
  });

  test('隐私导出包含真实数据且不包含照片原图', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const exported = await api(ctx.base, 'GET', `/api/privacy/export?childId=${child.id}`, { token: user.token });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.child.id, child.id);
    assert.ok(Array.isArray(exported.data.progress));
    assert.ok(Array.isArray(exported.data.consents));
    assert.ok(!JSON.stringify(exported.data).includes('data:image'));
  });

  test('删除孩子档案需要显式确认，删除后不可再访问', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '待删除' });
    const withoutConfirm = await api(ctx.base, 'DELETE', `/api/children/${child.id}`, { token: user.token, body: {} });
    assert.equal(withoutConfirm.status, 422);
    const deleted = await api(ctx.base, 'DELETE', `/api/children/${child.id}`, { token: user.token, body: { confirm: true } });
    assert.equal(deleted.status, 200);
    const list = await api(ctx.base, 'GET', '/api/children', { token: user.token });
    assert.equal(list.data.length, 0);
    const dash = await api(ctx.base, 'GET', `/api/analytics/dashboard?childId=${child.id}`, { token: user.token });
    assert.equal(dash.status, 404);
  });

  test('撤回学习分析授权后，看板返回明确错误', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const revoke = await api(ctx.base, 'PUT', `/api/children/${child.id}/consents/analytics`, { token: user.token, body: { granted: false } });
    assert.equal(revoke.status, 200);
    const dash = await api(ctx.base, 'GET', `/api/analytics/dashboard?childId=${child.id}`, { token: user.token });
    assert.equal(dash.status, 403);
    assert.equal(dash.error.code, 'CONSENT_REQUIRED');
    await api(ctx.base, 'PUT', `/api/children/${child.id}/consents/analytics`, { token: user.token, body: { granted: true } });
    const ok = await api(ctx.base, 'GET', `/api/analytics/dashboard?childId=${child.id}`, { token: user.token });
    assert.equal(ok.status, 200);
  });

  test('家庭创建者可彻底删除家庭数据，删除后账号停用', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '将被删除' });
    await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20 },
    });
    const refused = await api(ctx.base, 'DELETE', '/api/privacy/household', { token: user.token, body: {} });
    assert.equal(refused.status, 422);
    const erased = await api(ctx.base, 'DELETE', '/api/privacy/household', { token: user.token, body: { confirm: true } });
    assert.equal(erased.status, 200);
    assert.ok(erased.data.deleted.children >= 1);
    const me = await api(ctx.base, 'GET', '/api/auth/me', { token: user.token });
    assert.equal(me.status, 401);
    const relogin = await login(ctx.base, user.email, user.password);
    assert.equal(relogin.status, 403);
  });

  test('管理员接口对家长返回 403', async () => {
    const user = await newUser(ctx.base);
    const overview = await api(ctx.base, 'GET', '/api/admin/overview', { token: user.token });
    assert.equal(overview.status, 403);
    const users = await api(ctx.base, 'GET', '/api/admin/users', { token: user.token });
    assert.equal(users.status, 403);
  });

  test('提升为教师后可访问审核队列', async () => {
    const user = await newUser(ctx.base);
    await promote(ctx.app, user.user.id, 'teacher');
    const queue = await api(ctx.base, 'GET', '/api/admin/community/queue', { token: user.token });
    assert.equal(queue.status, 200);
    assert.ok(Array.isArray(queue.data));
  });

  test('自助停用账号后无法再登录，旧令牌失效', async () => {
    const user = await newUser(ctx.base);
    const disabled = await api(ctx.base, 'DELETE', '/api/privacy/account', { token: user.token });
    assert.equal(disabled.status, 200);
    const me = await api(ctx.base, 'GET', '/api/auth/me', { token: user.token });
    assert.equal(me.status, 401);
    const relogin = await login(ctx.base, user.email, user.password);
    assert.equal(relogin.status, 403);
    assert.equal(relogin.error.code, 'ACCOUNT_DISABLED');
  });
});
