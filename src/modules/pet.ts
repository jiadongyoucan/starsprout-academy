import type { Db } from '../infra/db.ts';
import { conflict, notFound, validation } from '../core/errors.ts';
import { newId, nowIso, today } from '../core/security.ts';
import { int, oneOf, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { assertChildAccess, audit, resolveChildId, trackEvent } from './shared.ts';
import { moderateContent } from './moderation.ts';
import { lessonWarmth } from './warmth.ts';

export const PET_SPECIES = ['bunny', 'fox', 'dragon'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];
export type PetMood = 'happy' | 'excited' | 'hungry' | 'sleepy' | 'missing';

type PetRow = {
  id: string; household_id: string; child_id: string; species: PetSpecies; name: string;
  level: number; exp: number; hunger: number; happiness: number; energy: number;
  bond: number; mood: PetMood; equipped: string; last_decay_at: string;
  adopted_at: string; updated_at: string;
};

const MOOD: Record<PetMood, { label: string; face: string }> = {
  happy: { label: '开心', face: '😊' },
  excited: { label: '超级开心', face: '🤩' },
  hungry: { label: '有点饿', face: '🥺' },
  sleepy: { label: '想睡觉', face: '😴' },
  missing: { label: '有点想你', face: '🥺' },
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function moodOf(pet: { hunger: number; happiness: number; energy: number }): PetMood {
  if (pet.hunger < 25) return 'hungry';
  if (pet.energy < 20) return 'sleepy';
  if (pet.happiness >= 85) return 'excited';
  return 'happy';
}

function levelFor(exp: number): number {
  return Math.max(1, Math.floor(exp / 100) + 1);
}

function ensureWallet(db: Db, childId: string) {
  db.run(
    `INSERT INTO wallets(child_id, coins, total_earned, updated_at) VALUES(?,?,?,?)
     ON CONFLICT(child_id) DO NOTHING`,
    [childId, 0, 0, nowIso()],
  );
  return db.get<{ child_id: string; coins: number; total_earned: number; updated_at: string }>(
    'SELECT * FROM wallets WHERE child_id = ?', [childId],
  )!;
}

function addCoins(db: Db, childId: string, coins: number): void {
  if (!coins) return;
  ensureWallet(db, childId);
  db.run(
    'UPDATE wallets SET coins = coins + ?, total_earned = total_earned + ?, updated_at = ? WHERE child_id = ?',
    [coins, Math.max(0, coins), nowIso(), childId],
  );
}

function decay(pet: PetRow): PetRow {
  const last = Date.parse(pet.last_decay_at);
  const hours = Number.isFinite(last) ? (Date.now() - last) / 3_600_000 : 0;
  if (hours < 2) return pet;
  // Gentle offline decay: capped loss and floors at 30+, so a weekend away never
  // greets a starving pet. Absence is framed as "missed you", not guilt.
  const capped = Math.min(24, hours);
  const next = {
    ...pet,
    hunger: clamp(Math.max(35, pet.hunger - Math.min(18, capped * 0.8))),
    happiness: clamp(Math.max(38, pet.happiness - Math.min(14, capped * 0.5))),
    energy: clamp(Math.max(30, pet.energy - Math.min(12, capped * 0.4))),
    last_decay_at: nowIso(),
  };
  next.mood = hours >= 24 ? 'missing' : moodOf(next);
  next.updated_at = nowIso();
  return next;
}

function persistPet(db: Db, pet: PetRow): void {
  db.run(
    `UPDATE pets SET level = ?, exp = ?, hunger = ?, happiness = ?, energy = ?, bond = ?, mood = ?,
      equipped = ?, last_decay_at = ?, updated_at = ? WHERE id = ?`,
    [pet.level, pet.exp, pet.hunger, pet.happiness, pet.energy, pet.bond, pet.mood,
      pet.equipped, pet.last_decay_at, pet.updated_at, pet.id],
  );
}

function getPetRow(db: Db, childId: string): PetRow | null {
  return db.get<PetRow>('SELECT * FROM pets WHERE child_id = ?', [childId]) || null;
}

function parseItem<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function shopRows(db: Db) {
  return db.all<Record<string, any>>('SELECT * FROM shop_items WHERE available = 1 ORDER BY sort, price').map(item => ({
    ...item, effect: parseItem(item.effect, {}),
  }));
}

function inventoryRows(db: Db, petId: string) {
  return db.all<Record<string, any>>(
    `SELECT i.item_code, i.qty, i.equipped, s.kind, s.name, s.emoji, s.price, s.description, s.effect
     FROM pet_inventory i JOIN shop_items s ON s.code = i.item_code
     WHERE i.pet_id = ? AND i.qty > 0 ORDER BY s.kind, s.sort`, [petId],
  ).map(row => ({ ...row, effect: parseItem(row.effect, {}), equipped: !!row.equipped }));
}

function dailyQuests(db: Db, childId: string, petId: string | null, plan: { done: number; total: number } | null) {
  const todayStr = today();
  const lessonToday = Number(db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM progress WHERE child_id = ? AND status = 'completed' AND substr(completed_at,1,10) = ?`,
    [childId, todayStr],
  )?.c || 0);
  const feedToday = petId ? Number(db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pet_interactions WHERE pet_id = ? AND action = 'feed' AND substr(created_at,1,10) = ?`,
    [petId, todayStr],
  )?.c || 0) : 0;
  const playToday = petId ? Number(db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pet_interactions WHERE pet_id = ? AND action = 'play' AND substr(created_at,1,10) = ?`,
    [petId, todayStr],
  )?.c || 0) : 0;
  return [
    { key: 'lesson', label: '完成 1 个学习活动', done: lessonToday > 0, progress: Math.min(lessonToday, 1), target: 1 },
    { key: 'plan', label: '完成今天的计划', done: !!plan && plan.total > 0 && plan.done >= plan.total, progress: plan?.done || 0, target: plan?.total || 1 },
    { key: 'feed', label: '喂伙伴一次', done: feedToday > 0, progress: Math.min(feedToday, 1), target: 1 },
    { key: 'play', label: '陪伙伴玩一次', done: playToday > 0, progress: Math.min(playToday, 1), target: 1 },
  ];
}

export function petView(db: Db, user: AuthUser, childIdRaw?: unknown) {
  const childId = resolveChildId(db, user, childIdRaw);
  const child = assertChildAccess(db, user, childId);
  const wallet = ensureWallet(db, childId);
  let pet = getPetRow(db, childId);
  if (pet) {
    const decayed = decay(pet);
    if (decayed !== pet) { persistPet(db, decayed); pet = decayed; }
  }
  const plan = db.get<{ id: string; title: string }>(
    "SELECT id, title FROM plans WHERE child_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [childId],
  );
  const planCounts = plan
    ? db.get<{ total: number; done: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM plan_items WHERE plan_id = ?`, [plan.id],
    )
    : null;
  const shop = shopRows(db);
  const inventory = pet ? inventoryRows(db, pet.id) : [];
  const quests = dailyQuests(db, childId, pet?.id || null, planCounts
    ? { total: Number(planCounts.total || 0), done: Number(planCounts.done || 0) } : null);
  const badges = db.all<{ source_type: string; source_id: string; meta: string; created_at: string }>(
    `SELECT source_type, source_id, meta, created_at FROM reward_events
     WHERE child_id = ? AND source_type IN ('unit','plan') ORDER BY created_at DESC LIMIT 20`, [childId],
  ).map(row => {
    let meta: any = {};
    try { meta = JSON.parse(row.meta); } catch { /* ignore */ }
    return { type: row.source_type, title: meta.title || (row.source_type === 'unit' ? '单元徽章' : '计划证书'), earnedAt: row.created_at };
  });
  return {
    child,
    wallet,
    shop,
    inventory,
    quests,
    badges,
    pet: pet ? {
      id: pet.id, species: pet.species, name: pet.name, level: pet.level, exp: pet.exp,
      hunger: pet.hunger, happiness: pet.happiness, energy: pet.energy, bond: pet.bond,
      mood: pet.mood, moodLabel: MOOD[pet.mood]?.label || '开心', moodFace: MOOD[pet.mood]?.face || '😊',
      equipped: parseItem<string[]>(pet.equipped, []),
      nextLevelExp: levelFor(pet.exp) * 100,
      progress: Math.round((pet.exp % 100)),
      adoptedAt: pet.adopted_at,
    } : null,
    todayCoins: Number(db.get<{ c: number }>(
      `SELECT COALESCE(SUM(coins),0) AS c FROM reward_events WHERE child_id = ? AND substr(created_at,1,10) = ?`,
      [childId, today()],
    )?.c || 0),
  };
}

export function adoptPet(db: Db, user: AuthUser, body: any) {
  const childId = resolveChildId(db, user, body?.childId);
  assertChildAccess(db, user, childId);
  if (getPetRow(db, childId)) throw conflict('这个孩子已经有一位伙伴了');
  const species = oneOf(body?.species, PET_SPECIES, '伙伴种类');
  const name = str(body?.name, { label: '伙伴名字', min: 1, max: 10 });
  const nameCheck = moderateContent(name, { onTopicHint: true });
  if (nameCheck.blocked || nameCheck.reasons.some(r => r.code === 'CONTACT' || r.code === 'PII')) {
    throw validation('这个名字不太合适，换一个可爱的吧');
  }
  const now = nowIso();
  db.tx(() => {
    db.run(
      `INSERT INTO pets(id, household_id, child_id, species, name, level, exp, hunger, happiness, energy, bond, mood, equipped, last_decay_at, adopted_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), user.householdId, childId, species, name, 1, 0, 82, 82, 82, 0, 'happy', '[]', now, now, now],
    );
    addCoins(db, childId, 20);
    db.run(
      'INSERT INTO pet_interactions(id, pet_id, child_id, action, item_code, coins_spent, detail, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [newId(), db.get<{ id: string }>('SELECT id FROM pets WHERE child_id = ?', [childId])!.id, childId, 'adopt', null, 0, '{"gift":20}', now],
    );
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'pet.adopt', entity: 'pet', entityId: childId, detail: { species, name } });
  });
  return { ...petView(db, user, childId), reaction: { title: '欢迎回家', text: `${name}会成为你每天学习的小搭档。`, emoji: '🎉' } };
}

function cooldownCheck(db: Db, petId: string, action: string, minutes: number): void {
  const last = db.get<{ created_at: string }>(
    'SELECT created_at FROM pet_interactions WHERE pet_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
    [petId, action],
  );
  if (!last) return;
  const remain = minutes * 60_000 - (Date.now() - Date.parse(last.created_at));
  if (remain > 0) throw validation(`${action === 'sleep' ? '刚睡过啦' : action === 'play' ? '刚玩过啦' : '刚刚已经摸过啦'}，${Math.ceil(remain / 60_000)} 分钟后再来`);
}

export function interactPet(db: Db, user: AuthUser, body: any) {
  const childId = resolveChildId(db, user, body?.childId);
  assertChildAccess(db, user, childId);
  let pet = getPetRow(db, childId);
  if (!pet) throw notFound('还没有领养伙伴，先去领养一只吧');
  pet = decay(pet);
  const action = oneOf(body?.action, ['feed', 'play', 'pet', 'sleep', 'clean'] as const, '互动');
  const oldLevel = pet.level;
  let itemCode: string | null = null;
  let itemName = '';
  let reaction = '';
  let coinSpent = 0;

  db.tx(() => {
    if (action === 'feed') {
      const requested = str(body?.itemCode, { optional: true, max: 40 });
      if (!requested) {
        cooldownCheck(db, pet!.id, 'feed', 1);
        // Free daily snack: basic care is never paywalled.
        pet!.hunger = clamp(pet!.hunger + 18);
        pet!.happiness = clamp(pet!.happiness + 3);
        pet!.exp += 1;
        pet!.bond += 1;
        reaction = `${pet!.name}吃到了免费的小饼干，满足地眯起眼睛。`;
      } else {
        itemCode = requested;
        const item = db.get<Record<string, any>>('SELECT * FROM shop_items WHERE code = ? AND kind = ?', [itemCode, 'food']);
        if (!item) throw validation('请选择一种食物');
        const inv = db.get<{ qty: number }>('SELECT qty FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet!.id, itemCode]);
        if (!inv || inv.qty < 1) throw validation('背包里没有这种食物，先去小铺买一点吧');
        const effect = parseItem<Record<string, number>>(item.effect, {});
        pet!.hunger = clamp(pet!.hunger + (effect.hunger || 10));
        pet!.happiness = clamp(pet!.happiness + (effect.happiness || 2));
        pet!.energy = clamp(pet!.energy + (effect.energy || 0));
        pet!.exp += effect.exp || 2;
        pet!.bond += 1;
        itemName = item.name;
        reaction = `${pet!.name}吃到了${item.name}，开心地晃了晃耳朵。`;
        if (inv.qty <= 1) db.run('DELETE FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet!.id, itemCode]);
        else db.run('UPDATE pet_inventory SET qty = qty - 1 WHERE pet_id = ? AND item_code = ?', [pet!.id, itemCode]);
      }
    } else if (action === 'play') {
      cooldownCheck(db, pet.id, 'play', 20);
      if (pet.energy < 12) throw validation(`${pet.name}有点累了，先睡一觉再玩吧`);
      const toyCode = str(body?.itemCode, { optional: true, max: 40 });
      let toyBonus = 0;
      if (toyCode) {
        const toy = db.get<Record<string, any>>('SELECT * FROM shop_items WHERE code = ? AND kind = ?', [toyCode, 'toy']);
        const owned = db.get('SELECT 1 AS ok FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet.id, toyCode]);
        if (!toy || !owned) throw validation('还没有这个玩具，先去小铺看看吧');
        toyBonus = Number(parseItem<Record<string, number>>(toy.effect, {}).happiness || 0);
        itemName = toy.name;
      }
      pet.energy = clamp(pet.energy - 10);
      pet.happiness = clamp(pet.happiness + 15 + toyBonus);
      pet.hunger = clamp(pet.hunger - 4);
      pet.exp += 4;
      pet.bond += 1;
      reaction = toyBonus ? `你拿出${itemName}，${pet.name}开心得转了个圈！` : `你和小伙伴玩了一会儿，${pet.name}开心得转了个圈！`;
    } else if (action === 'pet') {
      cooldownCheck(db, pet.id, 'pet', 1);
      pet.happiness = clamp(pet.happiness + 4);
      pet.exp += 1;
      pet.bond += 1;
      reaction = `${pet.name}眯起眼睛，蹭了蹭你的手。`;
    } else if (action === 'sleep') {
      cooldownCheck(db, pet.id, 'sleep', 60);
      pet.energy = clamp(pet.energy + 35);
      pet.happiness = clamp(pet.happiness + 2);
      pet.exp += 2;
      reaction = `${pet.name}打了一个小哈欠，睡得很香。`;
    } else {
      cooldownCheck(db, pet.id, 'clean', 20);
      pet.happiness = clamp(pet.happiness + 8);
      pet.energy = clamp(pet.energy - 2);
      pet.exp += 2;
      reaction = `房间变得干干净净，${pet.name}舒服地伸了个懒腰。`;
    }
    pet!.level = levelFor(pet!.exp);
    pet!.mood = moodOf(pet!);
    pet!.updated_at = nowIso();
    persistPet(db, pet!);
    db.run(
      'INSERT INTO pet_interactions(id, pet_id, child_id, action, item_code, coins_spent, detail, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [newId(), pet!.id, childId, action, itemCode, coinSpent, JSON.stringify({ reaction, level: pet!.level }), nowIso()],
    );
  });
  return {
    ...petView(db, user, childId),
    reaction: { title: action === 'feed' ? '吃得饱饱的' : action === 'play' ? '玩得真开心' : action === 'sleep' ? '晚安小可爱' : '陪伴一下', text: reaction, emoji: action === 'feed' ? '🥕' : action === 'play' ? '🎾' : action === 'sleep' ? '🌙' : '💛' },
    levelUp: pet.level > oldLevel,
    spent: coinSpent,
    itemName,
  };
}

export function buyItem(db: Db, user: AuthUser, body: any) {
  const childId = resolveChildId(db, user, body?.childId);
  assertChildAccess(db, user, childId);
  const pet = getPetRow(db, childId);
  if (!pet) throw notFound('先领养伙伴，再给它挑礼物吧');
  const code = str(body?.code, { label: '商品', max: 40 });
  const qty = int(body?.qty ?? 1, { min: 1, max: 10, label: '数量' });
  const item = db.get<Record<string, any>>('SELECT * FROM shop_items WHERE code = ?', [code]);
  if (!item) throw notFound('商品不存在');
  if (!item.available) throw validation('这件限定配饰只能通过完成计划获得');
  if (item.kind === 'clothing' && qty !== 1) throw validation('衣服一次只能兑换一件');
  const wallet = ensureWallet(db, childId);
  const total = Number(item.price) * qty;
  if (wallet.coins < total) throw validation(`金币不够啦，还差 ${total - wallet.coins} 枚；先完成一个学习活动吧`);
  const owned = db.get<{ qty: number }>('SELECT qty FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet.id, code]);
  if (item.kind === 'clothing' && owned) throw conflict('这件衣服已经在小衣橱里了');
  db.tx(() => {
    const paid = db.run('UPDATE wallets SET coins = coins - ?, updated_at = ? WHERE child_id = ? AND coins >= ?', [total, nowIso(), childId, total]);
    if (paid.changes === 0) throw validation('金币不够啦，先完成一个学习活动吧');
    if (item.kind === 'clothing' && db.get('SELECT 1 AS ok FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet.id, code])) {
      throw conflict('这件衣服已经在小衣橱里了');
    }
    if (owned) db.run('UPDATE pet_inventory SET qty = qty + ? WHERE pet_id = ? AND item_code = ?', [qty, pet.id, code]);
    else db.run('INSERT INTO pet_inventory(id, pet_id, item_code, qty, equipped, acquired_at) VALUES(?,?,?,?,?,?)',
      [newId(), pet.id, code, qty, 0, nowIso()]);
    db.run(
      'INSERT INTO pet_interactions(id, pet_id, child_id, action, item_code, coins_spent, detail, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [newId(), pet.id, childId, 'buy', code, total, JSON.stringify({ price: item.price, qty }), nowIso()],
    );
    audit(db, { householdId: user.householdId, actorId: user.id, action: 'pet.shop.buy', entity: 'shop_item', entityId: code, detail: { childId, total, qty } });
  });
  return { ...petView(db, user, childId), message: `已把「${item.name}」放进背包`, spent: total };
}

export function equipItem(db: Db, user: AuthUser, body: any) {
  const childId = resolveChildId(db, user, body?.childId);
  assertChildAccess(db, user, childId);
  const pet = getPetRow(db, childId);
  if (!pet) throw notFound('还没有伙伴');
  const code = str(body?.code, { label: '衣服', max: 40 });
  const item = db.get<Record<string, any>>('SELECT * FROM shop_items WHERE code = ?', [code]);
  if (!item || item.kind !== 'clothing') throw validation('只有衣服可以穿脱');
  const owned = db.get<{ qty: number }>('SELECT qty FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet.id, code]);
  if (!owned) throw validation('还没有这件衣服，先去小铺看看吧');
  const equipped = parseItem<string[]>(pet.equipped, []);
  const want = body?.equipped !== false;
  const next = want ? [...new Set([...equipped, code])] : equipped.filter(c => c !== code);
  db.tx(() => {
    db.run('UPDATE pets SET equipped = ?, updated_at = ? WHERE id = ?', [JSON.stringify(next), nowIso(), pet.id]);
    db.run('UPDATE pet_inventory SET equipped = ? WHERE pet_id = ? AND item_code = ?', [want ? 1 : 0, pet.id, code]);
  });
  return { ...petView(db, user, childId), message: want ? `穿上了「${item.name}」` : `脱下了「${item.name}」` };
}

// ---------- rewards ----------
type Milestone = { type: 'unit' | 'plan'; title: string; coins: number; exp: number; item?: string; itemName?: string };

function grantRewardEvent(db: Db, childId: string, type: string, sourceId: string, coins: number, exp: number, stars: number, meta: Record<string, unknown>): boolean {
  const inserted = db.run(
    `INSERT OR IGNORE INTO reward_events(id, child_id, source_type, source_id, coins, exp, stars, meta, created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [newId(), childId, type, sourceId, coins, exp, stars, JSON.stringify(meta), nowIso()],
  );
  return inserted.changes > 0;
}

function gainPet(db: Db, childId: string, exp: number, happiness: number): { pet: PetRow | null; levelUp: boolean } {
  let pet = getPetRow(db, childId);
  if (!pet) return { pet: null, levelUp: false };
  pet = decay(pet);
  const oldLevel = pet.level;
  pet.exp += exp;
  pet.happiness = clamp(pet.happiness + happiness);
  pet.hunger = clamp(pet.hunger - 1);
  pet.level = levelFor(pet.exp);
  pet.mood = moodOf(pet);
  pet.updated_at = nowIso();
  persistPet(db, pet);
  return { pet, levelUp: pet.level > oldLevel };
}

function unitMilestone(db: Db, childId: string, lessonId: string): Milestone | null {
  const row = db.get<{ unit_id: string; unit_title: string }>(
    `SELECT un.id AS unit_id, un.title AS unit_title FROM lessons l JOIN units un ON un.id = l.unit_id WHERE l.id = ?`, [lessonId],
  );
  if (!row) return null;
  const totals = db.get<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS(
       SELECT 1 FROM progress p WHERE p.lesson_id = l.id AND p.child_id = ? AND p.status = 'completed'
     ) THEN 1 ELSE 0 END) AS done FROM lessons l WHERE l.unit_id = ? AND l.is_published = 1`,
    [childId, row.unit_id],
  );
  if (!totals || Number(totals.total) === 0 || Number(totals.done) < Number(totals.total)) return null;
  if (!grantRewardEvent(db, childId, 'unit', row.unit_id, 30, 25, 3, { title: row.unit_title })) return null;
  addCoins(db, childId, 30);
  gainPet(db, childId, 25, 8);
  return { type: 'unit', title: row.unit_title, coins: 30, exp: 25 };
}

function planMilestone(db: Db, childId: string, planId: string): Milestone | null {
  const plan = db.get<{ id: string; title: string; child_id: string }>('SELECT id, title, child_id FROM plans WHERE id = ?', [planId]);
  if (!plan || plan.child_id !== childId) return null;
  const counts = db.get<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' AND completed_via = 'lesson' THEN 1 ELSE 0 END) AS done
     FROM plan_items WHERE plan_id = ?`, [planId],
  );
  if (!counts || Number(counts.total) === 0 || Number(counts.done) < Number(counts.total)) return null;
  const dates = Number(db.get<{ c: number }>(
    "SELECT COUNT(DISTINCT date) AS c FROM plan_items WHERE plan_id = ? AND status = 'done' AND completed_via = 'lesson'", [planId],
  )?.c || 0);
  // Ceremony rewards require a real plan (≥3 items across ≥3 days), preventing one-item farming.
  if (Number(counts.total) < 3 || dates < 3) return null;
  if (!grantRewardEvent(db, childId, 'plan', planId, 100, 60, 3, { title: plan.title })) return null;
  trackEvent(db, { householdId: db.get<{ household_id: string }>('SELECT household_id FROM children WHERE id = ?', [childId])?.household_id, childId, type: 'plan_completed', meta: { planId } });
  addCoins(db, childId, 100);
  gainPet(db, childId, 60, 12);
  const cape = db.get<{ code: string; name: string }>("SELECT code, name FROM shop_items WHERE code = 'star-cape'");
  const pet = getPetRow(db, childId);
  let itemName: string | undefined;
  if (cape && pet) {
    const owned = db.get('SELECT 1 AS ok FROM pet_inventory WHERE pet_id = ? AND item_code = ?', [pet.id, cape.code]);
    if (!owned) db.run('INSERT INTO pet_inventory(id, pet_id, item_code, qty, equipped, acquired_at) VALUES(?,?,?,?,?,?)',
      [newId(), pet.id, cape.code, 1, 0, nowIso()]);
    itemName = cape.name;
  }
  return { type: 'plan', title: plan.title, coins: 100, exp: 60, item: 'star-cape', itemName };
}

export function awardLessonCompletion(db: Db, childId: string, lessonId: string, score: number, planItemId?: string | null, correct = 0, total = 0) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score || 80)));
  const stars = safeScore >= 90 ? 3 : safeScore >= 70 ? 2 : 1;
  const coins = 10 + Math.floor(safeScore / 10);
  const lesson = db.get<{ title: string }>('SELECT title FROM lessons WHERE id = ?', [lessonId]);
  let firstTime = false;
  let petBefore = getPetRow(db, childId);
  const oldLevel = petBefore?.level || 0;
  const milestones: Milestone[] = [];

  db.tx(() => {
    firstTime = grantRewardEvent(db, childId, 'lesson', lessonId, coins, 10, stars, { score: safeScore, title: lesson?.title });
    if (firstTime) {
      addCoins(db, childId, coins);
      gainPet(db, childId, 10, 6);
    } else {
      gainPet(db, childId, 0, 2);
    }
    const unit = unitMilestone(db, childId, lessonId);
    if (unit) milestones.push(unit);
    if (planItemId) {
      const planItem = db.get<{ plan_id: string; child_id: string; status: string }>('SELECT plan_id, child_id, status FROM plan_items WHERE id = ?', [planItemId]);
      if (planItem && planItem.child_id === childId) {
        const plan = planMilestone(db, childId, planItem.plan_id);
        if (plan) milestones.push(plan);
      }
    }
  });
  const wallet = ensureWallet(db, childId);
  const pet = getPetRow(db, childId);
  const gainedCoins = milestones.reduce((sum, m) => sum + m.coins, 0) + (firstTime ? coins : 0);
  return {
    firstTime,
    stars,
    coins: firstTime ? coins : 0,
    bonusCoins: gainedCoins - (firstTime ? coins : 0),
    totalCoins: wallet.coins,
    exp: (firstTime ? 10 : 0) + milestones.reduce((sum, m) => sum + m.exp, 0),
    level: pet?.level || 0,
    levelUp: !!pet && pet.level > oldLevel,
    petMood: pet?.mood || null,
    milestones,
    review: !firstTime,
    score: safeScore,
    correct,
    total,
    warmth: lessonWarmth(childId, safeScore),
  };
}

export function awardPlanCompletion(db: Db, childId: string, planId: string) {
  let milestone: Milestone | null = null;
  const petBefore = getPetRow(db, childId);
  const oldLevel = petBefore?.level || 0;
  db.tx(() => { milestone = planMilestone(db, childId, planId); });
  const wallet = ensureWallet(db, childId);
  const pet = getPetRow(db, childId);
  return {
    milestones: milestone ? [milestone] : [],
    totalCoins: wallet.coins,
    level: pet?.level || 0,
    levelUp: !!pet && pet.level > oldLevel,
  };
}

export function moodMeta(mood: PetMood) {
  return MOOD[mood] || MOOD.happy;
}
