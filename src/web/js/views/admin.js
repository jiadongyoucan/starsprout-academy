import { request } from '../api.js';
import { badge, emptyState, esc, fmtDateTime, loading, openModal, relativeTime, toast } from '../ui.js';

const REGISTRY_TYPES = [
  { key: 'experts', label: '专家' },
  { key: 'skills', label: '技能' },
  { key: 'connectors', label: '连接器' },
];

export async function renderAdmin(root, ctx) {
  root.innerHTML = loading('正在加载运营数据…');
  let overview;
  let sources;
  let audit;
  let users;
  let models;
  let queues;
  try {
    [overview, sources, audit, users, models, ...queues] = await Promise.all([
      request('/api/admin/overview'),
      request('/api/admin/packs'),
      request('/api/admin/audit?limit=30'),
      request('/api/admin/users'),
      request('/api/agent/models'),
      ...REGISTRY_TYPES.map(type => request(`/api/admin/registry/queue?type=${type.key}`)),
    ]);
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="adminRetry">重试</button></div></div>`;
    root.querySelector('#adminRetry').addEventListener('click', () => renderAdmin(root, ctx));
    return;
  }
  const pendingRegistry = queues.flatMap((items, index) => items.map(item => ({ ...item, _type: REGISTRY_TYPES[index].key })));

  root.innerHTML = `
    <div class="row between top" style="margin-bottom:16px">
      <div><div class="eyebrow">Operations</div>
        <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">平台运营与治理</h2>
        <p class="muted small" style="margin-top:4px">审核、来源、模型与审计。所有管理操作都会写入审计日志。</p></div>
      <div class="row"><a class="btn ghost" href="#/community?tab=review">社区审核台 →</a>
        <button class="btn" id="syncSources" type="button">↻ 同步公开课源</button></div>
    </div>

    <section class="stat-grid" style="margin-bottom:18px">
      ${stat('👨‍👩‍👧', '家庭 / 用户', `${overview.households} / ${overview.users}`, `${overview.children} 个孩子`)}
      ${stat('📚', '已发布课时', overview.lessons, `${overview.sources} 个公开课源`)}
      ${stat('🛡️', '待审核', overview.pendingPosts + overview.pendingExperts + overview.pendingSkills, `社区 ${overview.pendingPosts} · 生态 ${overview.pendingExperts + overview.pendingSkills} · 课程包 ${overview.pendingPacks}`)}
      ${stat('🤖', 'AI 运行（24h）', overview.aiRuns24h, `${overview.reports} 份报告 · ${overview.snapshots} 张照片`)}
      ${stat('🌱', '近 7 天活跃家庭', overview.activeHouseholds7d || 0, `计划完成 ${overview.planCompletion || 0} 份`)}
      ${stat('🧾', '审核质量', overview.reviewApprovalRate == null ? '—' : `${overview.reviewApprovalRate}%`, overview.reviewAvgHours == null ? '暂无审核' : `平均 ${overview.reviewAvgHours} 小时`)}
    </section>

    <div class="grid two-col">
      <div class="stack">
        <section class="card">
          <div class="card-title"><div><h3>生态审核队列入</h3><span class="hint">公开专家 / 技能 / 连接器</span></div><span class="pill">${pendingRegistry.length}</span></div>
          ${pendingRegistry.length ? pendingRegistry.map(item => `
            <div class="review-item">
              <div class="row" style="gap:6px"><span class="pill primary">${esc(item._type === 'experts' ? '专家' : item._type === 'skills' ? '技能' : '连接器')}</span>
                <strong style="font-size:13px">${esc(item.name)}</strong><span class="tiny muted">${esc(item.owner_name || '')}</span></div>
              <p class="small muted" style="margin-top:4px">${esc(item.description || item.title || '')}</p>
              ${item.tools ? `<div class="chips" style="margin-top:6px">${item.tools.map(tool => `<span class="pill tiny mono">${esc(tool.name)}</span>`).join('')}</div>` : ''}
              <div class="review-actions">
                <button class="btn small" type="button" data-reg-review="${esc(item._type)}" data-id="${esc(item.id)}" data-decision="approve">通过并发布</button>
                <button class="btn small ghost" type="button" data-reg-review="${esc(item._type)}" data-id="${esc(item.id)}" data-decision="reject">拒绝</button>
              </div>
            </div>`).join('') : '<p class="small muted">没有待审核的生态资源。</p>'}
        </section>

        <section class="card">
          <div class="card-title"><div><h3>公开课程来源</h3><span class="hint">版本、许可证与审核状态</span></div><span class="pill">${sources.packs.length}</span></div>
          ${sources.sources.map(source => `<div class="row between" style="padding:9px 0;border-bottom:1px dashed var(--line)">
            <div><strong style="font-size:12.5px">${esc(source.name)}</strong>
              <div class="tiny muted">${esc(source.license)} · ${source.last_synced_at ? '最近同步 ' + esc(fmtDateTime(source.last_synced_at)) : '未同步'}</div></div>
            <a class="tiny" href="${esc(source.homepage || source.url)}" target="_blank" rel="noopener noreferrer">原站 ↗</a>
          </div>`).join('')}
          <div class="divider"></div>
          ${sources.packs.map(pack => `<div class="row between" style="padding:8px 0">
            <div><strong style="font-size:12.5px">${esc(pack.name)}</strong>
              <div class="tiny muted">${esc(pack.source_name)} · v${esc(pack.version)} · ${pack.lessons_imported} 课时 · ${esc(pack.subject_code)}/${esc(pack.class_code)}</div></div>
            <div class="row">${badge(pack.status)}${pack.status === 'quarantined' ? `<button class="btn small" type="button" data-approve-pack="${esc(pack.id)}">审核发布</button>` : ''}</div>
          </div>`).join('')}
          <p class="tiny muted" style="margin-top:8px">新版本默认进入隔离区，管理员确认许可证与内容后才发布；旧版本课时会被原子替换。</p>
        </section>

        <section class="card">
          <div class="card-title"><div><h3>用户</h3><span class="hint">管理员可重置临时密码</span></div><span class="pill">${users.length}</span></div>
          <div style="overflow-x:auto"><table class="table">
            <thead><tr><th>称呼</th><th>邮箱</th><th>角色</th><th>家庭</th><th>操作</th></tr></thead>
            <tbody>${users.map(user => `<tr>
              <td>${esc(user.name)}</td><td class="mono tiny">${esc(user.email)}</td>
              <td><span class="pill tiny">${esc({ parent: '家长', teacher: '教师', admin: '管理员' }[user.role] || user.role)}</span></td>
              <td class="tiny">${esc(user.household?.name || '—')}</td>
              <td><div class="row"><button class="btn small ghost" type="button" data-reset-user="${esc(user.id)}">重置密码</button>
                ${user.role !== 'admin' ? `<button class="btn small ghost" type="button" data-role-user="${esc(user.id)}" data-role="${user.role === 'teacher' ? 'parent' : 'teacher'}">${user.role === 'teacher' ? '设为家长' : '设为教师'}</button>` : ''}</div></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </section>

        <section class="card">
          <div class="card-title"><div><h3>审计日志</h3><span class="hint">最近 30 条</span></div></div>
          <div style="overflow-x:auto"><table class="table">
            <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th></tr></thead>
            <tbody>${audit.map(log => `<tr>
              <td class="tiny muted nowrap">${esc(fmtDateTime(log.created_at))}</td>
              <td class="tiny">${esc(log.actor_name || '系统')}</td>
              <td class="tiny mono">${esc(log.action)}</td>
              <td class="tiny">${esc(log.entity)}${log.entity_id ? ` · ${esc(String(log.entity_id).slice(0, 8))}` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-title"><div><h3>模型配置</h3><span class="hint">OpenAI-compatible，密钥加密存储</span></div>
            <button class="btn small ghost" id="addModel" type="button">＋ 添加</button></div>
          ${models.models.length ? models.models.map(model => `<div class="review-item" style="padding:12px">
            <div class="row between"><strong style="font-size:13px">${esc(model.name)}</strong>${model.isDefault ? '<span class="pill mint tiny">默认</span>' : ''}</div>
            <div class="tiny muted" style="margin-top:3px">${esc(model.provider)} · ${esc(model.model)} · ${esc(model.source)}</div>
            <div class="row" style="margin-top:6px">${model.configured ? '<span class="pill tiny">密钥已配置</span>' : '<span class="pill rose tiny">缺少密钥</span>'}
              <span class="spacer"></span>
              ${!model.isDefault && model.source === 'database' ? `<button class="btn small ghost" type="button" data-model-default="${esc(model.id)}">设为默认</button>` : ''}
              ${model.source === 'database' ? `<button class="btn small ghost" type="button" data-model-del="${esc(model.id)}">删除</button>` : ''}
            </div>
          </div>`).join('') : '<p class="small muted">尚未配置模型。系统会使用本地规则引擎，功能完整可用。</p>'}
          <p class="tiny muted" style="margin-top:8px">密钥只以 AES-256-GCM 加密保存，接口永不回传明文。</p>
        </section>

        <section class="card">
          <div class="card-title"><h3>合规与安全</h3></div>
          <div class="insight"><span class="ico">🔒</span><div><strong>家庭隔离</strong><p>所有资源查询带 household 条件；跨家庭读取返回 403/404。</p></div></div>
          <div class="insight"><span class="ico">🧾</span><div><strong>审批留痕</strong><p>审核结论写入 post_reviews 与 audit_logs，且不能自审。</p></div></div>
          <div class="insight"><span class="ico">🛰️</span><div><strong>连接器 SSRF 防护</strong><p>域名白名单、DNS 私网校验、禁止重定向、8 秒超时。</p></div></div>
          <div class="insight"><span class="ico">🧪</span><div><strong>沙箱</strong><p>Worker 隔离 + 时间/内存限制；生产默认关闭，需显式开启。</p></div></div>
          <div class="insight"><span class="ico">🗑️</span><div><strong>照片保留</strong><p>默认 30 天自动清理；家长可随时删除，设备需单独授权。</p></div></div>
        </section>

        <section class="card">
          <div class="card-title"><h3>快捷操作</h3></div>
          <a class="btn full ghost" style="justify-content:flex-start" href="#/community?tab=review">🛡️ 社区内容审核</a>
          <button class="btn full ghost" style="justify-content:flex-start;margin-top:8px" id="auditRefresh" type="button">↻ 刷新运营数据</button>
          <p class="tiny muted" style="margin-top:8px">模型与来源操作会实时写入审计；刷新不会清空记录。</p>
        </section>
      </div>
    </div>`;

  root.querySelector('#syncSources').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true; button.textContent = '同步中…';
    try {
      const results = await request('/api/admin/sources/sync', { method: 'POST' });
      const imported = results.filter(result => result.status !== 'skipped');
      toast(imported.length ? `已导入 ${imported.length} 个课程包，进入隔离区待审核` : '所有来源均为最新版本', 'success');
      await renderAdmin(root, ctx);
    } catch (error) { toast(error.message, 'error'); button.disabled = false; button.textContent = '↻ 同步公开课源'; }
  });
  root.querySelectorAll('[data-approve-pack]').forEach(button => button.addEventListener('click', async () => {
    try {
      await request(`/api/admin/packs/${encodeURIComponent(button.dataset.approvePack)}/approve`, { method: 'POST' });
      toast('课程包已发布', 'success');
      await renderAdmin(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-reg-review]').forEach(button => button.addEventListener('click', () => reviewRegistry(button.dataset.regReview, button.dataset.id, button.dataset.decision)));
  root.querySelectorAll('[data-reset-user]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('重置该用户密码？所有现有会话会立即失效。')) return;
    try {
      const result = await request(`/api/admin/users/${encodeURIComponent(button.dataset.resetUser)}/reset-password`, { method: 'POST' });
      openModal({
        title: '临时密码已生成',
        subtitle: '仅显示一次，请通过安全渠道转交',
        body: `<div class="code-display" style="font-size:22px;letter-spacing:.1em">${esc(result.temporaryPassword)}</div>
          <p class="small muted" style="margin-top:10px">用户首次登录后会被提示修改密码；旧会话已经失效。</p>`,
        footer: '<button class="btn" data-close type="button">我已记录</button>',
        onMount(modal, close) { modal.querySelector('[data-close]').addEventListener('click', close); },
      });
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelector('#addModel').addEventListener('click', () => openModelModal(root, ctx));
  root.querySelectorAll('[data-role-user]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('确认修改该用户的平台角色？')) return;
    try {
      await request(`/api/admin/users/${encodeURIComponent(button.dataset.roleUser)}/role`, { method: 'PATCH', body: { role: button.dataset.role } });
      toast('角色已更新', 'success');
      await renderAdmin(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-model-default]').forEach(button => button.addEventListener('click', async () => {
    try {
      await request(`/api/admin/models/${encodeURIComponent(button.dataset.modelDefault)}/default`, { method: 'POST' });
      toast('已设为默认模型', 'success');
      await renderAdmin(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-model-del]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('删除该模型配置？若为默认模型，将回退到环境变量或本地规则引擎。')) return;
    try {
      await request(`/api/admin/models/${encodeURIComponent(button.dataset.modelDel)}`, { method: 'DELETE' });
      toast('已删除', 'success');
      await renderAdmin(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelector('#auditRefresh')?.addEventListener('click', () => renderAdmin(root, ctx));

  function reviewRegistry(type, id, decision) {
    openModal({
      title: decision === 'approve' ? '通过并发布' : '拒绝发布',
      body: `<form id="regReviewForm"><div class="field"><label>审核意见${decision === 'reject' ? '（必填）' : '（可选）'}</label>
        <textarea class="input" name="note" maxlength="400"></textarea></div></form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn ${decision === 'reject' ? 'danger' : ''}" id="regReviewSubmit" type="button">确认</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#regReviewSubmit').addEventListener('click', async () => {
          const note = modal.querySelector('[name=note]').value.trim();
          if (decision === 'reject' && !note) { toast('拒绝需填写原因', 'error'); return; }
          try {
            await request(`/api/admin/registry/${encodeURIComponent(type)}/${encodeURIComponent(id)}/review`, { method: 'POST', body: { decision, note } });
            close(); toast('审核完成', 'success'); await renderAdmin(root, ctx);
          } catch (error) { toast(error.message, 'error'); }
        });
      },
    });
  }
}

function stat(icon, label, value, foot) {
  return `<div class="stat"><div class="stat-label"><span>${icon}</span>${esc(label)}</div>
    <div class="stat-value">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></div>`;
}

function openModelModal(root, ctx) {
  openModal({
    title: '添加模型配置',
    subtitle: '兼容 OpenAI Chat Completions 的服务均可',
    body: `<form id="modelForm">
      <div class="form-row">
        <div class="field"><label>配置名称</label><input class="input" name="name" placeholder="DeepSeek 主模型"></div>
        <div class="field"><label>供应商</label><input class="input" name="provider" placeholder="deepseek"></div>
      </div>
      <div class="field"><label>Base URL</label><input class="input" name="baseUrl" placeholder="https://api.deepseek.com"></div>
      <div class="form-row">
        <div class="field"><label>模型名</label><input class="input" name="model" placeholder="deepseek-chat"></div>
        <div class="field"><label>API Key</label><input class="input" type="password" name="apiKey" placeholder="sk-…"></div>
      </div>
      <label class="checkline"><input type="checkbox" name="isDefault" checked> 设为默认模型（立即生效）</label>
      <p class="form-hint" style="margin-top:8px">密钥使用服务端 APP_SECRET 派生的 AES-256-GCM 加密存储，不会返回给前端。</p>
    </form>`,
    footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="modelSubmit" type="button">保存</button>`,
    onMount(modal, close) {
      modal.querySelector('[data-close]').addEventListener('click', close);
      modal.querySelector('#modelSubmit').addEventListener('click', async () => {
        const form = modal.querySelector('#modelForm');
        const values = Object.fromEntries(new FormData(form).entries());
        values.isDefault = form.querySelector('[name=isDefault]').checked;
        try {
          await request('/api/admin/models', { method: 'POST', body: values });
          close(); toast('模型已保存', 'success'); await renderAdmin(root, ctx);
        } catch (error) { toast(error.message, 'error'); }
      });
    },
  });
}
