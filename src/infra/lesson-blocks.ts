import type { LevelCode, SubjectCode } from './curriculum-data.ts';

export type QuizQuestion = { q: string; options: string[]; answer: number; explain: string };
export type Block =
  | { type: 'intro'; title: string; emoji: string; text: string }
  | { type: 'story'; title: string; text: string }
  | { type: 'cards'; title: string; items: { label: string; emoji: string; note: string }[] }
  | { type: 'listen'; title: string; text: string; translation: string }
  | { type: 'speak'; title: string; text: string; translation: string; tips: string }
  | { type: 'trace'; title: string; char: string; pinyin: string; hint: string }
  | { type: 'read'; title: string; text: string; translation: string }
  | { type: 'piano'; title: string; notes: { n: string; label: string }[]; bpm: number; hint: string }
  | { type: 'rhythm'; title: string; pattern: string[]; bpm: number; hint: string }
  | { type: 'match'; title: string; pairs: { a: string; b: string }[]; hint: string }
  | { type: 'quiz'; title: string; questions: QuizQuestion[] }
  | { type: 'reflect'; title: string; prompt: string; emoji: string }
  | { type: 'resource'; title: string; url: string; source: string; license: string };

const EMOJI: Record<string, string> = {
  hello: '👋', hi: '👋', bye: '👋', mom: '👩', dad: '👨', baby: '👶', family: '👨‍👩‍👧',
  happy: '😊', sad: '😢', angry: '😠', scared: '😨', red: '🔴', blue: '🔵', yellow: '🟡', green: '🟢',
  cow: '🐄', duck: '🦆', pig: '🐖', sheep: '🐑', cat: '🐱', dog: '🐶', fish: '🐟', bird: '🐦',
  head: '🧑', shoulders: '💪', knees: '🦵', toes: '🦶', see: '👀', hear: '👂', smell: '👃', taste: '👅',
  run: '🏃', jump: '🤸', clap: '👏', stop: '✋', one: '1️⃣', two: '2️⃣', three: '3️⃣', four: '4️⃣', five: '5️⃣',
  apple: '🍎', banana: '🍌', orange: '🍊', grape: '🍇', rice: '🍚', milk: '🥛', egg: '🥚', bread: '🍞',
  please: '🙏', sorry: '😔', thanks: '🙏', sunny: '☀️', rainy: '🌧️', windy: '🌬️', cloudy: '☁️',
  spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️', hat: '🎩', coat: '🧥', shoes: '👟', shirt: '👕',
  cat_word: '🐱', sun: '☀️', bed: '🛏️', slide: '🛝', swing: '🎠', play: '🧸', shop: '🏪', money: '💰',
  wolf: '🐺', house: '🏠', spider: '🕷️', rain: '🌧️', up: '⬆️', show: '🎤', book: '📖', pencil: '✏️',
  desk: '🪑', chair: '🪑', week: '📅', month: '🗓️', age: '🎂', hobby: '🎨', what: '❓', where: '📍',
  who: '🧑', why: '🤔', first: '1️⃣', then: '2️⃣', next: '3️⃣', finally: '🏁',
  圆形: '⭕', 方形: '🟧', 红色: '🔴', 黄色: '🟡', 蓝色: '🔵', 绿色: '🟢', 水果: '🍎', 蔬菜: '🥕',
  大: '🐘', 小: '🐜', 多: '🍎🍎🍎', 少: '🍎', 上: '⬆️', 下: '⬇️', 前: '➡️', 后: '⬅️',
  日: '☀️', 月: '🌙', 山: '⛰️', 爸: '👨', 妈: '👩', 手: '✋', 口: '👄', 耳: '👂', 目: '👀',
  米: '🍚', 水: '💧', 猫: '🐱', 狗: '🐶', 鸟: '🐦', 鱼: '🐟', 星: '⭐', 天: '🌤️', 地: '🌍',
  人: '🧑', 家: '🏠', 门: '🚪', 江: '🏞️', 河: '🏞️', 树: '🌳', 林: '🌲', 吃: '🍽️', 喝: '🥤',
  鹅: '🦢', 白: '⚪', 毛: '🪶', 红: '🔴', 春: '🌸', 花: '🌸', 园: '🏡', 国: '🇨🇳', 图: '🖼️',
  倒水: '🫗', 杯子: '🥛', 舀: '🥄', 豆子: '🫘', 擦: '🧽', 抹布: '🧻', 桌子: '🪑', 粉红塔: '🩷',
  棕色梯: '🪵', 色板: '🎨', 串珠: '📿', 扣子: '🔘', 鞋带: '👟', 洗手: '🧼', 圆柱体: '🥫',
  几何: '🔷', 触觉: '🖐️', 数棒: '📏', 砂纸: '🪨', 浇水: '💦', 植物: '🌱', 叶子: '🍃',
  垃圾: '🗑️', 金色串珠: '🟡', 地图: '🗺️', 实验: '🧪', 点心: '🍪', 书包: '🎒', 时间: '⏰',
  加法蛇: '🐍', 减法板: '➖', 乘法板: '✖️', 建筑: '🏗️', 展示: '🎪', 钢琴: '🎹', 键盘: '🎹',
  白键: '⬜', 黑键: '⬛', do: '🎵', re: '🎵', mi: '🎵', fa: '🎵', sol: '🎵', la: '🎵',
  拍手: '👏', 节奏: '🥁', 强: '🔊', 弱: '🔉', 快: '🐇', 慢: '🐢', 五线谱: '🎼', 音符: '🎶',
  高音谱号: '𝄞', 全音符: '⚪', 二分音符: '🎵', 四分音符: '♪', 和弦: '🎹', 琶音: '🌊',
  附点: '🎵', 三拍子: '💃', 休止符: '🤫', 连奏: '〰️', 断奏: '✂️', 踏板: '🦶', 视奏: '👀',
  听音: '👂', 演奏会: '🎤',
};

const EN_ZH: Record<string, string> = {
  hello: '你好', hi: '嗨', bye: '再见', my: '我的', name: '名字', am: '是', red: '红色', blue: '蓝色',
  yellow: '黄色', green: '绿色', cow: '奶牛', duck: '鸭子', pig: '猪', sheep: '绵羊', cat: '猫', dog: '狗',
  fish: '鱼', bird: '鸟', head: '头', shoulders: '肩膀', knees: '膝盖', toes: '脚趾', see: '看见',
  hear: '听见', smell: '闻', taste: '尝', run: '跑', jump: '跳', clap: '拍手', stop: '停', mom: '妈妈',
  dad: '爸爸', baby: '宝宝', family: '家庭', happy: '开心', sad: '难过', angry: '生气', scared: '害怕',
  one: '一', two: '二', three: '三', four: '四', five: '五', apple: '苹果', banana: '香蕉', orange: '橙子',
  grape: '葡萄', rice: '米饭', milk: '牛奶', egg: '鸡蛋', bread: '面包', please: '请', sorry: '对不起',
  thanks: '谢谢', sunny: '晴天', rainy: '下雨', windy: '有风', cloudy: '多云', spring: '春天',
  summer: '夏天', autumn: '秋天', winter: '冬天', hat: '帽子', coat: '外套', shoes: '鞋子', shirt: '衬衫',
  sun: '太阳', bed: '床', slide: '滑梯', swing: '秋千', play: '玩', shop: '商店', money: '钱',
  wolf: '狼', house: '房子', spider: '蜘蛛', rain: '雨', up: '向上', show: '展示', book: '书',
  pencil: '铅笔', desk: '书桌', chair: '椅子', week: '星期', month: '月份', age: '年龄', hobby: '爱好',
  what: '什么', where: '哪里', who: '谁', why: '为什么', first: '首先', then: '然后', next: '接着',
  finally: '最后',
};

const HANZI_GLOSSARY: Record<string, string> = {
  日: 'rì|太阳', 月: 'yuè|月亮', 山: 'shān|大山', 我: 'wǒ|自己', 名: 'míng|名字', 字: 'zì|汉字',
  横: 'héng|横画', 竖: 'shù|竖画', 爸: 'bà|爸爸', 妈: 'mā|妈妈', 爷: 'yé|爷爷', 奶: 'nǎi|奶奶',
  手: 'shǒu|小手', 口: 'kǒu|嘴巴', 耳: 'ěr|耳朵', 目: 'mù|眼睛', 米: 'mǐ|大米', 水: 'shuǐ|水',
  果: 'guǒ|水果', 菜: 'cài|蔬菜', 一: 'yī|数字一', 二: 'èr|数字二', 三: 'sān|数字三',
  猫: 'māo|小猫', 狗: 'gǒu|小狗', 鸟: 'niǎo|小鸟', 鱼: 'yú|小鱼', 星: 'xīng|星星', 天: 'tiān|天空',
  地: 'dì|大地', 人: 'rén|人', 上: 'shàng|上面', 下: 'xià|下面', 大: 'dà|大', 小: 'xiǎo|小',
  家: 'jiā|家', 门: 'mén|门', 房: 'fáng|房子', 灯: 'dēng|灯', 从: 'cóng|跟从', 众: 'zhòng|许多人',
  看: 'kàn|看', 说: 'shuō|说', 想: 'xiǎng|想', 词: 'cí|词语', 句: 'jù|句子', 江: 'jiāng|江河',
  河: 'hé|河流', 海: 'hǎi|大海', 树: 'shù|大树', 林: 'lín|树林', 木: 'mù|木头', 吃: 'chī|吃',
  叫: 'jiào|叫', 喝: 'hē|喝', 多: 'duō|多', 少: 'shǎo|少', 只: 'zhī|量词', 朵: 'duǒ|量词',
  条: 'tiáo|量词', 个: 'gè|量词', 谁: 'shéi|谁', 在: 'zài|在', 做: 'zuò|做', 鹅: 'é|白鹅',
  白: 'bái|白色', 毛: 'máo|羽毛', 红: 'hóng|红色', 床: 'chuáng|床', 前: 'qián|前面', 明: 'míng|明亮',
  春: 'chūn|春天', 眠: 'mián|睡眠', 花: 'huā|花', 左: 'zuǒ|左边', 右: 'yòu|右边', 结: 'jié|结构',
  构: 'gòu|结构', 园: 'yuán|花园', 国: 'guó|国家', 围: 'wéi|包围', 读: 'dú|阅读', 问: 'wèn|提问',
  图: 'tú|图画', 故: 'gù|故事', 事: 'shì|事情', 记: 'jì|日记', 写: 'xiě|书写', 听: 'tīng|听',
};

const PIANO_NOTES: Record<string, { n: string; label: string }> = {
  do: { n: 'C4', label: 'do' }, re: { n: 'D4', label: 're' }, mi: { n: 'E4', label: 'mi' },
  fa: { n: 'F4', label: 'fa' }, sol: { n: 'G4', label: 'sol' }, la: { n: 'A4', label: 'la' },
  si: { n: 'B4', label: 'si' }, C: { n: 'C4', label: 'C' }, E: { n: 'E4', label: 'E' }, G: { n: 'G4', label: 'G' },
};

function emojiFor(token: string, fallback = '✨'): string {
  if (EMOJI[token]) return EMOJI[token];
  const lower = token.toLowerCase();
  if (EMOJI[lower]) return EMOJI[lower];
  for (const char of token) if (EMOJI[char]) return EMOJI[char];
  return fallback;
}

function pick<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  return arr.slice(0, n);
}

function shuffleStable<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (seed * 31 + i * 17) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeQuestion(
  prompt: string,
  answerText: string,
  pool: string[],
  explain: string,
  seed: number,
): QuizQuestion {
  const distractors = [...new Set(pool.filter(t => t !== answerText))].slice(0, 3);
  while (distractors.length < 3) distractors.push(['再想一想', '请爸爸妈妈帮忙', '明天再试试'][distractors.length] || '再看看');
  const options = shuffleStable([answerText, ...distractors], seed);
  return { q: prompt, options, answer: options.indexOf(answerText), explain };
}

function englishQuiz(focus: string[], pool: string[], seed: number): QuizQuestion[] {
  const known = focus.filter(w => EN_ZH[w]);
  const qs: QuizQuestion[] = [];
  if (known.length) {
    const target = known[seed % known.length];
    if (target) {
      qs.push(makeQuestion(`「${EN_ZH[target]}」用英语怎么说？`, target, pool, `「${target}」= ${EN_ZH[target]}。`, seed));
    }
  } else {
    const target = focus[seed % focus.length] || 'hello';
    qs.push(makeQuestion('下面哪个是今天练习的单词？', target, pool, `今天我们练习了「${target}」。`, seed));
  }
  return qs;
}

function hanziQuiz(focus: string[], pool: string[], seed: number): QuizQuestion[] {
  const chars = focus.filter(t => /^[\u4e00-\u9fa5]$/.test(t) && HANZI_GLOSSARY[t]);
  const qs: QuizQuestion[] = [];
  if (chars.length) {
    const target = chars[seed % chars.length];
    if (target) {
      const [pinyin, meaning] = (HANZI_GLOSSARY[target] || '|').split('|');
      qs.push(makeQuestion(
        `「${meaning}」是哪个字？`,
        target,
        chars.length >= 2 ? chars : [...chars, ...pool.filter(t => /^[\u4e00-\u9fa5]$/.test(t))],
        `「${target}」读 ${pinyin}，意思是${meaning}。`,
        seed,
      ));
    }
  } else {
    qs.push(makeQuestion('今天认识的新字是哪一个？', focus[seed % focus.length] || '日', pool, '把新字读给爸爸妈妈听。', seed));
  }
  return qs;
}

export type BuildLessonInput = {
  subject: SubjectCode;
  level: LevelCode;
  title: string;
  focus: string[];
  objective: string;
  unitTitle: string;
  index: number;
  pool: string[];
  resource?: { url: string; source: string; license: string };
};

export function buildBlocks(input: BuildLessonInput): Block[] {
  const { subject, title, focus, objective, unitTitle, index, pool, resource } = input;
  const seed = index + title.length;
  const blocks: Block[] = [];
  const first = focus[0] || title;

  blocks.push({
    type: 'intro', title, emoji: emojiFor(first),
    text: `今天的探索目标：${objective}。我们会在「${unitTitle}」里玩 4 个小环节，大约 20 分钟。`,
  });
  blocks.push({
    type: 'story', title: '星芽小剧场',
    text: `星芽森林里，豆豆背着小背包出发了。今天他要认识「${focus.join('、')}」。` +
      `豆豆有点紧张，你愿意陪他一起看一看、试一试、说一说吗？`,
  });

  if (subject === 'thinking') {
    blocks.push({
      type: 'cards', title: '发现卡', items: focus.map(f => ({ label: f, emoji: emojiFor(f), note: '今天的关键词' })),
    });
    const patternPool = focus.filter(f => emojiFor(f) !== '✨').map(f => emojiFor(f));
    const seq = patternPool.length >= 2 ? [patternPool[0], patternPool[1], patternPool[0], patternPool[1]] : ['🔴', '🔵', '🔴', '🔵'];
    blocks.push({
      type: 'match', title: '配一配', hint: '点左边一张，再点右边一张，找出一对好朋友。',
      pairs: focus.slice(0, 3).map(f => ({ a: f, b: emojiFor(f) })),
    });
    blocks.push({
      type: 'quiz', title: '小挑战',
      questions: [
        makeQuestion(`「${first}」是今天的哪个探索内容？`, first, pool, `今天我们探索了「${first}」。`, seed),
        makeQuestion(
          seq.length >= 4 ? `接下来的图案应该是？` : '哪一个是我们今天用到的？',
          emojiFor(first),
          [...seq.slice(0, 3).map(x => x), ...focus.map(f => emojiFor(f)), '⭐'].filter(Boolean),
          '先找规律，再说出你的理由。',
          seed + 1,
        ),
      ],
    });
  } else if (subject === 'english') {
    blocks.push({
      type: 'cards', title: 'Word Cards', items: focus.map(w => ({ label: w, emoji: emojiFor(w, '🔤'), note: EN_ZH[w] || '跟读并记住' })),
    });
    const words = focus.filter(w => EN_ZH[w]);
    const sentence = words.length
      ? `I like ${words.slice(0, 2).join(' and ')}.`
      : `Let's say ${focus.slice(0, 3).join(', ')}.`;
    blocks.push({
      type: 'listen', title: 'Listen & Repeat', text: sentence,
      translation: words.length ? `我喜欢${words.slice(0, 2).map(w => EN_ZH[w]).join('和')}。` : '跟我一起读。',
    });
    blocks.push({
      type: 'speak', title: 'Speak Out', text: words.length ? words.slice(0, 2).join(' and ') : sentence,
      translation: '大声跟读，勇敢开口就是进步。', tips: '先听一遍，再按住麦克风跟读；也可以只做口型练习。',
    });
    blocks.push({
      type: 'match', title: 'Match', hint: '把英文单词和图片配成一对。',
      pairs: focus.slice(0, 3).map(w => ({ a: w, b: emojiFor(w, '🔤') })),
    });
    blocks.push({
      type: 'quiz', title: 'Quick Quiz', questions: englishQuiz(focus, pool, seed),
    });
  } else if (subject === 'hanzi') {
    const char = focus.find(t => /^[\u4e00-\u9fa5]$/.test(t)) || '日';
    const gloss = HANZI_GLOSSARY[char] || '';
    const [pinyin] = gloss.split('|');
    blocks.push({
      type: 'trace', title: '描一描', char,
      pinyin: pinyin || '', hint: '用手指沿着虚线慢慢写，再自己写一个。',
    });
    blocks.push({
      type: 'cards', title: '字卡宝宝', items: focus.map(f => ({ label: f, emoji: emojiFor(f), note: HANZI_GLOSSARY[f] ? HANZI_GLOSSARY[f].split('|')[0] : '今天的新字' })),
    });
    blocks.push({
      type: 'read', title: '读一读', text: focus.filter(t => /[\u4e00-\u9fa5]/.test(t)).join('，') + '。',
      translation: '先听老师读，再跟着读，最后自己读一遍。',
    });
    blocks.push({ type: 'quiz', title: '识字小关卡', questions: hanziQuiz(focus, pool, seed) });
  } else if (subject === 'piano') {
    const notes = focus.map(f => PIANO_NOTES[f]).filter(Boolean).slice(0, 6);
    const sequence = notes.length >= 2
      ? [...notes, ...notes.slice(0, 2)]
      : [{ n: 'C4', label: 'do' }, { n: 'E4', label: 'mi' }, { n: 'G4', label: 'sol' }, { n: 'E4', label: 'mi' }];
    blocks.push({
      type: 'rhythm', title: '节奏热身', pattern: ['♩', '♩', '♪♪', '♩'], bpm: 80,
      hint: '跟着节拍器拍手：走走 跑跑 走。',
    });
    blocks.push({
      type: 'piano', title: '弹一弹', notes: sequence, bpm: 80,
      hint: '按顺序点亮琴键，先听再弹；慢一点也没关系。',
    });
    blocks.push({
      type: 'quiz', title: '音乐小问答',
      questions: [makeQuestion(
        `「${focus[0] || 'do'}」在今天的练习中是什么？`,
        focus[0] || 'do',
        [...focus, ...pool].filter(Boolean),
        `今天我们练习了「${focus.join('、')}」，记得听一听自己的声音。`,
        seed,
      )],
    });
  } else {
    blocks.push({
      type: 'cards', title: '工作展示', items: focus.map(f => ({ label: f, emoji: emojiFor(f), note: '观察并说出你的发现' })),
    });
    blocks.push({
      type: 'match', title: '工作配对', hint: '把工作名称和对应的图片配成一对。',
      pairs: focus.slice(0, 3).map(f => ({ a: f, b: emojiFor(f) })),
    });
    blocks.push({
      type: 'quiz', title: '回忆一下',
      questions: [makeQuestion(`「${emojiFor(first)}」对应哪一项工作？`, first, [...focus.slice(1), ...pool], `今天的工作是「${first}」，慢慢做、做完整。`, seed)],
    });
  }

  blocks.push({
    type: 'reflect', title: '今日回顾', emoji: '🌟',
    prompt: `今天最开心的是哪一步？请用一句话说给爸爸妈妈听。关键词：${focus.join('、')}`,
  });

  if (resource) {
    blocks.push({ type: 'resource', title: '拓展资源', url: resource.url, source: resource.source, license: resource.license });
  }
  return blocks;
}

export function lessonMinutes(subject: SubjectCode, level: LevelCode): number {
  const base = level === 'nursery' ? 12 : level === 'junior' ? 15 : level === 'middle' ? 18 : 20;
  const bonus = subject === 'piano' ? 5 : subject === 'hanzi' ? 2 : subject === 'english' ? 3 : 0;
  return base + bonus;
}

export function lessonEmoji(subject: SubjectCode, focus: string[]): string {
  return emojiFor(focus[0] || '', subject === 'english' ? '🔤' : '✨');
}
