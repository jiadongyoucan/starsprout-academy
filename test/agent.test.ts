import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, createTestApp, newUser, type TestContext } from './helpers.ts';

process.env.ENABLE_SANDBOX = 'true';

describe('智能体会话、记忆、工作区与沙箱', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('创建会话并列出，默认模型为本地规则引擎时仍可排课', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const session = await api(ctx.base, 'POST', '/api/agent/sessions', {
      token: user.token, body: { agentKind: 'planner', title: '测试排课' },
    });
    assert.equal(session.status, 200);
    assert.equal(session.data.agent_kind, 'planner');
    const list = await api(ctx.base, 'GET', '/api/agent/sessions', { token: user.token });
    assert.equal(list.data.length, 1);
    const reply = await api(ctx.base, 'POST', `/api/agent/sessions/${session.data.id}/messages`, {
      token: user.token,
      body: { content: `给${child.name}排两周计划，每周3天，每天20分钟，重点是英语` },
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.data.engine, 'local-rules');
    const toolNames = reply.data.tools.map((t: any) => t.name);
    assert.ok(toolNames.includes('create_plan'));
    assert.ok(reply.data.message.content.includes('计划'));
    const plans = await api(ctx.base, 'GET', '/api/plans', { token: user.token });
    assert.ok(plans.data.some((p: any) => p.source === 'ai' && p.status === 'draft'));
    const refreshed = await api(ctx.base, 'GET', `/api/agent/sessions/${session.data.id}`, { token: user.token });
    assert.ok(refreshed.data.messages.length >= 2);
    assert.ok(refreshed.data.messages[0].content.includes('排两周计划'));
  });

  test('会话不能跨家庭读取', async () => {
    const alice = await newUser(ctx.base);
    await addChild(ctx.base, alice.token);
    const session = await api(ctx.base, 'POST', '/api/agent/sessions', { token: alice.token, body: {} });
    const bob = await newUser(ctx.base);
    const peek = await api(ctx.base, 'GET', `/api/agent/sessions/${session.data.id}`, { token: bob.token });
    assert.equal(peek.status, 404);
    const post = await api(ctx.base, 'POST', `/api/agent/sessions/${session.data.id}/messages`, { token: bob.token, body: { content: 'hi' } });
    assert.equal(post.status, 404);
  });

  test('“记住”指令写入长期记忆，可查看并清除', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token);
    const session = await api(ctx.base, 'POST', '/api/agent/sessions', { token: user.token, body: {} });
    await api(ctx.base, 'POST', `/api/agent/sessions/${session.data.id}/messages`, {
      token: user.token, body: { content: '请记住：每周三和周六不排计划，孩子要上游泳课。' },
    });
    const memory = await api(ctx.base, 'GET', '/api/agent/memory', { token: user.token });
    assert.ok(memory.data.some((m: any) => m.value.includes('游泳课')));
    const cleared = await api(ctx.base, 'DELETE', '/api/privacy/memory', { token: user.token });
    assert.equal(cleared.status, 200);
    assert.ok(cleared.data.memoriesRemoved >= 1);
    const after = await api(ctx.base, 'GET', '/api/agent/memory', { token: user.token });
    assert.equal(after.data.length, 0);
  });

  test('工作区可保存/读取文件，拒绝路径穿越', async () => {
    const user = await newUser(ctx.base);
    const session = await api(ctx.base, 'POST', '/api/agent/sessions', { token: user.token, body: {} });
    const good = await api(ctx.base, 'PUT', `/api/agent/sessions/${session.data.id}/files`, {
      token: user.token, body: { path: 'drafts/我的教案.md', content: '# 教案\n\n听一听，说一说。' },
    });
    assert.equal(good.status, 200);
    const list = await api(ctx.base, 'GET', `/api/agent/sessions/${session.data.id}/files`, { token: user.token });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].path, 'drafts/我的教案.md');
    assert.equal(list.data[0].version, 1);
    const updated = await api(ctx.base, 'PUT', `/api/agent/sessions/${session.data.id}/files`, {
      token: user.token, body: { path: 'drafts/我的教案.md', content: '# 教案 v2' },
    });
    assert.equal(updated.data.version, 2);
    const traversal = await api(ctx.base, 'PUT', `/api/agent/sessions/${session.data.id}/files`, {
      token: user.token, body: { path: '../evil.md', content: 'x' },
    });
    assert.equal(traversal.status, 422);
    const absolute = await api(ctx.base, 'PUT', `/api/agent/sessions/${session.data.id}/files`, {
      token: user.token, body: { path: '/etc/passwd', content: 'x' },
    });
    assert.equal(absolute.status, 422);
    const deleted = await api(ctx.base, 'DELETE', `/api/agent/sessions/${session.data.id}/files/${list.data[0].id}`, { token: user.token });
    assert.equal(deleted.status, 200);
  });

  test('沙箱执行代码并返回输出，进程/require 不可用', async () => {
    const user = await newUser(ctx.base);
    const ok = await api(ctx.base, 'POST', '/api/agent/sandbox', {
      token: user.token, body: { code: 'console.log(2+3); "done"' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'ok');
    assert.ok(ok.data.output.includes('5'));
    assert.ok(ok.data.output.includes('done'));
    const denied = await api(ctx.base, 'POST', '/api/agent/sandbox', {
      token: user.token, body: { code: 'console.log(typeof require, typeof process)' },
    });
    assert.equal(denied.data.status, 'ok');
    assert.ok(denied.data.output.includes('undefined undefined'));
  });

  test('沙箱无法逃逸到宿主 process / 文件系统', async () => {
    const user = await newUser(ctx.base);
    const escaped = await api(ctx.base, 'POST', '/api/agent/sandbox', {
      token: user.token,
      body: { code: `try { const p = Math.constructor.constructor('return process')(); console.log(typeof p); } catch (e) { console.log('ESCAPE_BLOCKED'); }` },
    });
    assert.equal(escaped.status, 200);
    assert.ok(escaped.data.output.includes('ESCAPE_BLOCKED'), escaped.data.output);
    const fileRead = await api(ctx.base, 'POST', '/api/agent/sandbox', {
      token: user.token,
      body: { code: `try { const p = console.log.constructor.constructor('return process')(); const fs = p.mainModule.require('fs'); console.log(fs.readFileSync('/etc/passwd','utf8')); } catch (e) { console.log('BLOCKED', e.name); }` },
    });
    assert.ok(!fileRead.data.output.includes('root:'), fileRead.data.output);
  });

  test('沙箱默认关闭，需显式开启', async () => {
    const user = await newUser(ctx.base);
    const previous = process.env.ENABLE_SANDBOX;
    process.env.ENABLE_SANDBOX = 'false';
    const denied = await api(ctx.base, 'POST', '/api/agent/sandbox', { token: user.token, body: { code: 'console.log(1)' } });
    process.env.ENABLE_SANDBOX = previous;
    assert.equal(denied.status, 403);
    assert.ok(denied.error.message.includes('默认关闭'));
  });

  test('沙箱超时会被终止', async () => {
    const user = await newUser(ctx.base);
    const started = Date.now();
    const result = await api(ctx.base, 'POST', '/api/agent/sandbox', {
      token: user.token, body: { code: 'while (true) {}' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'timeout');
    assert.ok(Date.now() - started < 6000);
  });

  test('模型列表与工具清单可读，家长不能配置模型', async () => {
    const user = await newUser(ctx.base);
    const models = await api(ctx.base, 'GET', '/api/agent/models', { token: user.token });
    assert.equal(models.status, 200);
    assert.ok(Array.isArray(models.data.models));
    assert.ok(models.data.localAvailable);
    const tools = await api(ctx.base, 'GET', '/api/agent/tools', { token: user.token });
    assert.ok(tools.data.some((t: any) => t.name === 'create_plan'));
    assert.ok(tools.data.some((t: any) => t.name === 'sandbox_run'));
    const create = await api(ctx.base, 'POST', '/api/admin/models', {
      token: user.token,
      body: { name: '我的模型', provider: 'openai', baseUrl: 'https://api.example.com', model: 'gpt-x', apiKey: 'sk-test' },
    });
    assert.equal(create.status, 403);
  });

  test('报告类对话返回真实看板摘要', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const session = await api(ctx.base, 'POST', '/api/agent/sessions', { token: user.token, body: {} });
    const reply = await api(ctx.base, 'POST', `/api/agent/sessions/${session.data.id}/messages`, {
      token: user.token, body: { content: `${child.name}这周学得怎么样？` },
    });
    assert.equal(reply.status, 200);
    assert.ok(reply.data.message.content.includes(child.name));
    assert.ok(reply.data.tools.some((t: any) => t.name === 'report_progress'));
  });
});
