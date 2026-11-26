import { currentChild, request } from '../api.js';
import { celebrate, emptyState, esc, loading, openModal, toast, confirmDialog } from '../ui.js';
import { moodLine, petSvg, speciesMeta } from '../assets.js';

const SPECIES = ['bunny', 'fox', 'dragon'];
const KIND_LABEL = { food: '好吃的', clothing: '小衣服', toy: '小玩具', decor: '房间小物' };

export async function renderPet(root, ctx) {
  const child = currentChild();
  if (!child) {
    root.innerHTML = emptyState('🧒', '先添加孩子档案', '伙伴会陪孩子一起学习。', '<a class="btn" href="#/home">回首页</a>');
    return;
  }
  root.innerHTML = loading('正在打开伙伴的小窝…');
  let state;
  try {
    state = await request(`/api/pet?childId=${encodeURIComponent(child.id)}`);
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="petRetry">重试</button></div></div>`;
    root.querySelector('#petRetry').addEventListener('click', () => renderPet(root, ctx));
    return;
  }
  if (!state.pet) return renderAdoption(root, ctx, child, state);

  const pet = state.pet;
  const tab = ['home', 'shop', 'wardrobe', 'inventory'].includes(ctx.query.get('tab')) ? ctx.query.get('tab') : 'home';
  const meta = speciesMeta(pet.species);
  const foods = state.inventory.filter(item => item.kind === 'food');
  const clothing = state.inventory.filter(item => item.kind === 'clothing');
  const other = state.inventory.filter(item => item.kind !== 'food' && item.kind !== 'clothing');
  const speech = moodLine(pet.mood, pet.name);
  const progress = Math.min(100, Math.round((pet.exp % 100)));
  const questsDone = state.quests.filter(q => q.done).length;

  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">MY LITTLE COMPANION</div><h2>${esc(pet.name)}的小窝</h2>
        <p>${esc(petLabelText(meta))} · 每天一点点照顾，会让它更开心</p></div>
      <div class="row"><span class="wallet-chip">🪙 <b>${state.wallet.coins}</b></span>
        <a class="btn ghost small" href="#/home">回首页</a></div>
    </div>

    <div class="pet-page">
      <div class="stack">
        <section class="pet-room">
          <div class="room-sun"></div><div class="room-plant">🪴</div><div class="room-rug"></div>
          <div class="pet-stage">
            <div class="pet-speech">${esc(speech)}</div>
            <div class="pet-figure" id="petFigure">${petSvg(pet.species, pet.mood, pet.equipped, 220)}</div>
          </div>
          <div class="pet-name-card">
            <div class="level-ring" style="--p:${progress}"><b>Lv.${pet.level}</b><small>${progress}%</small></div>
            <div class="pn"><h3>${esc(pet.name)} <span class="tiny" style="font-family:var(--font);color:#9c8a72">${esc(pet.moodLabel)}</span></h3>
              <small>${esc(meta.tagline)} · 亲密度 ${pet.bond} · 经验 ${pet.exp}</small></div>
            <span class="pill mint">已陪伴 ${Math.max(1, Math.round((Date.now() - new Date(pet.adoptedAt).getTime()) / 86400000))} 天</span>
          </div>
          <div class="pet-actions">
            <button class="action-btn" type="button" data-action="feed"><span class="ico">🥕</span>喂食</button>
            <button class="action-btn" type="button" data-action="play"><span class="ico">🎾</span>玩耍</button>
            <button class="action-btn" type="button" data-action="pet"><span class="ico">💛</span>摸摸</button>
            <button class="action-btn" type="button" data-action="sleep"><span class="ico">🌙</span>睡觉</button>
            <button class="action-btn" type="button" data-action="clean"><span class="ico">🧹</span>整理</button>
          </div>
        </section>

        <div class="pet-tabs">
          <button class="pet-tab ${tab === 'home' ? 'active' : ''}" data-pet-tab="home">🏡 小窝</button>
          <button class="pet-tab ${tab === 'shop' ? 'active' : ''}" data-pet-tab="shop">🛍️ 宠物小铺</button>
          <button class="pet-tab ${tab === 'wardrobe' ? 'active' : ''}" data-pet-tab="wardrobe">👗 衣橱</button>
          <button class="pet-tab ${tab === 'inventory' ? 'active' : ''}" data-pet-tab="inventory">🎒 背包</button>
        </div>
        <section class="card" id="petTabBody">
          ${tab === 'home' ? `
            <div class="card-title"><div><h3>今天的小任务</h3><span class="hint">完成就能和小伙伴更亲近</span></div><span class="pill primary">${questsDone}/${state.quests.length}</span></div>
            <div class="quest-panel">${state.quests.map(quest => `<div class="quest-item ${quest.done ? 'done' : ''}"><span class="quest-check">✓</span><strong>${esc(quest.label)}</strong></div>`).join('')}</div>
            <div class="divider"></div>
            <div class="grid two-col" style="gap:12px">
              <div><h4 style="font-size:13px;margin:0 0 6px">照顾小贴士</h4>
                <p class="small muted">基础小饼干永远免费；商店里的零食只是小惊喜。伙伴不会因为几天没来而生气，它会说“想你了”。</p></div>
              <div><h4 style="font-size:13px;margin:0 0 6px">一起收集</h4>
                <p class="small muted">完成课时、单元和计划会获得金币与星星；金币只用来换装扮和小物，不会影响学习内容。</p></div>
            </div>
          ` : ''}
          ${tab === 'shop' ? `
            <div class="card-title"><div><h3>宠物小铺</h3><span class="hint">用学习赚来的金币，换一点小惊喜</span></div><span class="pill">🪙 ${state.wallet.coins}</span></div>
            ${['food', 'clothing', 'toy', 'decor'].map(kind => {
              const items = state.shop.filter(item => item.kind === kind);
              return `<h4 style="font-size:12.5px;margin:14px 0 8px;color:#8a765c">${esc(KIND_LABEL[kind])}</h4>
                <div class="shop-grid">${items.map(item => {
                  const owned = state.inventory.find(inv => inv.item_code === item.code);
                  const canAfford = state.wallet.coins >= item.price;
                  const clothingOwned = item.kind === 'clothing' && owned;
                  return `<div class="shop-item ${owned ? 'owned' : ''}">
                    <span class="em">${esc(item.emoji)}</span><h4>${esc(item.name)}</h4><p>${esc(item.description)}</p>
                    <div class="row between"><span class="price">🪙 ${item.price}</span>
                      <button class="btn small ${canAfford && !clothingOwned ? '' : 'ghost'}" type="button" data-buy="${esc(item.code)}" ${canAfford && !clothingOwned ? '' : 'disabled'}>${clothingOwned ? '已拥有' : canAfford ? '兑换' : '金币不足'}</button></div>
                  </div>`;
                }).join('')}</div>`;
            }).join('')}
            <p class="tiny muted" style="margin-top:12px">小铺商品是虚拟陪伴周边，兑换后可以在小窝展示；不涉及真实物流。</p>
          ` : ''}
          ${tab === 'wardrobe' ? `
            <div class="card-title"><div><h3>小衣橱</h3><span class="hint">给${esc(pet.name)}换一身心情</span></div><span class="pill">${clothing.length} 件</span></div>
            ${clothing.length ? `<div class="wardrobe-grid">${clothing.map(item => `<div class="inv-item">
              <span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>${item.equipped ? '正在穿' : '已拥有'}</small></div>
              <button class="equip-btn" type="button" data-equip="${esc(item.item_code)}" data-equipped="${item.equipped ? '1' : '0'}">${item.equipped ? '脱下' : '穿上'}</button>
            </div>`).join('')}</div>` : '<p class="small muted">还没有小衣服。去小铺用金币换一件吧。</p>'}
            <h4 style="font-size:12.5px;margin:18px 0 8px;color:#8a765c">房间小物</h4>
            ${other.filter(item => item.kind === 'decor').length ? `<div class="inventory-grid">${other.filter(item => item.kind === 'decor').map(item => `<div class="inv-item"><span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>已摆进小窝</small></div></div>`).join('')}</div>` : '<p class="tiny muted">还没有房间装饰。</p>'}
          ` : ''}
          ${tab === 'inventory' ? `
            <div class="card-title"><div><h3>背包</h3><span class="hint">食物、玩具与收藏</span></div><span class="pill">${state.inventory.length} 种</span></div>
            ${state.inventory.length ? `<div class="inventory-grid">${state.inventory.map(item => `<div class="inv-item"><span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>${esc(KIND_LABEL[item.kind])} × ${item.qty}</small></div>${item.kind === 'food' ? `<button class="equip-btn" type="button" data-feed-item="${esc(item.item_code)}">喂食</button>` : ''}</div>`).join('')}</div>` : '<p class="small muted">背包还是空的。去小铺看看吧。</p>'}
            <p class="tiny muted" style="margin-top:10px">基础小饼干免费无限；存粮只是更丰富的口味。</p>
          ` : ''}
        </section>
      </div>

      <aside class="pet-side">
        <section class="card soft">
          <div class="card-title"><div><h3>${esc(pet.name)}的状态</h3><span class="hint">${esc(pet.moodLabel)}</span></div><span class="pill">Lv.${pet.level}</span></div>
          <div class="pet-stats">
            ${statBar('🥕 饱食度', pet.hunger, '#f0a94a')}
            ${statBar('💗 心情', pet.happiness, '#ef7d84')}
            ${statBar('⚡ 精力', pet.energy, '#8bb89a')}
            ${statBar('🤝 亲密度', Math.min(100, pet.bond), '#8b7bd8')}
          </div>
          <p class="tiny muted" style="margin-top:10px">离线时状态变化很温和，最低也会保持在“有一点饿”，不会生病或离开。</p>
        </section>
        <section class="pet-coin-card"><span class="coin">🪙</span><div><strong>${state.wallet.coins}</strong> 金币<small>今天已赚 ${state.todayCoins} 枚 · 完成学习可继续获得</small></div></section>
        <section class="card">
          <div class="card-title"><div><h3>今天的小任务</h3><span class="hint">已和伙伴完成 ${questsDone} 项</span></div></div>
          ${state.quests.map(quest => `<div class="mini-quest ${quest.done ? 'done' : ''}"><span class="qdot">${quest.done ? '✓' : ''}</span><span>${esc(quest.label)}</span></div>`).join('')}
          <a class="btn small soft full" href="#/plans" style="margin-top:10px">去完成今日计划</a>
        </section>
        <section class="card">
          <div class="card-title"><h3>关于金币</h3></div>
          <p class="small muted">金币来自真实的学习完成：首通课时、完成单元、完成计划。重复学习不会重复发币；金币只兑换虚拟装扮与小物，不影响课程。</p>
        </section>
      </aside>
    </div>`;

  document.querySelectorAll('[data-pet-tab]').forEach(button => button.addEventListener('click', () => ctx.navigate(`#/pet?tab=${button.dataset.petTab}`)));

  async function interact(action, itemCode) {
    try {
      const result = await request('/api/pet/interact', { method: 'POST', body: { childId: child.id, action, itemCode } });
      toast(result.reaction?.text || '小伙伴很开心', 'success', 2600);
      if (result.levelUp) {
        celebrate({ title: '伙伴升级啦！', subtitle: `Lv.${result.pet.level} · ${result.pet.name}`, emoji: '🎈', rewards: { exp: 0 }, petHtml: petSvg(result.pet.species, 'excited', result.pet.equipped, 120), note: '它越来越喜欢和你一起学习了。', onClose: () => renderPet(root, ctx) });
      } else {
        window.dispatchEvent(new CustomEvent('pet:updated'));
        await renderPet(root, ctx);
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'feed') return openFeedChooser();
    void interact(action);
  }));
  document.querySelectorAll('[data-feed-item]').forEach(button => button.addEventListener('click', () => interact('feed', button.dataset.feedItem)));
  document.querySelectorAll('[data-buy]').forEach(button => button.addEventListener('click', async () => {
    const item = state.shop.find(entry => entry.code === button.dataset.buy);
    if (item.price >= 60 && !(await confirmDialog({ title: '兑换小惊喜', message: `用 ${item.price} 金币兑换「${item.name}」吗？金币只影响装扮与小物。`, confirmText: '兑换' }))) return;
    try {
      const result = await request('/api/pet/shop/buy', { method: 'POST', body: { childId: child.id, code: button.dataset.buy, qty: 1 } });
      toast(result.message, 'success');
      window.dispatchEvent(new CustomEvent('pet:updated'));
      await renderPet(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-equip]').forEach(button => button.addEventListener('click', async () => {
    try {
      const equipped = button.dataset.equipped !== '1';
      await request('/api/pet/equip', { method: 'POST', body: { childId: child.id, code: button.dataset.equip, equipped } });
      toast(equipped ? '换上新衣服啦' : '衣服收进衣橱了', 'success');
      window.dispatchEvent(new CustomEvent('pet:updated'));
      await renderPet(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));

  function openFeedChooser() {
    openModal({
      title: `喂${pet.name}一点好吃的`,
      subtitle: '基础小饼干免费；买了的零食是额外的小惊喜',
      body: `<div class="stack">
        <button class="inv-item" type="button" id="freeFeed" style="width:100%;text-align:left;background:#fff7e8">
          <span class="em">🍪</span><div><strong>免费小饼干</strong><small>饱食度 +18 · 心情 +3 · 不会花金币</small></div><span class="equip-btn">喂它</span>
        </button>
        ${foods.length ? foods.map(item => `<button class="inv-item" type="button" data-modal-feed="${esc(item.item_code)}" style="width:100%;text-align:left">
          <span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.description)} · 存粮 ×${item.qty}</small></div><span class="equip-btn">喂它</span>
        </button>`).join('') : '<p class="small muted">背包里没有存粮，免费小饼干也很好。</p>'}
      </div>`,
      footer: '<button class="btn ghost" data-close type="button">先不喂</button>',
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#freeFeed').addEventListener('click', () => { close(); void interact('feed'); });
        modal.querySelectorAll('[data-modal-feed]').forEach(button => button.addEventListener('click', () => { close(); void interact('feed', button.dataset.modalFeed); }));
      },
    });
  }
}

function statBar(label, value, color) {
  return `<div class="pet-stat"><div class="row"><span>${label}</span><b>${Math.round(value)}</b></div><div class="track"><i style="width:${Math.max(2, Math.min(100, value))}%;background:${color}"></i></div></div>`;
}

function petLabelText(meta) {
  return `${meta.label} · ${meta.tagline}`;
}

async function renderAdoption(root, ctx, child, state) {
  let selected = 'bunny';
  root.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">FIND A FRIEND</div><h2>领养一只小伙伴</h2>
      <p>它会陪你学习、听你说今天发生了什么，也会在完成计划时为你庆祝。</p></div>
      <a class="btn ghost small" href="#/home">回首页</a></div>
    <div class="adopt-panel">
      <section class="card">
        <div class="adopt-grid">
          ${SPECIES.map((species, index) => {
            const meta = speciesMeta(species);
            const mood = index === 0 ? 'happy' : index === 1 ? 'excited' : 'happy';
            return `<button class="adopt-card ${index === 0 ? 'selected' : ''}" type="button" data-species="${species}">
              ${petSvg(species, mood, [], 130)}<h4>${esc(meta.label)}</h4><p>${esc(meta.tagline)}</p>
            </button>`;
          }).join('')}
        </div>
        <div class="form-row" style="max-width:460px;margin:0 auto">
          <div class="field"><label>给它起个名字</label><input class="input" id="petName" maxlength="10" placeholder="例如：团子"></div>
          <div class="field"><label>领养礼物</label><div class="input" style="display:flex;align-items:center;background:#fff7e3">🪙 20 金币 · 🍪 免费小饼干</div></div>
        </div>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn large" type="button" id="adoptPet">带它回家</button>
        </div>
        <p class="tiny muted" style="text-align:center;margin-top:10px">伙伴不会生病或离开；离线时状态变化很温和。每个孩子一位伙伴。</p>
      </section>
    </div>`;
  root.querySelectorAll('[data-species]').forEach(button => button.addEventListener('click', () => {
    selected = button.dataset.species;
    root.querySelectorAll('[data-species]').forEach(el => el.classList.toggle('selected', el === button));
  }));
  root.querySelector('#adoptPet').addEventListener('click', async () => {
    const name = root.querySelector('#petName').value.trim();
    if (!name) { toast('先给伙伴起个名字吧', 'error'); return; }
    try {
      await request('/api/pet/adopt', { method: 'POST', body: { childId: child.id, species: selected, name } });
      celebrate({ title: `${name}来到你身边啦`, subtitle: '从今天起，一起学习、一起长大', emoji: '🏡', rewards: { coins: 20 }, petHtml: petSvg(selected, 'excited', [], 130), note: '完成学习活动可以赚金币，给伙伴换小衣服。', onClose: () => { window.dispatchEvent(new CustomEvent('pet:updated')); ctx.navigate('#/pet'); } });
    } catch (error) { toast(error.message, 'error'); }
  });
}
