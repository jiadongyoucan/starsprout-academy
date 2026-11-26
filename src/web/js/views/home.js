import { currentChild, childClassLabel, request, session } from '../api.js';
import {
  barChart, emptyState, esc, fmtDate, fmtDateTime, loading, localToday, openModal, subjectMeta, toast,
} from '../ui.js';
import { moodLine, petSvg, petLabel } from '../assets.js';
import { openChildModal } from './childModal.js';

export async function renderHome(root, ctx) {
  const child = currentChild();
  if (!child) {
    root.innerHTML = `<div class="card" style="text-align:center;padding:54px 24px;max-width:620px;margin:40px auto">
      <div style="font-size:60px">🌱</div>
      <h2 class="home-title" style="font-size:28px;margin-top:10px">先为孩子建一份成长档案</h2>
      <p class="muted" style="max-width:34em;margin:10px auto 22px">选择学段，课程体系和计划就会自动适配；孩子还会遇到一位会陪他学习的小伙伴。</p>
      <button class="btn large" id="onboardChild" type="button">添加孩子档案</button>
      <p class="tiny muted" style="margin-top:14px">摄像头授权默认关闭，只在你们需要时开启。</p>
    </div>`;
    root.querySelector('#onboardChild').addEventListener('click', () => openChildModal());
    return;
  }

  root.innerHTML = loading('正在准备今天的冒险…');
  let dashboard;
  let reports = [];
  let petState = null;
  let warmth = null;
  try {
    [dashboard, reports, petState] = await Promise.all([
      request(`/api/analytics/dashboard?childId=${encodeURIComponent(child.id)}&range=week`),
      request(`/api/analytics/reports?childId=${encodeURIComponent(child.id)}`).catch(() => []),
      request(`/api/pet?childId=${encodeURIComponent(child.id)}`).catch(() => null),
    ]);
  } catch (error) {
    const needsConsent = error.code === 'CONSENT_REQUIRED';
    root.innerHTML = `<div class="card" style="max-width:560px;margin:40px auto;text-align:center">
      <div style="font-size:44px">${needsConsent ? '🔐' : '😥'}</div>
      <h2 style="font-size:21px;margin-top:8px">${needsConsent ? '需要监护人授权学习分析' : '暂时加载失败'}</h2>
      <p class="muted" style="margin:8px 0 16px">${esc(error.message)}</p>
      <div class="row" style="justify-content:center">
        ${needsConsent ? '<a class="btn" href="#/devices">去开启授权</a>' : '<button class="btn small ghost" id="retry">重试</button>'}
      </div></div>`;
    root.querySelector('#retry')?.addEventListener('click', () => renderHome(root, ctx));
    return;
  }

  const metrics = dashboard.metrics;
  const okForWarmth = metrics.completed >= 2 ? 1 : 0;
  const warmthHistory = readWarmthHistory(child.id);
  warmth = await request(`/api/warmth?audience=parent&context=home&childId=${encodeURIComponent(child.id)}&ok=${okForWarmth}&exclude=${encodeURIComponent(warmthHistory.slice(-6).join('|'))}`).catch(() => null);
  const todayItems = dashboard.todayPlan?.items || [];
  const pendingToday = todayItems.filter(item => item.status === 'pending');
  const doneToday = todayItems.filter(item => item.status === 'done').length;
  const firstPending = pendingToday[0];
  const next = firstPending || (dashboard.nextLesson ? { lesson_id: dashboard.nextLesson.id, title: dashboard.nextLesson.title, minutes: dashboard.nextLesson.minutes } : null);
  const startHref = next?.lesson_id
    ? `#/learn/${encodeURIComponent(next.lesson_id)}${firstPending ? `?planItem=${encodeURIComponent(firstPending.id)}` : ''}`
    : '#/curriculum';
  const latestReport = reports[0];
  const pet = petState?.pet || null;
  const wallet = petState?.wallet || { coins: 0 };
  const petGreeting = pet ? moodLine(pet.mood, pet.name) : '还没有小伙伴，领养一只陪你一起学习吧';
  const greeting = greetingForChild(child.name);
  const todayStr = localToday();
  const quests = petState?.quests || [];

  root.innerHTML = `
    <section class="home-hero">
      <div class="home-hero-copy">
        <div class="hero-eyebrow">A LITTLE ADVENTURE EVERY DAY</div>
        <h1 class="home-title">${esc(greeting)}，<br><em>今天也一起长大一点点。</em></h1>
        <p class="home-sub">${todayItems.length
          ? `今天有 ${todayItems.length} 个小活动，已完成 ${doneToday} 个。${pendingToday.length ? `接下来是「${esc(pendingToday[0].title)}」。` : '今天的计划完成啦，去和小伙伴庆祝一下吧。'}`
          : '今天还没有排计划。花一分钟生成一份，或直接挑一个 15 分钟的活动开始。'}</p>
        <div class="hero-pills">
          <span class="pill primary">${esc(child.name)} · ${esc(childClassLabel(child.class_code))}</span>
          <span class="pill">🌱 今天也在，就很好</span>
          <span class="pill">🪙 ${wallet.coins} 金币</span>
          ${todayItems.length ? `<span class="pill mint">今天完成 ${doneToday} 个</span>` : ''}
        </div>
        <div class="hero-actions">
          <a class="btn" href="${startHref}">${next ? '开始今天的学习' : '去选一节课'}</a>
          <a class="btn ghost" href="#/plans">制定 / 调整计划</a>
          <a class="btn ghost" href="#/agent">和智能体聊聊</a>
        </div>
      </div>
      <div class="pet-spotlight" id="petSpotlight" role="link" tabindex="0" aria-label="去看我的伙伴">
        <div class="pet-bubble">${esc(petGreeting)}</div>
        <div class="ps-stage">${pet ? petSvg(pet.species, pet.mood, pet.equipped, 150) : `<div style="display:flex;gap:4px">${petSvg('bunny', 'sad', [], 76)}${petSvg('fox', 'happy', [], 76)}${petSvg('dragon', 'excited', [], 76)}</div>`}</div>
        <div class="ps-name">${pet ? esc(pet.name) : '领养一只小伙伴'}</div>
        <div class="ps-meta">${pet ? `${esc(petLabel(pet.species))} · Lv.${pet.level} · ${esc(pet.moodLabel)}` : '喂食、玩耍、一起收集小星星'}</div>
        ${pet ? `<div class="ps-bars">
          <span><i style="width:${pet.hunger}%;background:#f0a94a"></i></span>
          <span><i style="width:${pet.happiness}%;background:#ef7d84"></i></span>
          <span><i style="width:${pet.energy}%;background:#8bb89a"></i></span>
        </div>` : '<div class="ps-meta" style="margin-top:8px">点击领养 →</div>'}
      </div>
    </section>

    <section class="stat-strip">
      ${statCard('📚', '这一周完成', metrics.completed, '个小活动', deltaText(metrics.delta?.completed))}
      ${statCard('⏱️', '一起度过', metrics.minutes, '分钟', deltaText(metrics.delta?.minutes))}
      ${statCard('🌱', '这一周有学习', metrics.activeDays, '天', '慢慢来，也算数')}
    </section>

    <div class="home-grid">
      <div class="home-main">
        <section class="card">
          <div class="card-title">
            <div><h3>今日安排</h3><span class="hint">${esc(fmtDate(todayStr, 'relative'))} · ${todayItems.length} 个活动</span></div>
            <a class="btn small ghost" href="#/plans">查看计划</a>
          </div>
          ${todayItems.length ? `<div class="today-plan">
            ${todayItems.map(item => `
              <a class="today-item ${item.status === 'done' ? 'done' : ''}" href="#/learn/${encodeURIComponent(item.lesson_id)}?planItem=${encodeURIComponent(item.id)}">
                <span class="emoji" style="color:${esc(subjectMeta(item.subject_code).color)}">${subjectMeta(item.subject_code).icon}</span>
                <span class="meta"><strong>${esc(item.title)}</strong><small>${esc(item.subject_name)} · ${item.minutes} 分钟 · ${statusLabel(item.status)}</small></span>
                <span class="go">${item.status === 'done' ? '已完成 ✓' : '开始 →'}</span>
              </a>`).join('')}
          </div>` : emptyState('🗓️', '今天还是空白的', '用两周计划把它填满，或直接挑一节课开始。', '<a class="btn small" href="#/plans">生成计划</a>')}
        </section>

        <section class="card">
          <div class="card-title">
            <div><h3>这一周的小脚步</h3><span class="hint">每天 15–25 分钟就很好</span></div>
            <span class="pill mint">${metrics.activeDays} / 7 天有学习</span>
          </div>
          ${barChart(dashboard.series, { todayStr })}
        </section>

        <section class="card">
          <div class="card-title"><div><h3>他在慢慢长大</h3><span class="hint">按${esc(childClassLabel(child.class_code))}课程体系统计</span></div>
            <a class="btn small ghost" href="#/curriculum">课程体系</a></div>
          <div>
            ${(dashboard.overall || []).map(subject => `
              <div class="subject-line">
                <span class="ico" style="color:${esc(subject.color)}">${subject.icon}</span>
                <div>
                  <div class="row between"><strong style="font-size:12.5px">${esc(subject.name)}</strong><span class="tiny muted">${subject.completed}/${subject.total} 课时</span></div>
                  <div class="meter"><i style="width:${subject.percent}%;background:${esc(subject.color)}"></i></div>
                </div>
                <span class="pct">${subject.percent}%</span>
              </div>`).join('')}
          </div>
        </section>
      </div>

      <div class="home-side">
        <section class="warm-card" id="warmCard">
          <div class="warm-pin"></div>
          <div class="warm-kicker">${warmth ? ({ parent_warm: '给你的一句话', parent_humor: '轻松一下', parent_selfcare: '照顾自己' }[warmth.kind] || '给你的一句话') : '给你的一句话'}</div>
          <p class="warm-text" aria-live="polite">${esc(warmth?.text || '今天不必做满分父母。你在场，就已经很重要。')}</p>
          <div class="warm-foot"><span>🌿 星芽树洞</span><button class="warm-refresh" id="refreshWarmth" type="button">换一句 ↻</button></div>
        </section>
        <section class="card soft">
          <div class="card-title"><div><h3>今天的小约定</h3><span class="hint">完成就有小伙伴的回应</span></div><span class="pill primary">${quests.filter(q => q.done).length}/${quests.length || 4}</span></div>
          ${quests.length ? quests.map(quest => `<div class="mini-quest ${quest.done ? 'done' : ''}"><span class="qdot">${quest.done ? '✓' : ''}</span><span>${esc(quest.label)}</span></div>`).join('') : '<p class="small muted">领养伙伴后解锁每日任务。</p>'}
          <div class="row" style="margin-top:12px"><a class="btn small soft" href="#/pet">去看伙伴</a></div>
        </section>

        <section class="card soft">
          <div class="card-title"><div><h3>一点小发现</h3><span class="hint">${dashboard.ai?.engine === 'llm-assisted' ? 'AI 参与分析' : '基于真实记录的本地分析'}</span></div><span class="pill primary">✨</span></div>
          ${(dashboard.insights || []).map(insight => `
            <div class="insight ${esc(insight.tone)}">
              <span class="ico">${insight.tone === 'positive' ? '🌿' : insight.tone === 'focus' ? '🎯' : '💡'}</span>
              <div><strong>${esc(insight.title)}</strong><p>${esc(insight.text)}</p></div>
            </div>`).join('')}
          <p class="tiny muted" style="margin-top:8px">${esc(dashboard.ai?.disclosure || '')}</p>
        </section>

        ${dashboard.nextLesson ? `<a class="next-card" href="#/learn/${encodeURIComponent(dashboard.nextLesson.id)}">
          <span class="big">${dashboard.nextLesson.icon || '📘'}</span>
          <div><small>下一步建议</small><strong>${esc(dashboard.nextLesson.title)}</strong><small>${esc(dashboard.nextLesson.subject_name)} · ${dashboard.nextLesson.minutes} 分钟</small></div>
          <span class="spacer"></span><span>→</span>
        </a>` : ''}

        <section class="card">
          <div class="card-title"><div><h3>值得记住的小事</h3><span class="hint">把坚持变成看得见的礼物</span></div><span class="pill">🪙 ${wallet.coins}</span></div>
          ${pet ? `<div class="milestone-card"><span class="m-emoji">🎁</span><div><strong>${pet.level >= 5 ? '伙伴已经长大很多啦' : '给伙伴的小礼物'}</strong><p>用学习赚来的金币，给${esc(pet.name)}换一件小衣服，或添一件房间小物。不着急，慢慢来。</p></div></div>` : `<div class="milestone-card"><span class="m-emoji">🐾</span><div><strong>还没有小伙伴</strong><p>领养一只团子兔、小橘狐或芽芽龙，让学习有陪伴。</p><a class="tiny" href="#/pet">去领养 →</a></div></div>`}
          <div class="row" style="margin-top:12px"><a class="btn small ghost" href="#/pet?tab=shop">逛宠物小铺</a><a class="btn small ghost" href="#/pet?tab=wardrobe">打开衣橱</a></div>
        </section>

        <section class="card">
          <div class="card-title"><div><h3>给家长的一封小信</h3><span class="hint">${latestReport ? `最近更新 ${esc(fmtDateTime(latestReport.created_at))}` : '还没有生成过'}</span></div></div>
          ${latestReport ? `<p style="font-size:12.5px;line-height:1.75">${esc(latestReport.summary)}</p>
            <div class="row" style="margin-top:10px"><span class="pill ${latestReport.metrics?.engine === 'llm-assisted' ? 'primary' : ''}">${latestReport.metrics?.engine === 'llm-assisted' ? 'AI 生成' : '数据驱动'}</span>
            <a class="btn small ghost" href="#/account">更多报告</a></div>`
            : `<p class="small muted">用一分钟看看孩子这一周的投入、学科均衡与计划坚持度。</p>`}
          <button class="btn small soft full" id="genReport" type="button" style="margin-top:12px">生成${latestReport ? '新的' : '本周'}汇报</button>
        </section>
      </div>
    </div>`;

  if (warmth?.text) localStorage.setItem(warmthHistoryKey(child.id), JSON.stringify([...warmthHistory, warmth.text].slice(-7)));
  const petLink = () => ctx.navigate('#/pet');
  root.querySelector('#petSpotlight')?.addEventListener('click', petLink);
  root.querySelector('#petSpotlight')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') petLink(); });

  root.querySelector('#refreshWarmth')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const today = localToday();
    const capKey = `starsprout.warmth.refresh.${today}.${child.id}`;
    const used = Number(localStorage.getItem(capKey) || 0);
    if (used >= 2) { toast('今天先留一点期待，明天再换一句。', 'success'); button.textContent = '明天再换'; button.disabled = true; return; }
    button.disabled = true;
    try {
      const history = readWarmthHistory(child.id);
      const next = await request(`/api/warmth?audience=parent&context=home&childId=${encodeURIComponent(child.id)}&ok=${okForWarmth}&fresh=1&exclude=${encodeURIComponent(history.slice(-6).join('|'))}`);
      const card = root.querySelector('#warmCard');
      card.querySelector('.warm-text').textContent = next.text;
      card.querySelector('.warm-kicker').textContent = { parent_warm: '给你的一句话', parent_humor: '轻松一下', parent_selfcare: '照顾自己' }[next.kind] || '给你的一句话';
      localStorage.setItem(warmthHistoryKey(child.id), JSON.stringify([...history, next.text].slice(-7)));
      localStorage.setItem(capKey, String(used + 1));
      if (used + 1 >= 2) { button.textContent = '明天再换'; button.disabled = true; }
      else button.disabled = false;
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });


  root.querySelector('#genReport')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true; btn.textContent = '正在生成…';
    try {
      const report = await request('/api/analytics/reports', { method: 'POST', body: { childId: child.id, period: 'weekly' } });
      openModal({
        title: '本周学习汇报', subtitle: `${report.start} ~ ${report.end}`,
        body: `<div class="ai-note">${esc(report.summary)}</div>
          <h4 style="margin:16px 0 8px;font-size:13px">三个亮点</h4>
          ${report.highlights.map(h => `<div class="insight"><span class="ico">✨</span><div><p>${esc(h)}</p></div></div>`).join('')}
          <h4 style="margin:16px 0 8px;font-size:13px">下周期建议</h4>
          ${report.suggestions.map(s => `<div class="insight"><span class="ico">🌱</span><div><p>${esc(s)}</p></div></div>`).join('')}
          <p class="tiny muted" style="margin-top:10px">${report.engine === 'llm-assisted' ? '本次由 AI 结合真实学习数据生成。' : '本次由平台基于真实学习数据生成（未配置 AI 或未授权）。'}</p>`,
        footer: '<button class="btn" data-close type="button">知道了</button>',
        onMount(modal, close) { modal.querySelector('[data-close]').addEventListener('click', close); },
      });
      btn.textContent = '已生成';
      setTimeout(() => { btn.disabled = false; btn.textContent = '再次生成'; }, 600);
    } catch (error) {
      toast(error.message, 'error');
      btn.disabled = false; btn.textContent = '生成本周汇报';
    }
  });
  root.querySelector('#reportMore')?.addEventListener('click', () => ctx.navigate('#/account'));
}

function greetingForChild(name) {
  const hour = new Date().getHours();
  const time = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return `${time}，${name}`;
}

function statCard(icon, label, value, unit, foot) {
  return `<div class="stat-card-v2">
    <div class="lab"><span>${icon}</span>${esc(label)}</div>
    <div class="val">${esc(value)}<small>${esc(unit)}</small></div>
    <div class="foot">${foot || '&nbsp;'}</div>
  </div>`;
}

function deltaText(delta) {
  if (delta === undefined || delta === null) return '&nbsp;';
  if (delta === 0) return '<span class="muted">和上周期差不多</span>';
  return delta > 0
    ? `<span class="muted">比上周期多一点点</span>`
    : `<span class="muted">这周慢一点，也没关系</span>`;
}

function statusLabel(status) {
  return { pending: '待开始', done: '已完成', missed: '逾期', skipped: '已跳过', moved: '已顺延' }[status] || status;
}

function warmthHistoryKey(childId) { return `starsprout.warmth.history.${childId}`; }

function readWarmthHistory(childId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(warmthHistoryKey(childId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(-7) : [];
  } catch { return []; }
}
