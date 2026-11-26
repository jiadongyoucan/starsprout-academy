import { request, session } from '../api.js';
import {
  badge, emptyState, esc, fmtDateTime, loading, mdLite, openModal, relativeTime, statusText, toast,
} from '../ui.js';

const TYPE_LABEL = { insight: '学习心得', course: '好课程', question: '提问' };
const TYPE_ICON = { insight: '🌿', course: '📚', question: '❓' };

export async function renderCommunity(root, ctx) {
  const staff = ['teacher', 'admin'].includes(session.user?.role);
  const initial = ctx.query.get('tab') === 'review' && staff ? 'review' : ctx.query.get('tab') === 'mine' ? 'mine' : 'feed';
  root.innerHTML = `
    <div class="row between top" style="margin-bottom:16px">
      <div>
        <div class="eyebrow">Family & Teacher Community</div>
        <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">真实经验，比广告更值得看</h2>
        <p class="muted small" style="margin-top:4px">课程与心得都需审核；健康、相关、可追溯。看到不适内容可以举报。</p>
      </div>
      <button class="btn" id="composePost" type="button">＋ 发布</button>
    </div>
    <div class="tabs">
      <button type="button" data-tab="feed" class="${initial === 'feed' ? 'active' : ''}">🌿 广场</button>
      <button type="button" data-tab="mine" class="${initial === 'mine' ? 'active' : ''}">我的发布</button>
      ${staff ? `<button type="button" data-tab="review" class="${initial === 'review' ? 'active' : ''}">🛡️ 审核台</button>` : ''}
    </div>
    <div id="communityBody">${loading('正在打开社区…')}</div>`;

  const body = root.querySelector('#communityBody');
  let activeTab = initial;
  let feedType = '';

  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
    void loadTab(activeTab);
  }));
  root.querySelector('#composePost').addEventListener('click', () => openComposer());

  async function loadTab(tab) {
    body.innerHTML = loading('正在加载…');
    try {
      if (tab === 'feed') await loadFeed();
      else if (tab === 'mine') await loadMine();
      else await loadReview();
    } catch (error) {
      body.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="comRetry">重试</button></div></div>`;
      body.querySelector('#comRetry').addEventListener('click', () => loadTab(tab));
    }
  }

  async function loadFeed() {
    const posts = await request(`/api/community/feed${feedType ? `?type=${feedType}` : ''}`);
    body.innerHTML = `
      <div class="row between" style="margin-bottom:14px">
        <div class="chips">
          <button class="chip ${!feedType ? 'active' : ''}" type="button" data-type="">全部</button>
          ${Object.entries(TYPE_LABEL).map(([type, label]) => `<button class="chip ${feedType === type ? 'active' : ''}" type="button" data-type="${type}">${TYPE_ICON[type]} ${label}</button>`).join('')}
        </div>
        <span class="tiny muted">仅展示审核通过的内容</span>
      </div>
      ${posts.length ? `<div class="post-grid">${posts.map(postCard).join('')}</div>`
        : emptyState('🌿', '还没有通过审核的分享', '发布第一条学习心得，审核通过后会出现在这里。', '<button class="btn" type="button" id="emptyCompose">写一条</button>')}`;
    body.querySelector('#emptyCompose')?.addEventListener('click', () => openComposer());
    bindPostCards(posts);
    body.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
      feedType = button.dataset.type;
      void loadFeed();
    }));
  }

  function postCard(post) {
    return `<article class="post-card" data-open-post="${esc(post.id)}">
      <div class="post-head">
        <span class="avatar small">${esc((post.author_name || '家').slice(0, 1))}</span>
        <span>${esc(post.author_name)}</span><span>·</span><span>${esc(relativeTime(post.published_at || post.created_at))}</span>
        <span class="spacer"></span><span class="pill tiny">${TYPE_ICON[post.type] || '🌿'} ${esc(TYPE_LABEL[post.type] || post.type)}</span>
      </div>
      <h3>${esc(post.title)}</h3>
      <p>${esc(post.content)}</p>
      ${post.courseRef ? `<div class="course-ref">📚 关联课程：<strong>${esc(post.courseRef.title || '课程')}</strong></div>` : ''}
      <div class="post-foot">
        <button type="button" data-like="${esc(post.id)}">${post.liked ? '💜' : '🤍'} ${post.like_count}</button>
        <span>💬 ${post.comment_count || 0}</span><span>👀 ${post.view_count || 0}</span>
        <span class="spacer"></span>
        <span class="tiny muted">${(post.tags || []).slice(0, 2).map(tag => `#${esc(tag)}`).join(' ')}</span>
      </div>
    </article>`;
  }

  function bindPostCards(posts) {
    body.querySelectorAll('[data-open-post]').forEach(card => card.addEventListener('click', (event) => {
      if (event.target.closest('[data-like]')) return;
      void openPost(card.dataset.openPost);
    }));
    body.querySelectorAll('[data-like]').forEach(button => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        const result = await request(`/api/community/posts/${encodeURIComponent(button.dataset.like)}/like`, { method: 'POST' });
        button.textContent = `${result.liked ? '💜' : '🤍'} ${result.likeCount}`;
      } catch (error) { toast(error.message, 'error'); }
    }));
    void posts;
  }

  async function openPost(postId) {
    try {
      const data = await request(`/api/community/posts/${encodeURIComponent(postId)}`);
      const post = data.post;
      openModal({
        title: post.title,
        subtitle: `${post.author_name} · ${fmtDateTime(post.published_at || post.created_at)} · ${TYPE_LABEL[post.type]}`,
        wide: true,
        body: `<div class="row" style="margin-bottom:10px">${badge(post.status)}${(post.tags || []).map(tag => `<span class="pill tiny">#${esc(tag)}</span>`).join('')}</div>
          <div style="font-size:13.5px;line-height:1.85;white-space:pre-wrap">${esc(post.content)}</div>
          ${post.courseRef ? `<a class="course-ref" style="margin-top:14px;text-decoration:none" href="#/learn/${encodeURIComponent(post.courseRef.lessonId || '')}" data-close>📚 打开关联课程：<strong>${esc(post.courseRef.title || '')}</strong></a>` : ''}
          <div class="divider"></div>
          <div class="row between"><strong style="font-size:13px">评论 ${data.comments.length}</strong>
            <button class="btn small ghost" type="button" id="reportPost">举报</button></div>
          <div style="margin-top:10px">${data.comments.map(comment => `<div class="insight"><span class="avatar small">${esc(comment.author_name.slice(0, 1))}</span><div><strong>${esc(comment.author_name)}</strong><p>${esc(comment.content)}</p><span class="tiny muted">${esc(relativeTime(comment.created_at))}</span></div></div>`).join('') || '<p class="small muted">还没有评论。</p>'}</div>
          <form id="commentForm" style="display:flex;gap:8px;margin-top:12px"><input class="input" name="content" maxlength="500" placeholder="友善、具体地回应…"><button class="btn" type="submit">发送</button></form>`,
        footer: `<button class="btn ghost" data-close type="button">关闭</button>`,
        onMount(modal, close) {
          modal.querySelector('[data-close]').addEventListener('click', close);
          modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
          modal.querySelector('#commentForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const content = new FormData(event.currentTarget).get('content')?.trim();
            if (!content) return;
            try {
              const result = await request(`/api/community/posts/${encodeURIComponent(post.id)}/comments`, { method: 'POST', body: { content } });
              close(); toast(result.status === 'pending' ? '评论已提交，审核通过后展示' : '评论已发布', 'success'); void openPost(post.id);
            } catch (error) { toast(error.message, 'error'); }
          });
          modal.querySelector('#reportPost').addEventListener('click', () => {
            openModal({
              title: '举报内容', body: `<form id="reportForm"><div class="field"><label>举报原因</label><textarea class="input" name="reason" maxlength="300" placeholder="请说明具体问题，方便管理员核实"></textarea></div></form>`,
              footer: `<button class="btn ghost" data-c type="button">取消</button><button class="btn danger" id="reportSubmit" type="button">提交举报</button>`,
              onMount(inner, innerClose) {
                inner.querySelector('[data-c]').addEventListener('click', innerClose);
                inner.querySelector('#reportSubmit').addEventListener('click', async () => {
                  const reason = inner.querySelector('[name=reason]').value.trim();
                  if (reason.length < 2) { toast('请填写举报原因', 'error'); return; }
                  try {
                    await request(`/api/community/posts/${encodeURIComponent(post.id)}/report`, { method: 'POST', body: { reason } });
                    innerClose(); toast('已收到举报，管理员会尽快处理', 'success');
                  } catch (error) { toast(error.message, 'error'); }
                });
              },
            });
          });
        },
      });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function loadMine() {
    const posts = await request('/api/community/mine');
    body.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><span class="small muted">发布后会先进入审核；修改已通过内容会重新审核。</span>
        <button class="btn small ghost" type="button" id="mineCompose">＋ 新发布</button></div>
      ${posts.length ? `<div class="grid two">${posts.map(post => `<article class="post-card">
        <div class="row" style="gap:6px">${badge(post.status)}<span class="pill tiny">${TYPE_ICON[post.type]} ${TYPE_LABEL[post.type]}</span></div>
        <h3>${esc(post.title)}</h3><p>${esc(post.content)}</p>
        ${post.moderationReasons?.length ? `<div class="moderation tiny" style="color:#b45309">审核提示：${post.moderationReasons.map(esc).join('；')}</div>` : ''}
        ${post.status === 'rejected' ? '<div class="tiny" style="color:var(--rose)">未通过审核，可修改后重新提交。</div>' : ''}
        <div class="post-foot"><span class="tiny muted">${esc(fmtDateTime(post.created_at))}</span><span class="spacer"></span>
          <button type="button" data-edit-post="${esc(post.id)}">编辑</button>
          <button type="button" data-delete-post="${esc(post.id)}">删除</button></div>
      </article>`).join('')}</div>`
        : emptyState('📝', '还没有发布', '把最近有效的一次亲子共学写下来，也许正好帮到另一个家庭。', '<button class="btn" type="button" id="emptyMine">写第一条</button>')}`;
    body.querySelector('#mineCompose')?.addEventListener('click', () => openComposer());
    body.querySelector('#emptyMine')?.addEventListener('click', () => openComposer());
    body.querySelectorAll('[data-edit-post]').forEach(button => {
      const post = posts.find(p => p.id === button.dataset.editPost);
      button.addEventListener('click', () => openComposer(post));
    });
    body.querySelectorAll('[data-delete-post]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('确定删除这条内容？删除后不可恢复。')) return;
      try {
        await request(`/api/community/posts/${encodeURIComponent(button.dataset.deletePost)}`, { method: 'DELETE' });
        toast('已删除', 'success'); await loadMine();
      } catch (error) { toast(error.message, 'error'); }
    }));
  }

  async function loadReview() {
    const [queue, comments, reports] = await Promise.all([
      request('/api/admin/community/queue?status=pending'),
      request('/api/admin/community/comments?status=pending').catch(() => []),
      request('/api/admin/community/reports'),
    ]);
    body.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><span class="small muted">先看审核提示，再决定通过或拒绝；拒绝必须写清原因。不能审核自己的内容。</span>
        <span class="pill">${queue.length} 条待审 · ${comments.length} 条评论 · ${reports.filter(r => r.status === 'open').length} 条举报</span></div>
      ${queue.length ? queue.map(post => `<div class="review-item">
        <div class="row" style="gap:6px">${badge(post.status)}<span class="pill tiny">${TYPE_LABEL[post.type]}</span><span class="tiny muted">${esc(post.author_name)} · ${esc(post.household_name)}</span></div>
        <h4 style="margin-top:6px">${esc(post.title)}</h4>
        <div class="small" style="margin-top:4px;white-space:pre-wrap;max-height:120px;overflow:hidden">${esc(post.content)}</div>
        ${post.courseRef ? `<div class="course-ref" style="margin-top:6px">关联课时：${esc(post.courseRef.title || post.courseRef.lessonId)}</div>` : ''}
        ${post.moderationReasons?.length ? `<div class="moderation">⚠️ ${post.moderationReasons.map(esc).join('；')}</div>` : ''}
        <div class="review-actions">
          <button class="btn small" type="button" data-review="${esc(post.id)}" data-decision="approve">通过</button>
          <button class="btn small ghost" type="button" data-review="${esc(post.id)}" data-decision="reject">拒绝</button>
          <button class="btn small danger" type="button" data-review="${esc(post.id)}" data-decision="hide">隐藏</button>
        </div>
      </div>`).join('') : '<p class="small muted">审核队列已清空。</p>'}
      <h3 style="margin:22px 0 10px;font-size:15px">评论审核</h3>
      ${comments.length ? comments.map(comment => `<div class="review-item">
        <div class="row" style="gap:6px"><span class="pill tiny">评论</span><span class="tiny muted">${esc(comment.author_name)} · ${esc(comment.post_title)}</span></div>
        <div class="small" style="margin-top:6px;white-space:pre-wrap">${esc(comment.content)}</div>
        ${comment.moderationReasons?.length ? `<div class="moderation">⚠️ ${comment.moderationReasons.map(r => esc(r.label || r)).join('；')}</div>` : ''}
        <div class="review-actions">
          <button class="btn small" type="button" data-review-comment="${esc(comment.id)}" data-decision="approve">通过</button>
          <button class="btn small ghost" type="button" data-review-comment="${esc(comment.id)}" data-decision="reject">拒绝</button>
          <button class="btn small danger" type="button" data-review-comment="${esc(comment.id)}" data-decision="hide">隐藏</button>
        </div>
      </div>`).join('') : '<p class="small muted">没有待审评论。</p>'}
      <h3 style="margin:22px 0 10px;font-size:15px">举报处理</h3>
      ${reports.length ? reports.map(report => `<div class="review-item">
        <div class="row" style="gap:6px"><span class="pill ${report.status === 'open' ? 'rose' : ''}">${esc(report.status === 'open' ? '待处理' : '已处理')}</span><strong style="font-size:13px">${esc(report.post_title)}</strong></div>
        <p class="small muted" style="margin-top:4px">${esc(report.reason)} · ${esc(fmtDateTime(report.created_at))}</p>
        ${report.status === 'open' ? `<div class="review-actions"><button class="btn small ghost" type="button" data-resolve="${esc(report.id)}" data-decision="dismiss">驳回举报</button>
          <button class="btn small danger" type="button" data-resolve="${esc(report.id)}" data-decision="hide">隐藏内容</button></div>` : ''}
      </div>`).join('') : '<p class="small muted">没有举报记录。</p>'}`;
    body.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', () => reviewPost(button.dataset.review, button.dataset.decision)));
    body.querySelectorAll('[data-review-comment]').forEach(button => button.addEventListener('click', async () => {
      try {
        await request(`/api/admin/community/comments/${encodeURIComponent(button.dataset.reviewComment)}/review`, { method: 'POST', body: { decision: button.dataset.decision } });
        toast('评论已处理', 'success'); await loadReview();
      } catch (error) { toast(error.message, 'error'); }
    }));
    body.querySelectorAll('[data-resolve]').forEach(button => button.addEventListener('click', async () => {
      try {
        await request(`/api/admin/community/reports/${encodeURIComponent(button.dataset.resolve)}/resolve`, { method: 'POST', body: { decision: button.dataset.decision } });
        toast('已处理', 'success'); await loadReview();
      } catch (error) { toast(error.message, 'error'); }
    }));
  }

  function reviewPost(postId, decision) {
    openModal({
      title: decision === 'approve' ? '通过审核' : '拒绝审核',
      subtitle: decision === 'approve' ? '通过后会立即出现在社区广场' : '拒绝必须填写具体原因，作者可修改后重提',
      body: `<form id="reviewForm"><div class="field"><label>审核意见${decision === 'reject' ? '（必填）' : '（可选）'}</label>
        <textarea class="input" name="note" maxlength="500" placeholder="${decision === 'reject' ? '请说明不符合规范的具体原因与修改建议' : '例如：主题健康，经验具体'}"></textarea></div></form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn ${decision === 'reject' ? 'danger' : ''}" id="reviewSubmit" type="button">${decision === 'approve' ? '通过' : '拒绝'}</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        modal.querySelector('#reviewSubmit').addEventListener('click', async () => {
          const note = modal.querySelector('[name=note]').value.trim();
          if (decision === 'reject' && !note) { toast('拒绝时必须填写原因', 'error'); return; }
          try {
            await request(`/api/admin/community/posts/${encodeURIComponent(postId)}/review`, { method: 'POST', body: { decision, note } });
            close(); toast(decision === 'approve' ? '已通过并发布' : '已拒绝', 'success'); await loadReview();
          } catch (error) { toast(error.message, 'error'); }
        });
      },
    });
  }

  function openComposer(existing = null) {
    const type = existing?.type || 'insight';
    let selectedLesson = existing?.courseRef || null;
    openModal({
      title: existing ? '编辑发布' : '发布到社区',
      subtitle: '所有内容需审核；禁止导流、联系方式、广告与不健康内容',
      wide: true,
      body: `<form id="postForm">
        <div class="form-row">
          <div class="field"><label>内容类型</label><select class="select" name="type" ${existing ? 'disabled' : ''}>
            ${Object.entries(TYPE_LABEL).map(([value, label]) => `<option value="${value}" ${type === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select></div>
          <div class="field"><label>标签（逗号分隔，最多 5 个）</label><input class="input" name="tags" value="${esc((existing?.tags || []).join(','))}" placeholder="英语,习惯,小班"></div>
        </div>
        <div class="field"><label>标题</label><input class="input" name="title" maxlength="60" value="${esc(existing?.title || '')}" placeholder="一句话说清楚主题"></div>
        <div class="field"><label>正文</label><textarea class="input" name="content" maxlength="5000" style="min-height:180px" placeholder="写下具体做法、年龄段和真实观察。请勿包含孩子全名、联系方式或站外链接。">${esc(existing?.content || '')}</textarea></div>
        <div id="coursePicker" ${type === 'course' ? '' : 'hidden'}>
          <div class="field"><label>关联课时（发布课程必选）</label>
            <div class="search-row"><input class="input" id="courseQuery" placeholder="搜索课程，例如：英语"><button class="btn ghost" type="button" id="courseSearch">搜索</button></div>
            <div id="courseResults" style="margin-top:8px"></div>
            <div id="selectedCourse">${selectedLesson ? `<span class="pill mint">已选：${esc(selectedLesson.title || selectedLesson.lessonId)}</span>` : '<span class="tiny muted">尚未选择课时</span>'}</div>
          </div>
        </div>
        <div class="ai-note">审核规则：主题需与儿童教育相关；禁止色情、暴力、赌博、医疗承诺、导流与联系方式；课程必须关联平台已发布课时。</div>
      </form>`,
      footer: `<button class="btn ghost" data-close type="button">取消</button><button class="btn" id="postSubmit" type="button">${existing ? '保存并重新提交' : '提交审核'}</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-close]').addEventListener('click', close);
        const typeSelect = modal.querySelector('[name=type]');
        typeSelect.addEventListener('change', () => {
          modal.querySelector('#coursePicker').hidden = typeSelect.value !== 'course';
        });
        async function searchCourses() {
          const query = modal.querySelector('#courseQuery').value.trim();
          if (!query) return;
          const results = await request(`/api/curriculum/search?q=${encodeURIComponent(query)}`).catch(() => []);
          modal.querySelector('#courseResults').innerHTML = results.length
            ? results.map(lesson => `<button class="chip" type="button" data-pick-course="${esc(lesson.id)}" data-course-title="${esc(lesson.title)}" style="margin:3px">${esc(lesson.title)} · ${esc(lesson.class_name)}</button>`).join('')
            : '<span class="tiny muted">没有找到匹配课时</span>';
          modal.querySelectorAll('[data-pick-course]').forEach(button => button.addEventListener('click', () => {
            selectedLesson = { lessonId: button.dataset.pickCourse, title: button.dataset.courseTitle };
            modal.querySelector('#selectedCourse').innerHTML = `<span class="pill mint">已选：${esc(selectedLesson.title)}</span>`;
          }));
        }
        modal.querySelector('#courseSearch').addEventListener('click', searchCourses);
        modal.querySelector('#courseQuery').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchCourses(); } });
        modal.querySelector('#postSubmit').addEventListener('click', async () => {
          const form = modal.querySelector('#postForm');
          const values = Object.fromEntries(new FormData(form).entries());
          const tags = values.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 5);
          const payload = { type: values.type, title: values.title, content: values.content, tags };
          if (values.type === 'course') {
            if (!selectedLesson) { toast('发布课程必须关联一个课时', 'error'); return; }
            payload.courseRef = selectedLesson;
          }
          const button = modal.querySelector('#postSubmit');
          button.disabled = true; button.textContent = '提交中…';
          try {
            const result = existing
              ? await request(`/api/community/posts/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: payload })
              : await request('/api/community/posts', { method: 'POST', body: payload });
            close();
            const reasons = result.moderationReasons || [];
            openModal({
              title: '已提交审核',
              body: `<div class="celebration"><div class="big">🛡️</div>
                <h3 style="margin-top:6px">内容正在审核</h3>
                <p class="muted" style="margin-top:6px">${esc(result.message || '审核通过后才会出现在社区广场。')}</p>
                ${reasons.length ? `<div class="form-error" style="text-align:left;margin-top:12px">需要人工确认：${reasons.map(esc).join('；')}</div>` : ''}
                <p class="tiny muted" style="margin-top:12px">你可以在「我的发布」查看状态与审核意见。</p></div>`,
              footer: '<button class="btn" data-close type="button">知道了</button>',
              onMount(inner, innerClose) { inner.querySelector('[data-close]').addEventListener('click', innerClose); },
            });
            activeTab = 'mine';
            root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'mine'));
            await loadMine();
          } catch (error) {
            toast(error.message, 'error');
            button.disabled = false; button.textContent = existing ? '保存并重新提交' : '提交审核';
          }
        });
      },
    });
  }

  await loadTab(activeTab);
}
