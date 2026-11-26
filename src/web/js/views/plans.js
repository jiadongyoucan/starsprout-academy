import { currentChild, childClassLabel, request, session } from '../api.js';
import {
  badge, celebrate, emptyState, esc, fmtDate, fmtDateTime, loading, localToday, openModal, statusText, subjectMeta, toast, weekday,
} from '../ui.js';
import { petSvg } from '../assets.js';

export async function renderPlans(root, ctx) {
  const child = currentChild();
  if (!child) {
    root.innerHTML = emptyState('🧒', '先添加孩子档案', '计划需要绑定一个孩子。', '<a class="btn" href="#/home">回首页</a>');
    return;
  }
  root.innerHTML = loading('正在整理计划…');
  let plans = [];
  let reminders = [];
  try {
    [plans, reminders] = await Promise.all([
      request(`/api/plans?childId=${encodeURIComponent(child.id)}`),
      request('/api/reminders/upcoming').catch(() => []),
    ]);
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="planRetry">重试</button></div></div>`;
    root.querySelector('#planRetry').addEventListener('click', () => renderPlans(root, ctx));
    return;
  }

  root.innerHTML = `
    <div class="row between top" style="margin-bottom:18px">
      <div>
        <div class="eyebrow">AI-assisted Planning</div>
        <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">把一周排明白，就不用每天纠结</h2>
        <p class="muted small" style="margin-top:4px">为 ${esc(child.name)}（${esc(childClassLabel(child.class_code))}）按已完成进度排课；逾期可一键顺延。</p>
      </div>
      <div class="row">
        <button class="btn ghost" id="manualPlan" type="button">手动创建</button>
        <button class="btn" id="newPlan" type="button">✨ 生成两周计划</button>
      </div>
    </div>

    <div class="grid two-col">
      <div class="stack">
        ${plans.length ? plans.map(plan => `
          <article class="plan-card">
            <div class="row between top">
              <div>
                <div class="row" style="gap:8px;margin-bottom:5px">
                  ${badge(plan.status)}
                  <span class="pill">${plan.source === 'ai' ? 'AI 辅助生成' : '家长创建'}</span>
                  ${plan.engine === 'ai-assisted' ? '' : ''}
                </div>
                <h3>${esc(plan.title)}</h3>
                <p class="muted small" style="margin-top:4px">${esc(plan.goal)}</p>
              </div>
              <div class="text-right nowrap">
                <div class="strong" style="font-size:20px">${plan.progressPercent}%</div>
                <div class="tiny muted">完成度</div>
              </div>
            </div>
            <div class="plan-meta">
              <span class="pill">${esc(fmtDate(plan.start_date))} – ${esc(fmtDate(plan.end_date))}</span>
              <span class="pill">每周 ${plan.days_per_week} 天 · 每天 ${plan.minutes_per_day} 分钟</span>
              <span class="pill">${plan.done}/${plan.total} 项已完成</span>
              ${plan.missed ? `<span class="pill rose">${plan.missed} 项逾期</span>` : ''}
            </div>
            <div class="progress"><i style="width:${plan.progressPercent}%;background:${plan.status === 'archived' ? '#a8a29e' : 'var(--primary)'}"></i></div>
            <div class="row between">
              <span class="tiny muted">到期完成率 ${plan.adherence}% · 已投入 ${plan.minutesDone} 分钟</span>
              <div class="row">
                ${plan.status === 'draft' ? `<button class="btn small" type="button" data-activate="${esc(plan.id)}">激活计划</button>` : ''}
                <a class="btn small ghost" href="#/plans/${encodeURIComponent(plan.id)}">查看安排</a>
              </div>
            </div>
          </article>`).join('') : emptyState('🗓️', '还没有学习计划', '生成一份两周计划，或从手动创建开始。系统会跳过已完成课时并均衡五个学科。', '<button class="btn" id="emptyNewPlan" type="button">生成两周计划</button>')}
      </div>

      <div class="stack">
        <section class="card soft">
          <div class="card-title"><div><h3>提醒</h3><span class="hint">到期自动提醒，推送至设备</span></div><span class="pill primary">${reminders.length}</span></div>
          ${reminders.length ? reminders.slice(0, 6).map(reminder => `
            <div class="reminder-row"><span class="when">${esc(fmtDateTime(reminder.at))}</span>
              <span style="flex:1"><strong style="font-size:12px">${esc(reminder.child_name)}</strong>
                <div class="tiny muted">${esc(reminder.message)}</div></span></div>`).join('')
            : '<p class="small muted">暂时没有待发送的提醒。激活计划后会自动生成。</p>'}
        </section>
        <section class="card">
          <div class="card-title"><h3>为什么需要计划</h3></div>
          <div class="insight"><span class="ico">🎯</span><div><strong>少做选择</strong><p>每天打开就知道学什么，降低家长和孩子的决策成本。</p></div></div>
          <div class="insight"><span class="ico">🌿</span><div><strong>允许被打断</strong><p>没完成不等于失败；一键顺延到空白日，比整周放弃更有效。</p></div></div>
          <div class="insight"><span class="ico">📊</span><div><strong>有据可依</strong><p>计划、进度与周报使用同一份真实数据，不编造分数。</p></div></div>
        </section>
        <section class="card">
          <div class="card-title"><h3>AI 能力说明</h3></div>
          <p class="small muted">${ctx.meta?.ai?.configured
            ? '已配置大模型：生成计划时会用真实课程与进度做约束，AI 只补充个性化理由，不接触其他家庭数据。'
            : '当前未配置 AI 密钥，使用本地规则引擎：同样按课程顺序、已完成进度和时长约束排课，并可随时升级为大模型。'}</p>
        </section>
      </div>
    </div>`;

  const openGenerate = () => openPlanModal({ mode: 'ai', child, meta: ctx.meta, onDone: (plan) => ctx.navigate(`#/plans/${plan.plan.id}`) });
  root.querySelector('#newPlan')?.addEventListener('click', openGenerate);
  root.querySelector('#emptyNewPlan')?.addEventListener('click', openGenerate);
  root.querySelector('#manualPlan')?.addEventListener('click', () => openPlanModal({ mode: 'manual', child, meta: ctx.meta, onDone: (plan) => ctx.navigate(`#/plans/${plan.plan.id}`) }));
  root.querySelectorAll('[data-activate]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await request(`/api/plans/${encodeURIComponent(button.dataset.activate)}/activate`, { method: 'POST' });
      toast('计划已激活，提醒已生成', 'success');
      await renderPlans(root, ctx);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }));
}

export function openPlanModal({ mode, child, meta, onDone }) {
  const isAI = mode === 'ai';
  const today = localToday();
  openModal({
    title: isAI ? '生成学习计划' : '手动创建计划',
    subtitle: isAI ? 'AI 会读取真实进度，跳过已完成课时' : '按课程顺序自动填充，可自定义标题',
    wide: true,
    body: `<form id="planForm">
      ${!isAI ? `<div class="field"><label>计划标题</label><input class="input" name="title" maxlength="40" value="${esc(child.name)}的学习计划"></div>` : ''}
      <div class="form-row">
        <div class="field"><label>周期（周）</label><input class="input" type="number" name="weeks" min="1" max="8" value="2"></div>
        <div class="field"><label>每周学习天数</label><select class="select" name="daysPerWeek">
          ${[2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === 5 ? 'selected' : ''}>${n} 天</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>每天时长（分钟）</label><input class="input" type="number" name="minutesPerDay" min="15" max="90" value="25"></div>
        <div class="field"><label>开始日期</label><input class="input" type="date" name="startDate" value="${today}"></div>
      </div>
      <div class="field"><label>${isAI ? '这次想重点解决什么？' : '备注'}</label>
        <textarea class="input" name="${isAI ? 'goal' : 'notes'}" maxlength="200" placeholder="${isAI ? '例如：英语听说优先，同时别落下思维' : '例如：周三和周六没有时间'}"></textarea>
      </div>
      ${!isAI ? '' : `<div class="ai-note">${meta?.ai?.configured
        ? 'AI 会基于真实数据补全个性化说明；若 AI 不可用会自动降级为本地规则引擎，不会中断生成。'
        : '当前为本地规则引擎：按课程顺序、已完成进度、学科均衡与每日时长排课。配置 AI 密钥后可获得个性化说明。'}</div>`}
      ${meta?.policy?.summary ? `<p class="form-hint" style="margin-top:10px">${esc(meta.policy.summary)}</p>` : ''}
    </form>`,
    footer: `<button class="btn ghost" data-close type="button">取消</button>
      <button class="btn" type="button" id="planSubmit">${isAI ? '✨ 生成计划' : '创建计划'}</button>`,
    onMount(modal, close) {
      modal.querySelector('[data-close]').addEventListener('click', close);
      const submit = modal.querySelector('#planSubmit');
      submit.addEventListener('click', async () => {
        const form = modal.querySelector('#planForm');
        const values = Object.fromEntries(new FormData(form).entries());
        const body = {
          childId: child.id,
          weeks: Number(values.weeks), daysPerWeek: Number(values.daysPerWeek),
          minutesPerDay: Number(values.minutesPerDay), startDate: values.startDate,
        };
        if (isAI) body.goal = values.goal;
        else { body.title = values.title; body.notes = values.notes; }
        submit.disabled = true;
        submit.textContent = isAI ? '正在排课，约 10 秒…' : '创建中…';
        try {
          const plan = await request(isAI ? '/api/plans/generate' : '/api/plans/manual', { method: 'POST', body });
          close();
          toast(isAI ? '计划已生成，确认后激活' : '计划已创建', 'success');
          onDone?.(plan);
        } catch (error) {
          toast(error.message, 'error');
          submit.disabled = false;
          submit.textContent = isAI ? '✨ 生成计划' : '创建计划';
        }
      });
    },
  });
}

export async function renderPlanDetail(root, ctx) {
  const child = currentChild();
  if (!child) { ctx.navigate('#/home'); return; }
  root.innerHTML = loading('正在打开计划…');
  let data;
  try {
    data = await request(`/api/plans/${encodeURIComponent(ctx.id)}`);
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><a class="btn small ghost" href="#/plans">返回计划列表</a></div></div>`;
    return;
  }
  const { plan, stats, deviations, adjustments, reminders, items } = data;
  const todayStr = localToday();
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.date)) grouped.set(item.date, []);
    grouped.get(item.date).push(item);
  }
  const effectiveStatus = (item) => item.status === 'pending' && item.date < todayStr ? 'missed' : item.status;

  root.innerHTML = `
    <div class="row between" style="margin-bottom:16px">
      <button class="btn ghost small" type="button" id="backPlans">← 返回计划</button>
      <div class="row">
        ${plan.status === 'draft' ? '<button class="btn" type="button" id="activatePlan">激活计划</button>' : ''}
        ${plan.status !== 'archived' ? '<button class="btn ghost small" type="button" id="archivePlan">归档</button>' : ''}
      </div>
    </div>

    <section class="card" style="background:linear-gradient(135deg,#eef0ff,#fffdf9 65%)">
      <div class="row between top">
        <div>
          <div class="row" style="gap:8px;margin-bottom:6px">${badge(plan.status)}<span class="pill">${plan.source === 'ai' ? 'AI 辅助' : '家长创建'}</span>
            <span class="pill">${esc(data.child.name)} · ${esc(childClassLabel(data.child.class_code))}</span></div>
          <h2 style="font-size:23px;letter-spacing:-.02em">${esc(plan.title)}</h2>
          <p class="muted small" style="margin-top:5px">${esc(plan.goal)}</p>
        </div>
        <div style="min-width:120px">
          <div class="ring" style="--p:${stats.progressPercent};--c:var(--primary);margin-left:auto"><span>${stats.progressPercent}<small>%</small></span></div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <span class="pill">${esc(fmtDate(plan.start_date))} – ${esc(fmtDate(plan.end_date))}</span>
        <span class="pill">${stats.done}/${stats.total} 项完成</span>
        <span class="pill ${stats.adherence < 60 ? 'rose' : 'mint'}">到期完成率 ${stats.adherence}%</span>
        <span class="pill">累计 ${stats.minutesDone} 分钟</span>
      </div>
    </section>

    ${deviations.length ? `<section class="deviation" style="margin-top:14px;display:flex;gap:12px;align-items:flex-start">
      <span style="font-size:22px">🌤️</span>
      <div style="flex:1"><strong>有 ${deviations.length} 个计划项已逾期</strong>
        <p style="margin-top:3px;color:#9a5b12">不必重来。可以把它们顺延到最近的空白日，或选择跳过并保留记录。</p></div>
      <button class="btn small accent" type="button" id="correctPlan">一键纠偏</button>
    </section>` : ''}

    <div class="grid two-col" style="margin-top:16px">
      <div class="stack">
        <section class="card">
          <div class="card-title"><div><h3>每天安排</h3><span class="hint">点击完成或跳过，学习时可直接打开课时</span></div>
            <span class="pill">${items.length} 项</span></div>
          <div class="timeline">
            ${[...grouped.entries()].map(([date, dayItems]) => {
              const isPast = date < todayStr;
              const isToday = date === todayStr;
              return `<div class="tl-day ${isToday ? 'today' : isPast ? 'past' : ''}">
                <div class="tl-date">${esc(fmtDate(date))} ${esc(weekday(date))}${isToday ? '<span class="pill accent tiny">今天</span>' : ''}</div>
                ${dayItems.map(item => {
                  const status = effectiveStatus(item);
                  return `<div class="plan-item">
                    <span class="emoji" style="color:${esc(subjectMeta(item.subject_code).color)}">${subjectMeta(item.subject_code).icon}</span>
                    <span class="pi-meta"><strong>${esc(item.title)}</strong>
                      <small>${esc(subjectMeta(item.subject_code).name)} · ${item.minutes} 分钟 ${status !== 'pending' ? '· ' + esc(statusText(status)) : ''}</small></span>
                    <div class="acts">
                      ${item.lesson_id ? `<a class="btn small ghost" href="#/learn/${encodeURIComponent(item.lesson_id)}?planItem=${encodeURIComponent(item.id)}">学习</a>` : ''}
                      ${item.status === 'pending' ? `<button type="button" data-item-done="${esc(item.id)}" title="标记完成">✓</button>
                        <button type="button" data-item-skip="${esc(item.id)}" title="跳过">↷</button>` : ''}
                    </div>
                  </div>`;
                }).join('')}
              </div>`;
            }).join('')}
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="card soft">
          <div class="card-title"><div><h3>计划理由</h3><span class="hint">${plan.engine === 'ai-assisted' ? 'AI + 真实数据' : '家长创建'}</span></div><span class="pill primary">✨</span></div>
          <p style="font-size:12.5px;line-height:1.75">${esc(plan.ai_rationale || '')}</p>
          <p class="tiny muted" style="margin-top:10px">计划会跳过已完成课时，并优先补充进度较少的学科。</p>
        </section>

        <section class="card">
          <div class="card-title"><h3>提醒</h3><span class="pill">${reminders.length}</span></div>
          ${reminders.length ? reminders.map(reminder => `
            <div class="reminder-row"><span class="when">${esc(fmtDateTime(reminder.at))}</span>
              <span style="flex:1"><div class="tiny">${esc(reminder.message)}</div>
              <span class="tiny muted">${statusText(reminder.status)}</span></span></div>`).join('')
            : '<p class="small muted">激活计划后会自动生成学习提醒。</p>'}
        </section>

        ${adjustments.length ? `<section class="card">
          <div class="card-title"><h3>纠偏记录</h3><span class="pill">${adjustments.length}</span></div>
          ${adjustments.map(adj => `<div class="adjustment"><strong>${adj.action === 'shift_overdue' ? '顺延逾期项' : '跳过逾期项'}</strong>
            <div class="tiny" style="margin-top:3px">${esc(adj.reason)}</div>
            <div class="tiny muted" style="margin-top:3px">${esc(fmtDateTime(adj.created_at))}</div></div>`).join('')}
        </section>` : ''}
      </div>
    </div>`;

  root.querySelector('#backPlans').addEventListener('click', () => ctx.navigate('#/plans'));
  root.querySelector('#activatePlan')?.addEventListener('click', async () => {
    try {
      await request(`/api/plans/${encodeURIComponent(plan.id)}/activate`, { method: 'POST' });
      toast('计划已激活，未来 7 天提醒已生成', 'success');
      await renderPlanDetail(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelector('#archivePlan')?.addEventListener('click', async () => {
    if (!confirm('归档后计划将不再出现在日常视图，进度仍会保留。确定吗？')) return;
    try {
      await request(`/api/plans/${encodeURIComponent(plan.id)}`, { method: 'PATCH', body: { status: 'archived' } });
      toast('已归档', 'success');
      ctx.navigate('#/plans');
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelectorAll('[data-item-done]').forEach(button => button.addEventListener('click', () => setItem(button.dataset.itemDone, 'done')));
  root.querySelectorAll('[data-item-skip]').forEach(button => button.addEventListener('click', () => setItem(button.dataset.itemSkip, 'skipped')));
  async function setItem(itemId, status) {
    try {
      const result = await request(`/api/plans/${encodeURIComponent(plan.id)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: { status } });
      const milestones = result.rewards?.milestones || [];
      if (status === 'done' && milestones.length) {
        celebrate({
          title: '整份计划完成啦！',
          subtitle: `「${plan.title}」`,
          emoji: '🏆',
          rewards: result.rewards,
          petHtml: petSvg('bunny', 'excited', [], 120),
          note: '这是属于你们的坚持证书。',
          onClose: () => renderPlanDetail(root, ctx),
        });
      } else {
        toast(status === 'done' ? '已标记完成' : '已跳过', 'success');
        await renderPlanDetail(root, ctx);
      }
    } catch (error) { toast(error.message, 'error'); }
  }
  root.querySelector('#correctPlan')?.addEventListener('click', () => {
    openModal({
      title: '纠偏：让计划追上生活',
      subtitle: `有 ${deviations.length} 个逾期项`,
      body: `<form id="correctForm">
        <div class="field"><label>处理方式</label>
          <select class="select" name="strategy">
            <option value="shift">顺序顺延到最近的空白工作日（推荐）</option>
            <option value="skip">跳过这些课时，保留记录</option>
          </select></div>
        <div class="field"><label>原因（可选）</label><input class="input" name="reason" maxlength="200" placeholder="例如：这周出差、孩子生病"></div>
        <p class="form-hint">顺延不会改变课时内容，也不会影响已完成记录；如有需要会延长计划结束日期。</p>
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn accent" id="correctSubmit" type="button">确认纠偏</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#correctSubmit').addEventListener('click', async () => {
          const values = Object.fromEntries(new FormData(modal.querySelector('#correctForm')).entries());
          const submit = modal.querySelector('#correctSubmit');
          submit.disabled = true; submit.textContent = '处理中…';
          try {
            const result = await request(`/api/plans/${encodeURIComponent(plan.id)}/correct`, { method: 'POST', body: values });
            close();
            toast(result.message, result.moved ? 'success' : 'info', 5000);
            await renderPlanDetail(root, ctx);
          } catch (error) {
            toast(error.message, 'error');
            submit.disabled = false; submit.textContent = '确认纠偏';
          }
        });
      },
    });
  });
}
