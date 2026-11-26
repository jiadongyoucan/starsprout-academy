import { celebrate, esc, fmtDate, fmtDateTime, loading, localToday, openModal, toast, weekday } from './ui.js';
import { petSvg } from './assets.js';
import { lessonBlocksMarkup, mountLessonInteractions } from './views/learn.js';

const TOKEN_KEY = 'starsprout.device.token';
const CHILD_KEY = 'starsprout.device.child';
let token = localStorage.getItem(TOKEN_KEY) || '';
let eventSource = null;
let pollTimer = null;

const state = {
  profile: null,
  childId: localStorage.getItem(CHILD_KEY) || '',
  inbox: null,
  plan: null,
  lesson: null,
  learningSessionId: '',
  planItem: null,
  startedAt: 0,
  quizCorrect: 0,
  quizTotal: 0,
  quizAnswers: [],
  view: 'home',
};

const app = () => document.getElementById('deviceApp');

async function dapi(path, options = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch {
    throw new Error('网络连接失败，请检查 Wi-Fi');
  }
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (response.status === 401) {
    clearDevice();
    renderPair('设备令牌已失效，请让家长重新生成配对码。');
    throw new Error('设备未配对');
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
  }
  return payload?.data;
}

function clearDevice() {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CHILD_KEY);
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function currentChild() {
  return state.profile?.children?.find(child => child.id === state.childId) || state.profile?.children?.[0] || null;
}

function headerHtml() {
  const profile = state.profile;
  const child = currentChild();
  return `<header class="device-top">
    <a class="brand" href="#" aria-label="学习端首页">
      <span class="brand-mark"></span>
      <span class="brand-text"><strong>星芽学堂</strong><small>学习端</small></span>
    </a>
    <span class="driver" style="flex:1"></span>
    ${profile?.children?.length ? `<label class="device-child"><span class="sr-only">选择孩子</span>
      <select id="deviceChild">${profile.children.map(item => `<option value="${esc(item.id)}" ${item.id === child?.id ? 'selected' : ''}>${esc(item.name)} · ${{ nursery: '托班', junior: '小班', middle: '中班', senior: '大班' }[item.class_code] || item.class_code}</option>`).join('')}</select></label>` : ''}
    <span class="device-status-pill"><span class="device-status online"></span>已连接</span>
    <button class="btn small ghost" id="muteToggle" type="button" aria-pressed="${localStorage.getItem('starsprout.muted') === '1'}">${localStorage.getItem('starsprout.muted') === '1' ? '🔇 静音' : '🔊 声音'}</button>
    <button class="btn small ghost" id="exitDevice" type="button" title="家长密码解锁">家长设置</button>
  </header>`;
}

function bindHeader() {
  document.getElementById('deviceChild')?.addEventListener('change', (event) => {
    state.childId = event.target.value;
    localStorage.setItem(CHILD_KEY, state.childId);
    void renderHome();
  });
  const exitDevice = document.getElementById('exitDevice');
  if (exitDevice) {
    exitDevice.addEventListener('click', () => openParentGate());
  }
  document.getElementById('muteToggle')?.addEventListener('click', () => {
    const next = localStorage.getItem('starsprout.muted') === '1' ? '0' : '1';
    localStorage.setItem('starsprout.muted', next);
    if (next === '1') window.speechSynthesis?.cancel();
    bindHeader();
  });
}

function openParentGate() {
  openModal({
    title: '家长设置',
    subtitle: '退出学习端需要家长密码；孩子无法直接进入设备设置',
    body: `<div class="field"><label>家长登录密码</label><input class="input" id="deviceParentPassword" type="password" autocomplete="current-password" /></div><div id="deviceParentError" class="form-error" style="display:none"></div>`,
    footer: '<button class="btn ghost" data-close type="button">继续学习</button><button class="btn" id="deviceParentSubmit" type="button">验证并退出</button>',
    onMount(modal, close) {
      const input = modal.querySelector('#deviceParentPassword');
      const error = modal.querySelector('#deviceParentError');
      const submit = async () => {
        const button = modal.querySelector('#deviceParentSubmit');
        button.disabled = true; button.textContent = '验证中…';
        try {
          await dapi('/api/device/verify-parent', { method: 'POST', body: { password: input.value } });
          close(); clearDevice(); state.profile = null; renderPair();
        } catch (e) {
          error.textContent = e.message; error.style.display = 'block';
          button.disabled = false; button.textContent = '验证并退出';
        }
      };
      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.querySelector('#deviceParentSubmit').addEventListener('click', submit);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
      input.focus();
    },
  });
}

function renderHandback() {
  app().innerHTML = `${headerHtml()}<main class="device-main"><section class="device-card" style="max-width:520px;margin:40px auto;text-align:center">
    <div style="font-size:54px">🌙</div><h2 style="margin-top:10px">今天到这里啦</h2>
    <p class="device-muted" style="margin-top:8px;font-size:16px;line-height:1.8">把平板交给爸爸妈妈吧。学习记录已经保存，明天再继续。</p>
    <div class="row" style="justify-content:center;margin-top:18px"><button class="btn" id="handbackHome" type="button">回首页</button><button class="btn ghost" id="handbackAgain" type="button">再学一个</button></div>
  </section></main>`;
  bindHeader();
  document.getElementById('handbackHome').addEventListener('click', () => renderHome());
  document.getElementById('handbackAgain').addEventListener('click', () => state.plan ? openPlan(state.plan.plan.id) : renderHome());
}

function renderPair(message = '') {
  state.view = 'pair';
  const secure = window.isSecureContext;
  app().innerHTML = `<div class="device-pair">
    <div class="device-pair-card">
      <div style="display:flex;justify-content:center"><span class="brand-mark" style="width:64px;height:64px;border-radius:20px"></span></div>
      <div class="demo-mode" style="margin-top:14px">StarSprout Learning</div>
      <h1>把学习端交给孩子</h1>
      <p>请让家长在「多端联动」生成 6 位配对码，然后输入到这里。配对码一次性使用，10 分钟内有效。</p>
      ${message ? `<div class="form-error" style="margin-top:14px">${esc(message)}</div>` : ''}
      <form id="pairForm">
        <input class="pair-input" id="pairCode" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" aria-label="6 位配对码" />
        <div class="form-row" style="text-align:left">
          <div class="field"><label>设备名称</label><input class="input" id="deviceName" maxlength="30" value="学习平板"></div>
          <div class="field"><label>设备类型</label><select class="select" id="deviceKind"><option value="ipad">iPad / 平板</option><option value="mac">Mac</option><option value="android">Android 平板</option><option value="web">浏览器</option></select></div>
        </div>
        <button class="btn large full" type="submit" id="pairSubmit">开始配对</button>
      </form>
      ${!secure ? '<div class="deviation" style="margin-top:14px;text-align:left">🔒 摄像头需要 HTTPS 或 localhost。若通过局域网 IP 访问，请让家长按部署文档启用 HTTPS；否则拍照功能不可用，但仍可学习。</div>' : ''}
      <p class="tiny muted" style="margin-top:16px">家长端：<a href="/">打开家长端 ↗</a></p>
    </div>
  </div>`;
  const form = document.getElementById('pairForm');
  const codeInput = document.getElementById('pairCode');
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) { toast('请输入 6 位数字配对码', 'error'); return; }
    const button = document.getElementById('pairSubmit');
    button.disabled = true; button.textContent = '配对中…';
    try {
      const response = await fetch('/api/device/pair', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name: document.getElementById('deviceName').value.trim(), kind: document.getElementById('deviceKind').value }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '配对失败');
      token = payload.data.token;
      localStorage.setItem(TOKEN_KEY, token);
      state.profile = await dapi('/api/device/me');
      state.childId = state.profile.children?.[0]?.id || '';
      localStorage.setItem(CHILD_KEY, state.childId);
      toast('配对成功，等家长推送计划吧', 'success');
      await renderHome();
      connectEvents();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false; button.textContent = '开始配对';
    }
  });
}

async function renderHome() {
  try {
    state.profile = await dapi('/api/device/me');
    state.childId = state.profile.children?.some(child => child.id === state.childId) ? state.childId : (state.profile.children?.[0]?.id || '');
    state.warmth = await dapi('/api/device/warmth').catch(() => null);
    const inbox = await dapi('/api/device/inbox');
    state.inbox = inbox;
    state.view = 'home';
    const pushes = inbox.pushes || [];
    const child = currentChild();
    const hour = new Date().getHours();
    const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    app().innerHTML = `${headerHtml()}
      <main class="device-main">
        <section class="device-hero">
          <div>
            <div class="eyebrow">${esc(inbox.device.name)} · ${esc(fmtDate(new Date().toISOString().slice(0, 10), 'relative'))} ${esc(weekday(new Date().toISOString().slice(0, 10)))}</div>
            <h1>${esc(greeting)}，${esc(child?.name || '小朋友')}</h1>
            <p>${pushes.length ? '今天有一份小冒险，等你打开。' : '今天先休息一下，和伙伴打个招呼吧。'}</p>
            ${state.warmth?.text ? `<div class="device-warm">🌿 ${esc(state.warmth.text)}</div>` : ''}
          </div>
          <div class="emoji" aria-hidden="true">🎈</div>
        </section>

        <div class="device-grid">
          <div class="stack">
            <section class="device-card">
              <div class="row between"><div><h2>收件箱</h2><p class="device-muted">给你的小任务和照片邀请</p></div>
                <button class="btn small ghost" id="refreshInbox" type="button">刷新</button></div>
              <div class="device-inbox" style="margin-top:16px">
                ${pushes.length ? pushes.map(push => {
                  const kind = push.payload?.kind;
                  if (kind === 'photo_request') {
                    return `<div class="push-card photo">
                      <span class="pico">📷</span>
                      <div style="flex:1"><h3>想留一张学习照片吗？</h3>
                        <p>${esc(push.message)}</p>
                        <div class="actions"><button class="btn" type="button" data-photo="${esc(push.id)}">拍一张照片</button>
                          <button class="btn ghost small" type="button" data-dismiss-push="${esc(push.id)}">先不拍</button></div></div>
                    </div>`;
                  }
                  return `<div class="push-card">
                    <span class="pico">🗓️</span>
                    <div style="flex:1"><h3>${esc(push.payload?.title || push.plan_title || '学习计划')}</h3>
                      <p>${esc(push.message)}</p>
                      <p class="tiny muted">${push.payload?.items?.length || 0} 个活动 · ${esc(push.payload?.startDate || '')} 起</p>
                      <div class="actions"><button class="btn" type="button" data-open-plan="${esc(push.payload?.planId || push.plan_id)}" data-push-id="${esc(push.id)}">打开计划</button></div>
                    </div>
                  </div>`;
                }).join('') : `<div class="device-empty"><div class="big">🌤️</div><strong>收件箱是空的</strong><p>今天还没有小任务。先喝口水，等会儿再来看看。</p></div>`}
              </div>
            </section>
          </div>

          <div class="stack">
            <section class="device-card">
              <h3>开始前，先深呼吸</h3>
              <div class="insight" style="margin-top:8px"><span class="ico">🌬️</span><div><p>吸气 3 秒，呼气 3 秒。准备好了，再出发。</p></div></div>
              <div class="insight"><span class="ico">🪑</span><div><p>找一个舒服的位置，屏幕离眼睛一臂远。</p></div></div>
              <div class="insight"><span class="ico">⏱️</span><div><p>学一会儿就可以看看窗外，让眼睛休息。</p></div></div>
            </section>
            <section class="device-card">
              <h3>拍照与隐私</h3>
              <p class="device-muted" style="margin-top:6px">${child?.cameraConsent ? '家人已经准备好接收照片。只有你点「拍照」并确认后，照片才会发送。' : '现在还不能拍照，等家人开启授权。'}</p>
              <p class="tiny muted" style="margin-top:8px">照片只保存在家里，默认 30 天自动清理。</p>
            </section>
            <section class="device-card">
              <h3>设备信息</h3>
              <div class="kv" style="margin-top:8px"><dt>设备</dt><dd>${esc(inbox.device.name)}</dd><dt>连接</dt><dd>${pushes.length ? '已连接' : '安静等着'}</dd></div>
            </section>
          </div>
        </div>
        <p class="device-footer-note">学习记录会被好好保存 · 摄像头只在拍照时短暂开启</p>
      </main>`;
    bindHeader();
    document.getElementById('refreshInbox')?.addEventListener('click', () => renderHome());
    document.querySelectorAll('[data-open-plan]').forEach(button => button.addEventListener('click', () => openPlan(button.dataset.openPlan, button.dataset.pushId)));
    document.querySelectorAll('[data-photo]').forEach(button => button.addEventListener('click', () => {
      const push = pushes.find(item => item.id === button.dataset.photo);
      openPhoto(push);
    }));
    document.querySelectorAll('[data-dismiss-push]').forEach(button => button.addEventListener('click', () => dismissPush(button.dataset.dismissPush)));
    if (child?.cameraConsent === false) {
      document.querySelectorAll('[data-photo]').forEach(button => { button.disabled = true; button.textContent = '还没准备好'; });
    }
  } catch (error) {
    app().innerHTML = `<div class="device-pair"><div class="device-pair-card"><div class="big">😥</div><h1>暂时打不开</h1><p>${esc(error.message)}</p><button class="btn" type="button" id="retryHome">重试</button></div></div>`;
    document.getElementById('retryHome')?.addEventListener('click', () => renderHome());
  }
}

async function openPlan(planId, pushId) {
  if (!planId) { toast('这个推送没有关联计划', 'error'); return; }
  try {
    state.plan = await dapi(`/api/device/plans/${encodeURIComponent(planId)}`);
    if (pushId) dapi(`/api/device/pushes/${encodeURIComponent(pushId)}/ack`, { method: 'POST', body: { status: 'opened' } }).catch(() => {});
    state.view = 'plan';
    renderPlan();
  } catch (error) { toast(error.message, 'error'); }
}

function renderPlan() {
  const data = state.plan;
  if (!data) { void renderHome(); return; }
  const today = localToday();
  const grouped = new Map();
  data.items.forEach(item => {
    if (!grouped.has(item.date)) grouped.set(item.date, []);
    grouped.get(item.date).push(item);
  });
  app().innerHTML = `${headerHtml()}
    <main class="device-main">
      <div class="device-plan-head">
        <button class="btn ghost small" id="planBack" type="button">← 回首页</button>
        <div style="flex:1"><h2>${esc(data.plan.title)}</h2>
          <p class="device-muted">${esc(data.child.name)} · ${esc(fmtDate(data.plan.start_date))} – ${esc(fmtDate(data.plan.end_date))} · 每天 ${data.plan.minutes_per_day} 分钟</p></div>
        <span class="pill">${data.items.filter(item => item.status === 'done').length}/${data.items.length} 完成</span>
      </div>
      <div class="device-plan-list">
        ${[...grouped.entries()].map(([date, items]) => `<section class="device-plan-day">
          <div class="day-head"><span>${esc(fmtDate(date))} ${esc(weekday(date))}${date === today ? ' · 今天' : ''}</span><span>${items.length} 个活动</span></div>
          ${items.map(item => `<div class="device-plan-item ${item.status === 'done' ? 'done' : ''}">
            <span class="emoji">${{ thinking: '🧠', english: '🌍', piano: '🎹', hanzi: '✍️', montessori: '🧩' }[item.subject_code] || '📘'}</span>
            <span class="pm"><strong>${esc(item.title)}</strong><small>${esc(item.subject_name || '')} · ${item.minutes} 分钟 ${item.status === 'done' ? '· 已完成' : ''}</small></span>
            ${item.status === 'done'
              ? '<span class="pill mint">✓ 已完成</span>'
              : item.lesson_id ? `<button class="btn" type="button" data-start-lesson="${esc(item.id)}">开始学习</button>` : '<span class="pill">无课时</span>'}
          </div>`).join('')}
        </section>`).join('')}
      </div>
      <p class="device-footer-note">完成学习后，记录会被好好保存。做不完也没关系，明天可以接着来。</p>
    </main>`;
  bindHeader();
  document.getElementById('planBack').addEventListener('click', () => renderHome());
  document.querySelectorAll('[data-start-lesson]').forEach(button => button.addEventListener('click', () => {
    const item = data.items.find(entry => entry.id === button.dataset.startLesson);
    startLesson(item);
  }));
}

async function startLesson(item) {
  if (!item?.lesson_id) return;
  const child = state.plan?.child || currentChild();
  try {
    const started = await dapi('/api/device/learning/start', {
      method: 'POST', body: { childId: child.id, lessonId: item.lesson_id, planItemId: item.id },
    });
    state.learningSessionId = started.sessionId;
    state.planItem = item;
    state.lesson = await dapi(`/api/device/lessons/${encodeURIComponent(item.lesson_id)}`);
    state.startedAt = Date.now();
    state.quizCorrect = 0;
    state.quizTotal = 0;
    state.quizAnswers = [];
    state.view = 'lesson';
    renderLesson();
  } catch (error) { toast(error.message, 'error'); }
}

function renderLesson() {
  const data = state.lesson;
  const lesson = data.lesson;
  app().innerHTML = `${headerHtml()}
    <main class="device-main">
      <div class="device-lesson">
        <div class="device-lesson-head">
          <button class="btn ghost small" id="lessonBack" type="button">← 返回计划</button>
          <div style="flex:1"><h2>${esc(lesson.title)}</h2>
            <p class="device-muted">${esc(lesson.subject_name)} · ${esc(lesson.class_name)} · ${lesson.minutes} 分钟</p></div>
        </div>
        <div class="lesson-progress">${lesson.blocks.map(() => '<i></i>').join('')}</div>
        ${lesson.source ? `<div class="source-note">📎 来自「${esc(lesson.source.name)}」 · ${esc(lesson.source.license)}</div>` : ''}
        ${lessonBlocksMarkup(lesson)}
        <div class="device-lesson-complete"><button class="btn large" id="deviceComplete" type="button">完成学习 ✓</button></div>
      </div>
      <p class="device-footer-note">你的学习记录会被好好保存；照片只有你主动确认后才会发送。</p>
    </main>`;
  bindHeader();
  document.getElementById('lessonBack').addEventListener('click', () => {
    if (confirm('还没完成，确定返回吗？学习记录会保留在“进行中”。')) {
      dapi(`/api/device/learning/${encodeURIComponent(state.learningSessionId)}/end`, { method: 'POST', body: { status: 'abandoned' } }).catch(() => {});
      renderPlan();
    }
  });
  mountLessonInteractions(app(), lesson, (correct, flatIndex, optionIndex) => {
    state.quizTotal += 1; if (correct) state.quizCorrect += 1;
    if (Number.isInteger(flatIndex)) state.quizAnswers[flatIndex] = optionIndex;
  });
  document.getElementById('deviceComplete').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true; button.textContent = '正在同步…';
    try {
      const result = await dapi('/api/device/progress', {
        method: 'POST',
        body: {
          childId: (state.plan?.child || currentChild()).id,
          lessonId: lesson.id,
          planItemId: state.planItem?.id,
          learningSessionId: state.learningSessionId,
          answers: state.quizAnswers,
          seconds: Math.round((Date.now() - state.startedAt) / 1000),
        },
      });
      celebrate({
        title: '今天的探险完成啦',
        subtitle: `「${lesson.title}」`,
        emoji: '🌟',
        rewards: result.rewards || {},
        petHtml: petSvg(state.plan?.child?.pet?.species || 'bunny', result.rewards?.stars >= 3 ? 'excited' : 'happy', state.plan?.child?.pet?.equipped || [], 110),
        note: '记录已经同步给家长了',
        onClose: () => renderHandback(),
      });
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false; button.textContent = '完成学习 ✓';
    }
  });
}

function openPhoto(push) {
  const child = currentChild();
  if (!child?.cameraConsent) { toast('家长还没有开启拍照授权', 'error'); return; }
  let stream = null;
  let dataUrl = '';
  openModal({
    title: '给家长拍一张学习照片',
    subtitle: '只有你确认后才会发送；照片只保存在家庭服务器',
    wide: true,
    body: `<div id="cameraStage">
      <div class="camera-box" id="cameraBox"><div class="device-empty" style="color:#ddd"><div class="big">📷</div><p>点击下方按钮打开摄像头，或从相册选择</p></div></div>
      <div class="camera-actions">
        <button class="btn" id="startCamera" type="button">打开摄像头</button>
        <button class="btn ghost" id="capturePhoto" type="button" hidden>拍照</button>
        <label class="btn ghost" style="cursor:pointer">从相册选择<input type="file" id="photoFile" accept="image/*" hidden></label>
      </div>
      <div id="photoPreview" hidden>
        <div class="camera-box"><img id="previewImg" alt="照片预览"></div>
        <label class="checkline" style="margin-top:12px"><input type="checkbox" id="photoConsent"> 我同意把这张照片发送给家长</label>
      </div>
      <div class="device-consent" id="photoHint">📷 打开摄像头时，只有本页面能看到画面；关闭后会立即停止。</div>
    </div>`,
    footer: `<button class="btn ghost" data-close type="button">先不拍</button><button class="btn" id="sendPhoto" type="button" disabled>发送给家长</button>`,
    onMount(modal, close) {
      const box = modal.querySelector('#cameraBox');
      const videoHost = () => box.querySelector('video');
      const stop = () => { if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; } };
      const showPreview = (url) => {
        dataUrl = url;
        modal.querySelector('#previewImg').src = url;
        modal.querySelector('#photoPreview').hidden = false;
        modal.querySelector('#sendPhoto').disabled = !modal.querySelector('#photoConsent').checked;
      };
      modal.querySelector('#startCamera').addEventListener('click', async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          modal.querySelector('#photoHint').innerHTML = '⚠️ 当前环境不支持摄像头（需要 HTTPS 或 localhost）。可从相册选择照片。';
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
          box.innerHTML = '<video autoplay playsinline muted></video>';
          videoHost().srcObject = stream;
          await videoHost().play().catch(() => {});
          modal.querySelector('#capturePhoto').hidden = false;
          modal.querySelector('#startCamera').hidden = true;
          modal.querySelector('#photoHint').textContent = '📷 现在可以拍照；照片只在你确认后发送。';
        } catch {
          modal.querySelector('#photoHint').innerHTML = '⚠️ 摄像头不可用或权限被拒绝。可从相册选择照片，或让家长重新检查授权。';
        }
      });
      modal.querySelector('#capturePhoto').addEventListener('click', () => {
        const video = videoHost();
        if (!video) return;
        const canvas = document.createElement('canvas');
        const maxWidth = 1280;
        const ratio = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
        canvas.width = Math.round((video.videoWidth || 1280) * ratio);
        canvas.height = Math.round((video.videoHeight || 960) * ratio);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        showPreview(canvas.toDataURL('image/jpeg', 0.85));
        stop();
        modal.querySelector('#capturePhoto').hidden = true;
        modal.querySelector('#startCamera').hidden = false;
        box.innerHTML = '<div class="device-empty" style="color:#ddd"><p>已拍好，请确认预览</p></div>';
        modal.querySelector('#photoPreview').hidden = false;
      });
      modal.querySelector('#photoFile').addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return; }
        if (file.size > 2_500_000) { toast('照片太大，请选择较小的图片', 'error'); return; }
        const reader = new FileReader();
        reader.onload = () => showPreview(String(reader.result));
        reader.readAsDataURL(file);
        stop();
      });
      modal.querySelector('#photoConsent').addEventListener('change', (event) => {
        modal.querySelector('#sendPhoto').disabled = !event.target.checked || !dataUrl;
      });
      modal.querySelector('#sendPhoto').addEventListener('click', async () => {
        if (!dataUrl) { toast('请先拍照或选择照片', 'error'); return; }
        if (!modal.querySelector('#photoConsent').checked) { toast('需要勾选同意后才能发送', 'error'); return; }
        const button = modal.querySelector('#sendPhoto');
        button.disabled = true; button.textContent = '发送中…';
        try {
          await dapi('/api/device/snapshots', {
            method: 'POST',
            body: { childId: child.id, image: dataUrl, consent: true, learningSessionId: state.learningSessionId || undefined, note: '学习瞬间' },
          });
          await dapi(`/api/device/pushes/${encodeURIComponent(push.id)}/ack`, { method: 'POST', body: { status: 'opened' } }).catch(() => {});
          close(); stop(); toast('照片已发送给家长', 'success'); await renderHome();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false; button.textContent = '发送给家长';
        }
      });
      modal.querySelector('[data-close]').addEventListener('click', () => { stop(); void dismissPush(push.id, true); });
    },
    onClose: () => { if (stream) stream.getTracks().forEach(track => track.stop()); },
  });
}

async function dismissPush(pushId, silent = false) {
  try {
    await dapi(`/api/device/pushes/${encodeURIComponent(pushId)}/ack`, { method: 'POST', body: { status: 'dismissed' } });
    if (!silent) { toast('已告知家长稍后再拍', 'info'); await renderHome(); }
  } catch (error) { if (!silent) toast(error.message, 'error'); }
}

function connectEvents() {
  if (!pollTimer) pollTimer = setInterval(() => { if (state.view === 'home') void renderHome(); }, 30_000);
  if (!token || typeof EventSource === 'undefined') return;
  if (eventSource) eventSource.close();
  try {
    eventSource = new EventSource(`/api/device/events?token=${encodeURIComponent(token)}`);
    eventSource.addEventListener('push', (event) => {
      try {
        const payload = JSON.parse(event.data);
        toast(payload.kind === 'photo_request' ? '家人想看看你的学习瞬间' : `收到新计划：${payload.planTitle || ''}`, 'info', 6000);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('星芽学堂 · 学习端', { body: payload.message || '家长发来了新的学习任务' });
        }
      } catch { /* ignore */ }
      if (state.view === 'home') void renderHome();
    });
    eventSource.addEventListener('revoked', () => {
      clearDevice();
      renderPair('设备已被家长撤销，请重新配对。');
    });
    eventSource.onerror = () => { /* browser retries automatically; polling is the fallback */ };
  } catch { /* ignore */ }
}

async function boot() {
  if (!token) { renderPair(); return; }
  try {
    state.profile = await dapi('/api/device/me');
    state.childId = state.profile.children?.some(child => child.id === state.childId) ? state.childId : (state.profile.children?.[0]?.id || '');
    localStorage.setItem(CHILD_KEY, state.childId);
    await renderHome();
    connectEvents();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch {
    renderPair();
  }
}

boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
