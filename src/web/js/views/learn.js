import { currentChild, request, session } from '../api.js';
import { celebrate, esc, loading, subjectMeta, toast } from '../ui.js';
import { petSvg } from '../assets.js';

const NOTE_FREQ = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25 };
const BLOCK_LABEL = {
  intro: '导入', story: '故事', cards: '词卡', listen: '听一听', speak: '说一说', trace: '写一写',
  read: '读一读', piano: '弹一弹', rhythm: '节奏', match: '配对', quiz: '小挑战', reflect: '回顾', resource: '拓展',
};

let audioContext = null;
function getAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}
function tone(freq, duration = 0.55, type = 'triangle', volume = 0.14) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch { /* audio unavailable */ }
}

function speak(text, lang = 'zh-CN', rate = 1) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(lang.slice(0, 2)));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function speakButton(text, lang = 'zh-CN', label = '播放示范', rate = 1) {
  return `<button class="btn small soft" type="button" data-speak="${esc(text)}" data-lang="${lang}" data-rate="${rate}">🔊 ${esc(label)}</button>`;
}

export async function renderLearn(root, ctx) {
  const child = currentChild();
  if (!child) {
    root.innerHTML = `<div class="empty"><div class="big">🧒</div><strong>先添加孩子档案</strong><p>学习进度需要记录在孩子名下。</p><a class="btn" href="#/home">回首页</a></div>`;
    return;
  }
  const kidMode = ctx.query.get('kid') === '1';
  const backHref = kidMode ? '#/child' : '#/curriculum';
  const backLabel = '←';
  if (!ctx.id) { root.innerHTML = `<div class="empty"><strong>没有选择课时</strong><a class="btn" href="${backHref}">${kidMode ? '回儿童空间' : '去课程体系'}</a></div>`; return; }
  root.innerHTML = loading('正在准备互动课时…');
  let data;
  try {
    data = await request(`/api/curriculum/lessons/${encodeURIComponent(ctx.id)}?childId=${encodeURIComponent(child.id)}`);
  } catch (error) {
    root.innerHTML = `<div class="error-box">😥 ${esc(error.message)}<div class="actions"><a class="btn small ghost" href="${backHref}">${kidMode ? '回儿童空间' : '返回课程'}</a></div></div>`;
    return;
  }
  const lesson = data.lesson;
  const subject = subjectMeta(data.subject.code);
  let pet = null;
  try { pet = (await request(`/api/pet?childId=${encodeURIComponent(child.id)}`)).pet; } catch { /* companion optional */ }
  const planItemId = ctx.query.get('planItem') || '';
  const startedAt = Date.now();
  let finished = false;
  let quizCorrect = 0;
  let quizTotal = 0;
  const quizAnswers = [];

  const blocksHtml = lessonBlocksMarkup(lesson);
  root.innerHTML = `
    <div class="learn-shell">
      ${kidMode ? '<div class="kid-learn-bar"><a href="#/child">← 回儿童空间</a><span>慢慢来，我陪着你</span></div>' : ''}
      <div class="learn-head">
        <a class="back" href="${backHref}" aria-label="返回">${backLabel}</a>
        <div style="flex:1;min-width:0">
          <h2>${esc(lesson.title)}</h2>
          <p>${subject.icon} ${esc(data.subject.name)} · ${esc(data.classLevel.name)} · ${lesson.minutes} 分钟 · 约 ${lesson.blocks.length} 个互动环节</p>
        </div>
        <div class="row" style="gap:6px">
          ${lesson.source ? '<span class="pill sun">公开课程</span>' : ''}
          ${data.progress?.status === 'completed' ? '<span class="pill mint">已学完</span>' : ''}
        </div>
      </div>
      <div class="lesson-progress">${lesson.blocks.map(() => '<i></i>').join('')}</div>
      ${lesson.source ? `<div class="source-note" style="margin-bottom:14px">📎 本课时来自公开课源「${esc(lesson.source.name)}」 · ${esc(lesson.source.license)} · 已按平台体系二次设计</div>` : ''}
      ${blocksHtml}
      <div class="learn-foot">
        <div class="row">
          <a class="btn ghost" href="${backHref}">${kidMode ? '← 回儿童空间' : '← 课程地图'}</a>
          ${data.previousLesson ? `<a class="btn ghost small" href="#/learn/${encodeURIComponent(data.previousLesson.id)}">上一课：${esc(data.previousLesson.title)}</a>` : ''}
        </div>
        <button class="btn large" id="completeLesson" type="button">完成学习 ✓</button>
      </div>
      <p class="tiny muted" style="text-align:center;margin-top:12px">孩子的语音只在本机浏览器识别，不会上传；完成记录会同步给家长看板。</p>
    </div>`;

  mountLessonInteractions(root, lesson, (correct, flatIndex, optionIndex) => {
    quizTotal += 1; if (correct) quizCorrect += 1;
    if (Number.isInteger(flatIndex)) quizAnswers[flatIndex] = optionIndex;
  });

  root.querySelector('#completeLesson').addEventListener('click', async (event) => {
    if (finished) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在记录…';
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    try {
      const result = await request(`/api/curriculum/lessons/${encodeURIComponent(lesson.id)}/progress`, {
        method: 'POST',
        body: { childId: child.id, status: 'completed', seconds, planItemId: planItemId || undefined, answers: quizAnswers },
      });
      finished = true;
      showCelebration(lesson, result.rewards, data.nextLesson, planItemId ? '这个计划项也自动标记为完成啦。' : '', pet);
      if (data.progress) data.progress.status = 'completed';
      button.textContent = '已完成 ✓';
      button.classList.add('soft');
      button.disabled = true;
      void quizCorrect;
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = '完成学习 ✓';
    }
  });
}

function showCelebration(lesson, rewards, nextLesson, note, pet) {
  if (!rewards) {
    toast('完成啦，真棒！', 'success');
    return;
  }
  celebrate({
    title: '今天的探险完成啦',
    subtitle: `「${lesson.title}」`,
    emoji: '🌟',
    rewards,
    petHtml: petSvg(pet?.species || 'bunny', rewards.stars >= 3 ? 'excited' : 'happy', pet?.equipped || [], 110),
    note,
    nextHref: nextLesson ? `#/learn/${encodeURIComponent(nextLesson.id)}` : '',
    nextLabel: nextLesson ? `下一课：${nextLesson.title}` : '',
  });
}

export function lessonBlocksMarkup(lesson) {
  return lesson.blocks.map((block, index) => renderBlock(block, index, lesson)).join('');
}

export function mountLessonInteractions(root, lesson, onQuiz = () => {}) {
  attachCommon(root, lesson, () => {});
  attachTrace(root);
  attachPiano(root, lesson);
  attachRhythm(root, lesson);
  attachMatch(root, lesson);
  attachQuiz(root, lesson, onQuiz);
  attachSpeak(root, lesson);
}

function renderBlock(block, index, lesson) {
  const head = `<div class="block-kicker">${String(index + 1).padStart(2, '0')} · ${BLOCK_LABEL[block.type] || block.type}</div>`;
  switch (block.type) {
    case 'intro':
      return `<section class="block">${head}
        <div class="block-emoji">${esc(block.emoji || '🌱')}</div>
        <h3>${esc(block.title)}</h3><p>${esc(block.text)}</p>
        <div class="actions">${speakButton(block.text, 'zh-CN', '听老师读')}</div></section>`;
    case 'story':
      return `<section class="block">${head}<h3>${esc(block.title)}</h3>
        <div class="story-text">${esc(block.text)}</div>
        <div class="actions">${speakButton(block.text, 'zh-CN', '听故事')}</div></section>`;
    case 'cards':
      return `<section class="block">${head}<h3>${esc(block.title)}</h3><p class="lede">点一张卡片，听一听它的发音。</p>
        <div class="cards-grid">${block.items.map(item => `
          <button class="learn-card" type="button" data-speak="${esc(item.label)}" data-lang="zh-CN">
            <div class="e">${esc(item.emoji || '✨')}</div><strong>${esc(item.label)}</strong><small>${esc(item.note || '')}</small>
          </button>`).join('')}</div></section>`;
    case 'listen':
      return `<section class="block">${head}<h3>${esc(block.title)}</h3>
        <div class="quote">${esc(block.text)}</div><div class="translation">${esc(block.translation || '')}</div>
        <div class="actions">${speakButton(block.text, 'en-US', '听一听')}${speakButton(block.text, 'en-US', '慢速', 0.7)}</div></section>`;
    case 'speak':
      return `<section class="block" data-speak-block>${head}<h3>${esc(block.title)}</h3>
        <div class="quote">${esc(block.text)}</div><div class="translation">${esc(block.translation || '')}</div>
        <div class="actions">${speakButton(block.text, 'en-US', '先听一遍')}
          <button class="mic-btn" type="button" data-mic aria-label="按住或点击开始跟读">🎙️</button>
          <span class="small muted" data-mic-label>点击麦克风，记录你的跟读</span></div>
        <div class="speech-out" data-speech-out>${esc(block.tips || '大声跟读，勇敢开口就是进步。')}</div></section>`;
    case 'trace':
      return `<section class="block">${head}<h3>${esc(block.title)}：${esc(block.char)}</h3>
        <div class="trace-wrap">
          <div class="trace-canvas-wrap">
            <div class="trace-guide">${esc(block.char)}</div>
            <canvas class="trace-canvas" width="600" height="600" aria-label="描写汉字 ${esc(block.char)}"></canvas>
          </div>
          <div class="trace-side">
            <div class="pinyin">${esc(block.pinyin || '')}</div>
            <p style="margin-top:6px">${esc(block.hint || '沿着虚线慢慢写。')}</p>
            <div class="actions"><button class="btn small ghost" type="button" data-trace-clear>清空重写</button></div>
            <p class="tiny muted" style="margin-top:10px">写完后，用手指在桌上再写一遍，记忆更深。</p>
          </div>
        </div></section>`;
    case 'read':
      return `<section class="block">${head}<h3>${esc(block.title)}</h3>
        <div class="story-text">${esc(block.text)}</div>
        <p class="translation">${esc(block.translation || '')}</p>
        <div class="actions">${speakButton(block.text, 'zh-CN', '听一遍')}${speakButton(block.text, 'zh-CN', '慢速跟读', 0.75)}</div></section>`;
    case 'piano': {
      const keys = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
      const labels = { C4: 'do', D4: 're', E4: 'mi', F4: 'fa', G4: 'sol', A4: 'la', B4: 'si', C5: 'do' };
      return `<section class="block" data-piano-block>${head}<h3>${esc(block.title)}</h3>
        <p class="lede">${esc(block.hint || '先听再弹，慢一点也没关系。')}</p>
        <div class="note-seq">${(block.notes || []).map(note => `<span class="note-chip">${esc(note.label)}</span>`).join('')}</div>
        <div class="piano"><div class="piano-inner">${keys.map(key => `
          <button class="piano-key" type="button" data-note="${key}">${labels[key]}</button>`).join('')}</div></div>
        <div class="actions"><button class="btn small soft" type="button" data-play-notes>▶ 播放示范</button>
          <span class="small muted">也可以直接在琴键上弹一弹</span></div></section>`;
    }
    case 'rhythm':
      return `<section class="block" data-rhythm-block data-bpm="${Number(block.bpm) || 80}">${head}<h3>${esc(block.title)}</h3>
        <p class="lede">${esc(block.hint || '跟着节拍拍手。')}</p>
        <div class="rhythm">${(block.pattern || []).map((symbol, i) => `<button class="beat-dot" type="button" data-beat="${i}">${esc(symbol)}</button>`).join('')}</div>
        <div class="actions"><button class="btn small soft" type="button" data-metronome>▶ 开始节拍</button></div></section>`;
    case 'match':
      return `<section class="block" data-match-block>${head}<h3>${esc(block.title)}</h3>
        <p class="lede">${esc(block.hint || '把两边配成一对。')}</p>
        <div class="match-grid">
          <div class="match-col">${block.pairs.map((pair, i) => `<button class="match-item" type="button" data-side="a" data-pair="${i}">${esc(pair.a)}</button>`).join('')}</div>
          <div class="match-col">${shuffle(block.pairs.map((pair, i) => ({ text: pair.b, index: i }))).map(item => `<button class="match-item" type="button" data-side="b" data-pair="${item.index}">${esc(item.text)}</button>`).join('')}</div>
        </div>
        <p class="small muted" style="margin-top:8px" data-match-status>还没有配对成功</p></section>`;
    case 'quiz':
      return `<section class="block" data-quiz-block>${head}<h3>${esc(block.title)}</h3>
        <div data-quiz-body></div></section>`;
    case 'reflect':
      return `<section class="block">${head}<div class="block-emoji">${esc(block.emoji || '🌟')}</div>
        <h3>${esc(block.title)}</h3><div class="reflect-box">${esc(block.prompt)}</div>
        <div class="actions">${speakButton(block.prompt, 'zh-CN', '听问题')}<button class="btn small ghost" type="button" data-speak-done>我已经说给爸妈听了</button></div>
        <p class="tiny muted" style="margin-top:8px">没有标准答案，表达本身就是学习。</p></section>`;
    case 'resource': {
      const url = safeHttp(block.url);
      return `<section class="block">${head}<h3>${esc(block.title)}</h3>
        <div class="resource-link">
          <span style="font-size:22px">🔗</span>
          <div style="flex:1"><strong style="font-size:12.5px">${esc(block.source)}</strong>
            <div class="tiny muted">${esc(block.license)} · 外部资源，建议家长陪同</div></div>
          ${url ? `<a class="btn small ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开 ↗</a>` : ''}
        </div></section>`;
    }
    default:
      return `<section class="block">${head}<h3>${esc(block.title || '互动')}</h3><p>${esc(block.text || '')}</p></section>`;
  }
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function safeHttp(url) {
  try {
    const parsed = new URL(url, location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

function attachCommon(root, lesson) {
  root.addEventListener('click', (event) => {
    const speakEl = event.target.closest('[data-speak]');
    if (speakEl) {
      const lang = speakEl.dataset.lang || 'zh-CN';
      const rate = Number(speakEl.dataset.rate || 1);
      speak(speakEl.dataset.speak, lang, rate);
      return;
    }
    const done = event.target.closest('[data-speak-done]');
    if (done) toast('真棒，表达就是学习。', 'success');
  });
}

function attachTrace(root) {
  root.querySelectorAll('.trace-canvas').forEach(canvas => {
    const wrap = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let last = null;
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4f46e5';
    const pos = (event) => {
      const rect = canvas.getBoundingClientRect();
      const touch = event.touches?.[0] || event;
      return {
        x: (touch.clientX - rect.left) * (canvas.width / rect.width),
        y: (touch.clientY - rect.top) * (canvas.height / rect.height),
      };
    };
    const start = (event) => { event.preventDefault(); drawing = true; last = pos(event); };
    const move = (event) => {
      if (!drawing) return;
      event.preventDefault();
      const point = pos(event);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      last = point;
    };
    const end = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointerleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    const clear = wrap.parentElement.querySelector('[data-trace-clear]');
    clear?.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
  });
}

function attachPiano(root, lesson) {
  root.querySelectorAll('[data-piano-block]').forEach(blockEl => {
    const lessonBlock = lesson.blocks.find(b => b.type === 'piano');
    const notes = lessonBlock?.notes || [];
    let playing = false;
    blockEl.addEventListener('click', async (event) => {
      const key = event.target.closest('[data-note]');
      if (key) {
        tone(NOTE_FREQ[key.dataset.note] || 440, 0.55);
        key.classList.add('hit');
        setTimeout(() => key.classList.remove('hit'), 220);
      }
      if (event.target.closest('[data-play-notes]') && !playing) {
        playing = true;
        for (const note of notes) {
          tone(NOTE_FREQ[note.n] || 440, 0.5);
          const key = blockEl.querySelector(`[data-note="${note.n}"]`);
          if (key) { key.classList.add('hit'); setTimeout(() => key.classList.remove('hit'), 320); }
          await delay(460);
        }
        playing = false;
      }
    });
  });
}

function attachRhythm(root, lesson) {
  root.querySelectorAll('[data-rhythm-block]').forEach(blockEl => {
    let timer = null;
    let beat = 0;
    const bpm = Number(blockEl.dataset.bpm) || 80;
    const dots = [...blockEl.querySelectorAll('[data-beat]')];
    blockEl.querySelector('[data-metronome]')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      if (timer) {
        clearInterval(timer);
        timer = null;
        dots.forEach(d => d.classList.remove('on'));
        button.textContent = '▶ 开始节拍';
        return;
      }
      button.textContent = '■ 停止节拍';
      timer = setInterval(() => {
        dots.forEach(d => d.classList.remove('on'));
        const dot = dots[beat % Math.max(1, dots.length)];
        dot?.classList.add('on');
        tone(880, 0.06, 'square', 0.08);
        beat += 1;
      }, Math.max(260, 60000 / bpm));
    });
  });
}

function attachMatch(root) {
  root.querySelectorAll('[data-match-block]').forEach(blockEl => {
    const items = [...blockEl.querySelectorAll('.match-item')];
    const total = items.filter(i => i.dataset.side === 'a').length;
    let matched = 0;
    let selectedA = null;
    let selectedB = null;
    const status = blockEl.querySelector('[data-match-status]');
    const reset = () => {
      selectedA?.classList.remove('sel');
      selectedB?.classList.remove('sel');
      selectedA = null; selectedB = null;
    };
    items.forEach(item => item.addEventListener('click', () => {
      if (item.classList.contains('matched')) return;
      if (item.dataset.side === 'a') {
        if (selectedA) selectedA.classList.remove('sel');
        selectedA = item;
      } else {
        if (selectedB) selectedB.classList.remove('sel');
        selectedB = item;
      }
      item.classList.add('sel');
      if (selectedA && selectedB) {
        if (selectedA.dataset.pair === selectedB.dataset.pair) {
          selectedA.classList.add('matched');
          selectedB.classList.add('matched');
          selectedA.classList.remove('sel');
          selectedB.classList.remove('sel');
          tone(660, 0.2, 'sine', 0.1);
          matched += 1;
          status.textContent = matched === total ? '全部配对成功，太棒了！' : `已配对 ${matched}/${total}`;
          selectedA = null; selectedB = null;
        } else {
          const a = selectedA;
          const b = selectedB;
          a.classList.add('wrong'); b.classList.add('wrong');
          setTimeout(() => {
            a.classList.remove('wrong', 'sel');
            b.classList.remove('wrong', 'sel');
          }, 420);
          selectedA = null; selectedB = null;
        }
      }
    }));
  });
}

function attachQuiz(root, lesson, onAnswer) {
  let quizOffset = 0;
  root.querySelectorAll('[data-quiz-block]').forEach((blockEl, blockIndex) => {
    const lessonBlock = lesson.blocks.filter(b => b.type === 'quiz')[blockIndex];
    if (!lessonBlock) return;
    const questions = lessonBlock.questions || [];
    const startOffset = quizOffset;
    quizOffset += questions.length;
    const body = blockEl.querySelector('[data-quiz-body]');
    let index = 0;
    let correct = 0;
    let answered = false;

    const renderQuestion = () => {
      answered = false;
      const question = questions[index];
      if (!question) {
        body.innerHTML = `<div class="quiz-explain">本模块完成：答对 ${correct}/${questions.length} 题。</div>`;
        return;
      }
      body.innerHTML = `<p class="strong" style="margin-top:12px">${esc(question.q)}</p>
        <div class="quiz-options">
          ${question.options.map((option, optionIndex) => `<button class="quiz-option" type="button" data-option="${optionIndex}">${esc(option)}</button>`).join('')}
        </div>
        <div data-explain></div>
        <div class="actions"><button class="btn small ghost" type="button" data-next hidden>${index + 1 === questions.length ? '完成本模块' : '下一题'}</button></div>`;
      body.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const optionIndex = Number(button.dataset.option);
        const isCorrect = optionIndex === question.answer;
        if (isCorrect) correct += 1;
        onAnswer(isCorrect, startOffset + index, optionIndex);
        body.querySelectorAll('[data-option]').forEach((optionButton, i) => {
          optionButton.disabled = true;
          if (i === question.answer) optionButton.classList.add('correct');
          if (i === optionIndex && !isCorrect) optionButton.classList.add('wrong');
        });
        const explain = body.querySelector('[data-explain]');
        explain.innerHTML = `<div class="quiz-explain">${isCorrect ? '✅ ' : '💡 '}${esc(question.explain)}</div>`;
        const next = body.querySelector('[data-next]');
        next.hidden = false;
        next.addEventListener('click', () => { index += 1; renderQuestion(); });
      }));
    };
    renderQuestion();
  });
}

function attachSpeak(root, lesson) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  root.querySelectorAll('[data-speak-block]').forEach(blockEl => {
    const mic = blockEl.querySelector('[data-mic]');
    const out = blockEl.querySelector('[data-speech-out]');
    const label = blockEl.querySelector('[data-mic-label]');
    if (!SR) {
      mic?.addEventListener('click', () => {
        out.textContent = '这个浏览器不支持语音识别，可以只做口型练习，再点「听一遍」对照。';
      });
      return;
    }
    let recognition = null;
    mic?.addEventListener('click', () => {
      if (recognition) { recognition.stop(); recognition = null; mic.classList.remove('rec'); return; }
      try {
        recognition = new SR();
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        mic.classList.add('rec');
        if (label) label.textContent = '正在听…再点一次结束';
        out.textContent = '请大声跟读…';
        recognition.onresult = (event) => {
          const transcript = [...event.results].map(result => result[0].transcript).join(' ');
          out.textContent = `我听到：${transcript}。${transcript ? '很棒，再对照示范听一遍。' : '没关系，再试一次。'}`;
        };
        recognition.onerror = () => {
          out.textContent = '没有听清，检查麦克风权限后再试；也可以只做口型练习。';
          mic.classList.remove('rec');
          recognition = null;
          if (label) label.textContent = '点击麦克风，记录你的跟读';
        };
        recognition.onend = () => {
          mic.classList.remove('rec');
          recognition = null;
          if (label) label.textContent = '点击麦克风，再读一次';
        };
        recognition.start();
      } catch {
        out.textContent = '麦克风不可用（需要 HTTPS 或 localhost 并允许权限）。可以只做口型练习。';
      }
    });
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
