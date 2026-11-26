import { currentChild, request } from '../api.js';
import { celebrate, emptyState, esc, loading, openModal, toast, confirmDialog } from '../ui.js';
import { moodLine, petSvg, speciesMeta } from '../assets.js';

const SPECIES = ['bunny', 'fox', 'dragon'];
const KIND_LABEL = { food: '好吃的', clothing: '小衣服', toy: '小玩具', decor: '房间小物' };

export async function renderPet(root, ctx) {
  window.__petCleanup?.(); window.__petCleanup = null;
  const generation = (window.__petGeneration || 0) + 1; window.__petGeneration = generation;
  const child = currentChild();
  if (!child) { root.innerHTML = emptyState('🧒', '先添加孩子档案', '伙伴会陪孩子一起学习。', '<a class="btn" href="#/home">回首页</a>'); return; }
  root.innerHTML = loading('正在打开伙伴的小窝…');
  let state;
  try { state = await request(`/api/pet?childId=${encodeURIComponent(child.id)}`); }
  catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="petRetry">重试</button></div></div>`;
    root.querySelector('#petRetry').addEventListener('click', () => renderPet(root, ctx));
    return;
  }
  if (generation !== window.__petGeneration) return;
  if (!state.pet) return renderAdoption(root, ctx, child, state);
  const pet = state.pet;
  const tab = ['shop', 'wardrobe', 'inventory'].includes(ctx.query.get('tab')) ? ctx.query.get('tab') : 'shop';
  const inventory = state.inventory;
  const foods = inventory.filter(item => item.kind === 'food');
  const clothing = inventory.filter(item => item.kind === 'clothing');
  const decor = inventory.filter(item => item.kind === 'decor');
  const toys = inventory.filter(item => item.kind === 'toy');
  const speech = moodLine(pet.mood, pet.name);
  const progress = Math.min(100, Math.round((pet.exp % 100)));

  root.innerHTML = `
    <div class="page-head pet-head">
      <div><div class="eyebrow">MY COMPANION</div><h2>${esc(pet.name)}的小窝</h2></div>
      <div class="row">
        <button class="help-btn" type="button" data-tip="金币来自完成课时、单元和计划；只兑换虚拟装扮，不影响学习。" aria-label="金币说明">?</button>
        <span class="wallet-chip">🪙 <b>${state.wallet.coins}</b></span>
        <a class="btn ghost small" href="#/child">儿童模式</a>
      </div>
    </div>
    <div class="pet-layout">
      <section class="pet-room3d-card">
        <div id="pet3dStage" class="pet-3d-stage"></div>
        <div class="pet3d-overlay">
          <div class="pet-speech" id="petSpeech">${esc(speech)}</div>
          <div class="pet-namebar">
            <div class="level-ring" style="--p:${progress}"><b>Lv.${pet.level}</b><small>${progress}%</small></div>
            <div class="pn"><h3 id="petName">${esc(pet.name)}</h3><small id="petMood">${esc(pet.moodLabel)} · 亲密度 ${pet.bond}</small></div>
            <button class="help-btn" type="button" data-tip="拖拽旋转视角；点一下伙伴可以摸摸它。" aria-label="3D 操作说明">?</button>
          </div>
        </div>
        <div class="pet-orbit" id="petOrbit"><button type="button" data-orbit="-1" aria-label="向左转">↺</button><button type="button" data-orbit="1" aria-label="向右转">↻</button></div>
        <div class="pet-actions" id="petActions">
          <button class="action-btn" type="button" data-action="feed"><span class="ico">🥕</span><b>喂食</b></button>
          <button class="action-btn" type="button" data-action="play"><span class="ico">🎾</span><b>玩耍</b></button>
          <button class="action-btn" type="button" data-action="pet"><span class="ico">🤚</span><b>摸摸</b></button>
          <button class="action-btn" type="button" data-action="sleep"><span class="ico">🌙</span><b>睡觉</b></button>
          <button class="action-btn" type="button" data-action="clean"><span class="ico">🫧</span><b>整理</b></button>
        </div>
      </section>

      <aside class="pet-side">
        <section class="card pet-status-card">
          <div class="card-title"><div><h3>${esc(pet.name)}的状态</h3></div><span class="pill">Lv.${pet.level}</span></div>
          <div class="pet-stats">
            ${statBar('🥕 饱食', pet.hunger, '#f0a94a', 'hunger')}
            ${statBar('💗 心情', pet.happiness, '#ef7d84', 'happiness')}
            ${statBar('⚡ 精力', pet.energy, '#8bb89a', 'energy')}
            ${statBar('🤝 亲密', Math.min(100, pet.bond), '#8b7bd8', 'bond')}
          </div>
          <p class="tiny muted pet-note">离线变化很温和，最低也只会“有一点饿”，不会生病或离开。</p>
        </section>
        <section class="card pet-quest-card">
          <div class="card-title"><div><h3>今天的小约定</h3></div><span class="pill">${state.quests.filter(q => q.done).length}/${state.quests.length}</span></div>
          ${state.quests.map(q => `<div class="mini-quest ${q.done ? 'done' : ''}"><span class="qdot">${q.done ? '✓' : ''}</span><span>${esc(q.label)}</span></div>`).join('')}
          <a class="btn small soft full" href="#/plans" style="margin-top:10px">去完成今日计划</a>
        </section>
        <section class="pet-coin-card"><span class="coin">🪙</span><div><strong id="petCoins">${state.wallet.coins}</strong> 金币<small>今天已赚 ${state.todayCoins} 枚</small></div></section>
        <section class="pet-mini-stats">
          <div><b>${state.badges.length}</b><small>张贴纸</small></div>
          <div><b>${decor.length}</b><small>件装饰</small></div>
          <div><b>${toys.length}</b><small>个玩具</small></div>
        </section>
      </aside>
    </div>

    <div class="pet-tabs" role="tablist">
      <button class="pet-tab ${tab === 'shop' ? 'active' : ''}" type="button" data-pet-tab="shop" role="tab">小铺</button>
      <button class="pet-tab ${tab === 'wardrobe' ? 'active' : ''}" type="button" data-pet-tab="wardrobe" role="tab">衣橱</button>
      <button class="pet-tab ${tab === 'inventory' ? 'active' : ''}" type="button" data-pet-tab="inventory" role="tab">背包</button>
    </div>
    <section class="card pet-tab-body" id="petTabBody">
      ${tab === 'shop' ? renderShop(state, pet) : tab === 'wardrobe' ? renderWardrobe(clothing, decor, pet) : renderInventory(inventory, pet)}
    </section>`;

  // Load the 1.27MB 3D engine only on the pet page and only if WebGL exists.
  const stage = root.querySelector('#pet3dStage');
  let view3d = null;
  let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; view3d?.dispose(); view3d = null; window.__petLive = Math.max(0, (window.__petLive || 1) - 1); };
  window.__petCleanup = cleanup;
  window.__petLive = (window.__petLive || 0) + 1;
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
  if (gl) {
    try {
      const { createPet3D } = await import('../pet3d.js');
      if (generation !== window.__petGeneration || !stage.isConnected) { cleanup(); return; }
      view3d = createPet3D({ container: stage, pet, onPat: () => void interact('pet') });
    } catch { view3d = null; }
  }
  if (!view3d) stage.innerHTML = `<div class="pet2d-room"><div class="pet2d-sun"></div><div class="pet2d-cloud c1"></div><div class="pet2d-cloud c2"></div><div class="pet2d-window"></div><div class="pet2d-rug"></div><div class="pet2d-pet" id="pet2dPet" role="button" tabindex="0" aria-label="摸摸${esc(pet.name)}">${petSvg(pet.species, pet.mood, pet.equipped, 300)}</div><div class="pet2d-plant">🪴</div></div>`;
  const bindFallback = () => {
    const el = root.querySelector('#pet2dPet'); if (!el) return;
    el.addEventListener('click', () => void interact('pet'));
    el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void interact('pet'); } });
  };
  bindFallback();
  stage.addEventListener('pet3d-lost', () => { if (view3d) { cleanup(); } stage.innerHTML = `<div class="pet2d-room"><div class="pet2d-sun"></div><div class="pet2d-cloud c1"></div><div class="pet2d-cloud c2"></div><div class="pet2d-window"></div><div class="pet2d-rug"></div><div class="pet2d-pet" id="pet2dPet" role="button" tabindex="0" aria-label="摸摸${esc(pet.name)}">${petSvg(pet.species, pet.mood, pet.equipped, 300)}</div><div class="pet2d-plant">🪴</div></div>`; bindFallback(); root.querySelector('#petOrbit')?.remove(); });

  document.querySelectorAll('[data-pet-tab]').forEach(button => button.addEventListener('click', () => ctx.navigate(`#/pet?tab=${button.dataset.petTab}`)));
  root.querySelectorAll('[data-orbit]').forEach(button => button.addEventListener('click', () => view3d?.orbit(Number(button.dataset.orbit) * 0.22)));
  if (!view3d) root.querySelector('#petOrbit')?.remove();
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (action === 'feed') return openFeedChooser();
    await interact(action);
  }));

  async function interact(action, itemCode) {
    const buttons = [...document.querySelectorAll('[data-action]')];
    buttons.forEach(b => b.disabled = true);
    try {
      const result = await request('/api/pet/interact', { method: 'POST', body: { childId: child.id, action, itemCode } });
      view3d?.playAction(action);
      view3d?.setState(result.pet);
      if (!view3d) animateFallback(action);
      updatePetSide(result);
      toast(result.reaction?.text || '伙伴很开心', 'success', 2400);
      if (result.levelUp) celebrate({ title: '伙伴升级啦', subtitle: `${result.pet.name} · Lv.${result.pet.level}`, emoji: '🎈', rewards: { coins: 0 }, petHtml: petSvg(result.pet.species, 'excited', result.pet.equipped, 120), onClose: () => renderPet(root, ctx) });
    } catch (error) { toast(error.message, 'error'); }
    buttons.forEach(b => b.disabled = false);
  }

  function animateFallback(action) {
    const figure = root.querySelector('#pet2dPet');
    if (!figure) return;
    const fx = document.createElement('span'); fx.className = 'pet2d-fx'; fx.textContent = action === 'feed' ? '🥕' : action === 'play' ? '✨' : action === 'sleep' ? '💤' : action === 'clean' ? '🫧' : '💗';
    figure.parentElement.appendChild(fx); setTimeout(() => fx.remove(), 1500);
    figure.classList.remove('feed', 'play', 'pat', 'sleep', 'clean');
    void figure.offsetWidth;
    figure.classList.add(action);
    setTimeout(() => figure.classList.remove(action), 1600);
  }

  function updatePetSide(result) {
    if (!result?.pet) return;
    const p = result.pet;
    root.querySelector('#petMood').textContent = `${p.moodLabel} · 亲密度 ${p.bond}`;
    root.querySelector('#petSpeech').textContent = result.reaction?.text || moodLine(p.mood, p.name);
    root.querySelector('#petCoins').textContent = result.wallet?.coins ?? state.wallet.coins;
    const values = { hunger: p.hunger, happiness: p.happiness, energy: p.energy, bond: Math.min(100, p.bond) };
    root.querySelectorAll('[data-stat]').forEach(el => {
      const v = values[el.dataset.stat]; if (v == null) return;
      el.querySelector('b').textContent = Math.round(v);
      el.querySelector('i').style.width = `${Math.max(2, v)}%`;
    });
  }

  function openFeedChooser() {
    openModal({
      title: `喂${pet.name}一点好吃的`,
      subtitle: '基础小饼干免费；存粮是额外的小惊喜',
      body: `<div class="stack">
        <button class="choice-row" type="button" id="freeFeed"><span class="em">🍪</span><span><strong>免费小饼干</strong><small>饱食 +18 · 心情 +3 · 不花金币</small></span></button>
        ${foods.map(item => `<button class="choice-row" type="button" data-modal-feed="${esc(item.item_code)}"><span class="em">${esc(item.emoji)}</span><span><strong>${esc(item.name)}</strong><small>存粮 ×${item.qty}</small></span></button>`).join('')}
      </div>`,
      footer: '<button class="btn ghost" data-close type="button">先不喂</button>',
      onMount(modal, close) {
        modal.querySelector('#freeFeed').addEventListener('click', () => { close(); void interact('feed'); });
        modal.querySelectorAll('[data-modal-feed]').forEach(button => button.addEventListener('click', () => { close(); void interact('feed', button.dataset.modalFeed); }));
        modal.querySelector('[data-close]').addEventListener('click', close);
      },
    });
  }

  // tab actions
  document.querySelectorAll('[data-buy]').forEach(button => button.addEventListener('click', async () => {
    const item = state.shop.find(entry => entry.code === button.dataset.buy);
    if (item.price >= 60 && !(await confirmDialog({ title: '兑换小惊喜', message: `用 ${item.price} 金币兑换「${item.name}」吗？`, confirmText: '兑换' }))) return;
    try { const result = await request('/api/pet/shop/buy', { method: 'POST', body: { childId: child.id, code: item.code, qty: 1 } }); toast(result.message, 'success'); await renderPet(root, ctx); }
    catch (error) { toast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-equip]').forEach(button => button.addEventListener('click', async () => {
    try { await request('/api/pet/equip', { method: 'POST', body: { childId: child.id, code: button.dataset.equip, equipped: button.dataset.equipped !== '1' } }); toast('换好啦', 'success'); await renderPet(root, ctx); }
    catch (error) { toast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-feed-item]').forEach(button => button.addEventListener('click', () => interact('feed', button.dataset.feedItem)));

}

function statBar(label, value, color, key) {
  return `<div class="pet-stat" data-stat="${key}"><div class="row"><span>${label}</span><b>${Math.round(value)}</b></div><div class="track"><i style="width:${Math.max(2, Math.min(100, value))}%;background:${color}"></i></div></div>`;
}

function renderShop(state, pet) {
  return `<div class="card-title"><div><h3>宠物小铺</h3></div><span class="pill">🪙 ${state.wallet.coins}</span></div>
    ${['food', 'clothing', 'toy', 'decor'].map(kind => {
      const items = state.shop.filter(item => item.kind === kind);
      return `<h4 class="shop-kind">${KIND_LABEL[kind]}</h4><div class="shop-grid">${items.map(item => {
        const owned = state.inventory.find(inv => inv.item_code === item.code);
        const clothingOwned = item.kind === 'clothing' && owned;
        const can = state.wallet.coins >= item.price && !clothingOwned;
        return `<div class="shop-item ${owned ? 'owned' : ''}"><span class="em">${esc(item.emoji)}</span><h4>${esc(item.name)}</h4><p>${esc(item.description)}</p>
          <div class="row between"><span class="price">🪙 ${item.price}</span><button class="btn small ${can ? '' : 'ghost'}" type="button" data-buy="${esc(item.code)}" ${can ? '' : 'disabled'}>${clothingOwned ? '已拥有' : can ? '兑换' : '金币不足'}</button></div></div>`;
      }).join('')}</div>`;
    }).join('')}
    <p class="tiny muted" style="margin-top:10px">虚拟周边，兑换后可在小窝展示。</p>`;
}

function renderWardrobe(clothing, decor, pet) {
  return `<div class="card-title"><div><h3>小衣橱</h3></div><span class="pill">${clothing.length} 件</span></div>
    ${clothing.length ? `<div class="wardrobe-grid">${clothing.map(item => `<div class="inv-item"><span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>${item.equipped ? '正在穿' : '已拥有'}</small></div><button class="equip-btn" type="button" data-equip="${esc(item.item_code)}" data-equipped="${item.equipped ? '1' : '0'}">${item.equipped ? '脱下' : '穿上'}</button></div>`).join('')}</div>` : '<p class="small muted">还没有小衣服，去小铺看看。</p>'}
    <h4 class="shop-kind">房间小物</h4>
    ${decor.length ? `<div class="inventory-grid">${decor.map(item => `<div class="inv-item"><span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>已摆进小窝</small></div></div>`).join('')}</div>` : '<p class="tiny muted">还没有装饰。</p>'}`;
}

function renderInventory(inventory, pet) {
  return `<div class="card-title"><div><h3>背包</h3></div><span class="pill">${inventory.length} 种</span></div>
    ${inventory.length ? `<div class="inventory-grid">${inventory.map(item => `<div class="inv-item"><span class="em">${esc(item.emoji)}</span><div><strong>${esc(item.name)}</strong><small>${KIND_LABEL[item.kind]} × ${item.qty}</small></div>${item.kind === 'food' ? `<button class="equip-btn" type="button" data-feed-item="${esc(item.item_code)}">喂食</button>` : ''}</div>`).join('')}</div>` : '<p class="small muted">背包空空的。</p>'}`;
}

async function renderAdoption(root, ctx, child, state) {
  let selected = 'bunny';
  root.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">FIND A FRIEND</div><h2>领养一位伙伴</h2></div><a class="btn ghost small" href="#/home">回首页</a></div>
    <div class="adopt-panel"><section class="card">
      <div class="adopt-grid">${SPECIES.map((species, i) => { const meta = speciesMeta(species); return `<button class="adopt-card ${i === 0 ? 'selected' : ''}" type="button" data-species="${species}">${petSvg(species, i === 1 ? 'excited' : 'happy', [], 120)}<h4>${esc(meta.label)}</h4><p>${esc(meta.tagline)}</p></button>`; }).join('')}</div>
      <div class="adopt-form"><div class="field"><label>给它起个名字</label><input class="input" id="petName" maxlength="10" placeholder="例如：团子"></div><button class="btn large" type="button" id="adoptPet">带它回家</button></div>
      <p class="tiny muted" style="text-align:center">基础小饼干免费；伙伴不会生病或离开。</p>
    </section></div>`;
  root.querySelectorAll('[data-species]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.species; root.querySelectorAll('[data-species]').forEach(el => el.classList.toggle('selected', el === button)); }));
  root.querySelector('#adoptPet').addEventListener('click', async () => {
    const name = root.querySelector('#petName').value.trim();
    if (!name) { toast('先起个名字吧', 'error'); return; }
    try { await request('/api/pet/adopt', { method: 'POST', body: { childId: child.id, species: selected, name } }); celebrate({ title: `${name}来啦`, subtitle: '一起学习、一起长大', emoji: '🏡', rewards: { coins: 20 }, petHtml: petSvg(selected, 'excited', [], 120), onClose: () => ctx.navigate('#/pet') }); }
    catch (error) { toast(error.message, 'error'); }
  });
}
