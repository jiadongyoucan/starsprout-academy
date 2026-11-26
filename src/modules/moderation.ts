export type ModerationReason = { code: string; label: string; severity: 'block' | 'review' };
export type ModerationResult = { score: number; reasons: ModerationReason[]; blocked: boolean; onTopic: boolean };

const HOMOGLYPHS: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'і': 'i', 'ј': 'j',
  'ѕ': 's', 'ԁ': 'd', 'ν': 'v', 'ⅴ': 'v', '𝐯': 'v', 'ｖ': 'v', 'ⱱ': 'v', 'ɡ': 'g',
};

const BANNED: { re: RegExp; label: string }[] = [
  { re: /色情|裸聊|裸照|招嫖|约炮|成人视频|黄片|色诱/, label: '包含色情或成人内容' },
  { re: /赌博|博彩|下注|时时彩|六合彩|赌球/, label: '包含赌博信息' },
  { re: /毒品|冰毒|大麻|摇头丸|吸毒/, label: '包含毒品信息' },
  { re: /枪支|弹药|爆炸物|自制炸弹/, label: '包含危险物品信息' },
  { re: /自杀|自残|割腕|轻生/, label: '包含自伤/自杀相关内容，需专业支持' },
  { re: /恋童|儿童色情|猥亵儿童|性侵儿童/, label: '涉及儿童性侵害内容' },
  { re: /虐待儿童|家暴|打死孩子/, label: '涉及暴力伤害儿童内容' },
  { re: /把孩子打|打孩子|揍孩子|体罚|关小黑屋|罚站一天/, label: '涉及体罚或暴力管教' },
  { re: /恐怖袭击|砍人|杀人|血腥/, label: '包含暴力恐怖内容' },
  { re: /傻逼|去死|废物|贱人|滚出去/, label: '包含辱骂或攻击性语言' },
  { re: /刷单|兼职日结|返利|代购|代理招募|发展下线/, label: '包含营销或欺诈信息' },
  { re: /偏方|神药|包治百病|增高药/, label: '包含未经证实的效果承诺' },
];

const CONTACT = /加微信|加v|加薇|vx|wx号|微信号|weixin|wechat|扫码|公众号|加群|私聊|qq号|扣扣|手机号|联系方式|领取资料|免费领取/;
const URL_RE = /(https?:\/\/|www\.)/;
const PHONE_RE = /1[3-9]\d{9}/;
const ID_RE = /\b\d{17}[\dXx]\b/;
const EDUCATION_KEYWORDS = [
  '孩子', '幼儿', '宝宝', '亲子', '学习', '课程', '计划', '启蒙', '绘本', '钢琴', '汉字', '识字',
  '英语', '思维', '蒙氏', '老师', '课堂', '习惯', '专注', '成长', '阅读', '游戏', '家庭', '陪伴',
  '托班', '小班', '中班', '大班', '早教', '教育',
];

export function normalizeText(input: string): string {
  return String(input || '').normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .split('').map(ch => HOMOGLYPHS[ch] ?? ch).join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function moderateContent(text: string, meta: { onTopicHint?: boolean } = {}): ModerationResult {
  const normalized = normalizeText(text);
  const compact = normalized.replace(/[\s._\-*~·|]/g, '');
  const reasons: ModerationReason[] = [];
  let score = 100;

  for (const rule of BANNED) {
    if (rule.re.test(compact) || rule.re.test(normalized)) {
      reasons.push({ code: 'BANNED', label: rule.label, severity: 'block' });
      score -= 70;
    }
  }
  if (CONTACT.test(compact) || CONTACT.test(normalized)) {
    reasons.push({ code: 'CONTACT', label: '包含站外联系方式或导流信息', severity: 'block' });
    score -= 60;
  }
  if (PHONE_RE.test(compact) || ID_RE.test(compact)) {
    reasons.push({ code: 'PII', label: '包含手机号或身份证号等隐私信息', severity: 'block' });
    score -= 60;
  }
  if (URL_RE.test(normalized)) {
    reasons.push({ code: 'EXTERNAL_LINK', label: '包含站外链接，需人工核验', severity: 'review' });
    score -= 25;
  }
  if (/(诊断|处方|用药|治疗|疗效)/.test(normalized)) {
    reasons.push({ code: 'MEDICAL', label: '涉及医疗建议，需人工核验', severity: 'review' });
    score -= 20;
  }
  const topicHits = EDUCATION_KEYWORDS.filter(k => normalized.includes(k)).length;
  const onTopic = meta.onTopicHint === true || topicHits > 0;
  if (!onTopic) {
    reasons.push({ code: 'OFF_TOPIC', label: '未见与儿童教育主题相关的内容', severity: 'review' });
    score -= 35;
  }
  const blocked = reasons.some(r => r.severity === 'block');
  return { score: Math.max(0, score), reasons, blocked, onTopic };
}

export function assertSafeDisplayName(name: string): void {
  const result = moderateContent(name, { onTopicHint: true });
  if (result.blocked || result.reasons.some(r => r.code === 'CONTACT')) {
    throw new Error('称呼包含不合适的内容，请修改后再试');
  }
}

export function moderateComment(content: string): ModerationResult {
  return moderateContent(content, { onTopicHint: true });
}
