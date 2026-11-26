import { ApiError } from './api.js';

export function localToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const logo = (size = 32) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" style="display:block">
    <rect width="64" height="64" rx="18" fill="#4f46e5"/>
    <path d="M32 50V29" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M32 33c-9 0-14-5-14-13 8 0 14 5 14 13Z" fill="#c7f9d8"/>
    <path d="M32 38c8 0 13-4.5 13-12-7.5 0-13 4.5-13 12Z" fill="#fde68a"/>
    <circle cx="32" cy="49" r="3" fill="#fff"/>
  </svg>`;

export function toast(message, type = 'info', ms = 3200) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  while (root.children.length > 3) root.removeChild(root.firstElementChild);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, ms);
  setTimeout(() => el.remove(), ms + 250);
}

let activeModal = null;
let activeOnClose = null;
let activeRestore = null;

export function closeModal() {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.style.overflow = '';
  activeModal = null;
  const restore = activeRestore;
  activeRestore = null;
  if (restore) restore();
  const callback = activeOnClose;
  activeOnClose = null;
  if (callback) { try { callback(); } catch { /* ignore */ } }
}

export function openModal({ title, subtitle = '', body = '', footer = '', wide = false, onMount, onClose, dismissible = true }) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop" ${dismissible ? 'data-close' : ''}></div>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        ${dismissible ? '<button class="modal-close" type="button" data-close aria-label="关闭">✕</button>' : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.classList.add('open');
  document.body.style.overflow = 'hidden';
  root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
  const modal = root.querySelector('.modal');
  if (onMount) onMount(modal, closeModal);
  activeModal = modal;
  activeRestore = trapFocus(modal, closeModal);
  activeOnClose = onClose || null;
  return { el: modal, close: closeModal };
}

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确认', danger = false }) {
  return new Promise((resolve) => {
    const { el, close } = openModal({
      title,
      body: `<p style="font-size:13.5px;color:var(--ink-2);line-height:1.75">${esc(message)}</p>`,
      footer: `<button class="btn ghost" data-no type="button">取消</button>
               <button class="btn ${danger ? 'danger' : ''}" data-yes type="button">${esc(confirmText)}</button>`,
      onMount(modal) {
        modal.querySelector('[data-no]').addEventListener('click', () => { close(); resolve(false); });
        modal.querySelector('[data-yes]').addEventListener('click', () => { close(); resolve(true); });
      },
    });
    void el;
  });
}

export function badge(status) {
  const labels = {
    draft: '草稿', active: '进行中', archived: '已归档', pending: '待审核', approved: '已通过',
    rejected: '未通过', hidden: '已隐藏', pending_review: '待审核', published: '已发布',
    done: '已完成', missed: '已逾期', skipped: '已跳过', moved: '已顺延', sent: '已提醒',
    queued: '待接收', error: '出错', ok: '成功',
  };
  return `<span class="badge ${esc(status)}">${esc(labels[status] || status)}</span>`;
}

export function statusText(status) {
  const labels = {
    draft: '草稿', active: '进行中', archived: '已归档', pending: '待审核', approved: '已发布',
    rejected: '未通过', hidden: '已隐藏', pending_review: '审核中', published: '已发布',
    done: '已完成', missed: '逾期', skipped: '已跳过', moved: '已顺延', sent: '已提醒',
    queued: '待接收', error: '出错',
  };
  return labels[status] || status;
}

const SUBJECTS = {
  thinking: { name: '智趣思维', icon: '🧠', color: '#6366f1' },
  english: { name: '英语启蒙', icon: '🌍', color: '#0ea5e9' },
  piano: { name: '钢琴律动', icon: '🎹', color: '#f59e0b' },
  hanzi: { name: '汉字启蒙', icon: '✍️', color: '#ef4444' },
  montessori: { name: '蒙氏工作', icon: '🧩', color: '#10b981' },
};
export function subjectMeta(code) {
  return SUBJECTS[code] || { name: code || '综合', icon: '📘', color: '#4f46e5' };
}

export function fmtDate(dateStr, style = 'short') {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).length <= 10 ? `${dateStr}T00:00:00` : dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (style === 'relative') {
    if (same) return '今天';
    if (d.toDateString() === tomorrow.toDateString()) return '明天';
    if (d.toDateString() === yesterday.toDateString()) return '昨天';
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function weekday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || '';
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return fmtDate(iso);
}

export function mdLite(text) {
  const safe = esc(text || '');
  const lines = safe.split(/\n/);
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(bullet ? bullet[1] : numbered[1])}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (!line.trim()) { html += '<div style="height:6px"></div>'; continue; }
      if (/^#{1,4}\s/.test(line)) { html += `<p><strong>${inline(line.replace(/^#{1,4}\s+/, ''))}</strong></p>`; continue; }
      html += `<p>${inline(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function inline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function safeUrl(url) {
  try {
    const parsed = new URL(url, location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

export function ring(percent, color = '#4f46e5', label = '') {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="ring" style="--p:${p};--c:${color}"><span>${p}<small>%</small></span></div>${label ? `<div class="tiny muted" style="text-align:center;margin-top:6px">${esc(label)}</div>` : ''}`;
}

export function barChart(series, { todayStr = '' } = {}) {
  if (!series?.length) return '<div class="empty"><p>暂无数据</p></div>';
  const max = Math.max(1, ...series.map(s => s.minutes || 0), ...series.map(s => s.lessons || 0));
  return `<div class="bars">${series.map(s => {
    const value = s.minutes || s.lessons || 0;
    const height = Math.max(3, Math.round((value / max) * 100));
    const day = s.date ? new Date(`${s.date}T00:00:00`) : null;
    const label = day ? `${day.getMonth() + 1}/${day.getDate()}` : '';
    const isToday = s.date === todayStr;
    return `<div class="bar-col">
      <div class="bar ${isToday ? 'today' : ''}" style="--v:${height}" data-tip="${esc(`${label} · ${s.lessons} 个活动 / ${s.minutes} 分钟`)}"></div>
      <div class="bar-label">${esc(label)}</div>
    </div>`;
  }).join('')}</div>`;
}

export function emptyState(emoji, title, text, actionHtml = '') {
  return `<div class="empty"><div class="big">${emoji}</div><strong>${esc(title)}</strong><p>${esc(text)}</p>${actionHtml ? `<div class="actions" style="justify-content:center">${actionHtml}</div>` : ''}</div>`;
}

export function errorState(error, retryId = '') {
  const message = error instanceof ApiError ? error.message : (error?.message || '加载失败');
  return `<div class="error-box">😥 ${esc(message)}${retryId ? `<div class="actions"><button class="btn small ghost" id="${retryId}" type="button">重新加载</button></div>` : ''}</div>`;
}

export function loading(label = '正在加载…') {
  return `<div class="loading"><div class="spinner"></div><span>${esc(label)}</span></div>`;
}

export function pageHeader(title, subtitle, actions = '') {
  return `<div class="row between top" style="margin-bottom:18px">
    <div><h2 style="font-size:24px;letter-spacing:-.025em">${esc(title)}</h2>
    ${subtitle ? `<p class="muted small" style="margin-top:4px">${esc(subtitle)}</p>` : ''}</div>
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </div>`;
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function formValues(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number') data[el.name] = el.value === '' ? undefined : Number(el.value);
    else data[el.name] = el.value;
  }
  return data;
}

export function showFormError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    form.prepend(box);
  }
  box.textContent = message;
  box.style.display = 'block';
}

export function clearFormError(form) {
  const box = form.querySelector('.form-error');
  if (box) box.style.display = 'none';
}

/* ---------------- celebration ---------------- */
function trapFocus(container, onEscape) {
  const previous = document.activeElement;
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const keydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onEscape(); }
    if (event.key !== 'Tab') return;
    const focusables = [...container.querySelectorAll(selector)].filter(el => !el.disabled && el.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keydown);
  setTimeout(() => container.querySelector(selector)?.focus(), 40);
  return () => {
    document.removeEventListener('keydown', keydown);
    if (previous instanceof HTMLElement) previous.focus();
  };
}

export function celebrate({ title, subtitle = '', emoji = '🌟', rewards = {}, petHtml = '', note = '', nextHref = '', nextLabel = '', onClose = null }) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const overlay = document.createElement('div');
  overlay.className = 'celebrate-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  const colors = ['#f6b94a', '#ef7d84', '#8b7bd8', '#8bb89a', '#8cc7e8', '#fde68a'];
  const confetti = reduced ? '' : Array.from({ length: 34 }, (_, i) => {
    const left = (i * 37 + 11) % 100;
    const delay = (i % 9) * 0.08;
    const duration = 1.5 + (i % 6) * 0.22;
    return `<i style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${duration}s"></i>`;
  }).join('');
  const totalCoins = Number(rewards.coins || 0) + Number(rewards.bonusCoins || 0);
  const chips = [
    totalCoins > 0 ? `<span class="reward-chip">🪙 +${totalCoins} 金币</span>` : '',
    Number(rewards.exp || 0) > 0 ? `<span class="reward-chip xp">✨ +${rewards.exp} 经验</span>` : '',
    rewards.stars ? `<span class="reward-chip star">${'★'.repeat(rewards.stars)}${'☆'.repeat(Math.max(0, 3 - rewards.stars))}</span>` : '',
  ].filter(Boolean).join('');
  const milestones = (rewards.milestones || []).map(m => `<div class="milestone-line">${m.type === 'unit' ? '🏅 完成一个单元' : '🏆 完成一份计划'} · ${esc(m.title)}${m.itemName ? ` · 获得「${esc(m.itemName)}」` : ''}</div>`).join('');
  overlay.innerHTML = `<div class="celebrate-card">
    <div class="confetti">${confetti}</div>
    <div class="crown" aria-hidden="true">${esc(emoji)}</div>
    <h2>${esc(title)}</h2>
    ${subtitle ? `<p class="cs-sub">${esc(subtitle)}</p>` : ''}
    ${petHtml ? `<div class="celebrate-pet">${petHtml}</div>` : ''}
    <div class="reward-row">${chips}</div>
    ${Number(rewards.correct || 0) > 0 && Number(rewards.total || 0) > 0 ? `<p class="tiny muted">答对 ${rewards.correct}/${rewards.total} 题，${rewards.stars >= 3 ? '像小星星一样闪亮' : '每一次尝试都算数'}</p>` : ''}
    ${rewards.warmth ? `<p class="warm-line" aria-live="polite">🌿 ${esc(rewards.warmth)}</p>` : ''}
    ${rewards.levelUp ? '<p class="tiny" style="color:#7c5a22">伙伴升级啦，快去小窝看看！</p>' : ''}
    ${milestones}
    ${note ? `<p class="tiny muted" style="margin-top:8px">${esc(note)}</p>` : ''}
    <div class="celebrate-actions">
      ${nextHref ? `<a class="btn" href="${esc(nextHref)}" data-celebrate-close>${esc(nextLabel || '继续')}</a>` : '<button class="btn" type="button" data-celebrate-close>太棒了</button>'}
      <button class="btn ghost" type="button" data-celebrate-close>收下这份小星星</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const restore = trapFocus(overlay, close);
  function close() {
    restore();
    overlay.remove();
    window.dispatchEvent(new CustomEvent('pet:updated'));
    if (onClose) onClose();
  }
  overlay.querySelectorAll('[data-celebrate-close]').forEach(el => el.addEventListener('click', close));
}
