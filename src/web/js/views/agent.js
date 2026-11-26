import { currentChild, request } from '../api.js';
import {
  badge, emptyState, esc, fmtDateTime, loading, mdLite, openModal, relativeTime, toast,
} from '../ui.js';

const KIND_LABEL = { planner: '计划规划师', tutor: '陪学导师', expert: '专家智能体' };
const KIND_ICON = { planner: '🗓️', tutor: '🌱', expert: '🧑‍🏫' };

export async function renderAgent(root, ctx) {
  root.innerHTML = loading('正在打开工作室…');
  let sessions = [];
  let models = [];
  let experts = [];
  try {
    const results = await Promise.all([
      request('/api/agent/sessions'),
      request('/api/agent/models'),
      Promise.all([
        request('/api/registry/experts').catch(() => []),
        request('/api/registry/experts?scope=mine').catch(() => []),
      ]).then(([pub, mine]) => [...new Map([...pub, ...mine].map(e => [e.id, e])).values()]),
    ]);
    sessions = results[0];
    models = results[1].models || [];
    experts = results[2];
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="agentRetry">重试</button></div></div>`;
    root.querySelector('#agentRetry').addEventListener('click', () => renderAgent(root, ctx));
    return;
  }

  const requested = ctx.query.get('s');
  let selectedId = sessions.some(s => s.id === requested) ? requested : (sessions[0]?.id || '');
  let detail = null;
  if (selectedId) {
    try { detail = await request(`/api/agent/sessions/${encodeURIComponent(selectedId)}`); }
    catch { selectedId = ''; detail = null; }
  }
  const child = currentChild();
  const modelLabel = (ref) => {
    if (!ref || ref === 'default') return models.find(m => m.isDefault)?.name || '本地规则引擎';
    return models.find(m => m.id === ref)?.name || (ref === 'local' ? '本地规则引擎' : ref);
  };

  root.innerHTML = `
    <div class="agent-shell">
      <aside class="agent-panel agent-panel-side">
        <div class="agent-panel-head">
          <h3>会话</h3>
          <button class="icon-btn" id="newSession" type="button" aria-label="新建会话" style="width:30px;height:30px">＋</button>
        </div>
        <div class="agent-panel-body" id="sessionList">
          ${sessions.length ? sessions.map(item => `
            <button class="agent-session ${item.id === selectedId ? 'active' : ''}" type="button" data-session="${esc(item.id)}">
              <strong>${KIND_ICON[item.agent_kind] || '💬'} ${esc(item.title)}</strong>
              <small>${KIND_LABEL[item.agent_kind] || '智能体'} · ${item.message_count} 条 · ${esc(relativeTime(item.updated_at))}</small>
            </button>`).join('') : `<p class="small muted" style="padding:14px 8px">还没有会话。新建一个，从「帮我排两周计划」开始。</p>`}
        </div>
        <div style="padding:10px 12px;border-top:1px solid var(--line)">
          <p class="tiny muted">智能体可调用课程检索、排课、周报、沙箱与社区草稿工具；所有写入都受家庭边界与审核约束。</p>
        </div>
      </aside>

      <section class="chat-panel">
        <header class="chat-head">
          <span class="avatar small">${detail ? KIND_ICON[detail.agent_kind] || '🤖' : '🤖'}</span>
          <div style="flex:1;min-width:0">
            <strong>${detail ? esc(detail.title) : '新的创作会话'}</strong>
            <small>${detail ? `${esc(detail.expert?.name || KIND_LABEL[detail.agent_kind] || '智能体')} · ${esc(modelLabel(detail.model))}` : '选择一个会话，或新建'}</small>
          </div>
          <div class="row agent-mobile-tools">
            <button class="icon-btn" type="button" data-sessions-open aria-label="会话" style="width:32px;height:32px">💬</button>
            <button class="icon-btn" type="button" data-context-open="memory" aria-label="记忆" style="width:32px;height:32px">🧠</button>
            <button class="icon-btn" type="button" data-context-open="files" aria-label="工作区" style="width:32px;height:32px">📁</button>
            <button class="icon-btn" type="button" data-context-open="sandbox" aria-label="沙箱" style="width:32px;height:32px">🧪</button>
          </div>
          ${detail ? '<button class="btn small ghost" id="deleteSession" type="button">删除</button>' : ''}
        </header>
        <div class="chat-body" id="chatBody"></div>
        <div class="chat-composer">
          <div class="quick-prompts" id="quickPrompts">
            ${quickPrompts(detail?.agent_kind || 'planner', child).map(prompt => `<button type="button" data-prompt="${esc(prompt)}">${esc(prompt)}</button>`).join('')}
          </div>
          <textarea id="chatInput" placeholder="${detail ? '说说你想要的课程、计划或想了解的进展…' : '先新建一个会话，再开始对话'}" ${detail ? '' : 'disabled'}></textarea>
          <div class="composer-actions">
            <span class="tiny muted">Enter 发送 · Shift+Enter 换行${models.some(m => m.configured) ? '' : ' · 未配置 AI 时使用本地规则引擎'}</span>
            <button class="btn small" id="sendMessage" type="button" ${detail ? '' : 'disabled'}>发送</button>
          </div>
        </div>
      </section>

      <aside class="agent-panel agent-panel-side" id="contextPanel">
        <div class="context-tabs">
          <button type="button" class="active" data-context="memory">记忆</button>
          <button type="button" data-context="files">工作区</button>
          <button type="button" data-context="sandbox">沙箱</button>
          <button type="button" data-context-close aria-label="关闭" style="flex:0;padding:0 10px">✕</button>
        </div>
        <div class="context-body" id="contextBody"></div>
      </aside>
    </div>`;

  let currentTab = 'memory';
  const chatBody = root.querySelector('#chatBody');
  const contextBody = root.querySelector('#contextBody');
  const contextPanel = root.querySelector('#contextPanel');

  function normalizeMessage(message) {
    const copy = { ...message };
    if (typeof copy.tool_results === 'string') { try { copy.tool_results = JSON.parse(copy.tool_results); } catch { copy.tool_results = []; } }
    if (typeof copy.tool_calls === 'string') { try { copy.tool_calls = JSON.parse(copy.tool_calls); } catch { copy.tool_calls = []; } }
    return copy;
  }
  if (detail) detail.messages = (detail.messages || []).map(normalizeMessage);

  function renderMessages() {
    if (!detail) {
      chatBody.innerHTML = `<div class="empty" style="margin:auto">
        <div class="big">🤖</div><strong>开始一次对话式创作</strong>
        <p>让智能体帮你排计划、写教案、解读进度，或把它当作专家来提问。会话、记忆、工作区与沙箱彼此关联。</p>
        <button class="btn" type="button" id="emptyNewSession">新建会话</button>
      </div>`;
      chatBody.querySelector('#emptyNewSession')?.addEventListener('click', openNewSession);
      return;
    }
    if (!detail.messages.length) {
      chatBody.innerHTML = `<div class="chat-notice">这是一个新会话，已绑定家庭记忆与课程库</div>
        <div class="msg"><span class="avatar small">🌱</span><div><div class="bubble">
          <p>你好，我是${esc(KIND_LABEL[detail.agent_kind] || '星芽智能体')}。我可以：</p>
          <ul><li>按真实进度排一份计划，并保存为草稿；</li><li>检索课程库、写一份可审核的教案；</li><li>解读孩子的学习数据，生成周报；</li><li>把创作存入工作区，或提交社区审核。</li></ul>
          <p>你可以直接说：「给${esc(child?.name || '孩子')}排两周、每周 5 天、每天 25 分钟的计划，英语优先」。</p>
        </div></div></div>`;
      return;
    }
    chatBody.innerHTML = detail.messages.map(message => {
      if (message.role === 'user') {
        return `<div class="msg user"><span class="avatar small warm">家</span>
          <div><div class="bubble">${mdLite(message.content)}</div><div class="msg-time">${esc(fmtDateTime(message.created_at))}</div></div></div>`;
      }
      const toolChips = (message.tool_results || []).filter(tool => tool?.name).map(tool =>
        `<button class="tool-chip" type="button" data-tool="${esc(JSON.stringify(tool))}">🔧 ${esc(tool.name)}</button>`).join('');
      return `<div class="msg"><span class="avatar small">🤖</span>
        <div><div class="bubble">${mdLite(message.content)}
          ${toolChips ? `<div class="tool-trace">${toolChips}</div>` : ''}</div>
          <div class="msg-time">${esc(fmtDateTime(message.created_at))}</div></div></div>`;
    }).join('');
    chatBody.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
      let tool;
      try { tool = JSON.parse(button.dataset.tool); } catch { return; }
      openModal({
        title: `工具调用：${tool.name}`,
        body: `<pre class="sandbox-out" style="max-height:320px">${esc(JSON.stringify({ args: tool.args, result: tool.result }, null, 2))}</pre>`,
        footer: '<button class="btn" data-close type="button">关闭</button>',
        onMount(modal, close) { modal.querySelector('[data-close]').addEventListener('click', close); },
      });
    }));
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  async function loadContext(tab) {
    currentTab = tab;
    root.querySelectorAll('[data-context]').forEach(button => button.classList.toggle('active', button.dataset.context === tab));
    contextBody.innerHTML = loading('加载中…');
    try {
      if (tab === 'memory') {
        const memories = await request('/api/agent/memory');
        contextBody.innerHTML = `
          <p class="tiny muted" style="margin-bottom:10px">家庭长期记忆会参与后续对话，可随时删除。</p>
          ${memories.length ? memories.map(memory => `<div class="memory-item">
            <strong>${esc(memory.key)}</strong><p>${esc(memory.value)}</p>
            <button type="button" data-memory-del="${esc(memory.id)}">删除</button></div>`).join('')
            : '<p class="small muted">还没有记忆。对智能体说「记住：周三不排课」试试。</p>'}
          <p class="tiny muted" style="margin-top:10px">记忆按家庭隔离，不会跨家庭共享。</p>`;
        contextBody.querySelectorAll('[data-memory-del]').forEach(button => button.addEventListener('click', async () => {
          try {
            await request(`/api/agent/memory/${encodeURIComponent(button.dataset.memoryDel)}`, { method: 'DELETE' });
            toast('记忆已删除', 'success');
            await loadContext('memory');
          } catch (error) { toast(error.message, 'error'); }
        }));
      } else if (tab === 'files') {
        if (!detail) { contextBody.innerHTML = '<p class="small muted">先选择一个会话，工作区文件会保存到该会话。</p>'; return; }
        const files = await request(`/api/agent/sessions/${encodeURIComponent(detail.id)}/files`);
        contextBody.innerHTML = `
          <div class="row" style="margin-bottom:10px"><button class="btn small soft" type="button" id="newFile" style="flex:1">＋ 新建文件</button></div>
          ${files.length ? files.map(file => `<div class="file-item">
            <span>📄</span><span class="fname" title="${esc(file.path)}">${esc(file.path)}</span>
            <button class="btn small ghost" type="button" data-file-view="${esc(file.id)}">打开</button></div>`).join('')
            : '<p class="small muted">工作区还是空的。让智能体「写一份小班英语教案」，或自己新建。</p>'}
          <p class="tiny muted" style="margin-top:10px">AI 创作的课程会先留在工作区，不会直接进入公开课程库。</p>`;
        contextBody.querySelector('#newFile')?.addEventListener('click', () => openFileEditor(null));
        contextBody.querySelectorAll('[data-file-view]').forEach(button => {
          const file = files.find(f => f.id === button.dataset.fileView);
          button.addEventListener('click', () => openFileEditor(file));
        });
        function openFileEditor(file) {
          const isNew = !file;
          openModal({
            title: isNew ? '新建工作区文件' : file.path,
            subtitle: isNew ? '保存在当前会话，不对外公开' : `版本 ${file.version} · 更新于 ${fmtDateTime(file.updated_at)}`,
            wide: true,
            body: `<form id="fileForm">
              <div class="field"><label>文件路径</label><input class="input" name="path" maxlength="120" value="${esc(file?.path || 'drafts/教案.md')}" ${isNew ? '' : 'readonly'}></div>
              <div class="field"><label>内容</label><textarea class="input" name="content" style="min-height:280px;font-family:var(--mono);font-size:12px">${esc(file?.content || '# 新教案\\n\\n## 目标\\n\\n## 活动流程\\n')}</textarea></div>
            </form>`,
            footer: `<button class="btn ghost" data-close type="button">取消</button>${isNew ? '' : `<button class="btn danger" id="deleteFile" type="button">删除</button>`}
              <button class="btn" id="saveFile" type="button">保存</button>`,
            onMount(modal, close) {
              modal.querySelector('[data-close]').addEventListener('click', close);
              modal.querySelector('#saveFile').addEventListener('click', async () => {
                const values = Object.fromEntries(new FormData(modal.querySelector('#fileForm')).entries());
                try {
                  await request(`/api/agent/sessions/${encodeURIComponent(detail.id)}/files`, { method: 'PUT', body: values });
                  close(); toast('已保存到工作区', 'success'); await loadContext('files');
                } catch (error) { toast(error.message, 'error'); }
              });
              modal.querySelector('#deleteFile')?.addEventListener('click', async () => {
                try {
                  await request(`/api/agent/sessions/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
                  close(); toast('文件已删除', 'success'); await loadContext('files');
                } catch (error) { toast(error.message, 'error'); }
              });
            },
          });
        }
      } else {
        const sandboxOn = !!(ctx.meta?.features?.sandbox);
        contextBody.innerHTML = `
          <p class="tiny muted" style="margin-bottom:8px">在权限受限的独立子进程中执行一小段 JavaScript，用于计算或演示。默认关闭，需服务端显式设置 ENABLE_SANDBOX=true。</p>
          ${sandboxOn ? '' : '<div class="deviation" style="margin-bottom:8px">当前沙箱未启用；这是生产默认状态。管理员可在服务端配置中开启。</div>'}
          <textarea class="code-area" id="sandboxCode">const days = 14;
const minutes = 25;
console.log("两周总时长", days * minutes, "分钟");
[1,2,3].map(n => n * 2);</textarea>
          <div class="actions"><button class="btn small" type="button" id="runSandbox" style="flex:1" ${sandboxOn ? '' : 'disabled'}>▶ 运行</button></div>
          <pre class="sandbox-out" id="sandboxOut">输出会显示在这里</pre>
          <p class="tiny muted" style="margin-top:8px">子进程无应用密钥/环境变量、无文件读写、无子进程权限；超时自动终止。它仍不是虚拟机级隔离，请勿运行不可信代码。</p>`;
        contextBody.querySelector('#runSandbox').addEventListener('click', async () => {
          const button = contextBody.querySelector('#runSandbox');
          button.disabled = true; button.textContent = '运行中…';
          try {
            const result = await request('/api/agent/sandbox', { method: 'POST', body: { code: contextBody.querySelector('#sandboxCode').value, sessionId: detail?.id } });
            contextBody.querySelector('#sandboxOut').textContent = `${result.status === 'ok' ? '✅' : result.status === 'timeout' ? '⏱️' : '⚠️'} ${result.status} · ${result.durationMs}ms\n${result.output}`;
          } catch (error) {
            contextBody.querySelector('#sandboxOut').textContent = `⚠️ ${error.message}`;
          }
          button.disabled = false; button.textContent = '▶ 运行';
        });
      }
    } catch (error) {
      contextBody.innerHTML = `<p class="small" style="color:var(--rose)">${esc(error.message)}</p>`;
    }
  }

  async function sendMessage() {
    if (!detail) { toast('请先新建会话', 'error'); return; }
    const input = root.querySelector('#chatInput');
    const content = input.value.trim();
    if (!content) return;
    const button = root.querySelector('#sendMessage');
    input.value = '';
    input.style.height = 'auto';
    button.disabled = true;
    const userMessage = { role: 'user', content, created_at: new Date().toISOString(), tool_results: [] };
    detail.messages.push(userMessage);
    renderMessages();
    chatBody.insertAdjacentHTML('beforeend', '<div class="chat-notice" id="typing">🤖 正在思考，必要时会调用工具…</div>');
    chatBody.scrollTop = chatBody.scrollHeight;
    try {
      const response = await request(`/api/agent/sessions/${encodeURIComponent(detail.id)}/messages`, { method: 'POST', body: { content } });
      root.querySelector('#typing')?.remove();
      const assistant = normalizeMessage(response.message);
      detail.messages.push(assistant);
      if (response.notice) {
        chatBody.insertAdjacentHTML('beforeend', `<div class="chat-notice">${esc(response.notice)}</div>`);
      }
      renderMessages();
      if (response.session?.title && response.session.title !== detail.title) {
        detail.title = response.session.title;
        const head = root.querySelector('.chat-head strong');
        if (head) head.textContent = detail.title;
        void refreshSessions();
      }
    } catch (error) {
      root.querySelector('#typing')?.remove();
      chatBody.insertAdjacentHTML('beforeend', `<div class="chat-notice" style="color:var(--rose)">${esc(error.message)}</div>`);
    }
    button.disabled = false;
    input.focus();
  }

  async function refreshSessions() {
    try {
      const list = await request('/api/agent/sessions');
      const container = root.querySelector('#sessionList');
      if (!container) return;
      container.innerHTML = list.map(item => `
        <button class="agent-session ${item.id === selectedId ? 'active' : ''}" type="button" data-session="${esc(item.id)}">
          <strong>${KIND_ICON[item.agent_kind] || '💬'} ${esc(item.title)}</strong>
          <small>${KIND_LABEL[item.agent_kind] || '智能体'} · ${item.message_count} 条 · ${esc(relativeTime(item.updated_at))}</small>
        </button>`).join('');
      container.querySelectorAll('[data-session]').forEach(button => button.addEventListener('click', () => {
        ctx.navigate(`#/agent?s=${encodeURIComponent(button.dataset.session)}`);
      }));
    } catch { /* ignore */ }
  }

  function openNewSession() {
    openModal({
      title: '新建智能体会话',
      subtitle: '选择角色与模型；专家会注入对应人格与技能',
      body: `<form id="newSessionForm">
        <div class="field"><label>会话标题（可选）</label><input class="input" name="title" maxlength="40" placeholder="例如：米粒的英语周计划"></div>
        <div class="form-row">
          <div class="field"><label>智能体角色</label><select class="select" name="agentKind">
            <option value="planner">计划规划师</option><option value="tutor">陪学导师</option><option value="expert">专家智能体</option>
          </select></div>
          <div class="field"><label>模型</label><select class="select" name="model">
            <option value="default">默认模型${models.some(m => m.configured) ? '' : '（本地规则）'}</option>
            ${models.map(model => `<option value="${esc(model.id)}">${esc(model.name)} · ${esc(model.model)}</option>`).join('')}
            <option value="local">仅本地规则引擎</option>
          </select></div>
        </div>
        <div class="field"><label>专家（可选）</label><select class="select" name="expertId">
          <option value="">不绑定专家</option>
          ${experts.map(expert => `<option value="${esc(expert.id)}">${esc(expert.name)} · ${esc(expert.title)}</option>`).join('')}
        </select></div>
        <p class="form-hint">专家可以发布并共享；使用他人发布的专家前需先安装。公开内容都经过审核。</p>
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="createSession" type="button">创建会话</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#createSession').addEventListener('click', async () => {
          const form = modal.querySelector('#newSessionForm');
          const values = Object.fromEntries(new FormData(form).entries());
          const button = modal.querySelector('#createSession');
          button.disabled = true; button.textContent = '创建中…';
          try {
            const created = await request('/api/agent/sessions', {
              method: 'POST',
              body: {
                title: values.title || undefined,
                agentKind: values.agentKind,
                model: values.model,
                expertId: values.expertId || undefined,
              },
            });
            close();
            ctx.navigate(`#/agent?s=${encodeURIComponent(created.id)}`);
          } catch (error) {
            toast(error.message, 'error');
            button.disabled = false; button.textContent = '创建会话';
          }
        });
      },
    });
  }

  renderMessages();
  root.querySelector('#newSession')?.addEventListener('click', openNewSession);
  root.querySelector('[data-sessions-open]')?.addEventListener('click', () => {
    openModal({
      title: '选择会话', subtitle: '会话按家庭隔离',
      body: `<div class="stack">${sessions.length ? sessions.map(item => `<button class="agent-session" type="button" data-mobile-session="${esc(item.id)}" style="border:1px solid var(--line)">
        <strong>${KIND_ICON[item.agent_kind] || '💬'} ${esc(item.title)}</strong><small>${KIND_LABEL[item.agent_kind]} · ${item.message_count} 条</small></button>`).join('') : '<p class="small muted">还没有会话</p>'}</div>`,
      footer: '<button class="btn" type="button" id="mobileNewSession">＋ 新建会话</button>',
      onMount(modal, close) {
        modal.querySelector('#mobileNewSession').addEventListener('click', () => { close(); openNewSession(); });
        modal.querySelectorAll('[data-mobile-session]').forEach(button => button.addEventListener('click', () => {
          close(); ctx.navigate(`#/agent?s=${encodeURIComponent(button.dataset.mobileSession)}`);
        }));
      },
    });
  });
  root.querySelectorAll('[data-session]').forEach(button => button.addEventListener('click', () => {
    ctx.navigate(`#/agent?s=${encodeURIComponent(button.dataset.session)}`);
  }));
  root.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    const input = root.querySelector('#chatInput');
    if (!detail) { openNewSession(); return; }
    input.value = button.dataset.prompt;
    input.focus();
  }));
  const input = root.querySelector('#chatInput');
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  });
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, input.scrollHeight)}px`;
  });
  root.querySelector('#sendMessage')?.addEventListener('click', () => void sendMessage());
  root.querySelector('#deleteSession')?.addEventListener('click', () => {
    if (!confirm('删除这个会话？工作区中的草稿也会一起删除。')) return;
    request(`/api/agent/sessions/${encodeURIComponent(detail.id)}`, { method: 'DELETE' })
      .then(() => { toast('会话已删除', 'success'); ctx.navigate('#/agent'); })
      .catch(error => toast(error.message, 'error'));
  });
  root.querySelectorAll('[data-context]').forEach(button => button.addEventListener('click', () => {
    contextPanel.classList.add('context-open');
    void loadContext(button.dataset.context);
  }));
  root.querySelectorAll('[data-context-open]').forEach(button => button.addEventListener('click', () => {
    contextPanel.classList.add('context-open');
    void loadContext(button.dataset.contextOpen);
  }));
  root.querySelector('[data-context-close]')?.addEventListener('click', () => contextPanel.classList.remove('context-open'));

  await loadContext('memory');
}

function quickPrompts(kind, child) {
  const name = child?.name || '孩子';
  if (kind === 'expert') return [`给${name}一个 10 分钟练习方案`, '这个年龄段最常见的误区是什么？', '帮我把练习变得更好玩'];
  if (kind === 'tutor') return [`${name}今天学什么比较好？`, '把这个知识点讲得更简单', '推荐一个 15 分钟亲子活动'];
  return [`给${name}排两周计划，每周5天，每天25分钟`, `${name}这周学得怎么样？`, '写一份小班英语亲子共读教案', '记住：我们周三和周六没有时间'];
}
