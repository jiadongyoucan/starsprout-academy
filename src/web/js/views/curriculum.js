import { currentChild, childClassLabel, request } from '../api.js';
import { emptyState, esc, loading, subjectMeta, toast } from '../ui.js';

const LEVELS = [
  { code: 'nursery', name: '托班', age: '2–3 岁' },
  { code: 'junior', name: '小班', age: '3–4 岁' },
  { code: 'middle', name: '中班', age: '4–5 岁' },
  { code: 'senior', name: '大班', age: '5–6 岁' },
];
const SUBJECT_ORDER = ['thinking', 'english', 'piano', 'hanzi', 'montessori'];

export async function renderCurriculum(root, ctx) {
  const child = currentChild();
  if (!child) {
    root.innerHTML = emptyState('🧒', '还没有孩子档案', '添加孩子后，课程会按学段自动适配。', '<a class="btn" href="#/home">去添加</a>');
    return;
  }
  let classCode = child.class_code;
  let subjectCode = '';
  let detail = null;
  const cache = new Map();
  const sourcesPromise = request('/api/curriculum/sources').catch(() => null);

  async function frameworksFor(code) {
    if (cache.has(code)) return cache.get(code);
    const data = await request(`/api/curriculum/frameworks?classCode=${encodeURIComponent(code)}&childId=${encodeURIComponent(child.id)}`);
    cache.set(code, data);
    return data;
  }

  async function showList({ busy = false } = {}) {
    if (busy) root.innerHTML = loading('正在展开课程地图…');
    try {
      const [frameworks, sourceData] = await Promise.all([frameworksFor(classCode), sourcesPromise]);
      detail = null;
      const filtered = subjectCode ? frameworks.filter(f => f.subject_code === subjectCode) : frameworks;
      const classMeta = LEVELS.find(l => l.code === classCode);
      const isCurrent = classCode === child.class_code;
      root.innerHTML = `
        <div class="row between top" style="margin-bottom:16px">
          <div>
            <div class="eyebrow">Structured Curriculum</div>
            <h2 style="font-size:24px;letter-spacing:-.025em;margin-top:2px">一张完整的成长地图</h2>
            <p class="muted small" style="margin-top:4px">${esc(child.name)} · ${esc(childClassLabel(child.class_code))}在读。每个学科都由「单元 → 课时」螺旋上升，前置关系清晰。</p>
          </div>
          <div class="row">
            <span class="pill primary">${esc(classMeta?.name || classCode)} · ${esc(classMeta?.age || '')}</span>
            ${isCurrent ? '<span class="pill mint">与孩子学段一致</span>' : '<span class="pill sun">跨学段浏览</span>'}
          </div>
        </div>

        <div class="row between" style="margin-bottom:14px;gap:12px">
          <div class="segmented" role="tablist" aria-label="学段">
            ${LEVELS.map(level => `<button type="button" data-level="${level.code}" class="${level.code === classCode ? 'active' : ''}">${level.name}</button>`).join('')}
          </div>
          <span class="tiny muted">切换学段仅改变浏览范围，学习进度仍记录在 ${esc(child.name)} 名下</span>
        </div>

        <div class="chips" style="margin-bottom:18px">
          <button class="chip ${!subjectCode ? 'active' : ''}" type="button" data-subject="">全部模块</button>
          ${SUBJECT_ORDER.map(code => {
            const meta = subjectMeta(code);
            return `<button class="chip ${subjectCode === code ? 'active' : ''}" type="button" data-subject="${code}"><span>${meta.icon}</span>${meta.name}</button>`;
          }).join('')}
        </div>

        ${filtered.length ? `<div class="grid auto">
          ${filtered.map(framework => {
            const meta = subjectMeta(framework.subject_code);
            const sourceUnits = Number(framework.source_unit_count || 0);
            return `<button class="subject-card" type="button" data-framework="${esc(framework.id)}" style="--sc:${esc(meta.color)};text-align:left;border:1px solid var(--line)">
              <span class="wash"></span>
              <span class="ico">${meta.icon}</span>
              <h3>${esc(meta.name)}</h3>
              <p>${esc((framework.objectives || []).slice(0, 2).join(' · ') || meta.name + '体系课程')}</p>
              <div class="row between">
                <span class="tiny muted">${framework.unit_count} 个单元 · ${framework.lesson_count} 课时${sourceUnits ? ' · 含公开课' : ''}</span>
                <span class="pct">${framework.progressPercent}%</span>
              </div>
              <div class="meter" style="height:7px;border-radius:99px;background:#f0ebdf;overflow:hidden;margin-top:8px">
                <span style="display:block;height:100%;width:${framework.progressPercent}%;background:${esc(meta.color)};border-radius:99px"></span>
              </div>
              <div class="row between" style="margin-top:10px">
                <span class="tiny muted">已完成 ${framework.completed_count}/${framework.lesson_count}</span>
                <span class="tiny strong">查看课程 →</span>
              </div>
            </button>`;
          }).join('')}
        </div>` : emptyState('📚', '这个模块还没有课程', '切换其他模块，或稍后同步公开课源。')}

        <section class="section">
          <div class="section-head">
            <div><h2>公开课程来源</h2><p>所有外部内容都保留来源与许可证，版本随平台迭代，导入后进入审核流程。</p></div>
            <span class="pill">${sourceData?.sources?.length || 0} 个来源 · ${sourceData?.packs?.length || 0} 个课程包</span>
          </div>
          <div class="grid auto">
            ${(sourceData?.sources || []).map(source => `
              <div class="card soft">
                <div class="row between"><strong style="font-size:13px">${esc(source.name)}</strong><span class="pill mint">授权清晰</span></div>
                <p class="tiny muted" style="margin-top:8px;line-height:1.6">${esc(source.description)}</p>
                <div class="divider"></div>
                <div class="tiny muted">许可证：${esc(source.license)}</div>
                <div class="tiny muted" style="margin-top:3px">最近同步：${source.last_synced_at ? esc(source.last_synced_at.slice(0, 10)) : '尚未同步'}</div>
                <a class="tiny" href="${esc(source.homepage || source.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px">访问原站 ↗</a>
              </div>`).join('')}
          </div>
          <div class="matrix-note" style="margin-top:14px">🌱 体系化承诺：平台课程按「学段 × 学科 × 单元 × 课时」组织，新增公开内容会映射到既有框架与前置关系，不会以零散资源堆叠。</div>
        </section>`;

      root.querySelectorAll('[data-level]').forEach(btn => btn.addEventListener('click', async () => {
        classCode = btn.dataset.level;
        subjectCode = '';
        await showList({ busy: true });
      }));
      root.querySelectorAll('[data-subject]').forEach(btn => btn.addEventListener('click', () => {
        subjectCode = btn.dataset.subject;
        void showList();
      }));
      root.querySelectorAll('[data-framework]').forEach(btn => btn.addEventListener('click', async () => {
        await showDetail(btn.dataset.framework, classCode, frameworks);
      }));
    } catch (error) {
      root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="curRetry">重新加载</button></div></div>`;
      root.querySelector('#curRetry').addEventListener('click', () => showList({ busy: true }));
    }
  }

  async function showDetail(frameworkId, levelCode, frameworks) {
    root.innerHTML = loading('正在打开课程单元…');
    try {
      const data = await request(`/api/curriculum/frameworks/${encodeURIComponent(frameworkId)}?childId=${encodeURIComponent(child.id)}`);
      const meta = subjectMeta(data.framework.subject_code);
      const level = LEVELS.find(l => l.code === levelCode);
      const allDone = data.units.reduce((n, u) => n + u.completedCount, 0);
      const allLessons = data.units.reduce((n, u) => n + u.lessonCount, 0);
      root.innerHTML = `
        <div class="row between" style="margin-bottom:16px">
          <button class="btn ghost small" type="button" id="backCur">← 返回课程地图</button>
          <span class="pill">${esc(level?.name || levelCode)} · ${esc(data.framework.term)}</span>
        </div>
        <div class="card" style="background:linear-gradient(135deg,${meta.color}12,#fffdf9 70%);border-color:${meta.color}33">
          <div class="row top" style="gap:16px">
            <span style="width:56px;height:56px;border-radius:16px;background:${meta.color}1a;display:grid;place-items:center;font-size:27px;flex:none">${meta.icon}</span>
            <div style="flex:1;min-width:0">
              <div class="eyebrow">${esc(meta.name)} · ${esc(level?.name)}课程体系</div>
              <h2 style="font-size:23px;letter-spacing:-.02em;margin-top:3px">${esc(data.framework.title)}</h2>
              <p class="muted small" style="margin-top:5px">${esc(data.framework.objectives.join('；'))}</p>
              <div class="row" style="margin-top:10px">
                <span class="pill">${data.units.length} 个单元</span>
                <span class="pill">${allLessons} 个课时</span>
                <span class="pill mint">已完成 ${allDone}</span>
                ${data.isForChild ? '' : '<span class="pill sun">非当前学段</span>'}
              </div>
            </div>
          </div>
        </div>

        <div class="units" style="margin-top:16px">
          ${data.units.map((unit, index) => `
            <section class="unit">
              <div class="unit-head">
                <div class="row" style="gap:10px">
                  <span class="unit-num">${index + 1}</span>
                  <div><h4>${esc(unit.title)}</h4><p>${esc(unit.objective)}</p></div>
                </div>
                <div class="row" style="gap:6px">
                  ${unit.source_name ? `<span class="pill sun" title="${esc(unit.source_name)}">公开课</span>` : ''}
                  <span class="pill">${unit.completedCount}/${unit.lessonCount}</span>
                </div>
              </div>
              ${unit.lessons.map((lesson, lessonIndex) => `
                <a class="lesson-row" href="#/learn/${encodeURIComponent(lesson.id)}?childId=${encodeURIComponent(child.id)}">
                  <span class="idx ${lesson.progress_status === 'completed' ? 'done' : ''}">${lesson.progress_status === 'completed' ? '✓' : lessonIndex + 1}</span>
                  <span class="lmeta"><strong>${esc(lesson.title)}</strong><small>${lesson.minutes} 分钟 · ${esc(lesson.objective)}</small></span>
                  ${lesson.source_code ? '<span class="pill sun tiny">来源</span>' : ''}
                  <span class="go">›</span>
                </a>`).join('')}
              ${unit.source_code ? `<div class="source-note">📎 本单元来自公开课源「${esc(unit.source_name || unit.source_code)}」，已按平台体系映射；许可证信息见课程来源。</div>` : ''}
            </section>`).join('')}
        </div>
        <div class="matrix-note" style="margin-top:14px">💡 建议按单元顺序学习；已完成课时会自动从新计划中排除。</div>`;
      root.querySelector('#backCur').addEventListener('click', () => void showList());
    } catch (error) {
      toast(error.message, 'error');
      root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><button class="btn small ghost" id="backCur2">返回课程地图</button></div></div>`;
      root.querySelector('#backCur2').addEventListener('click', () => void showList());
    }
  }

  await showList({ busy: true });
}
