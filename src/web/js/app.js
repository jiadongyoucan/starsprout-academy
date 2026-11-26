import {
  bootstrap, clearSession, currentChild, logoutLocal, request, session, saveSession,
  setCurrentChild, childClassLabel,
} from './api.js';
import {
  badge, closeModal, emptyState, esc, fmtDate, fmtDateTime, logo, openModal, toast,
} from './ui.js';
import { renderHome } from './views/home.js';
import { renderCurriculum } from './views/curriculum.js';
import { renderLearn } from './views/learn.js';
import { renderPlans, renderPlanDetail } from './views/plans.js';
import { renderAgent } from './views/agent.js';
import { renderRegistry } from './views/registry.js';
import { renderCommunity } from './views/community.js';
import { renderDevices } from './views/devices.js';
import { renderAccount } from './views/account.js';
import { renderAdmin } from './views/admin.js';
import { renderPet } from './views/pet.js';
import { renderChild } from './views/child.js';
import { petSvg } from './assets.js';
import { openChildModal } from './views/childModal.js';

const state = { meta: null, booted: false, reminders: [], reminderTimer: null, unread: 0, petData: null };

const NAV = [
  { group: '工作台', items: [
    { route: 'home', label: '首页', icon: '🏡', href: '#/home' },
    { route: 'creation', label: '创作中心', icon: '✨', href: '#/creation' },
    { route: 'plans', label: '学习计划', icon: '🗓️', href: '#/plans' },
  ] },
  { group: '成长', items: [
    { route: 'curriculum', label: '课程', icon: '📚', href: '#/curriculum' },
    { route: 'pet', label: '伙伴', icon: '🐾', href: '#/pet' },
    { route: 'community', label: '社区', icon: '🌿', href: '#/community' },
  ] },
  { group: '家庭', items: [
    { route: 'devices', label: '多端', icon: '📱', href: '#/devices' },
    { route: 'account', label: '账户', icon: '⚙️', href: '#/account' },
  ] },
];

const BOTTOM = [
  { route: 'home', label: '首页', icon: '🏡', href: '#/home' },
  { route: 'curriculum', label: '课程', icon: '📚', href: '#/curriculum' },
  { route: 'pet', label: '伙伴', icon: '🐾', href: '#/pet' },
  { route: 'plans', label: '计划', icon: '🗓️', href: '#/plans' },
  { route: 'creation', label: '创作', icon: '✨', href: '#/creation' },
];

const PAGES = {
  home: { title: '首页', subtitle: '今天也一起，慢慢长大' },
  curriculum: { title: '课程体系', subtitle: '四学段 × 五模块，体系化进阶' },
  learn: { title: '互动课时', subtitle: '听一听、说一说、读一读、写一写' },
  plans: { title: '学习计划', subtitle: '生成、纠偏、提醒，一步一步来' },
  agent: { title: '创作中心', subtitle: '把想法变成课程、计划与作品' },
  creation: { title: '创作中心', subtitle: '把想法变成课程、计划与作品' },
  registry: { title: '专家与技能', subtitle: '发布、安装，连接第三方工具' },
  community: { title: '社区广场', subtitle: '健康、相关、经审核的分享' },
  devices: { title: '多端联动', subtitle: '手机制定计划，平板专注学习' },
  account: { title: '账户与隐私', subtitle: '孩子档案、监护授权与数据' },
  admin: { title: '管理后台', subtitle: '运营、审核与模型配置' },
  pet: { title: '我的伙伴', subtitle: '一起学习、一起收集小星星' },
  child: { title: '儿童空间', subtitle: '今天想去哪里冒险？' },
  review: { title: '审核台', subtitle: '社区内容与专家资源审核' },
};

function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return { route: parts[0] || 'home', id: parts[1] || '', query: new URLSearchParams(queryPart || '') };
}

function navigate(hash) {
  if (location.hash === hash) void renderRoute();
  else location.hash = hash;
}

function greeting() {
  const hour = new Date().getHours();
  const name = session.user?.name || '家长';
  if (hour < 6) return `${name}，夜深了，早点休息`;
  if (hour < 11) return `早上好，${name}`;
  if (hour < 14) return `中午好，${name}`;
  if (hour < 18) return `下午好，${name}`;
  return `晚上好，${name}`;
}

async function loadMeta() {
  try {
    state.meta = await request('/api/meta');
  } catch {
    state.meta = { demoMode: false, features: {}, ai: { configured: false } };
  }
}


/* ---------------- auth ---------------- */
function renderAuth(mode = 'login') {
  document.body.classList.remove('kid-mode');
  sessionStorage.removeItem('starsprout.kidLocked');
  const authRoot = document.getElementById('authRoot');
  const shell = document.getElementById('shell');
  shell.hidden = true;
  authRoot.hidden = false;
  document.body.classList.add('auth');
  const demo = state.meta?.demoAccounts || [];
  const setup = !!state.meta?.setupRequired;
  if (setup) mode = 'setup';
  const isSetup = mode === 'setup';
  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  authRoot.innerHTML = `
    <div class="auth-split">
      <section class="auth-hero">
        <div class="auth-brand"><span class="brand-mark"></span>星芽学堂 · StarSprout</div>
        <div>
          <h1 class="auth-headline">每天 20 分钟，<br>陪孩子<em>长成自己的样子</em>。</h1>
          <p class="auth-sub">托班到幼小衔接的体系化课程，AI 帮家长排计划、纠偏、写汇报；一块平板就能开始，照片留痕只在你们家里。</p>
          <div class="auth-points">
            <div class="auth-point"><span class="ico">📚</span><div><strong>体系化，不零散</strong><small>5 大模块 × 4 学段，180+ 互动课时</small></div></div>
            <div class="auth-point"><span class="ico">🤖</span><div><strong>会计划的 AI</strong><small>按进度排课，逾期一键顺延</small></div></div>
            <div class="auth-point"><span class="ico">📱</span><div><strong>手机与平板联动</strong><small>家长推送，孩子打开就能学</small></div></div>
          </div>
        </div>
        <div class="auth-float">
          <div class="glass-card"><strong>🧠 智趣思维 · 小班</strong><small>今天：数字找朋友 · 18 分钟</small></div>
          <div class="glass-card"><strong>🌱 本周计划完成 86%</strong><small>比上周多 12%，继续保持</small></div>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          ${isSetup ? `<div class="pill green" style="margin-bottom:12px">首次初始化</div>`
            : `<div class="auth-tabs">
                <button type="button" class="${isLogin ? 'active' : ''}" data-mode="login">登录</button>
                <button type="button" class="${isRegister ? 'active' : ''}" data-mode="register">创建家庭</button>
              </div>`}
          <h2>${isSetup ? '初始化这台星芽学堂' : isLogin ? '欢迎回来' : '为你的家庭建一个成长空间'}</h2>
          <p class="lede">${isSetup ? '还没有任何账号。创建第一位管理员，然后邀请家人使用。' : isLogin ? '用邮箱登录，继续今天的 20 分钟。' : '30 秒完成注册，马上得到一份两周计划。'}</p>
          <form id="authForm" novalidate>
            ${!isLogin ? `<div class="field"><label for="name">${isSetup ? '管理员称呼' : '你的称呼'}</label><input class="input" id="name" name="name" autocomplete="nickname" placeholder="例如：米粒妈妈" required></div>` : ''}
            ${isSetup ? `<div class="field"><label for="setupToken">初始化令牌 <span class="tiny muted">远程部署必填</span></label><input class="input" id="setupToken" name="setupToken" autocomplete="one-time-code" placeholder="查看启动日志 / SETUP_TOKEN"><p class="tiny muted" style="margin-top:4px">在本机 localhost 初始化可留空。</p></div>` : ''}
            <div class="field"><label for="email">邮箱</label><input class="input" id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
            <div class="field"><label for="password">密码</label><input class="input" id="password" name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="至少 8 位，含字母与数字" required></div>
            ${!isLogin ? `<div class="field"><label for="householdName">家庭名称（可选）</label><input class="input" id="householdName" name="householdName" placeholder="例如：星芽之家"></div>
            <label class="checkline" style="margin-bottom:14px"><input type="checkbox" name="guardian" required> 我是孩子的监护人，同意按《隐私与儿童数据保护说明》处理家庭数据。</label>` : ''}
            <button class="btn large full" type="submit" id="submitBtn">${isSetup ? '创建管理员并开始' : isLogin ? '登录' : '创建并开始'}</button>
          </form>
          ${demo.length && !isSetup ? `<div class="auth-demo">
            <div class="row between"><span class="small muted">演示环境可直接体验（仅限本地）</span><span class="pill plain tiny">演示</span></div>
            <div class="demo-buttons">
              ${demo.map(d => `<button class="demo-btn" type="button" data-demo="${esc(d.email)}" data-pass="${esc(d.password)}"><strong>${esc(d.label)}</strong>${esc(d.email)}</button>`).join('')}
            </div>
          </div>` : ''}
          ${isSetup ? '<p class="tiny muted" style="margin-top:12px">首次初始化只在系统没有任何账号时可用；请使用你自己的邮箱。对外部署请先完成此步骤，再开放访问。</p>' : ''}
          <p class="auth-foot">儿童隐私优先 · 照片需单独授权 · 默认 30 天自动清理</p>
        </div>
      </section>
    </div>`;

  authRoot.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => renderAuth(btn.dataset.mode));
  });
  const form = authRoot.querySelector('#authForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('#submitBtn');
    const data = Object.fromEntries(new FormData(form).entries());
    if (!isLogin && !data.guardian) { toast('请先确认监护人身份与隐私说明', 'error'); return; }
    submit.disabled = true;
    submit.textContent = isSetup ? '初始化中…' : isLogin ? '登录中…' : '创建中…';
    try {
      let payload;
      if (isSetup) payload = await request('/api/setup', { method: 'POST', headers: data.setupToken ? { 'x-setup-token': data.setupToken } : {}, body: { name: data.name, email: data.email, password: data.password, householdName: data.householdName } });
      else if (isLogin) payload = await request('/api/auth/login', { method: 'POST', body: { email: data.email, password: data.password } });
      else payload = await request('/api/auth/register', { method: 'POST', body: { name: data.name, email: data.email, password: data.password, householdName: data.householdName } });
      saveSession(payload);
      if (state.meta) state.meta.setupRequired = false;
      authRoot.hidden = true;
      if (payload.user?.mustChangePassword) {
        await enterApp(true);
        promptPasswordChange();
      } else {
        await enterApp();
        navigate('#/home');
        toast(isSetup ? '管理员已创建，先添加孩子档案吧' : isLogin ? `欢迎回来，${session.user.name}` : '家庭空间已创建，先添加孩子档案吧', 'success');
        if (!isLogin) setTimeout(() => openChildModal(), 500);
      }
    } catch (error) {
      toast(error.message || '操作失败', 'error');
      submit.disabled = false;
      submit.textContent = isSetup ? '创建管理员并开始' : isLogin ? '登录' : '创建并开始';
    }
  });
  authRoot.querySelectorAll('[data-demo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      form.querySelector('#email').value = btn.dataset.demo;
      form.querySelector('#password').value = btn.dataset.pass;
      form.requestSubmit();
    });
  });
}

function promptPasswordChange() {
  openModal({
    title: '请设置新密码',
    subtitle: '当前为临时密码，修改后才能继续使用',
    dismissible: false,
    body: `<form id="forcedPasswordForm">
      <div class="field"><label>当前临时密码</label><input class="input" type="password" name="oldPassword" autocomplete="current-password" required></div>
      <div class="field"><label>新密码</label><input class="input" type="password" name="newPassword" autocomplete="new-password" placeholder="至少 8 位，含字母与数字" required></div>
      <p class="form-hint">修改后旧会话全部失效，并自动为你登录新会话。</p>
    </form>`,
    footer: `<button class="btn" id="forcedSave" type="button">更新密码并继续</button>`,
    onMount(modal) {
      modal.querySelector('#forcedSave').addEventListener('click', async () => {
        const values = Object.fromEntries(new FormData(modal.querySelector('#forcedPasswordForm')).entries());
        const button = modal.querySelector('#forcedSave');
        button.disabled = true; button.textContent = '更新中…';
        try {
          const result = await request('/api/auth/change-password', { method: 'POST', body: values });
          saveSession(result);
          if (session.user) session.user.mustChangePassword = false;
          closeModal();
          await enterApp();
          navigate('#/home');
          toast('密码已更新', 'success');
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false; button.textContent = '更新密码并继续';
        }
      });
    },
  });
}

/* ---------------- shell ---------------- */
function paintAvatar(el, person) {
  if (!el) return;
  if (person?.avatar) el.innerHTML = `<img src="${esc(person.avatar)}" alt="${esc(person.name || '头像')}">`;
  else el.textContent = (person?.name || '星').slice(0, 1);
}

function renderNav() {
  const sideNav = document.getElementById('sideNav');
  const role = session.user?.role || 'parent';
  const groups = NAV.map(group => {
    const items = group.items.map(item => `
      <a class="nav-link" href="${item.href}" data-route="${item.route}" aria-label="${item.label}" title="${item.label}">
        <span class="ni" aria-hidden="true">${item.icon}</span><span>${item.label}</span>
      </a>`).join('');
    return `<div class="nav-group-label">${group.group}</div>${items}`;
  }).join('');
  const staff = ['teacher', 'admin'].includes(role);
  const extra = `${staff ? `<div class="nav-group-label">治理</div>
    <a class="nav-link" href="#/community?tab=review" data-route="review" aria-label="审核台" title="审核台"><span class="ni">🛡️</span><span>审核台</span></a>` : ''}
    ${role === 'admin' ? `<a class="nav-link" href="#/admin" data-route="admin" aria-label="管理后台" title="管理后台"><span class="ni">🧭</span><span>管理后台</span></a>` : ''}`;
  sideNav.innerHTML = groups + extra;

  const bottom = document.getElementById('bottomNav');
  bottom.innerHTML = BOTTOM.map(item => `
    <a href="${item.href}" data-route="${item.route}"><span class="ni" aria-hidden="true">${item.icon}</span><span>${item.label}</span></a>`).join('');

  document.getElementById('userName').textContent = session.user?.name || '家长';
  document.getElementById('userRole').textContent = role === 'admin' ? '管理员' : role === 'teacher' ? '教师' : '家长';
  paintAvatar(document.getElementById('userAvatar'), session.user);
  paintAvatar(document.getElementById('topAvatar'), session.user);
  document.getElementById('brandMark').innerHTML = logo(38);
}

function renderChildSwitcher() {
  const wrap = document.getElementById('childSwitcherWrap');
  const select = document.getElementById('childSwitcher');
  if (!session.children.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  select.innerHTML = session.children.map(child =>
    `<option value="${esc(child.id)}" ${child.id === session.currentChildId ? 'selected' : ''}>${esc(child.name)} · ${esc(childClassLabel(child.class_code))}</option>`,
  ).join('');
}

function markActiveNav(route) {
  const activeRoute = route === 'review' ? 'community' : route === 'learn' ? 'curriculum' : route;
  document.querySelectorAll('[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === activeRoute);
  });
}

function updatePageTitle(route, id) {
  const page = PAGES[route] || PAGES.home;
  document.getElementById('pageTitle').textContent = page.title;
  const subtitle = route === 'home' ? greeting() : page.subtitle;
  document.getElementById('pageSubtitle').textContent = subtitle;
  document.title = `${page.title} · 星芽学堂`;
  if (route === 'plans' && id) document.getElementById('pageTitle').textContent = '计划详情';
}

async function refreshPetChip() {
  if (!session.user) return;
  const child = currentChild();
  const walletEl = document.getElementById('topWallet');
  const moodEl = document.getElementById('topMood');
  const sideEl = document.getElementById('sidePet');
  if (!child) {
    if (walletEl) walletEl.hidden = true;
    if (moodEl) moodEl.hidden = true;
    if (sideEl) sideEl.hidden = true;
    return;
  }
  try {
    const data = await request(`/api/pet?childId=${encodeURIComponent(child.id)}`);
    state.petData = data;
    if (walletEl) {
      walletEl.hidden = false;
      walletEl.innerHTML = `🪙 <b>${data.wallet?.coins || 0}</b>`;
    }
    if (moodEl) {
      moodEl.hidden = false;
      moodEl.innerHTML = data.pet ? `${data.pet.moodFace} <span>${esc(data.pet.name)}</span>` : '🐾 <span>领养伙伴</span>';
    }
    if (sideEl) {
      sideEl.hidden = false;
      const pet = data.pet;
      sideEl.innerHTML = pet
        ? `<div class="sp-row"><span class="sp-avatar">${petSvg(pet.species, pet.mood, pet.equipped, 52)}</span>
            <div><strong>${esc(pet.name)}</strong><small>${esc(pet.moodLabel)} · Lv.${pet.level}</small>
            <span class="sp-coins">🪙 ${data.wallet?.coins || 0} · 去小窝</span></div></div>`
        : `<div class="sp-row"><span class="sp-avatar">🐾</span><div><strong>遇见你的伙伴</strong><small>领养一只，让学习有陪伴</small><span class="sp-coins">去领养 →</span></div></div>`;
      sideEl.onclick = () => navigate('#/pet');
      sideEl.onkeydown = (event) => { if (event.key === 'Enter') navigate('#/pet'); };
      sideEl.tabIndex = 0;
    }
  } catch {
    if (walletEl) walletEl.hidden = true;
    if (moodEl) moodEl.hidden = true;
    if (sideEl) sideEl.hidden = true;
  }
}

async function renderRoute() {
  if (!session.user) { renderAuth('login'); return; }
  window.__petCleanup?.(); window.__petCleanup = null;
  window.__petGeneration = (window.__petGeneration || 0) + 1;
  let { route, id, query } = parseHash();
  if (route === 'agent') { const q = query.toString(); location.replace(`#/creation${q ? `?${q}` : ''}`); return; }
  const kidRoute = route === 'child' || (route === 'learn' && query.get('kid') === '1');
  const kidLocked = sessionStorage.getItem('starsprout.kidLocked') === '1';
  if (kidLocked && !kidRoute) {
    toast('儿童空间已锁定，请家长先解锁', 'info');
    if (location.hash !== '#/child') location.hash = '#/child';
    return;
  }
  if (route === 'child') sessionStorage.setItem('starsprout.kidLocked', '1');
  if (route === 'admin' && session.user.role !== 'admin') {
    toast('没有管理员权限', 'error');
    navigate('#/home');
    return;
  }
  if (route === 'review' && !['teacher', 'admin'].includes(session.user.role)) {
    toast('没有审核权限', 'error');
    navigate('#/home');
    return;
  }
  const view = document.getElementById('view');
  const kidMode = route === 'child' || (route === 'learn' && query.get('kid') === '1');
  document.body.classList.toggle('kid-mode', kidMode);
  markActiveNav(route);
  updatePageTitle(route, id);
  view.innerHTML = '<div class="loading"><div class="spinner"></div><span>正在准备…</span></div>';
  window.scrollTo({ top: 0, behavior: 'instant' });
  const ctx = { route, id, query, meta: state.meta, navigate };
  try {
    if (route === 'home') await renderHome(view, ctx);
    else if (route === 'curriculum') await renderCurriculum(view, ctx);
    else if (route === 'learn') await renderLearn(view, ctx);
    else if (route === 'plans') { id ? await renderPlanDetail(view, ctx) : await renderPlans(view, ctx); }
    else if (route === 'creation') await renderAgent(view, ctx);
    else if (route === 'registry') await renderRegistry(view, ctx);
    else if (route === 'community' || route === 'review') await renderCommunity(view, ctx);
    else if (route === 'devices') await renderDevices(view, ctx);
    else if (route === 'account') await renderAccount(view, ctx);
    else if (route === 'admin') await renderAdmin(view, ctx);
    else if (route === 'pet') await renderPet(view, ctx);
    else if (route === 'child') await renderChild(view, ctx);
    else { view.innerHTML = emptyState('🧭', '页面不存在', '回到首页继续吧', '<a class="btn" href="#/home">回首页</a>'); }
    void refreshPetChip();
  } catch (error) {
    console.error(error);
    view.innerHTML = `<div class="error-box">😥 ${esc(error.message || '页面加载失败')}
      <div class="actions"><button class="btn small ghost" type="button" id="retryView">重新加载</button></div></div>`;
    view.querySelector('#retryView')?.addEventListener('click', () => renderRoute());
  }
}

async function enterApp(skipRoute = false) {
  document.getElementById('authRoot').hidden = true;
  document.getElementById('shell').hidden = false;
  document.body.classList.remove('auth');
  document.body.classList.toggle('kid-mode', false);
  renderNav();
  renderChildSwitcher();
  if (!skipRoute) await renderRoute();
  await refreshPetChip();
  startReminderPolling();
}

/* ---------------- reminders & menus ---------------- */
async function pollReminders() {
  if (!session.user) return;
  try {
    const due = await request('/api/reminders/dispatch', { method: 'POST' });
    for (const reminder of due) {
      toast(`⏰ ${reminder.child_name}：${reminder.message}`, 'info', 6000);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('星芽学堂 · 学习提醒', { body: `${reminder.child_name}：${reminder.message}` });
      }
    }
    const upcoming = await request('/api/reminders/upcoming');
    state.reminders = upcoming;
    state.unread = due.length;
    const dot = document.getElementById('bellDot');
    if (dot) dot.hidden = upcoming.length === 0;
  } catch { /* silent */ }
}

function startReminderPolling() {
  if (state.reminderTimer) return;
  void pollReminders();
  state.reminderTimer = setInterval(pollReminders, 60_000);
}

function openMenu(contentHtml) {
  const root = document.getElementById('menuRoot');
  root.hidden = false;
  root.innerHTML = `<div class="menu-pop" role="menu">${contentHtml}</div>`;
  root.addEventListener('click', (event) => {
    if (event.target === root) closeMenu();
  }, { once: true });
  root.querySelectorAll('[data-menu-close]').forEach(el => el.addEventListener('click', closeMenu));
}
function closeMenu() {
  const root = document.getElementById('menuRoot');
  root.hidden = true;
  root.innerHTML = '';
}

function openUserMenu() {
  const role = session.user?.role;
  const staff = ['teacher', 'admin'].includes(role);
  openMenu(`
    <div style="padding:8px 10px 6px"><strong style="font-size:13px">${esc(session.user?.name || '')}</strong>
      <div class="tiny muted">${esc(session.household?.name || '')} · ${role === 'admin' ? '管理员' : role === 'teacher' ? '教师' : '家长'}</div></div>
    <div class="menu-sep"></div>
    <a href="#/account" data-menu-close>⚙️ 账户与隐私</a>
    <a href="#/devices" data-menu-close>📱 多端联动</a>
    <a href="#/registry" data-menu-close>🧑‍🏫 专家与技能</a>
    ${staff ? '<a href="#/community?tab=review" data-menu-close>🛡️ 审核台</a>' : ''}
    ${role === 'admin' ? '<a href="#/admin" data-menu-close>🧭 管理后台</a>' : ''}
    <div class="menu-sep"></div>
    <button type="button" id="menuLogout">↩️ 退出登录</button>`);
  document.getElementById('menuLogout').addEventListener('click', async () => {
    closeMenu();
    try { await request('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    logoutLocal();
    clearInterval(state.reminderTimer); state.reminderTimer = null;
    renderAuth('login');
  });
}

async function openBellMenu() {
  await pollReminders();
  const items = state.reminders.slice(0, 6).map(reminder => `
    <div style="padding:8px 10px;border-radius:9px;background:var(--surface-2);margin:5px 0">
      <strong style="font-size:11.5px">${esc(reminder.child_name)} · ${esc(fmtDate(reminder.at))}</strong>
      <div class="tiny muted" style="margin-top:2px">${esc(reminder.message)}</div>
    </div>`).join('') || '<p class="small muted" style="padding:8px 10px">暂时没有待发送的提醒。</p>';
  openMenu(`
    <div style="padding:8px 10px 4px"><strong style="font-size:13px">学习提醒</strong></div>
    ${items}
    <div class="menu-sep"></div>
    <a href="#/plans" data-menu-close>查看全部计划 →</a>`);
}

function bindShellEvents() {
  document.getElementById('childSwitcher')?.addEventListener('change', (event) => {
    setCurrentChild(event.target.value);
    void renderRoute();
  });
  document.getElementById('bellBtn')?.addEventListener('click', () => void openBellMenu());
  document.getElementById('topAvatar')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openUserMenu();
  });
  document.getElementById('userMenuBtn')?.addEventListener('click', openUserMenu);
  document.getElementById('menuBtn')?.addEventListener('click', () => {
    openMenu(`
      <div class="nav-group-label">导航</div>
      ${NAV.flatMap(g => g.items).map(item => `<a href="${item.href}" data-menu-close>${item.icon} ${item.label}</a>`).join('')}
      ${['teacher', 'admin'].includes(session.user?.role) ? '<a href="#/community?tab=review" data-menu-close>🛡️ 审核台</a>' : ''}
      ${session.user?.role === 'admin' ? '<a href="#/admin" data-menu-close>🧭 管理后台</a>' : ''}
      <div class="menu-sep"></div>
      <button type="button" id="mobileAddChild">➕ 添加孩子档案</button>`);
    document.getElementById('mobileAddChild')?.addEventListener('click', () => { closeMenu(); openChildModal(); });
  });
  window.addEventListener('hashchange', () => void renderRoute());
  window.addEventListener('auth:expired', () => {
    clearInterval(state.reminderTimer); state.reminderTimer = null;
    toast('登录已过期，请重新登录', 'error');
    renderAuth('login');
  });
  window.addEventListener('pet:updated', () => { void refreshPetChip(); });
  window.addEventListener('children:updated', async () => {
    await bootstrap();
    renderChildSwitcher();
    void renderRoute();
  });
  window.addEventListener('online', () => toast('网络已恢复', 'success'));
  window.addEventListener('offline', () => toast('网络已断开，部分内容可离线查看', 'error'));
}

/* ---------------- boot ---------------- */
async function init() {
  document.getElementById('brandMark').innerHTML = logo(38);
  await loadMeta();
  if (!state.meta?.features?.curriculumLessons) {
    // meta may be unavailable on first boot; the API will surface errors elsewhere
  }
  const ok = await bootstrap();
  bindShellEvents();
  if (ok) {
    document.getElementById('authRoot').hidden = true;
    if (session.user?.mustChangePassword) {
      await enterApp(true);
      promptPasswordChange();
    } else {
      await enterApp();
    }
  } else {
    renderAuth('login');
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  state.booted = true;
}

init().catch((error) => {
  console.error(error);
  const authRoot = document.getElementById('authRoot');
  authRoot.hidden = false;
  authRoot.innerHTML = `<div style="padding:40px;max-width:520px;margin:8vh auto" class="card">
    <h2 style="font-size:20px">页面加载失败</h2>
    <p class="muted" style="margin:10px 0 16px">${esc(error.message || '未知错误')}</p>
    <button class="btn" id="bootRetry">刷新重试</button></div>`;
  authRoot.querySelector('#bootRetry')?.addEventListener('click', () => location.reload());
});
