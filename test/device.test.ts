import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  api, addChild, createTestApp, newUser, pairDevice, PNG_DATA_URL, promote, type TestContext,
} from './helpers.ts';

describe('多端联动：配对、推送、学习与摄像头照片', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('家长生成配对码，设备用一次性配对码换取设备令牌', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const codeResult = await api(ctx.base, 'POST', '/api/devices/pairing-code', {
      token: user.token, body: { name: '客厅 iPad', kind: 'ipad' },
    });
    assert.equal(codeResult.status, 200);
    assert.match(codeResult.data.code, /^\d{6}$/);
    assert.ok(codeResult.data.url.endsWith('/device'));
    assert.ok(codeResult.data.instructions.includes('10 分钟'));

    const wrong = await api(ctx.base, 'POST', '/api/device/pair', { body: { code: '999999', name: 'x', kind: 'ipad' } });
    assert.equal(wrong.status, 422);
    const pair = await api(ctx.base, 'POST', '/api/device/pair', {
      body: { code: codeResult.data.code, name: '客厅 iPad', kind: 'ipad' },
    });
    assert.equal(pair.status, 200);
    assert.ok(pair.data.token);
    assert.equal(pair.data.children.length, 1);
    assert.equal(pair.data.children[0].id, child.id);
    assert.equal(pair.data.children[0].cameraConsent, true);
    const reuse = await api(ctx.base, 'POST', '/api/device/pair', {
      body: { code: codeResult.data.code, name: '再次配对', kind: 'ipad' },
    });
    assert.equal(reuse.status, 422, '配对码必须一次性使用');
    // helper uses Bearer token, device token is not a user token; call raw via fetch
    const wrongGate = await fetch(`${ctx.base}/api/device/verify-parent`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pair.data.token}` },
      body: JSON.stringify({ password: 'definitely-wrong' }),
    });
    assert.equal(wrongGate.status, 403);
    const rightGate = await fetch(`${ctx.base}/api/device/verify-parent`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pair.data.token}` },
      body: JSON.stringify({ password: user.password }),
    });
    assert.equal(rightGate.status, 200);
  });

  test('家长推送计划，平板收件箱收到并可标记已打开', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const device = await pairDevice(ctx.base, user.token);
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20, title: '推送到平板' },
    });
    const planId = plan.data.plan.plan.id;
    const push = await api(ctx.base, 'POST', `/api/devices/${device.device.id}/push`, {
      token: user.token, body: { childId: child.id, planId, message: '今晚一起学 20 分钟' },
    });
    assert.equal(push.status, 200);
    const inbox = await api(ctx.base, 'GET', '/api/device/inbox', { token: device.token });
    assert.equal(inbox.status, 200);
    const received = inbox.data.pushes.find((p: any) => p.id === push.data.pushId);
    assert.ok(received);
    assert.equal(received.payload.kind, 'plan');
    assert.equal(received.status, 'delivered');
    const ack = await api(ctx.base, 'POST', `/api/device/pushes/${push.data.pushId}/ack`, {
      token: device.token, body: { status: 'opened' },
    });
    assert.equal(ack.status, 200);
    const planOnDevice = await api(ctx.base, 'GET', `/api/device/plans/${planId}`, { token: device.token });
    assert.equal(planOnDevice.status, 200);
    assert.ok(planOnDevice.data.items.length >= 2);
    assert.equal(planOnDevice.data.child.id, child.id);
    const lessonId = planOnDevice.data.items.find((i: any) => i.lesson_id).lesson_id;
    const lesson = await api(ctx.base, 'GET', `/api/device/lessons/${lessonId}`, { token: device.token });
    assert.equal(lesson.status, 200);
    assert.ok(lesson.data.lesson.blocks.length >= 5);
    const started = await api(ctx.base, 'POST', '/api/device/learning/start', {
      token: device.token, body: { childId: child.id, lessonId, planItemId: planOnDevice.data.items[0].id },
    });
    assert.equal(started.status, 200);
    const ended = await api(ctx.base, 'POST', `/api/device/learning/${started.data.sessionId}/end`, {
      token: device.token, body: { status: 'completed' },
    });
    assert.equal(ended.status, 200);
  });

  test('家长请求拍照，平板可以拒绝或上传；照片仅本家庭可读', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '拍照宝宝' });
    const device = await pairDevice(ctx.base, user.token, '学习 iPad');
    const requested = await api(ctx.base, 'POST', `/api/devices/${device.device.id}/request-photo`, {
      token: user.token, body: { childId: child.id, message: '让妈妈看看你在学什么' },
    });
    assert.equal(requested.status, 200);
    const inbox = await api(ctx.base, 'GET', '/api/device/inbox', { token: device.token });
    assert.ok(inbox.data.pushes.some((p: any) => p.payload.kind === 'photo_request'));

    const refused = await api(ctx.base, 'POST', '/api/device/snapshots', {
      token: device.token, body: { childId: child.id, image: PNG_DATA_URL, consent: false },
    });
    assert.equal(refused.status, 422);
    const saved = await api(ctx.base, 'POST', '/api/device/snapshots', {
      token: device.token, body: { childId: child.id, image: PNG_DATA_URL, note: '在学汉字', consent: true },
    });
    assert.equal(saved.status, 200);
    const list = await api(ctx.base, 'GET', `/api/snapshots?childId=${child.id}`, { token: user.token });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].note, '在学汉字');

    const image = await fetch(`${ctx.base}${list.data[0].imageUrl}`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await image.arrayBuffer());
    assert.ok(bytes.length > 100);
    assert.equal(bytes[0], 0x89);

    const stranger = await newUser(ctx.base);
    const forbidden = await fetch(`${ctx.base}${list.data[0].imageUrl}`, { headers: { authorization: `Bearer ${stranger.token}` } });
    assert.equal(forbidden.status, 404);
    const strangerList = await api(ctx.base, 'GET', `/api/snapshots?childId=${child.id}`, { token: stranger.token });
    assert.equal(strangerList.status, 404);

    const deleted = await api(ctx.base, 'DELETE', `/api/snapshots/${saved.data.id}`, { token: user.token });
    assert.equal(deleted.status, 200);
    const after = await api(ctx.base, 'GET', `/api/snapshots?childId=${child.id}`, { token: user.token });
    assert.equal(after.data.length, 0);
  });

  test('未授权摄像头的孩子无法被请求拍照或上传照片', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '无授权', consents: { camera: false, ai_processing: true } });
    const device = await pairDevice(ctx.base, user.token);
    const request = await api(ctx.base, 'POST', `/api/devices/${device.device.id}/request-photo`, {
      token: user.token, body: { childId: child.id },
    });
    assert.equal(request.status, 403);
    const upload = await api(ctx.base, 'POST', '/api/device/snapshots', {
      token: device.token, body: { childId: child.id, image: PNG_DATA_URL, consent: true },
    });
    assert.equal(upload.status, 403);
  });

  test('设备令牌不能访问家长接口；撤销后设备立即失效', async () => {
    const user = await newUser(ctx.base);
    await addChild(ctx.base, user.token);
    const device = await pairDevice(ctx.base, user.token);
    const asDevice = await api(ctx.base, 'GET', '/api/plans', { token: device.token });
    assert.equal(asDevice.status, 401);
    const revoke = await api(ctx.base, 'DELETE', `/api/devices/${device.device.id}`, { token: user.token });
    assert.equal(revoke.status, 200);
    const inbox = await api(ctx.base, 'GET', '/api/device/inbox', { token: device.token });
    assert.equal(inbox.status, 401);
  });

  test('管理员按保留期清理会同时删除数据库记录与磁盘文件', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const device = await pairDevice(ctx.base, user.token);
    await api(ctx.base, 'POST', '/api/device/snapshots', {
      token: device.token, body: { childId: child.id, image: PNG_DATA_URL, consent: true },
    });
    await promote(ctx.app, user.user.id, 'admin');
    const purge = await api(ctx.base, 'POST', '/api/privacy/snapshots/purge', { token: user.token, body: { days: 0 } });
    assert.equal(purge.status, 200);
    assert.ok(purge.data.removed >= 1);
    assert.equal(ctx.app.db.get('SELECT COUNT(*) AS c FROM snapshots')?.c, 0);
    const dir = `${ctx.dir}/snapshots`;
    assert.equal(fs.readdirSync(dir).filter(name => !name.startsWith('.')).length, 0);
    const invalid = await api(ctx.base, 'POST', '/api/privacy/snapshots/purge', { token: user.token, body: { days: -3 } });
    assert.equal(invalid.status, 422);
  });

  test('家长可以把照片批量清理（儿童隐私删除权）', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token);
    const device = await pairDevice(ctx.base, user.token);
    await api(ctx.base, 'POST', '/api/device/snapshots', {
      token: device.token, body: { childId: child.id, image: PNG_DATA_URL, consent: true },
    });
    const purge = await api(ctx.base, 'DELETE', `/api/children/${child.id}/snapshots`, { token: user.token });
    assert.equal(purge.status, 200);
    assert.equal(purge.data.removed, 1);
    const list = await api(ctx.base, 'GET', `/api/snapshots?childId=${child.id}`, { token: user.token });
    assert.equal(list.data.length, 0);
  });
});
