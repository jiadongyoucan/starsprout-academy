import { blob, currentChild, request, session, setCurrentChild } from '../api.js';
import { emptyState, esc, fmtDateTime, loading, openModal, toast } from '../ui.js';

export async function renderDevices(root, ctx) {
  const child = currentChild();
  root.innerHTML = loading('正在检查多端联动状态…');
  let devices = [];
  let children = [];
  let plans = [];
  let snapshots = [];
  try {
    [devices, children] = await Promise.all([
      request('/api/devices'),
      request('/api/children'),
    ]);
    if (child) {
      [plans, snapshots] = await Promise.all([
        request(`/api/plans?childId=${encodeURIComponent(child.id)}`).catch(() => []),
        request(`/api/snapshots?childId=${encodeURIComponent(child.id)}`).catch(() => []),
      ]);
    }
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="devRetry">重试</button></div></div>`;
    root.querySelector('#devRetry').addEventListener('click', () => renderDevices(root, ctx));
    return;
  }
  const secure = window.isSecureContext;
  const activePlans = plans.filter(plan => plan.status !== 'archived');

  root.innerHTML = `
    <div class="row between top" style="margin-bottom:16px">
      <div>
        <div class="eyebrow">Phone ↔ Tablet / Mac</div>
        <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">手机做计划，平板专注学</h2>
        <p class="muted small" style="margin-top:4px">一次配对，长期可用；推送、学习进度与照片都留在本家庭。</p>
      </div>
      <button class="btn" id="pairDevice" type="button">＋ 配对学习设备</button>
    </div>

    ${!secure ? `<div class="deviation" style="margin-bottom:16px">🔒 当前不是安全上下文（HTTPS / localhost）。摄像头与「添加到主屏幕」会被浏览器禁用。局域网使用请参考部署文档生成证书。</div>` : ''}

    <div class="grid two-col">
      <div class="stack">
        <section class="card">
          <div class="card-title"><div><h3>学习设备</h3><span class="hint">平板、Mac 或手机浏览器</span></div><span class="pill">${devices.length}</span></div>
          ${devices.length ? devices.map(device => `
            <div class="card soft" style="margin-bottom:10px;padding:14px">
              <div class="row between">
                <div class="row"><span class="device-status ${device.online ? 'online' : ''}"></span>
                  <div><strong style="font-size:13px">${esc(device.name)}</strong>
                    <div class="tiny muted">${esc(device.kind)} · ${device.status === 'paired' ? '已配对' : device.status === 'pending' ? '待配对' : '已撤销'} · 最近活跃 ${device.last_seen_at ? esc(fmtDateTime(device.last_seen_at)) : '未知'}</div></div>
                </div>
                ${device.status === 'paired' ? `<div class="row">
                  <button class="btn small ghost" type="button" data-push="${esc(device.id)}" data-child="${esc(device.id)}">推送计划</button>
                  <button class="btn small ghost" type="button" data-photo-request="${esc(device.id)}">请求拍照</button>
                  <button class="btn small ghost" type="button" data-revoke="${esc(device.id)}">撤销</button></div>` : ''}
              </div>
            </div>`).join('')
            : emptyState('📱', '还没有配对设备', '在平板或 Mac 打开学习端，输入 6 位配对码即可。', '<button class="btn" type="button" id="emptyPair">生成配对码</button>')}
          <div class="row" style="margin-top:6px"><a class="btn small ghost" href="/device" target="_blank" rel="noopener">打开学习端演示 ↗</a>
            <span class="tiny muted">建议全屏并「添加到主屏幕」。</span></div>
        </section>

        <section class="card">
          <div class="card-title"><div><h3>监护人授权</h3><span class="hint">随时可撤回，撤回后立即停止对应能力</span></div></div>
          ${children.map(item => `
            <div style="padding:10px 0;border-bottom:1px dashed var(--line)">
              <div class="row between"><strong style="font-size:13px">${esc(item.name)}</strong><span class="tiny muted">${{ nursery: '托班', junior: '小班', middle: '中班', senior: '大班' }[item.class_code] || esc(item.class_code)}</span></div>
              <div class="consent-row"><div><strong style="font-size:12px">AI 辅助规划与汇报</strong><div class="tiny muted">发送前仅提供去标识的学习摘要</div></div>
                <button class="switch ${item.consents.ai_processing ? 'on' : ''}" type="button" role="switch" aria-checked="${item.consents.ai_processing}" data-consent="${esc(item.id)}" data-kind="ai_processing"></button></div>
              <div class="consent-row"><div><strong style="font-size:12px">学习数据分析</strong><div class="tiny muted">用于看板与周期报告</div></div>
                <button class="switch ${item.consents.analytics ? 'on' : ''}" type="button" role="switch" aria-checked="${item.consents.analytics}" data-consent="${esc(item.id)}" data-kind="analytics"></button></div>
              <div class="consent-row"><div><strong style="font-size:12px">设备拍照留痕</strong><div class="tiny muted">默认关闭；照片需家长主动请求、设备同意</div></div>
                <button class="switch ${item.consents.camera ? 'on' : ''}" type="button" role="switch" aria-checked="${item.consents.camera}" data-consent="${esc(item.id)}" data-kind="camera"></button></div>
            </div>`).join('')}
          <p class="tiny muted" style="margin-top:10px">照片默认 30 天自动清理；可在下方随时删除。儿童数据导出与账号注销在「账户与隐私」。</p>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-title"><div><h3>学习瞬间</h3><span class="hint">${child ? esc(child.name) : ''} · 仅家庭可见</span></div>
            <div class="row"><span class="pill">${snapshots.length}</span>
              <button class="btn small ghost" type="button" id="refreshSnaps">刷新</button></div></div>
          ${snapshots.length ? `<div class="photo-grid" id="photoGrid">
            ${snapshots.map(snap => `<figure class="photo" data-snap="${esc(snap.id)}" style="margin:0">
              <div class="photo-loading skeleton" style="width:100%;height:100%"></div>
              <button class="del" type="button" data-del-snap="${esc(snap.id)}" aria-label="删除照片">✕</button>
              <figcaption class="cap">${esc(snap.device_name || '学习设备')} · ${esc(fmtDateTime(snap.created_at))}${snap.note ? ' · ' + esc(snap.note) : ''}</figcaption>
            </figure>`).join('')}
          </div>` : emptyState('📷', '还没有学习瞬间', '在设备端同意拍照后，照片会出现在这里。家长也可以主动请求一张。', '')}
          <p class="tiny muted" style="margin-top:10px">照片不经任何第三方 CDN；每次读取都会校验家庭权限。</p>
        </section>

        <section class="card">
          <div class="card-title"><h3>联动说明</h3></div>
          <div class="insight"><span class="ico">1️⃣</span><div><strong>配对</strong><p>家长生成 6 位一次性配对码（10 分钟有效），在平板打开 /device 输入。</p></div></div>
          <div class="insight"><span class="ico">2️⃣</span><div><strong>推送</strong><p>把计划推送到设备；平板收件箱立即显示，并可开始学习。</p></div></div>
          <div class="insight"><span class="ico">3️⃣</span><div><strong>回传</strong><p>完成记录自动同步到看板与周报；家长不用再问“今天学了什么”。</p></div></div>
          <div class="insight"><span class="ico">4️⃣</span><div><strong>边界</strong><p>撤销设备后令牌立即失效；照片需孩子端明确同意，家长无法静默开启摄像头。</p></div></div>
        </section>
      </div>
    </div>`;

  // load photos with auth and object URLs
  snapshots.forEach(async (snap) => {
    const figure = root.querySelector(`[data-snap="${CSS.escape(snap.id)}"]`);
    if (!figure) return;
    try {
      const file = await blob(snap.imageUrl);
      const url = URL.createObjectURL(file);
      figure.querySelector('.photo-loading')?.remove();
      const img = document.createElement('img');
      img.src = url;
      img.alt = `学习照片 ${snap.created_at}`;
      figure.prepend(img);
    } catch {
      figure.querySelector('.photo-loading')?.remove();
      figure.insertAdjacentHTML('afterbegin', '<div class="empty" style="padding:20px">无法加载</div>');
    }
  });

  root.querySelector('#pairDevice')?.addEventListener('click', openPairing);
  root.querySelector('#emptyPair')?.addEventListener('click', openPairing);
  root.querySelector('#refreshSnaps')?.addEventListener('click', () => renderDevices(root, ctx));
  root.querySelectorAll('[data-del-snap]').forEach(button => button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!confirm('删除这张照片？此操作不可恢复。')) return;
    try {
      await request(`/api/snapshots/${encodeURIComponent(button.dataset.delSnap)}`, { method: 'DELETE' });
      toast('照片已删除', 'success');
      await renderDevices(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-consent]').forEach(button => button.addEventListener('click', async () => {
    const granted = !button.classList.contains('on');
    try {
      await request(`/api/children/${encodeURIComponent(button.dataset.consent)}/consents/${button.dataset.kind}`, { method: 'PUT', body: { granted } });
      toast(granted ? '授权已开启' : '授权已关闭', 'success');
      await renderDevices(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-revoke]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('撤销后该设备将立即失去访问权限，需要重新配对。')) return;
    try {
      await request(`/api/devices/${encodeURIComponent(button.dataset.revoke)}`, { method: 'DELETE' });
      toast('设备已撤销', 'success');
      await renderDevices(root, ctx);
    } catch (error) { toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-push]').forEach(button => button.addEventListener('click', () => openPush(button.dataset.push)));
  root.querySelectorAll('[data-photo-request]').forEach(button => button.addEventListener('click', () => openPhotoRequest(button.dataset.photoRequest)));

  function openPairing() {
    request('/api/devices/pairing-code', { method: 'POST', body: { name: '学习平板', kind: 'ipad' } })
      .then(result => {
        let remaining = Math.max(0, Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 1000));
        const { close } = openModal({
          title: '配对学习设备',
          subtitle: '配对码一次性使用，10 分钟内有效',
          body: `<div class="code-display">${esc(result.code)}</div>
            <div class="row" style="justify-content:center;margin-top:12px">
              <button class="btn small soft" type="button" id="copyCode">复制配对码</button>
              <span class="pill" id="countdown">${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}</span>
            </div>
            <div class="divider"></div>
            <p class="small">1. 在平板或 Mac 浏览器打开：</p>
            <div class="quote" style="font-size:14px;word-break:break-all">${esc(result.url)}</div>
            <p class="small muted" style="margin-top:8px">2. 输入上方 6 位配对码；成功后设备将获得独立令牌。</p>
            ${!window.isSecureContext ? '<div class="deviation" style="margin-top:12px">摄像头与 PWA 安装需要 HTTPS 或 localhost。请让家长用手机热点/本机地址，或按部署文档生成证书。</div>' : ''}
            <p class="tiny muted" style="margin-top:10px">${esc(result.instructions)}</p>`,
          footer: `<a class="btn ghost" href="/device" target="_blank" rel="noopener">打开学习端 ↗</a><button class="btn" data-close type="button">完成</button>`,
          onMount(modal, closeModal) {
            modal.querySelector('#copyCode').addEventListener('click', async () => {
              try { await navigator.clipboard.writeText(result.code); toast('配对码已复制', 'success'); }
              catch { toast('复制失败，请手动输入', 'error'); }
            });
            modal.querySelector('[data-close]').addEventListener('click', () => { clearInterval(timer); closeModal(); renderDevices(root, ctx); });
            const timer = setInterval(() => {
              remaining -= 1;
              const countdown = modal.querySelector('#countdown');
              if (countdown) countdown.textContent = `${Math.max(0, Math.floor(remaining / 60))}:${String(Math.max(0, remaining % 60)).padStart(2, '0')}`;
              if (remaining <= 0) { clearInterval(timer); if (countdown) countdown.textContent = '已过期'; }
            }, 1000);
            void close;
          },
        });
      })
      .catch(error => toast(error.message, 'error'));
  }

  function openPush(deviceId) {
    openModal({
      title: '推送学习计划',
      subtitle: '平板收件箱会立即收到；打开后自动标记',
      body: `<form id="pushForm">
        <div class="field"><label>孩子</label><select class="select" name="childId">${children.map(c => `<option value="${esc(c.id)}" ${child?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>计划</label><select class="select" name="planId">${activePlans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.title)} · ${plan.done}/${plan.total}</option>`).join('')}</select></div>
        <div class="field"><label>附言</label><input class="input" name="message" maxlength="200" placeholder="今晚一起学 20 分钟吧！"></div>
        ${activePlans.length ? '' : '<div class="deviation">还没有可推送的计划，先到「学习计划」生成一份。</div>'}
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="pushSubmit" type="button">推送</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#pushSubmit').addEventListener('click', async () => {
          const values = Object.fromEntries(new FormData(modal.querySelector('#pushForm')).entries());
          try {
            await request(`/api/devices/${encodeURIComponent(deviceId)}/push`, { method: 'POST', body: values });
            close(); toast('已推送到学习设备', 'success');
          } catch (error) { toast(error.message, 'error'); }
        });
      },
    });
  }

  function openPhotoRequest(deviceId) {
    openModal({
      title: '请求一张学习照片',
      subtitle: '孩子端会显示提示并询问是否允许；无法静默拍照',
      body: `<form id="photoForm">
        <div class="field"><label>孩子</label><select class="select" name="childId">${children.filter(c => c.consents.camera).map(c => `<option value="${esc(c.id)}" ${child?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>给孩子的话</label><input class="input" name="message" maxlength="120" placeholder="想看看你在学什么，可以拍一张吗？"></div>
        ${children.some(c => c.consents.camera) ? '' : '<div class="deviation">还没有孩子开启摄像头授权。请先在上方「监护人授权」中明确开启。</div>'}
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="photoSubmit" type="button">发送请求</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#photoSubmit').addEventListener('click', async () => {
          const values = Object.fromEntries(new FormData(modal.querySelector('#photoForm')).entries());
          try {
            await request(`/api/devices/${encodeURIComponent(deviceId)}/request-photo`, { method: 'POST', body: values });
            close(); toast('已发送拍照邀请，等待设备同意', 'success');
          } catch (error) { toast(error.message, 'error'); }
        });
      },
    });
  }
}
