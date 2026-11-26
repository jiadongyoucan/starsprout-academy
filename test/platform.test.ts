import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, completeLesson, createTestApp, login, newUser, promote, type TestContext } from './helpers.ts';

describe('专家生态、连接器、看板与平台治理', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('教师发布公开专家需审核，通过后其他家庭可浏览、安装与使用', async () => {
    const teacher = await newUser(ctx.base);
    await promote(ctx.app, teacher.user.id, 'teacher');
    const parent = await newUser(ctx.base);
    const child = await addChild(ctx.base, parent.token);
    const created = await api(ctx.base, 'POST', '/api/registry/experts', {
      token: teacher.token,
      body: {
        name: '测试专家 · 绘本', title: '绘本共读导师', description: '用开放问题带孩子读绘本，关注表达与倾听。',
        systemPrompt: '你是绘本共读专家，每次给出 3 个开放式问题和一段共读脚本。',
        visibility: 'public', subjects: ['english', 'hanzi'], classCodes: ['junior', 'middle'],
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.status, 'pending_review');
    const beforeApprove = await api(ctx.base, 'GET', '/api/registry/experts', { token: parent.token });
    assert.ok(!beforeApprove.data.some((e: any) => e.id === created.data.id));

    const admin = await newUser(ctx.base);
    await promote(ctx.app, admin.user.id, 'admin');
    const queue = await api(ctx.base, 'GET', '/api/admin/registry/queue?type=expert', { token: admin.token });
    assert.ok(queue.data.some((e: any) => e.id === created.data.id));
    const approved = await api(ctx.base, 'POST', `/api/admin/registry/experts/${created.data.id}/review`, {
      token: admin.token, body: { decision: 'approve', note: '内容专业，符合儿童教育主题' },
    });
    assert.equal(approved.status, 200);
    const afterApprove = await api(ctx.base, 'GET', '/api/registry/experts', { token: parent.token });
    assert.ok(afterApprove.data.some((e: any) => e.id === created.data.id));

    const installed = await api(ctx.base, 'POST', `/api/registry/experts/${created.data.id}/install`, { token: parent.token });
    assert.equal(installed.status, 200);
    const session = await api(ctx.base, 'POST', '/api/agent/sessions', {
      token: parent.token, body: { agentKind: 'expert', expertId: created.data.id, title: '和绘本专家聊聊' },
    });
    assert.equal(session.status, 200);
    assert.equal(session.data.expert_id, created.data.id);
    const reply = await api(ctx.base, 'POST', `/api/agent/sessions/${session.data.id}/messages`, {
      token: parent.token, body: { content: `给${child.name}推荐一本小班绘本共读方法` },
    });
    assert.equal(reply.status, 200);
    assert.ok(reply.data.message.content.length > 20);
  });

  test('家长不能发布公开专家，但可以创建仅家庭可用专家', async () => {
    const parent = await newUser(ctx.base);
    const publicTry = await api(ctx.base, 'POST', '/api/registry/experts', {
      token: parent.token,
      body: { name: '公开尝试', title: '测试', description: '这是一个公开专家的测试描述内容。', systemPrompt: '你是测试专家，请给出简短建议。', visibility: 'public' },
    });
    assert.equal(publicTry.status, 403);
    const privateExpert = await api(ctx.base, 'POST', '/api/registry/experts', {
      token: parent.token,
      body: { name: '家庭专属专家', title: '家庭陪学', description: '只给本家庭使用的陪学专家。', systemPrompt: '你是家庭陪学专家，回答要短。', visibility: 'household' },
    });
    assert.equal(privateExpert.status, 200);
    assert.equal(privateExpert.data.status, 'published');
  });

  test('管理员不能审核自己发布的资源', async () => {
    const admin = await newUser(ctx.base);
    await promote(ctx.app, admin.user.id, 'admin');
    const created = await api(ctx.base, 'POST', '/api/registry/skills', {
      token: admin.token,
      body: {
        code: 'admin-skill', name: '管理员技能', description: '管理员创建的技能示例。', kind: 'prompt',
        definition: { template: '输出三条建议' }, visibility: 'public',
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.status, 'pending_review');
    const reviewOwn = await api(ctx.base, 'POST', `/api/admin/registry/skills/${created.data.id}/review`, {
      token: admin.token, body: { decision: 'approve' },
    });
    assert.equal(reviewOwn.status, 403);
  });

  test('内置连接器可调用真实课程检索；HTTP 连接器默认被允许列表阻止', async () => {
    const parent = await newUser(ctx.base);
    const builtin = await api(ctx.base, 'POST', '/api/registry/connectors', {
      token: parent.token,
      body: {
        name: '家庭工具箱', kind: 'builtin', description: '课程检索与计划建议', visibility: 'household',
        tools: [{ name: 'curriculum.search', description: '检索课程', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }],
      },
    });
    assert.equal(builtin.status, 200);
    const invoked = await api(ctx.base, 'POST', `/api/registry/connectors/${builtin.data.id}/invoke`, {
      token: parent.token, body: { tool: 'curriculum.search', args: { query: '钢琴' } },
    });
    assert.equal(invoked.status, 200);
    assert.ok(invoked.data.result.lessons.length >= 1);
    assert.ok(invoked.data.result.lessons[0].title);

    const httpConnector = await api(ctx.base, 'POST', '/api/registry/connectors', {
      token: parent.token,
      body: {
        name: '外部 HTTP 工具', kind: 'http', baseUrl: 'http://127.0.0.1:1/hook', authType: 'none',
        description: '用于验证 SSRF 防护', visibility: 'household',
        tools: [{ name: 'notify', description: '发送通知', input_schema: { type: 'object', properties: { msg: { type: 'string' } } } }],
      },
    });
    assert.equal(httpConnector.status, 200);
    const blocked = await api(ctx.base, 'POST', `/api/registry/connectors/${httpConnector.data.id}/invoke`, {
      token: parent.token, body: { tool: 'notify', args: { msg: 'hi' } },
    });
    assert.equal(blocked.status, 403);
    assert.ok(blocked.error.message.includes('CONNECTOR_ALLOWED_HOSTS'));
  });

  test('看板聚合真实完成数据并给出有依据的建议', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    await completeLesson(ctx.base, user.token, child.id, 'lsn_thinking_junior_u1_l1');
    await completeLesson(ctx.base, user.token, child.id, 'lsn_english_junior_u1_l1');
    const dash = await api(ctx.base, 'GET', `/api/analytics/dashboard?childId=${child.id}&range=week`, { token: user.token });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.metrics.completed, 2);
    assert.ok(dash.data.metrics.minutes > 0);
    assert.equal(dash.data.metrics.streak, 1);
    assert.ok(dash.data.series.length === 7);
    assert.ok(dash.data.insights.length >= 2);
    assert.ok(dash.data.insights.every((i: any) => i.text && !i.text.includes('NaN')));
    const overallSubjects = dash.data.overall.map((s: any) => s.code);
    assert.deepEqual(overallSubjects.sort(), ['english', 'hanzi', 'montessori', 'piano', 'thinking']);
  });

  test('周期报告可生成、落库并被再次读取；数据仅本家庭可见', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    await completeLesson(ctx.base, user.token, child.id, 'lsn_piano_junior_u1_l1');
    const generated = await api(ctx.base, 'POST', '/api/analytics/reports', {
      token: user.token, body: { childId: child.id, period: 'weekly' },
    });
    assert.equal(generated.status, 200);
    assert.ok(generated.data.summary.includes('1 个'));
    assert.ok(generated.data.highlights.length >= 2);
    assert.ok(generated.data.suggestions.length >= 2);
    assert.ok(['local-insight', 'llm-assisted'].includes(generated.data.engine));
    for (const period of ['daily', 'monthly']) {
      const extra = await api(ctx.base, 'POST', '/api/analytics/reports', { token: user.token, body: { childId: child.id, period } });
      assert.equal(extra.status, 200);
      assert.equal(extra.data.period, period);
    }
    const list = await api(ctx.base, 'GET', `/api/analytics/reports?childId=${child.id}`, { token: user.token });
    assert.equal(list.data.length, 3);
    const stranger = await newUser(ctx.base);
    const forbidden = await api(ctx.base, 'GET', `/api/analytics/reports?childId=${child.id}`, { token: stranger.token });
    assert.equal(forbidden.status, 404);
  });

  test('管理员可配置模型，看板与管理统计可用', async () => {
    const admin = await newUser(ctx.base);
    await promote(ctx.app, admin.user.id, 'admin');
    const created = await api(ctx.base, 'POST', '/api/admin/models', {
      token: admin.token,
      body: { name: '测试模型', provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'demo-model', apiKey: 'sk-test-123456', isDefault: true },
    });
    assert.equal(created.status, 200);
    assert.ok(created.data.models.some((m: any) => m.name === '测试模型' && m.configured));
    const models = await api(ctx.base, 'GET', '/api/agent/models', { token: admin.token });
    const createdModel = models.data.models.find((m: any) => m.name === '测试模型');
    assert.ok(createdModel);
    assert.ok(!JSON.stringify(models.data).includes('sk-test-123456'), 'API Key 不能回传');
    const overview = await api(ctx.base, 'GET', '/api/admin/overview', { token: admin.token });
    assert.equal(overview.status, 200);
    assert.ok(overview.data.users >= 1);
    assert.ok(overview.data.lessons >= 180);
    const audit = await api(ctx.base, 'GET', '/api/admin/audit', { token: admin.token });
    assert.ok(audit.data.length >= 1);
    const deleted = await api(ctx.base, 'DELETE', `/api/admin/models/${createdModel.id}`, { token: admin.token });
    assert.equal(deleted.status, 200);
  });

  test('管理员可以授予教师角色，但不能修改自己的角色', async () => {
    const admin = await newUser(ctx.base);
    await promote(ctx.app, admin.user.id, 'admin');
    const user = await newUser(ctx.base);
    const promoted = await api(ctx.base, 'PATCH', `/api/admin/users/${user.user.id}/role`, {
      token: admin.token, body: { role: 'teacher' },
    });
    assert.equal(promoted.status, 200);
    const me = await api(ctx.base, 'GET', '/api/auth/me', { token: user.token });
    assert.equal(me.data.user.role, 'teacher');
    const queue = await api(ctx.base, 'GET', '/api/admin/community/queue', { token: user.token });
    assert.equal(queue.status, 200);
    const self = await api(ctx.base, 'PATCH', `/api/admin/users/${admin.user.id}/role`, {
      token: admin.token, body: { role: 'parent' },
    });
    assert.equal(self.status, 403);
  });

  test('管理员重置密码后旧令牌失效，临时密码首次登录标记需改密', async () => {
    const teacher = await newUser(ctx.base);
    await promote(ctx.app, teacher.user.id, 'teacher');
    const admin = await newUser(ctx.base);
    await promote(ctx.app, admin.user.id, 'admin');
    const reset = await api(ctx.base, 'POST', `/api/admin/users/${teacher.user.id}/reset-password`, { token: admin.token });
    assert.equal(reset.status, 200);
    assert.ok(reset.data.temporaryPassword);
    const old = await api(ctx.base, 'GET', '/api/auth/me', { token: teacher.token });
    assert.equal(old.status, 401);
    const relogin = await login(ctx.base, teacher.email, reset.data.temporaryPassword);
    assert.equal(relogin.status, 200);
    assert.equal(relogin.data.user.mustChangePassword, true);
    const blocked = await api(ctx.base, 'GET', '/api/children', { token: relogin.data.token });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.error.code, 'PASSWORD_CHANGE_REQUIRED');
    const changed = await api(ctx.base, 'POST', '/api/auth/change-password', {
      token: relogin.data.token,
      body: { oldPassword: reset.data.temporaryPassword, newPassword: 'TeacherNew123!' },
    });
    assert.equal(changed.status, 200);
    const allowed = await api(ctx.base, 'GET', '/api/children', { token: changed.data.token });
    assert.equal(allowed.status, 200);
  });
});
