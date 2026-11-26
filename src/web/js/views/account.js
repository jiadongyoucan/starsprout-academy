import { bootstrap, clearSession, currentChild, request, saveSession, session } from '../api.js';
import {
  emptyState, esc, fmtDateTime, loading, openModal, toast,
} from '../ui.js';
import { openChildModal } from './childModal.js';

export async function renderAccount(root, ctx) {
  const child = currentChild();
  root.innerHTML = loading('正在读取账户与隐私设置…');
  let children = [];
  let reports = [];
  try {
    children = await request('/api/children');
    if (child) reports = await request(`/api/analytics/reports?childId=${encodeURIComponent(child.id)}`);
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="accRetry">重试</button></div></div>`;
    root.querySelector('#accRetry').addEventListener('click', () => renderAccount(root, ctx));
    return;
  }
  const roleLabel = { parent: '家长', teacher: '教师', admin: '管理员' }[session.user.role] || '家长';
  const policy = ctx.meta?.policy;

  root.innerHTML = `
    <div class="row between top" style="margin-bottom:16px">
      <div><div class="eyebrow">Family & Privacy</div>
        <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">你们的数据，只属于你们</h2>
        <p class="muted small" style="margin-top:4px">孩子档案、监护授权、学习汇报与数据导出都集中在这里。</p></div>
      <button class="btn ghost" id="logoutBtn" type="button">退出登录</button>
    </div>

    <div class="grid two-col">
      <div class="stack">
        <section class="card">
          <div class="row" style="gap:12px">
            <span class="avatar" style="width:48px;height:48px;font-size:18px">${esc((session.user.name || '星').slice(0, 1))}</span>
            <div style="flex:1"><strong style="font-size:16px">${esc(session.user.name)}</strong>
              <div class="small muted">${esc(session.user.email)}</div>
              <div class="row" style="margin-top:6px"><span class="pill">${roleLabel}</span><span class="pill">${esc(session.household?.name || '')}</span>
              ${session.user.mustChangePassword ? '<span class="pill rose">建议修改临时密码</span>' : ''}</div></div>
          </div>
          <div class="divider"></div>
          <div class="card-title"><h3>修改密码</h3></div>
          <form id="passwordForm">
            <div class="field"><label>当前密码</label><input class="input" type="password" name="oldPassword" autocomplete="current-password" required></div>
            <div class="field"><label>新密码</label><input class="input" type="password" name="newPassword" autocomplete="new-password" placeholder="至少 8 位，含字母与数字" required></div>
            <button class="btn small" type="submit">更新密码</button>
          </form>
        </section>

        <section class="card">
          <div class="card-title"><div><h3>浏览器通知</h3><span class="hint">页面打开时接收系统通知</span></div></div>
          <p class="small muted">开启后，页面打开期间计划提醒会通过系统通知送达；关闭页面后，下次打开会补发到期提醒（需 HTTPS 或 localhost）。</p>
          <button class="btn small soft" id="enableNotify" type="button" style="margin-top:10px">开启通知</button>
        </section>

        <section class="card">
          <div class="card-title"><div><h3>隐私与数据</h3><span class="hint">政策版本 ${esc(policy?.version || '2026-01')}</span></div></div>
          <p class="small muted" style="line-height:1.75">${esc(policy?.summary || '儿童数据最小化采集；照片需监护人单独授权；AI 处理可随时关闭。')}</p>
          <div class="divider"></div>
          <div class="stack">
            <button class="btn small ghost" id="exportData" type="button">⬇️ 导出${child ? esc(child.name) : ''}的学习数据（JSON）</button>
            <button class="btn small ghost" id="purgeMemory" type="button">🧠 清除全部 AI 记忆与沙箱记录</button>
            <button class="btn small ghost" id="eraseHousehold" type="button" style="color:var(--rose)">彻底删除家庭数据</button>
            <button class="btn small ghost" id="disableAccount" type="button">停用我的账号</button>
          </div>
          <p class="tiny muted" style="margin-top:10px">导出不含照片原图；照片请在「多端联动」逐张下载或删除。照片默认 ${policy?.retentionDays || 30} 天自动清理。</p>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-title"><div><h3>孩子档案</h3><span class="hint">学段决定课程与计划的适配</span></div>
            <button class="btn small ghost" id="addChild" type="button">＋ 添加</button></div>
          ${children.length ? children.map(item => `
            <div class="plan-item" style="padding:14px">
              <span class="avatar warm" style="width:38px;height:38px">${esc(item.avatar || item.name.slice(0, 1))}</span>
              <span class="pi-meta"><strong>${esc(item.name)} · ${{ nursery: '托班', junior: '小班', middle: '中班', senior: '大班' }[item.class_code] || item.class_code}</strong>
                <small>${item.stats.completed} 个活动 · ${item.stats.minutes} 分钟 · 连续 ${item.stats.streak} 天</small></span>
              <div class="acts">
                <button type="button" data-edit-child="${esc(item.id)}">编辑</button>
                <button type="button" data-del-child="${esc(item.id)}">删除</button>
              </div>
            </div>
            <div class="chips" style="padding:0 0 10px 48px">
              <span class="chip ${item.consents.ai_processing ? 'active' : ''}" style="font-size:11px;padding:4px 9px">AI ${item.consents.ai_processing ? '已授权' : '未授权'}</span>
              <span class="chip ${item.consents.analytics ? 'active' : ''}" style="font-size:11px;padding:4px 9px">分析 ${item.consents.analytics ? '已授权' : '未授权'}</span>
              <span class="chip ${item.consents.camera ? 'active' : ''}" style="font-size:11px;padding:4px 9px">拍照 ${item.consents.camera ? '已授权' : '未授权'}</span>
            </div>`).join('')
            : emptyState('🧒', '还没有孩子档案', '添加后即可获得适配学段的课程与计划。', '<button class="btn small" id="addChild2" type="button">添加孩子</button>')}
        </section>

        <section class="card">
          <div class="card-title"><div><h3>学习汇报</h3><span class="hint">${child ? esc(child.name) : '当前孩子'} · 保存在本地数据库</span></div></div>
          <div class="row" style="margin-bottom:10px">
            <button class="btn small soft" type="button" data-report="daily">生成日报</button>
            <button class="btn small soft" type="button" data-report="weekly">生成周报</button>
            <button class="btn small soft" type="button" data-report="monthly">生成月报</button>
          </div>
          ${reports.length ? reports.map(report => `<div class="review-item">
            <div class="row between"><strong style="font-size:13px">${{ daily: '日报', weekly: '周报', monthly: '月报' }[report.period] || report.period} · ${esc(report.period_key)}</strong>
              <span class="tiny muted">${esc(fmtDateTime(report.created_at))}</span></div>
            <p class="small" style="margin-top:5px">${esc(report.summary)}</p>
            <div class="row" style="margin-top:6px"><span class="pill tiny">${report.metrics?.engine === 'llm-assisted' ? 'AI 生成' : '数据驱动'}</span>
              <span class="tiny muted">完成 ${report.metrics?.completed ?? 0} 个 · ${report.metrics?.minutes ?? 0} 分钟</span></div>
          </div>`).join('') : '<p class="small muted">还没有汇报。生成一份，用一页纸看见这一周。</p>'}
        </section>

        <section class="card">
          <div class="card-title"><h3>当前授权一览</h3></div>
          <div class="kv">
            ${children.map(item => `<dt>${esc(item.name)}</dt><dd class="small">AI ${item.consents.ai_processing ? '✓' : '✗'} · 分析 ${item.consents.analytics ? '✓' : '✗'} · 拍照 ${item.consents.camera ? '✓' : '✗'}</dd>`).join('') || '<dt>暂无</dt><dd>—</dd>'}
          </div>
          <p class="tiny muted" style="margin-top:10px">授权开关在「多端联动 → 监护人授权」；关闭 AI 后，计划与报告会自动降级为本地数据驱动，不影响课程使用。</p>
        </section>
      </div>
    </div>`;

  root.querySelector('#addChild')?.addEventListener('click', () => openChildModal());
  root.querySelector('#addChild2')?.addEventListener('click', () => openChildModal());
  root.querySelectorAll('[data-edit-child]').forEach(button => {
    const item = children.find(c => c.id === button.dataset.editChild);
    button.addEventListener('click', () => openEditChild(item));
  });
  root.querySelectorAll('[data-del-child]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('删除孩子档案会同时删除其学习进度、计划和照片。此操作不可恢复，确定继续？')) return;
    try {
      await request(`/api/children/${encodeURIComponent(button.dataset.delChild)}`, { method: 'DELETE', body: { confirm: true } });
      toast('孩子档案已删除', 'success');
      await bootstrap();
      window.dispatchEvent(new CustomEvent('children:updated'));
      await renderAccount(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));

  root.querySelector('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await request('/api/auth/change-password', { method: 'POST', body: values });
      saveSession(result);
      toast('密码已更新，旧会话已失效', 'success');
      event.currentTarget.reset();
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelector('#logoutBtn').addEventListener('click', async () => {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearSession();
    location.href = '/';
  });
  root.querySelector('#enableNotify').addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('当前浏览器不支持系统通知', 'error'); return; }
    const permission = await Notification.requestPermission();
    toast(permission === 'granted' ? '通知已开启' : '未获得通知权限', permission === 'granted' ? 'success' : 'error');
  });
  root.querySelector('#exportData')?.addEventListener('click', async () => {
    if (!child) return;
    try {
      const data = await request(`/api/privacy/export?childId=${encodeURIComponent(child.id)}`);
      const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `starsprout-${child.name}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast('数据已导出', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelector('#purgeMemory')?.addEventListener('click', async () => {
    if (!confirm('清除全部 AI 长期记忆与沙箱执行记录？此操作不可恢复。')) return;
    try {
      const result = await request('/api/privacy/memory', { method: 'DELETE' });
      toast(`已清除 ${result.memoriesRemoved} 条记忆、${result.sandboxRunsRemoved} 条沙箱记录`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelector('#eraseHousehold')?.addEventListener('click', async () => {
    if (!confirm('这会永久删除本家庭的孩子档案、计划、照片、AI 记忆、社区内容与专家资源，且不可恢复。只有家庭创建者在没有其他成员时可以执行。确定吗？')) return;
    if (!confirm('最后确认：真的要彻底删除吗？')) return;
    try {
      const result = await request('/api/privacy/household', { method: 'DELETE', body: { confirm: true } });
      clearSession();
      alert(result.message);
      location.href = '/';
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelector('#disableAccount')?.addEventListener('click', async () => {
    if (!confirm('停用账号后，所有登录会话立即失效，且无法再登录。家庭数据会保留给其他监护人。确定吗？')) return;
    try {
      await request('/api/privacy/account', { method: 'DELETE' });
      clearSession();
      toast('账号已停用', 'success');
      setTimeout(() => location.href = '/', 600);
    } catch (error) { toast(error.message, 'error'); }
  });
  root.querySelectorAll('[data-report]').forEach(button => button.addEventListener('click', async () => {
    if (!child) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = '生成中…';
    try {
      const result = await request('/api/analytics/reports', { method: 'POST', body: { childId: child.id, period: button.dataset.report } });
      openModal({
        title: `${{ daily: '日报', weekly: '周报', monthly: '月报' }[result.period]} · ${result.periodKey}`,
        wide: true,
        body: `<div class="ai-note">${esc(result.summary)}</div>
          <h4 style="margin:14px 0 6px;font-size:13px">亮点</h4>${result.highlights.map(h => `<div class="insight"><span class="ico">✨</span><div><p>${esc(h)}</p></div></div>`).join('')}
          <h4 style="margin:14px 0 6px;font-size:13px">建议</h4>${result.suggestions.map(s => `<div class="insight"><span class="ico">🌱</span><div><p>${esc(s)}</p></div></div>`).join('')}`,
        footer: '<button class="btn" data-close type="button">关闭</button>',
        onMount(modal, close) { modal.querySelector('[data-close]').addEventListener('click', close); },
      });
      await renderAccount(root, ctx);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false; button.textContent = original;
    }
  }));
}

function openEditChild(item) {
  openModal({
    title: `编辑 ${item.name} 的档案`,
    body: `<form id="editChildForm">
      <div class="form-row">
        <div class="field"><label>昵称</label><input class="input" name="name" maxlength="12" value="${esc(item.name)}"></div>
        <div class="field"><label>学段</label><select class="select" name="classCode">
          ${[['nursery', '托班'], ['junior', '小班'], ['middle', '中班'], ['senior', '大班']].map(([code, label]) => `<option value="${code}" ${item.class_code === code ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
      </div>
      <div class="field"><label>出生年份</label><input class="input" type="number" name="birthYear" min="2016" max="2026" value="${item.birth_year || ''}"></div>
    </form>`,
    footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="editChildSave" type="button">保存</button>`,
    onMount(modal, close) {
      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.querySelector('#editChildSave').addEventListener('click', async () => {
        const values = Object.fromEntries(new FormData(modal.querySelector('#editChildForm')).entries());
        try {
          await request(`/api/children/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: { name: values.name, classCode: values.classCode, birthYear: values.birthYear ? Number(values.birthYear) : undefined },
          });
          close();
          await bootstrap();
          window.dispatchEvent(new CustomEvent('children:updated'));
          toast('档案已更新', 'success');
          location.hash = '#/account';
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch (error) { toast(error.message, 'error'); }
      });
    },
  });
}
