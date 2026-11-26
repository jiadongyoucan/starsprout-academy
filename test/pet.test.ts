import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, addChild, createTestApp, newUser, type TestContext } from './helpers.ts';

describe('星芽伙伴：领养、情绪、小铺与学习奖励', () => {
  let ctx: TestContext;
  before(async () => { ctx = await createTestApp(); });
  after(async () => { await ctx.close(); });

  test('孩子可以领养伙伴，获得初始金币与状态', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '伙伴测试' });
    const before = await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token });
    assert.equal(before.status, 200);
    assert.equal(before.data.pet, null);
    assert.ok(before.data.shop.length >= 12);
    assert.equal(before.data.wallet.coins, 0);
    const adopted = await api(ctx.base, 'POST', '/api/pet/adopt', {
      token: user.token, body: { childId: child.id, species: 'bunny', name: '团子' },
    });
    assert.equal(adopted.status, 200);
    assert.equal(adopted.data.pet.name, '团子');
    assert.equal(adopted.data.pet.hunger, 82);
    assert.equal(adopted.data.wallet.coins, 20);
    const again = await api(ctx.base, 'POST', '/api/pet/adopt', {
      token: user.token, body: { childId: child.id, species: 'fox', name: '橘子' },
    });
    assert.equal(again.status, 409);
  });

  test('首通课时按得分发星星与金币，重复完成不再发币', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '奖励测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'dragon', name: '芽芽' } });
    const lesson = await api(ctx.base, 'GET', '/api/curriculum/lessons/lsn_english_junior_u1_l1?childId=' + child.id, { token: user.token });
    const questions = lesson.data.lesson.blocks.filter((b: any) => b.type === 'quiz').flatMap((b: any) => b.questions);
    const answers = questions.map((q: any) => q.answer);
    const first = await api(ctx.base, 'POST', '/api/curriculum/lessons/lsn_english_junior_u1_l1/progress', {
      token: user.token, body: { childId: child.id, status: 'completed', seconds: 600, answers },
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.rewards.firstTime, true);
    assert.equal(first.data.rewards.stars, 3);
    assert.equal(first.data.rewards.coins, 20);
    assert.equal(first.data.scoring.score, 100);
    const walletAfter = (await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token })).data.wallet.coins;
    assert.equal(walletAfter, 40);
    const repeat = await api(ctx.base, 'POST', '/api/curriculum/lessons/lsn_english_junior_u1_l1/progress', {
      token: user.token, body: { childId: child.id, status: 'completed', score: 100, seconds: 100 },
    });
    assert.equal(repeat.data.scoring.score, 80, '客户端 score 不被用于评分');
    assert.equal(repeat.data.rewards.firstTime, false);
    assert.equal(repeat.data.rewards.coins, 0);
    const walletRepeat = (await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token })).data.wallet.coins;
    assert.equal(walletRepeat, walletAfter);
  });

  test('完成一个单元会触发一次单元里程碑奖励', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '单元测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'fox', name: '小橘' } });
    const lessons = ['lsn_thinking_junior_u1_l1', 'lsn_thinking_junior_u1_l2', 'lsn_thinking_junior_u1_l3'];
    let milestone = null;
    for (const lesson of lessons) {
      const res = await api(ctx.base, 'POST', `/api/curriculum/lessons/${lesson}/progress`, {
        token: user.token, body: { childId: child.id, status: 'completed', score: 90, seconds: 600 },
      });
      if (res.data.rewards.milestones.length) milestone = res.data.rewards.milestones[0];
    }
    assert.ok(milestone, '第三个课时完成后应出现单元里程碑');
    assert.equal(milestone.type, 'unit');
    assert.equal(milestone.coins, 30);
    const fourth = await api(ctx.base, 'POST', '/api/curriculum/lessons/lsn_thinking_junior_u1_l1/progress', {
      token: user.token, body: { childId: child.id, status: 'completed', score: 100, seconds: 10 },
    });
    assert.equal(fourth.data.rewards.milestones.length, 0, '单元奖励只发一次');
  });

  test('完成计划全部项目触发计划里程碑与限定披风', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '计划奖励' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'bunny', name: '云朵' } });
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 3, minutesPerDay: 20, title: '仪式感计划' },
    });
    const planId = plan.data.plan.plan.id;
    const items = plan.data.plan.items;
    assert.ok(items.length >= 3);
    let milestone = null;
    for (const item of items) {
      const res = await api(ctx.base, 'POST', `/api/curriculum/lessons/${item.lesson_id}/progress`, {
        token: user.token, body: { childId: child.id, status: 'completed', score: 88, seconds: 600, planItemId: item.id },
      });
      if (res.data.rewards.milestones.some((m: any) => m.type === 'plan')) milestone = res.data.rewards.milestones.find((m: any) => m.type === 'plan');
    }
    assert.ok(milestone);
    assert.equal(milestone.coins, 100);
    assert.equal(milestone.item, 'star-cape');
    const state = await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token });
    assert.ok(state.data.inventory.some((item: any) => item.item_code === 'star-cape'));
    const repeat = await api(ctx.base, 'PATCH', `/api/plans/${planId}/items/${items[0].id}`, { token: user.token, body: { status: 'done' } });
    assert.equal(repeat.data.rewards, undefined, '手工标记计划项不发奖励');
  });

  test('不能用同一课时刷多个计划项，也不能靠跳过或手工完成拿计划金币', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '防刷测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'bunny', name: '小云' } });
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 3, minutesPerDay: 20, title: '防刷计划' },
    });
    const planId = plan.data.plan.plan.id;
    const items = plan.data.plan.items;
    // same lesson sent with every plan item id must not mark or pay the plan
    const lessonId = items[0].lesson_id;
    for (const item of items) {
      const res = await api(ctx.base, 'POST', `/api/curriculum/lessons/${lessonId}/progress`, {
        token: user.token, body: { childId: child.id, status: 'completed', seconds: 60, planItemId: item.id },
      });
      assert.equal(res.data.rewards.milestones.some((m: any) => m.type === 'plan'), false);
    }
    // skipping the remaining items and completing only one does not pay
    for (const item of items.slice(1)) {
      await api(ctx.base, 'PATCH', `/api/plans/${planId}/items/${item.id}`, { token: user.token, body: { status: 'skipped' } });
    }
    const last = items[0];
    const res = await api(ctx.base, 'POST', `/api/curriculum/lessons/${last.lesson_id}/progress`, {
      token: user.token, body: { childId: child.id, status: 'completed', seconds: 60, planItemId: last.id },
    });
    assert.equal(res.data.rewards.milestones.some((m: any) => m.type === 'plan'), false);
    const state = await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token });
    assert.equal(state.data.inventory.some((item: any) => item.item_code === 'star-cape'), false);
  });

  test('参考答案里未作答的题目不得分，服装不能批量购买，免费喂食有短冷却', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '细节测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'dragon', name: '小芽' } });
    const lesson = await api(ctx.base, 'GET', `/api/curriculum/lessons/lsn_english_junior_u1_l1?childId=${child.id}`, { token: user.token });
    const questions = lesson.data.lesson.blocks.filter((b: any) => b.type === 'quiz').flatMap((b: any) => b.questions);
    const answers = questions.map((q: any) => q.answer);
    answers[0] = null;
    const scored = await api(ctx.base, 'POST', '/api/curriculum/lessons/lsn_english_junior_u1_l1/progress', {
      token: user.token, body: { childId: child.id, status: 'completed', seconds: 60, answers },
    });
    assert.ok(scored.data.scoring.score < 100, '空答案不能得分');
    assert.ok(scored.data.scoring.correct < questions.length);
    const clothes = await api(ctx.base, 'POST', '/api/pet/shop/buy', { token: user.token, body: { childId: child.id, code: 'yellow-hat', qty: 10 } });
    assert.equal(clothes.status, 422);
    const firstFeed = await api(ctx.base, 'POST', '/api/pet/interact', { token: user.token, body: { childId: child.id, action: 'feed' } });
    assert.equal(firstFeed.status, 200);
    const secondFeed = await api(ctx.base, 'POST', '/api/pet/interact', { token: user.token, body: { childId: child.id, action: 'feed' } });
    assert.equal(secondFeed.status, 422, '免费喂食有短冷却，避免刷经验');
  });

  test('小铺购买、喂食、穿衣与余额校验', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '小铺测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'bunny', name: '团子' } });
    const poor = await api(ctx.base, 'POST', '/api/pet/shop/buy', { token: user.token, body: { childId: child.id, code: 'star-cape', qty: 1 } });
    assert.equal(poor.status, 422);
    const bought = await api(ctx.base, 'POST', '/api/pet/shop/buy', { token: user.token, body: { childId: child.id, code: 'carrot', qty: 2 } });
    assert.equal(bought.status, 200);
    assert.equal(bought.data.wallet.coins, 4);
    assert.ok(bought.data.inventory.some((item: any) => item.item_code === 'carrot' && item.qty === 2));
    const fed = await api(ctx.base, 'POST', '/api/pet/interact', { token: user.token, body: { childId: child.id, action: 'feed', itemCode: 'carrot' } });
    assert.equal(fed.status, 200);
    assert.ok(fed.data.pet.hunger >= 82);
    assert.equal(fed.data.inventory.find((item: any) => item.item_code === 'carrot').qty, 1);
    const hat = await api(ctx.base, 'POST', '/api/pet/shop/buy', { token: user.token, body: { childId: child.id, code: 'yellow-hat', qty: 1 } });
    assert.equal(hat.status, 422, '金币不足');
  });

  test('穿衣与玩耍、串门隔离', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '衣柜测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'dragon', name: '芽芽' } });
    // earn coins
    for (const lesson of ['lsn_hanzi_junior_u1_l1', 'lsn_hanzi_junior_u1_l2', 'lsn_hanzi_junior_u1_l3']) {
      await api(ctx.base, 'POST', `/api/curriculum/lessons/${lesson}/progress`, { token: user.token, body: { childId: child.id, status: 'completed', score: 100, seconds: 600 } });
    }
    const buy = await api(ctx.base, 'POST', '/api/pet/shop/buy', { token: user.token, body: { childId: child.id, code: 'yellow-hat', qty: 1 } });
    assert.equal(buy.status, 200);
    const equip = await api(ctx.base, 'POST', '/api/pet/equip', { token: user.token, body: { childId: child.id, code: 'yellow-hat', equipped: true } });
    assert.equal(equip.status, 200);
    assert.ok(equip.data.pet.equipped.includes('yellow-hat'));
    const play = await api(ctx.base, 'POST', '/api/pet/interact', { token: user.token, body: { childId: child.id, action: 'play' } });
    assert.equal(play.status, 200);
    assert.ok(play.data.pet.happiness > 0);
    const playAgain = await api(ctx.base, 'POST', '/api/pet/interact', { token: user.token, body: { childId: child.id, action: 'play' } });
    assert.equal(playAgain.status, 422);
    const stranger = await newUser(ctx.base);
    const peek = await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: stranger.token });
    assert.equal(peek.status, 404);
  });

  test('小计划不发放计划金币，防止刷奖励（仍然保持完成记录）', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '小计划测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'bunny', name: '小团' } });
    const plan = await api(ctx.base, 'POST', '/api/plans/manual', {
      token: user.token, body: { childId: child.id, weeks: 1, daysPerWeek: 2, minutesPerDay: 20, title: '只有两个活动' },
    });
    const items = plan.data.plan.items;
    assert.ok(items.length < 3);
    for (const item of items) {
      await api(ctx.base, 'POST', `/api/curriculum/lessons/${item.lesson_id}/progress`, {
        token: user.token, body: { childId: child.id, status: 'completed', seconds: 60, answers: [], planItemId: item.id },
      });
    }
    const state = await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token });
    assert.ok(state.data.inventory.every((item: any) => item.item_code !== 'star-cape'));
  });


  test('48 小时缺席仍然温暖，宠物数据可导出并随孩子删除', async () => {
    const user = await newUser(ctx.base);
    const child = await addChild(ctx.base, user.token, { name: '缺席测试' });
    await api(ctx.base, 'POST', '/api/pet/adopt', { token: user.token, body: { childId: child.id, species: 'fox', name: '小橘' } });
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    ctx.app.db.run('UPDATE pets SET last_decay_at = ?, hunger = 80, happiness = 80, energy = 80 WHERE child_id = ?', [old, child.id]);
    const state = await api(ctx.base, 'GET', `/api/pet?childId=${child.id}`, { token: user.token });
    assert.equal(state.data.pet.mood, 'missing');
    assert.ok(state.data.pet.hunger >= 35, '缺席两天也不应饥饿归零');
    const exported = await api(ctx.base, 'GET', `/api/privacy/export?childId=${child.id}`, { token: user.token });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.companion.pet.name, '小橘');
    assert.ok(Array.isArray(exported.data.companion.rewards));
    const removed = await api(ctx.base, 'DELETE', `/api/children/${child.id}`, { token: user.token, body: { confirm: true } });
    assert.equal(removed.status, 200);
    assert.equal(ctx.app.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM pets WHERE child_id = ?', [child.id])?.c, 0);
    assert.equal(ctx.app.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM wallets WHERE child_id = ?', [child.id])?.c, 0);
  });

});
