import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, createTestApp, newUser, promote, type TestContext } from './helpers.ts';

const CLEAN = '每天晚饭后放十分钟英文儿歌，不要求跟读，孩子慢慢会自己哼。坚持两周后，孩子开始主动问单词意思了。';

describe('社区广场、内容审核与审批状态机', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('新发布内容进入待审核，未审核不出现在 feed；作者可见自己的状态', async () => {
    const user = await newUser(ctx.base);
    const created = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token, body: { type: 'insight', title: '我们的英语磨耳朵方法', content: CLEAN, tags: ['英语', '习惯'] },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.status, 'pending');
    assert.ok(created.data.moderationReasons.length === 0);
    const feed = await api(ctx.base, 'GET', '/api/community/feed', { token: user.token });
    assert.ok(!feed.data.some((p: any) => p.id === created.data.id));
    const mine = await api(ctx.base, 'GET', '/api/community/mine', { token: user.token });
    assert.equal(mine.data[0].id, created.data.id);
    assert.equal(mine.data[0].status, 'pending');
  });

  test('导流、联系方式与违规词在提交阶段直接拦截', async () => {
    const user = await newUser(ctx.base);
    const contact = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'insight', title: '加微信免费领取资料', content: '扫码加微信，免费领取全套课程资料，名额有限，快点联系我。', tags: ['资料'] },
    });
    assert.equal(contact.status, 422);
    assert.equal(contact.error.code, 'CONTENT_REJECTED');
    assert.ok(contact.error.details.reasons.join('').includes('导流'));

    const phone = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'insight', title: '英语启蒙经验分享', content: `加我手机 13800138000 领取资料。${CLEAN}`, tags: ['英语'] },
    });
    assert.equal(phone.status, 422);

    const bypass = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'insight', title: '英语启蒙经验分享', content: `加 v x 领取资料。${CLEAN}`, tags: ['英语'] },
    });
    assert.equal(bypass.status, 422);

    const violent = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'insight', title: '家庭教育心得', content: `今天把孩子打得不敢说话，真是气死了。${CLEAN}`, tags: ['亲子'] },
    });
    assert.equal(violent.status, 422);
  });

  test('课程发布必须关联已发布课时', async () => {
    const user = await newUser(ctx.base);
    const noRef = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'course', title: '我设计的小班英语课', content: CLEAN, tags: ['英语'] },
    });
    assert.equal(noRef.status, 422);
    assert.ok(noRef.error.message.includes('关联'));
    const withRef = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: {
        type: 'course', title: '我设计的小班英语课', content: CLEAN, tags: ['英语'],
        courseRef: { lessonId: 'lsn_english_junior_u1_l1' },
      },
    });
    assert.equal(withRef.status, 200);
    assert.equal(withRef.data.status, 'pending');
    const invalidRef = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'course', title: '我设计的小班英语课', content: CLEAN, tags: ['英语'], courseRef: { lessonId: 'bad' } },
    });
    assert.equal(invalidRef.status, 422);
  });

  test('教师/管理员审批后进入 feed，且不能审批自己的内容', async () => {
    const author = await newUser(ctx.base);
    const reviewer = await newUser(ctx.base);
    await promote(ctx.app, reviewer.user.id, 'teacher');
    const created = await api(ctx.base, 'POST', '/api/community/posts', {
      token: author.token, body: { type: 'insight', title: '亲子共读的三个小技巧', content: `${CLEAN} 共读时多问开放问题。`, tags: ['绘本'] },
    });
    const pending = await api(ctx.base, 'GET', '/api/admin/community/queue', { token: reviewer.token });
    assert.ok(pending.data.some((p: any) => p.id === created.data.id));
    const approved = await api(ctx.base, 'POST', `/api/admin/community/posts/${created.data.id}/review`, {
      token: reviewer.token, body: { decision: 'approve', note: '主题健康，经验具体' },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.status, 'approved');

    const ownPost = await api(ctx.base, 'POST', '/api/community/posts', {
      token: reviewer.token, body: { type: 'insight', title: '我自己的家庭教育记录', content: CLEAN, tags: ['家庭'] },
    });
    const reviewOwn = await api(ctx.base, 'POST', `/api/admin/community/posts/${ownPost.data.id}/review`, {
      token: reviewer.token, body: { decision: 'approve', note: '自审' },
    });
    assert.equal(reviewOwn.status, 403);
    const feed = await api(ctx.base, 'GET', '/api/community/feed', { token: author.token });
    assert.ok(feed.data.some((p: any) => p.id === created.data.id));
    const detail = await api(ctx.base, 'GET', `/api/community/posts/${created.data.id}`, { token: author.token });
    assert.equal(detail.data.post.status, 'approved');
    assert.equal(detail.data.comments.length, 0);
    assert.equal(detail.data.post.household_id, undefined, '公开详情不应泄露家庭 ID');
    assert.equal(detail.data.post.moderation_score, undefined, '公开详情不应泄露审核分数');
  });

  test('拒绝必须填写理由，作者可看到原因；已通过内容编辑后重新审核', async () => {
    const author = await newUser(ctx.base);
    const reviewer = await newUser(ctx.base);
    await promote(ctx.app, reviewer.user.id, 'admin');
    const created = await api(ctx.base, 'POST', '/api/community/posts', {
      token: author.token, body: { type: 'insight', title: '孩子不爱学英语怎么办', content: CLEAN, tags: ['英语'] },
    });
    const noNote = await api(ctx.base, 'POST', `/api/admin/community/posts/${created.data.id}/review`, {
      token: reviewer.token, body: { decision: 'reject' },
    });
    assert.equal(noNote.status, 422);
    const rejected = await api(ctx.base, 'POST', `/api/admin/community/posts/${created.data.id}/review`, {
      token: reviewer.token, body: { decision: 'reject', note: '请补充具体年龄段与做法' },
    });
    assert.equal(rejected.data.status, 'rejected');
    const mine = await api(ctx.base, 'GET', '/api/community/mine', { token: author.token });
    assert.equal(mine.data[0].status, 'rejected');
    const edited = await api(ctx.base, 'PATCH', `/api/community/posts/${created.data.id}`, {
      token: author.token,
      body: { title: '小班孩子不爱学英语怎么办', content: `${CLEAN} 我补充了具体年龄段：小班 4 岁。` },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.status, 'pending');
    const feed = await api(ctx.base, 'GET', '/api/community/feed', { token: author.token });
    assert.ok(!feed.data.some((p: any) => p.id === created.data.id));
  });

  test('与儿童教育无关的内容进入待审并标注原因，由人工决定', async () => {
    const user = await newUser(ctx.base);
    const offTopic = await api(ctx.base, 'POST', '/api/community/posts', {
      token: user.token,
      body: { type: 'insight', title: '周末去哪里玩比较划算', content: '这家店打折力度很大，建议大家周末都去看看，停车也方便，环境不错。', tags: ['生活'] },
    });
    assert.equal(offTopic.status, 200);
    assert.ok(offTopic.data.moderationReasons.some((r: string) => r.includes('主题')));
  });

  test('评论经过审核，点赞可切换，浏览量会增长', async () => {
    const author = await newUser(ctx.base);
    const reviewer = await newUser(ctx.base);
    await promote(ctx.app, reviewer.user.id, 'admin');
    const created = await api(ctx.base, 'POST', '/api/community/posts', {
      token: author.token, body: { type: 'insight', title: '睡前十分钟的亲子阅读', content: CLEAN, tags: ['阅读'] },
    });
    await api(ctx.base, 'POST', `/api/admin/community/posts/${created.data.id}/review`, {
      token: reviewer.token, body: { decision: 'approve' },
    });
    const good = await api(ctx.base, 'POST', `/api/community/posts/${created.data.id}/comments`, {
      token: reviewer.token, body: { content: '这个方法很实用，今晚就试试。' },
    });
    assert.equal(good.status, 200);
    const bad = await api(ctx.base, 'POST', `/api/community/posts/${created.data.id}/comments`, {
      token: reviewer.token, body: { content: '加微信 13800138000 领取资料' },
    });
    assert.equal(bad.status, 422);
    const like1 = await api(ctx.base, 'POST', `/api/community/posts/${created.data.id}/like`, { token: reviewer.token });
    assert.equal(like1.data.liked, true);
    assert.equal(like1.data.likeCount, 1);
    const like2 = await api(ctx.base, 'POST', `/api/community/posts/${created.data.id}/like`, { token: reviewer.token });
    assert.equal(like2.data.liked, false);
    assert.equal(like2.data.likeCount, 0);
    await api(ctx.base, 'GET', `/api/community/posts/${created.data.id}`, { token: author.token });
    const after = await api(ctx.base, 'GET', `/api/community/posts/${created.data.id}`, { token: author.token });
    assert.ok(after.data.post.view_count >= 2);
    assert.equal(after.data.comments.length, 1);
  });

  test('举报后管理员可隐藏违规内容', async () => {
    const author = await newUser(ctx.base);
    const reporter = await newUser(ctx.base);
    const admin = await newUser(ctx.base);
    await promote(ctx.app, admin.user.id, 'admin');
    const created = await api(ctx.base, 'POST', '/api/community/posts', {
      token: author.token, body: { type: 'insight', title: '一个关于陪伴的小记录', content: CLEAN, tags: ['陪伴'] },
    });
    await api(ctx.base, 'POST', `/api/admin/community/posts/${created.data.id}/review`, {
      token: admin.token, body: { decision: 'approve' },
    });
    const report = await api(ctx.base, 'POST', `/api/community/posts/${created.data.id}/report`, {
      token: reporter.token, body: { reason: '内容与描述不符，疑似广告' },
    });
    assert.equal(report.status, 200);
    const reports = await api(ctx.base, 'GET', '/api/admin/community/reports', { token: admin.token });
    assert.equal(reports.data.length, 1);
    const resolved = await api(ctx.base, 'POST', `/api/admin/community/reports/${reports.data[0].id}/resolve`, {
      token: admin.token, body: { decision: 'hide' },
    });
    assert.equal(resolved.status, 200);
    const detail = await api(ctx.base, 'GET', `/api/community/posts/${created.data.id}`, { token: reporter.token });
    assert.equal(detail.status, 404, '隐藏内容对普通用户不可见');
  });
});
