import { currentChild, request } from '../api.js';
import { emptyState, esc, loading, localToday, openModal, toast } from '../ui.js';
import { moodLine, petSvg } from '../assets.js';

export async function renderChild(root, ctx) {
  const child = currentChild();
  if (!child) {
    root.innerHTML = emptyState('🧒', '先请家长添加孩子档案', '伙伴和冒险都在等你。', '<a class="btn" href="#/home">回家长空间</a>');
    return;
  }
  root.innerHTML = loading('正在把今天的冒险铺好…');
  let petState = null;
  let plans = [];
  let warmth = null;
  try {
    [petState, plans, warmth] = await Promise.all([
      request(`/api/pet?childId=${encodeURIComponent(child.id)}`).catch(() => null),
      request(`/api/plans?childId=${encodeURIComponent(child.id)}`).catch(() => []),
      request(`/api/warmth?audience=child&context=child&childId=${encodeURIComponent(child.id)}`).catch(() => null),
    ]);
  } catch (error) {
    root.innerHTML = `<div class="kid-error">😥 ${esc(error.message)}<div><button class="btn" id="kidRetry">再试一次</button></div></div>`;
    root.querySelector('#kidRetry').addEventListener('click', () => renderChild(root, ctx));
    return;
  }
  const pet = petState?.pet || null;
  const active = (plans || []).find(plan => plan.status === 'active') || (plans || [])[0];
  let items = [];
  if (active) {
    try {
      const detail = await request(`/api/plans/${encodeURIComponent(active.id)}`);
      const today = localToday();
      items = (detail.items || []).filter(item => item.date >= today).slice(0, 3);
      if (!items.length) items = (detail.items || []).filter(item => item.status !== 'done').slice(0, 3);
    } catch { /* a plan can be archived while opening */ }
  }
  if (!items.length) items = [];
  const first = items.find(item => item.status !== 'done');
  const startHref = first?.lesson_id
    ? `#/learn/${encodeURIComponent(first.lesson_id)}?planItem=${encodeURIComponent(first.id)}&kid=1`
    : '#/child';
  const petLine = warmth?.text || (pet ? moodLine(pet.mood, pet.name) : '今天也有人在等你一起出发。');
  const stickers = petState?.badges || [];
  const completed = items.filter(item => item.status === 'done').length;
  const greeting = greetingForChild(child.name);

  root.innerHTML = `
  <div class="kid-world">
    <div class="kid-sky" aria-hidden="true">
      <span class="kid-sun"></span><span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span>
      <span class="rainbow"></span><span class="hill h1"></span><span class="hill h2"></span><span class="flower f1">🌼</span><span class="flower f2">🌷</span><span class="flower f3">🍄</span>
    </div>
    <header class="kid-top">
      <button class="kid-parent-link" id="kidExit" type="button">← 家长空间</button>
      <div class="kid-top-badge">今日小冒险</div>
      <div class="kid-top-right"><span>🪙 ${petState?.wallet?.coins ?? 0}</span><span>🏅 ${stickers.length}</span></div>
    </header>
    <main class="kid-main">
      <section class="kid-hero">
        <div class="kid-hello">
          <div class="kid-eyebrow">HELLO, ${esc(child.name.toUpperCase())}</div>
          <h1>${esc(greeting)}，<br>今天想去哪里冒险？</h1>
          <p>${items.length ? `有 ${items.length} 个小站等着你。完成一个，就盖一个印章。` : '今天没有安排，也可以随便挑一件喜欢的事做。'}</p>
          <div class="kid-hero-actions">
            <a class="kid-big-btn" id="kidStart" href="${startHref}">${first ? '开始今天的冒险' : '和伙伴玩一会儿'} <span>→</span></a>
            <button class="kid-soft-btn" type="button" id="kidMapJump">看看我的地图</button>
          </div>
        </div>
        <div class="kid-pet-card">
          <div class="kid-speech" aria-live="polite">${esc(petLine)}</div>
          <div class="kid-pet-stage">${pet ? petSvg(pet.species, pet.mood, pet.equipped, 190) : petSvg('bunny', 'happy', [], 170)}</div>
          <div class="kid-pet-name">${pet ? `${esc(pet.name)} · Lv.${pet.level}` : '还没有伙伴'}</div>
          <div class="kid-pet-actions">
            ${pet ? `<button class="kid-chip" type="button" id="kidHug">抱抱伙伴</button><button class="kid-chip" type="button" id="kidPlay2">玩一会儿</button>` : '<span class="kid-chip">请家长帮忙领养</span>'}
          </div>
        </div>
      </section>

      <section class="kid-map-card">
        <div class="kid-map-head"><div><span class="kid-eyebrow">TODAY'S LITTLE STOPS</span><h2>今天的三个小站</h2></div><span class="kid-progress-pill">${completed}/${items.length || 0} 个印章</span></div>
        ${items.length ? `<div class="kid-path">
          ${items.map((item, i) => `<a class="kid-stop ${item.status === 'done' ? 'done' : ''}" href="#/learn/${encodeURIComponent(item.lesson_id)}?planItem=${encodeURIComponent(item.id)}&kid=1">
            <span class="kid-stop-num">${item.status === 'done' ? '✓' : i + 1}</span>
            <span class="kid-stop-icon">${{ thinking: '🧠', english: '🌍', piano: '🎹', hanzi: '✍️', montessori: '🧩' }[item.subject_code] || '📘'}</span>
            <span class="kid-stop-copy"><strong>${esc(item.title)}</strong><small>${esc(item.subject_name || ({ thinking: '智趣思维', english: '英语', piano: '钢琴', hanzi: '汉字', montessori: '蒙氏工作' }[item.subject_code] || '小活动'))} · ${item.minutes} 分钟</small></span>
            <span class="kid-stop-go">${item.status === 'done' ? '再玩一次' : '出发 →'}</span>
          </a>`).join('')}
        </div>` : `<div class="kid-empty-map"><span>🌈</span><p>今天的地图还是空白的。去挑一个喜欢的活动，就是冒险的开始。</p><button class="kid-big-btn small" type="button" id="kidNoPlanPlay">和伙伴玩一会儿</button></div>`}
        <p class="kid-map-note">做不完也没关系。地图不会跑掉，明天还可以接着走。</p>
      </section>

      <div class="kid-bottom-grid">
        <section class="kid-sticker-card">
          <div class="kid-map-head"><div><span class="kid-eyebrow">MY LITTLE COLLECTION</span><h2>我的贴纸墙</h2></div><span class="kid-progress-pill">${stickers.length} 张</span></div>
          ${stickers.length ? `<div class="kid-stickers">${stickers.slice(0, 8).map(s => `<div class="kid-sticker ${s.type}"><span>${s.type === 'unit' ? '🏅' : '🏆'}</span><small>${esc(s.title)}</small></div>`).join('')}</div>` : `<div class="kid-sticker-empty"><p>完成一个单元或一份计划，就会得到一张贴纸。</p><div class="kid-empty-stickers"><span>+</span><span>+</span><span>+</span></div></div>`}
        </section>
        <section class="kid-choice-card">
          <span class="kid-eyebrow">A TINY CHOICE</span>
          <h2>今天的小心愿</h2>
          <p>如果只想玩一会儿，也可以。学习不差这三分钟。</p>
          <div class="kid-hero-actions">
            ${pet ? `<button class="kid-soft-btn" type="button" id="kidPlay">和伙伴玩一会儿</button>` : '<span class="kid-chip">请家长帮忙领养</span>'}
            <button class="kid-soft-btn" type="button" id="kidMapJump2">看看这周安排</button>
          </div>
        </section>
      </div>
      <p class="kid-footer">你不需要每次都做对。愿意再来一次，就已经很了不起。</p>
    </main>
  </div>`;

  root.querySelector('#kidStart')?.addEventListener('click', (event) => { if (!first) { event.preventDefault(); root.querySelector('#kidPlay')?.click(); } });
  root.querySelector('#kidExit')?.addEventListener('click', () => openParentUnlock(ctx));
  ['#kidMapJump', '#kidMapJump2', '#kidMapJump3'].forEach(selector => root.querySelector(selector)?.addEventListener('click', () => root.querySelector('.kid-map-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  root.querySelector('#kidPlay2')?.addEventListener('click', () => root.querySelector('#kidPlay')?.click());
  root.querySelector('#kidNoPlanPlay')?.addEventListener('click', () => root.querySelector('#kidPlay')?.click());
  root.querySelector('#kidHug')?.addEventListener('click', async () => {
    if (!pet) return;
    try {
      const result = await request('/api/pet/interact', { method: 'POST', body: { childId: child.id, action: 'pet' } });
      toast(result.reaction?.text || '伙伴蹭了蹭你的手', 'success');
      await renderChild(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelector('#kidPlay')?.addEventListener('click', async () => {
    if (!pet) return;
    try {
      const result = await request('/api/pet/interact', { method: 'POST', body: { childId: child.id, action: 'play', itemCode: (petState?.inventory || []).find(item => item.kind === 'toy')?.item_code } });
      toast(result.reaction?.text || '你们玩得很开心', 'success');
      await renderChild(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  });
}

function greetingForChild(name) {
  const hour = new Date().getHours();
  const time = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return `${time}，${name}`;
}

function openParentUnlock(ctx) {
  openModal({
    title: '请家长解锁',
    subtitle: '儿童空间已锁定，输入家长登录密码回到家长视图',
    body: `<div class="field"><label>家长密码</label><input class="input" id="parentUnlockPassword" type="password" autocomplete="current-password" /></div>
      <div id="parentUnlockError" class="form-error" style="display:none"></div>`,
    footer: '<button class="btn ghost" data-close type="button">继续陪孩子</button><button class="btn" id="parentUnlockBtn" type="button">解锁并返回</button>',
    onMount(modal, close) {
      const input = modal.querySelector('#parentUnlockPassword');
      const error = modal.querySelector('#parentUnlockError');
      const submit = async () => {
        const password = input.value;
        if (!password) { error.textContent = '请输入家长密码'; error.style.display = 'block'; return; }
        const btn = modal.querySelector('#parentUnlockBtn');
        btn.disabled = true; btn.textContent = '验证中…';
        try {
          await request('/api/auth/verify-password', { method: 'POST', body: { password } });
          sessionStorage.removeItem('starsprout.kidLocked');
          close();
          if (location.hash === '#/child') location.hash = '#/home';
          else ctx.navigate('#/home');
        } catch (e) {
          error.textContent = e.message;
          error.style.display = 'block';
          btn.disabled = false; btn.textContent = '解锁并返回';
        }
      };
      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.querySelector('#parentUnlockBtn').addEventListener('click', submit);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
      input.focus();
    },
  });
}
