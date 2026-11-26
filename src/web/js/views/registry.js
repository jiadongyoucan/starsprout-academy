import { request, session } from '../api.js';
import {
  badge, emptyState, esc, loading, openModal, toast, statusText,
} from '../ui.js';

const TABS = [
  { key: 'experts', label: '专家智能体', icon: '🧑‍🏫' },
  { key: 'skills', label: '技能', icon: '🧩' },
  { key: 'connectors', label: '连接器', icon: '🔌' },
];
const SUBJECTS = [
  { code: 'thinking', name: '智趣思维' }, { code: 'english', name: '英语' }, { code: 'piano', name: '钢琴' },
  { code: 'hanzi', name: '汉字' }, { code: 'montessori', name: '蒙氏' },
];
const CLASSES = [
  { code: 'nursery', name: '托班' }, { code: 'junior', name: '小班' },
  { code: 'middle', name: '中班' }, { code: 'senior', name: '大班' },
];

export async function renderRegistry(root, ctx) {
  const initial = TABS.some(tab => tab.key === ctx.query.get('tab')) ? ctx.query.get('tab') : 'experts';
  const canPublish = ['teacher', 'admin'].includes(session.user?.role);
  root.innerHTML = `
    <div class="row between top" style="margin-bottom:16px">
      <div>
        <div class="eyebrow">Open Ecosystem</div>
        <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">把专业的人，请进你的家庭</h2>
        <p class="muted small" style="margin-top:4px">专家、技能与连接器可以发布、安装和复用；公开内容需审核，工具调用有边界与审计。</p>
      </div>
      <button class="btn" id="createEntity" type="button">＋ 发布 / 新建</button>
    </div>
    <div class="tabs" id="registryTabs">
      ${TABS.map(tab => `<button type="button" data-tab="${tab.key}" class="${tab.key === initial ? 'active' : ''}">${tab.icon} ${tab.label}</button>`).join('')}
    </div>
    <div id="registryBody">${loading('正在加载生态资源…')}</div>`;

  let activeTab = initial;
  const body = root.querySelector('#registryBody');

  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
    void loadTab(activeTab);
  }));
  root.querySelector('#createEntity').addEventListener('click', () => openCreate(activeTab));

  async function loadTab(tab) {
    body.innerHTML = loading('正在加载…');
    try {
      if (tab === 'experts') await loadExperts();
      else if (tab === 'skills') await loadSkills();
      else await loadConnectors();
    } catch (error) {
      body.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="regRetry">重试</button></div></div>`;
      body.querySelector('#regRetry').addEventListener('click', () => loadTab(tab));
    }
  }

  async function loadExperts() {
    const [publicList, mine, installed] = await Promise.all([
      request('/api/registry/experts?scope=public'),
      request('/api/registry/experts?scope=mine'),
      request('/api/registry/experts?scope=installed'),
    ]);
    const map = new Map();
    for (const expert of [...publicList, ...mine, ...installed]) {
      const existing = map.get(expert.id) || {};
      map.set(expert.id, { ...existing, ...expert, installed: existing.installed || expert.installed, isMine: existing.isMine || expert.isMine });
    }
    const experts = [...map.values()];
    body.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <span class="small muted">已发布 ${publicList.length} 位专家 · 我已安装 ${installed.length} 位 · 我发布 ${mine.length} 位</span>
        <span class="pill">${canPublish ? '教师可发布公开专家' : '公开专家需教师身份'}</span>
      </div>
      ${experts.length ? `<div class="grid auto">${experts.map(expert => `
        <article class="entity-card">
          <div class="entity-top">
            <span class="entity-ico">🧑‍🏫</span>
            <div style="flex:1;min-width:0">
              <div class="row" style="gap:6px">${badge(expert.status)}${expert.isMine ? '<span class="pill tiny">我的</span>' : ''}${expert.installed ? '<span class="pill mint tiny">已安装</span>' : ''}</div>
              <h3 style="margin-top:5px">${esc(expert.name)}</h3>
              <div class="sub">${esc(expert.title)} · ${esc(expert.owner_name || '')}</div>
            </div>
          </div>
          <p>${esc(expert.description)}</p>
          <div class="chips">${(expert.subjects || []).slice(0, 3).map(s => `<span class="pill tiny">${esc(SUBJECTS.find(x => x.code === s)?.name || s)}</span>`).join('')}
            ${(expert.classCodes || []).slice(0, 3).map(c => `<span class="pill tiny">${esc(CLASSES.find(x => x.code === c)?.name || c)}</span>`).join('')}</div>
          <div class="entity-foot">
            <span class="tiny muted">📥 ${expert.installs} 次安装 ${expert.rating ? `· ⭐ ${expert.rating}` : ''}</span>
            <div class="row">
              ${expert.status === 'published' || expert.isMine ? `<button class="btn small ghost" type="button" data-use-expert="${esc(expert.id)}">使用</button>` : ''}
              ${expert.status === 'published' ? (expert.installed
                ? `<button class="btn small ghost" type="button" data-uninstall-expert="${esc(expert.id)}">取消安装</button>`
                : `<button class="btn small soft" type="button" data-install-expert="${esc(expert.id)}">安装</button>`) : ''}
            </div>
          </div>
        </article>`).join('')}</div>`
        : emptyState('🧑‍🏫', '专家市场还是空的', '教师可以发布第一位专家；家长也可以创建仅家庭可用的专家。', '<button class="btn" type="button" id="emptyCreateExpert">创建家庭专家</button>')}`;
    body.querySelector('#emptyCreateExpert')?.addEventListener('click', () => openExpertModal());
    body.querySelectorAll('[data-install-expert]').forEach(button => button.addEventListener('click', () => install('experts', button.dataset.installExpert, tab)));
    body.querySelectorAll('[data-uninstall-expert]').forEach(button => button.addEventListener('click', () => uninstall('experts', button.dataset.uninstallExpert, tab)));
    body.querySelectorAll('[data-use-expert]').forEach(button => button.addEventListener('click', () => useExpert(button.dataset.useExpert)));
  }

  async function loadSkills() {
    const [publicSkills, householdSkills] = await Promise.all([
      request('/api/registry/skills'),
      request('/api/registry/skills?scope=household'),
    ]);
    const map = new Map();
    for (const skill of [...publicSkills, ...householdSkills]) map.set(skill.id, { ...map.get(skill.id), ...skill });
    const skills = [...map.values()];
    body.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><span class="small muted">技能是可复用的提示词或工作流，专家可以引用技能。</span>
        <button class="btn small ghost" type="button" id="createSkill2">＋ 新建技能</button></div>
      ${skills.length ? `<div class="grid auto">${skills.map(skill => `
        <article class="entity-card">
          <div class="entity-top"><span class="entity-ico">🧩</span>
            <div style="flex:1;min-width:0"><div class="row" style="gap:6px">${badge(skill.status)}<span class="pill tiny">${skill.kind === 'workflow' ? '工作流' : '提示词'}</span></div>
              <h3 style="margin-top:5px">${esc(skill.name)}</h3><div class="sub">${esc(skill.code)} · ${esc(skill.owner_name || '')}</div></div>
          </div>
          <p>${esc(skill.description)}</p>
          <div class="entity-foot"><span class="tiny muted">📥 ${skill.installs} 次安装</span>
            <div class="row">
              ${skill.status === 'published' ? (skill.installed
                ? `<button class="btn small ghost" type="button" data-uninstall-skill="${esc(skill.id)}">取消安装</button>`
                : `<button class="btn small soft" type="button" data-install-skill="${esc(skill.id)}">安装</button>`) : ''}
            </div>
          </div>
        </article>`).join('')}</div>`
        : emptyState('🧩', '还没有技能', '把常用的陪练步骤整理成技能，专家或其他家长可以复用。', '<button class="btn" type="button" id="emptyCreateSkill">创建技能</button>')}`;
    body.querySelector('#createSkill2')?.addEventListener('click', () => openSkillModal());
    body.querySelector('#emptyCreateSkill')?.addEventListener('click', () => openSkillModal());
    body.querySelectorAll('[data-install-skill]').forEach(button => button.addEventListener('click', () => install('skills', button.dataset.installSkill, tab)));
    body.querySelectorAll('[data-uninstall-skill]').forEach(button => button.addEventListener('click', () => uninstall('skills', button.dataset.uninstallSkill, tab)));
  }

  async function loadConnectors() {
    const connectors = await request('/api/registry/connectors');
    body.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><span class="small muted">连接器把第三方工具接入智能体：内置工具、HTTP Webhook，全部经过权限与 SSRF 校验。</span>
        <button class="btn small ghost" type="button" id="createConnector2">＋ 新建连接器</button></div>
      ${connectors.length ? `<div class="grid auto">${connectors.map(connector => `
        <article class="entity-card">
          <div class="entity-top"><span class="entity-ico">🔌</span>
            <div style="flex:1;min-width:0"><div class="row" style="gap:6px">${badge(connector.status)}<span class="pill tiny">${connector.kind === 'builtin' ? '内置' : 'HTTP'}</span></div>
              <h3 style="margin-top:5px">${esc(connector.name)}</h3><div class="sub">${esc(connector.owner_name)} · ${esc(connector.visibility === 'public' ? '公开' : '家庭可见')}</div></div>
          </div>
          <p>${esc(connector.description)}</p>
          <div class="chips">${(connector.tools || []).map(tool => `<span class="pill tiny mono">${esc(tool.name)}</span>`).join('')}</div>
          <div class="entity-foot"><span class="tiny muted">${connector.secretMasked ? `密钥 ${esc(connector.secretMasked)}` : '无需密钥'}</span>
            <div class="row"><button class="btn small ghost" type="button" data-invoke="${esc(connector.id)}" ${connector.status !== 'published' ? 'disabled' : ''}>测试调用</button></div>
          </div>
        </article>`).join('')}</div>`
        : emptyState('🔌', '还没有连接器', '把家庭日历、通知服务或课程索引接进来。HTTP 连接器需要在服务端配置允许域名。', '<button class="btn" type="button" id="emptyCreateConnector">新建连接器</button>')}`;
    body.querySelector('#createConnector2')?.addEventListener('click', () => openConnectorModal());
    body.querySelector('#emptyCreateConnector')?.addEventListener('click', () => openConnectorModal());
    body.querySelectorAll('[data-invoke]').forEach(button => button.addEventListener('click', () => {
      const connector = connectors.find(c => c.id === button.dataset.invoke);
      openInvoke(connector);
    }));
  }

  async function install(type, id, tab) {
    try {
      await request(`/api/registry/${type}/${encodeURIComponent(id)}/install`, { method: 'POST' });
      toast('已安装到本家庭', 'success');
      await loadTab(tab);
    } catch (error) { toast(error.message, 'error'); }
  }
  async function uninstall(type, id, tab) {
    try {
      await request(`/api/registry/${type}/${encodeURIComponent(id)}/uninstall`.replace('/uninstall', '/install'), { method: 'DELETE' });
      toast('已取消安装', 'success');
      await loadTab(tab);
    } catch (error) { toast(error.message, 'error'); }
  }

  function useExpert(expertId) {
    request('/api/agent/sessions', {
      method: 'POST',
      body: { agentKind: 'expert', expertId, title: '与专家对话' },
    }).then(sessionData => ctx.navigate(`#/agent?s=${encodeURIComponent(sessionData.id)}`))
      .catch(error => toast(error.message, 'error'));
  }

  function openInvoke(connector) {
    const tools = connector.tools || [];
    openModal({
      title: `测试连接器 · ${connector.name}`,
      subtitle: '调用会记录在审计日志中，响应截断保存',
      body: `<form id="invokeForm">
        <div class="field"><label>工具</label><select class="select" name="tool">${tools.map(tool => `<option value="${esc(tool.name)}">${esc(tool.name)} — ${esc(tool.description)}</option>`).join('')}</select></div>
        <div class="field"><label>参数（JSON）</label><textarea class="input" name="args" style="font-family:var(--mono);font-size:12px">${esc(defaultArgs(tools[0]))}</textarea></div>
      </form>
      <pre class="sandbox-out" id="invokeOut">尚未调用</pre>`,
      footer: `<button class="btn ghost" data-close type="button">关闭</button><button class="btn" id="invokeBtn" type="button">调用</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#invokeBtn').addEventListener('click', async () => {
          const form = modal.querySelector('#invokeForm');
          const values = Object.fromEntries(new FormData(form).entries());
          let args;
          try { args = values.args.trim() ? JSON.parse(values.args) : {}; }
          catch { toast('参数不是合法 JSON', 'error'); return; }
          const button = modal.querySelector('#invokeBtn');
          button.disabled = true; button.textContent = '调用中…';
          try {
            const result = await request(`/api/registry/connectors/${encodeURIComponent(connector.id)}/invoke`, {
              method: 'POST', body: { tool: values.tool, args },
            });
            modal.querySelector('#invokeOut').textContent = `✅ ${result.durationMs}ms\n${JSON.stringify(result.result, null, 2).slice(0, 4000)}`;
          } catch (error) {
            modal.querySelector('#invokeOut').textContent = `⚠️ ${error.message}`;
          }
          button.disabled = false; button.textContent = '调用';
        });
      },
    });
  }

  function openCreate(tab) {
    if (tab === 'skills') openSkillModal();
    else if (tab === 'connectors') openConnectorModal();
    else openExpertModal();
  }

  function openExpertModal() {
    openModal({
      title: '发布专家智能体', subtitle: '公开专家需要教师/管理员身份并经过审核；家庭专家即时可用',
      body: `<form id="expertForm">
        <div class="form-row">
          <div class="field"><label>名称</label><input class="input" name="name" maxlength="40" placeholder="例如：周老师 · 蒙氏日常" required></div>
          <div class="field"><label>一句话专长</label><input class="input" name="title" maxlength="60" placeholder="AMI 认证 / 幼儿园主教 8 年" required></div>
        </div>
        <div class="field"><label>简介</label><textarea class="input" name="description" maxlength="600" placeholder="告诉家长你擅长什么、会如何回答"></textarea></div>
        <div class="field"><label>人格提示词</label><textarea class="input" name="systemPrompt" maxlength="4000" placeholder="例如：先说明工作目的，再给材料清单与分步示范，最后提示观察要点。"></textarea></div>
        <div class="form-row">
          <div class="field"><label>擅长学科</label><select class="select" name="subjects" multiple size="4">${SUBJECTS.map(s => `<option value="${s.code}">${s.name}</option>`).join('')}</select></div>
          <div class="field"><label>适用学段</label><select class="select" name="classes" multiple size="4">${CLASSES.map(c => `<option value="${c.code}">${c.name}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>可见范围</label><select class="select" name="visibility">
          <option value="household">仅本家庭</option>
          <option value="public" ${canPublish ? '' : 'disabled'}>公开（需审核${canPublish ? '' : ' · 需教师身份'}）</option>
        </select></div>
        <p class="form-hint">公开内容会展示给其他家庭；请勿写入真实儿童姓名或联系方式。</p>
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="expertSubmit" type="button">提交</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#expertSubmit').addEventListener('click', async () => {
          const form = modal.querySelector('#expertForm');
          const values = Object.fromEntries(new FormData(form).entries());
          const subjects = [...form.querySelector('[name=subjects]').selectedOptions].map(o => o.value);
          const classCodes = [...form.querySelector('[name=classes]').selectedOptions].map(o => o.value);
          const button = modal.querySelector('#expertSubmit');
          button.disabled = true;
          try {
            const result = await request('/api/registry/experts', {
              method: 'POST',
              body: { ...values, subjects, classCodes },
            });
            close(); toast(result.message || '已提交', 'success'); await loadTab('experts');
          } catch (error) { toast(error.message, 'error'); button.disabled = false; }
        });
      },
    });
  }

  function openSkillModal() {
    openModal({
      title: '创建技能', subtitle: '提示词或工作流，可被专家引用、被其他家庭安装',
      body: `<form id="skillForm">
        <div class="form-row">
          <div class="field"><label>技能标识</label><input class="input" name="code" pattern="[a-z][a-z0-9-]{2,39}" placeholder="例如：piano-10min" required></div>
          <div class="field"><label>技能名称</label><input class="input" name="name" maxlength="40" placeholder="钢琴 10 分钟陪练" required></div>
        </div>
        <div class="field"><label>说明</label><input class="input" name="description" maxlength="300" placeholder="给出一首曲子的慢练分解步骤与鼓励话术"></div>
        <div class="field"><label>类型</label><select class="select" name="kind"><option value="prompt">提示词</option><option value="workflow">工作流</option></select></div>
        <div class="field"><label>模板 / 步骤</label><textarea class="input" name="template" maxlength="2000" placeholder="先分手慢练 2 遍 → 只练难点小节 3 遍 → 合手 1 遍 → 录下来听一遍"></textarea></div>
        <div class="field"><label>可见范围</label><select class="select" name="visibility">
          <option value="household">仅本家庭</option><option value="public" ${canPublish ? '' : 'disabled'}>公开（需审核）</option>
        </select></div>
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="skillSubmit" type="button">提交</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#skillSubmit').addEventListener('click', async () => {
          const form = modal.querySelector('#skillForm');
          const values = Object.fromEntries(new FormData(form).entries());
          try {
            const result = await request('/api/registry/skills', {
              method: 'POST',
              body: {
                code: values.code, name: values.name, description: values.description, kind: values.kind,
                visibility: values.visibility, definition: { template: values.template },
              },
            });
            close(); toast(result.message || '已创建', 'success'); await loadTab('skills');
          } catch (error) { toast(error.message, 'error'); }
        });
      },
    });
  }

  function openConnectorModal() {
    const sample = JSON.stringify([{ name: 'curriculum.search', description: '按关键词检索课程', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }], null, 2);
    openModal({
      title: '新建连接器', subtitle: '内置工具或 HTTP Webhook；公开内容需审核',
      wide: true,
      body: `<form id="connectorForm">
        <div class="form-row">
          <div class="field"><label>名称</label><input class="input" name="name" maxlength="50" placeholder="家庭日历"></div>
          <div class="field"><label>类型</label><select class="select" name="kind"><option value="builtin">内置工具</option><option value="http">HTTP Webhook</option></select></div>
        </div>
        <div class="field"><label>说明</label><input class="input" name="description" maxlength="300" placeholder="把学习提醒发送到家庭自动化服务"></div>
        <div class="field"><label>Base URL（HTTP 类型必填）</label><input class="input" name="baseUrl" placeholder="https://example.com/hooks/starbuddy"></div>
        <div class="form-row">
          <div class="field"><label>认证方式</label><select class="select" name="authType"><option value="none">无</option><option value="bearer">Bearer</option><option value="header">自定义 Header</option></select></div>
          <div class="field"><label>密钥（可选）</label><input class="input" name="secret" type="password" placeholder="保存后仅显示尾号"></div>
        </div>
        <div class="field"><label>工具清单（JSON 数组）</label><textarea class="input" name="tools" style="font-family:var(--mono);font-size:12px;min-height:150px">${esc(sample)}</textarea></div>
        <div class="form-row">
          <div class="field"><label>可见范围</label><select class="select" name="visibility"><option value="household">仅本家庭</option><option value="public" ${canPublish ? '' : 'disabled'}>公开（需审核）</option></select></div>
          <div class="field"><label>安全提示</label><p class="form-hint">HTTP 连接器仅允许白名单域名，拒绝私网地址与重定向。</p></div>
        </div>
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="connectorSubmit" type="button">创建</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#connectorSubmit').addEventListener('click', async () => {
          const form = modal.querySelector('#connectorForm');
          const values = Object.fromEntries(new FormData(form).entries());
          let tools;
          try { tools = JSON.parse(values.tools); }
          catch { toast('工具清单不是合法 JSON', 'error'); return; }
          const button = modal.querySelector('#connectorSubmit');
          button.disabled = true;
          try {
            const result = await request('/api/registry/connectors', {
              method: 'POST',
              body: { ...values, tools, authType: values.authType, baseUrl: values.baseUrl || undefined },
            });
            close(); toast(result.message || '已创建', 'success'); await loadTab('connectors');
          } catch (error) { toast(error.message, 'error'); button.disabled = false; }
        });
      },
    });
  }

  await loadTab(activeTab);
}

function defaultArgs(tool) {
  if (!tool?.input_schema?.properties) return '{}';
  const args = {};
  for (const key of Object.keys(tool.input_schema.properties)) args[key] = tool.input_schema.properties[key]?.type === 'number' ? 0 : '示例';
  return JSON.stringify(args, null, 2);
}
