import type { Db } from './db.ts';
import { config } from '../config.ts';
import { hashPassword, newId, nowIso, today, addDays } from '../core/security.ts';
import { importPack } from './public-courses.ts';
import { buildBlocks, lessonMinutes } from './lesson-blocks.ts';
import { SHOP_ITEMS } from './shop-data.ts';
import {
  LEVELS, PUBLIC_PACKS, PUBLIC_SOURCES, SUBJECTS, SYLLABUS, TERM,
  type LevelCode, type PublicPack, type SubjectCode,
} from './curriculum-data.ts';

const SUBJECT_BY_CODE = Object.fromEntries(SUBJECTS.map(s => [s.code, s])) as Record<SubjectCode, (typeof SUBJECTS)[number]>;

function meta(db: Db, key: string): string | undefined {
  return db.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key])?.value;
}
function setMeta(db: Db, key: string, value: string): void {
  db.run('INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

function lessonTagList(subject: SubjectCode, level: LevelCode, unitTitle: string, focus: string[]): string[] {
  const subjectName = SUBJECT_BY_CODE[subject].name;
  return [subjectName, level, unitTitle, ...focus].slice(0, 8);
}

function tokenPool(subject: SubjectCode, level: LevelCode): string[] {
  return SYLLABUS[subject][level].flatMap(u => u.lessons.flatMap(([, focus]) => focus));
}

function insertCoreFramework(db: Db, subject: SubjectCode, level: LevelCode): void {
  const subjectMeta = SUBJECT_BY_CODE[subject];
  const levelMeta = LEVELS.find(l => l.code === level)!;
  const units = SYLLABUS[subject][level];
  const frameworkId = `fw_${subject}_${level}`;
  db.run(
    `INSERT OR IGNORE INTO frameworks(id, subject_code, class_code, term, title, objectives, source_code, version, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [frameworkId, subject, level, TERM, `${subjectMeta.name} · ${levelMeta.name}体系`, JSON.stringify(units.map(u => u.objective)), null, 1, nowIso()],
  );
  const pool = tokenPool(subject, level);
  units.forEach((unit, ui) => {
    const unitId = `unt_${subject}_${level}_u${ui + 1}`;
    db.run(
      `INSERT OR IGNORE INTO units(id, framework_id, code, title, seq, objective, source_code) VALUES(?,?,?,?,?,?,?)`,
      [unitId, frameworkId, `U${ui + 1}`, unit.title, ui + 1, unit.objective, null],
    );
    unit.lessons.forEach(([title, focus], li) => {
      const lessonId = `lsn_${subject}_${level}_u${ui + 1}_l${li + 1}`;
      const blocks = buildBlocks({
        subject, level, title, focus: [...focus], objective: unit.objective,
        unitTitle: unit.title, index: ui * 10 + li + 1, pool,
      });
      db.run(
        `INSERT OR IGNORE INTO lessons(id, unit_id, code, title, seq, minutes, objective, blocks, tags, source_code, version, is_published)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          lessonId, unitId, `U${ui + 1}L${li + 1}`, title, li + 1,
          lessonMinutes(subject, level), `${unit.objective}（${title}）`,
          JSON.stringify(blocks), JSON.stringify(lessonTagList(subject, level, unit.title, [...focus])),
          null, 1, 1,
        ],
      );
    });
  });
}

function seedCurriculum(db: Db): void {
  if (meta(db, 'curriculum_version')) return;
  db.tx(() => {
    for (const subject of SUBJECTS) {
      db.run('INSERT OR IGNORE INTO subjects(code, name, icon, color, summary, sort) VALUES(?,?,?,?,?,?)',
        [subject.code, subject.name, subject.icon, subject.color, subject.summary, subject.sort]);
    }
    for (const level of LEVELS) {
      db.run('INSERT OR IGNORE INTO class_levels(code, name, age_min, age_max, sort) VALUES(?,?,?,?,?)',
        [level.code, level.name, level.ageMin, level.ageMax, level.sort]);
    }
    for (const source of PUBLIC_SOURCES) {
      db.run('INSERT OR IGNORE INTO public_sources(code, name, url, license, description, homepage, last_synced_at, version) VALUES(?,?,?,?,?,?,?,?)',
        [source.code, source.name, source.url, source.license, source.description, source.homepage, null, source.version]);
    }
    for (const subject of SUBJECTS) {
      for (const level of LEVELS) insertCoreFramework(db, subject.code, level.code);
    }
    for (const pack of PUBLIC_PACKS) importPack(db, pack, { autoApprove: true });
    setMeta(db, 'curriculum_version', '1');
  });
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function seedDemo(db: Db): void {
  if (meta(db, 'demo_version')) return;
  const now = nowIso();
  const day0 = today();
  db.tx(() => {
    const users = [
      { id: 'usr_admin', email: config.demo.admin.email, password: config.demo.admin.password, name: '星芽管理员', role: 'admin' },
      { id: 'usr_teacher', email: config.demo.teacher.email, password: config.demo.teacher.password, name: '林老师', role: 'teacher' },
      { id: 'usr_parent', email: config.demo.parent.email, password: config.demo.parent.password, name: '米粒妈妈', role: 'parent' },
      { id: 'usr_other', email: 'other@demo.com', password: 'Other123!', name: '果果爸爸', role: 'parent' },
    ];
    for (const user of users) {
      db.run(
        `INSERT OR IGNORE INTO users(id, email, password_hash, name, role, avatar, disabled, created_at, must_change_password)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [user.id, user.email, hashPassword(user.password), user.name, user.role, null, 0, now,
          config.env === 'production' && !config.demoMode ? 1 : 0],
      );
    }
    db.run('INSERT OR IGNORE INTO households(id, name, owner_id, created_at) VALUES(?,?,?,?)', ['hh_star', '星芽之家', 'usr_parent', now]);
    db.run('INSERT OR IGNORE INTO households(id, name, owner_id, created_at) VALUES(?,?,?,?)', ['hh_other', '果果的家', 'usr_other', now]);
    db.run('INSERT OR IGNORE INTO households(id, name, owner_id, created_at) VALUES(?,?,?,?)', ['hh_admin', '平台运营', 'usr_admin', now]);
    for (const [hid, uid] of [['hh_star', 'usr_parent'], ['hh_star', 'usr_teacher'], ['hh_other', 'usr_other'], ['hh_admin', 'usr_admin']]) {
      db.run('INSERT OR IGNORE INTO household_members(household_id, user_id, role, created_at) VALUES(?,?,?,?)', [hid, uid, 'parent', now]);
    }
    const children = [
      { id: 'chi_mili', household: 'hh_star', name: '米粒', classCode: 'junior', birthYear: 2022 },
      { id: 'chi_lele', household: 'hh_star', name: '乐乐', classCode: 'senior', birthYear: 2020 },
      { id: 'chi_guoguo', household: 'hh_other', name: '果果', classCode: 'middle', birthYear: 2021 },
    ];
    for (const child of children) {
      db.run('INSERT OR IGNORE INTO children(id, household_id, name, class_code, birth_year, avatar, created_at) VALUES(?,?,?,?,?,?,?)',
        [child.id, child.household, child.name, child.classCode, child.birthYear, child.name.slice(0, 1), now]);
      for (const kind of ['camera', 'ai_processing', 'analytics']) {
        db.run(
          `INSERT OR IGNORE INTO guardian_consents(id, household_id, child_id, kind, granted, granted_by, policy_version, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          [`cns_${child.id}_${kind}`, child.household, child.id, kind, 1, child.household === 'hh_star' ? 'usr_parent' : 'usr_other', '2026-01', now, now],
        );
      }
    }

    const juniorLessons = db.all<{ id: string; subject_code: string; minutes: number; title: string }>(
      `SELECT l.id, f.subject_code, l.minutes, l.title FROM lessons l
       JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
       WHERE f.class_code = 'junior' AND l.source_code IS NULL ORDER BY f.subject_code, un.seq, l.seq`,
    );
    const seniorLessons = db.all<{ id: string; subject_code: string; minutes: number; title: string }>(
      `SELECT l.id, f.subject_code, l.minutes, l.title FROM lessons l
       JOIN units un ON un.id = l.unit_id JOIN frameworks f ON f.id = un.framework_id
       WHERE f.class_code = 'senior' AND l.source_code IS NULL ORDER BY f.subject_code, un.seq, l.seq`,
    );
    const pickBySubject = (rows: typeof juniorLessons, take: number) => {
      const bySubject = new Map<string, typeof rows>();
      for (const row of rows) {
        if (!bySubject.has(row.subject_code)) bySubject.set(row.subject_code, []);
        bySubject.get(row.subject_code)!.push(row);
      }
      return [...bySubject.values()].flatMap(list => list.slice(0, take));
    };
    const miliProgress = pickBySubject(juniorLessons, 3).slice(0, 13);
    miliProgress.forEach((lesson, i) => {
      const completed = new Date(Date.now() - (i + 1) * 20 * 3600_000).toISOString();
      db.run(
        `INSERT OR IGNORE INTO progress(id, child_id, lesson_id, status, score, seconds, attempts, started_at, completed_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [`prg_mili_${i}`, 'chi_mili', lesson.id, 'completed', 78 + ((i * 7) % 23), lesson.minutes * 60, 1, completed, completed, completed],
      );
    });
    pickBySubject(seniorLessons, 2).forEach((lesson, i) => {
      const completed = new Date(Date.now() - (i + 2) * 26 * 3600_000).toISOString();
      db.run(
        `INSERT OR IGNORE INTO progress(id, child_id, lesson_id, status, score, seconds, attempts, started_at, completed_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [`prg_lele_${i}`, 'chi_lele', lesson.id, 'completed', 82 + (i % 15), lesson.minutes * 60, 1, completed, completed, completed],
      );
    });
    const nextMili = juniorLessons[15];
    if (nextMili) {
      db.run(
        `INSERT OR IGNORE INTO progress(id, child_id, lesson_id, status, score, seconds, attempts, started_at, completed_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        ['prg_mili_wip', 'chi_mili', nextMili.id, 'in_progress', null, 300, 1, isoHoursAgo(3), null, now],
      );
    }

    // ---- active plan with one missed item (for correction demo) ----
    const miliLessonPool = pickBySubject(juniorLessons, 4);
    const start = addDays(day0, -4);
    const end = addDays(day0, 9);
    db.run(
      `INSERT OR IGNORE INTO plans(id, household_id, child_id, title, goal, created_by, source, status, start_date, end_date,
        days_per_week, minutes_per_day, ai_rationale, version, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['pln_mili_1', 'hh_star', 'chi_mili', '米粒的两周成长计划', '建立稳定的每日学习节奏，英语与思维双线并进',
        'usr_parent', 'ai', 'active', start, end, 5, 25,
        '基于米粒近两周的完成记录与「小班」课程顺序生成：每天 1 个主课时 + 1 个轻量复习，周三留白，避免连续高强度；优先补齐英语听说，再穿插思维与汉字。',
        1, isoHoursAgo(96), now],
    );
    let seq = 0;
    let poolIndex = 0;
    for (let offset = 0; offset < 14 && seq < 10; offset++) {
      const date = addDays(start, offset);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const lesson = miliLessonPool[poolIndex % miliLessonPool.length];
      poolIndex += 1;
      if (!lesson) continue;
      seq += 1;
      const status = date < day0 ? (seq === 2 ? 'missed' : 'done') : 'pending';
      db.run(
        `INSERT OR IGNORE INTO plan_items(id, plan_id, household_id, child_id, date, seq, lesson_id, subject_code, title, minutes, status, completed_at, note)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`pli_mili_${seq}`, 'pln_mili_1', 'hh_star', 'chi_mili', date, seq, lesson.id, lesson.subject_code, lesson.title,
          lesson.minutes, status, status === 'done' ? `${date}T11:30:00.000Z` : null, null],
      );
    }
    db.run(
      `INSERT OR IGNORE INTO reminders(id, plan_id, household_id, child_id, at, message, channel, status, created_at, sent_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ['rem_mili_1', 'pln_mili_1', 'hh_star', 'chi_mili', new Date(`${addDays(day0, 1)}T11:00:00.000Z`).toISOString(),
        '米粒今天的学习计划已准备好，一起开始 20 分钟吧！', 'inapp', 'scheduled', now, null],
    );
    db.run(
      `INSERT OR IGNORE INTO plans(id, household_id, child_id, title, goal, created_by, source, status, start_date, end_date,
        days_per_week, minutes_per_day, ai_rationale, version, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['pln_lele_1', 'hh_star', 'chi_lele', '乐乐的幼小衔接计划（草稿）', '入学准备：专注力、拼音与钢琴表达',
        'usr_parent', 'ai', 'draft', day0, addDays(day0, 20), 4, 30,
        '乐乐已进入大班下学期，建议每周 4 次、每次 30 分钟，优先安排拼音与视奏，同步加入蒙氏时间管理。',
        1, isoHoursAgo(30), now],
    );

    // ---- community ----
    const post1 = {
      id: 'post_1', author: 'usr_parent', hid: 'hh_star', type: 'insight',
      title: '把「纠偏」用起来：我们家的一周节奏', tags: ['习惯养成', '计划'],
      content: '以前计划一被打断就整周放弃。现在每周日晚上花 5 分钟看「偏差」，把没完成的课时一键顺延到周三和周六的空白时段，孩子反而更有掌控感。\n\n小经验：把目标写成「每天 20 分钟」，而不是「一周学完一个单元」。',
      status: 'approved', publishedAt: isoHoursAgo(50),
    };
    const post2 = {
      id: 'post_2', author: 'usr_teacher', hid: 'hh_star', type: 'course',
      title: '小班钢琴第一课：黑白键与「找到 do」', tags: ['钢琴', '小班'],
      content: '用一张大键盘图 + 三分钟游戏，让孩子在「找一找」中认识中央 C。重点不是弹对，而是愿意坐下来、听一听。\n\n附课程链接，可直接加入计划。',
      status: 'approved', publishedAt: isoHoursAgo(20),
      courseRef: JSON.stringify({ lessonId: 'lsn_piano_junior_u1_l2', title: '找到 do' }),
    };
    const post3 = {
      id: 'post_3', author: 'usr_teacher', hid: 'hh_star', type: 'insight',
      title: '陪练不吼叫：三个替换句', tags: ['亲子沟通', '钢琴'],
      content: '把「你怎么又错了」换成「这一次我们只练这一小节」；把「快点」换成「我数三下，你准备好就开始」；把「真棒」换成「我看到你刚才放慢了速度」。',
      status: 'pending', publishedAt: null,
    };
    const post4 = {
      id: 'post_4', author: 'usr_other', hid: 'hh_other', type: 'insight',
      title: '加微信领全套资料', tags: ['资料'],
      content: '扫码加微信，免费领取全套课程资料，名额有限。',
      status: 'rejected', publishedAt: null,
    };
    const insertPost = (post: {
      id: string; author: string; hid: string; type: string; title: string; tags: string[];
      content: string; status: string; publishedAt: string | null; courseRef?: string;
    }) => {
      db.run(
        `INSERT OR IGNORE INTO community_posts(id, household_id, author_id, type, title, content, tags, course_ref, status,
          moderation_score, moderation_reasons, like_count, view_count, created_at, updated_at, published_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [post.id, post.hid, post.author, post.type, post.title, post.content, JSON.stringify(post.tags),
          post.courseRef || null, post.status, post.status === 'rejected' ? 30 : 95,
          JSON.stringify(post.status === 'rejected' ? ['包含站外联系方式或导流信息'] : []),
          post.id === 'post_1' ? 12 : post.id === 'post_2' ? 8 : 0, 30, post.id === 'post_2' ? isoHoursAgo(20) : isoHoursAgo(50),
          now, post.publishedAt],
      );
    };
    for (const post of [post1, post2, post3, post4]) insertPost(post);
    db.run('INSERT OR IGNORE INTO comments(id, post_id, user_id, content, status, created_at) VALUES(?,?,?,?,?,?)',
      ['cmt_1', 'post_1', 'usr_teacher', '顺延这个思路太好了，我也试试把空白时段留出来。', 'approved', isoHoursAgo(40)]);
    db.run('INSERT OR IGNORE INTO comments(id, post_id, user_id, content, status, created_at) VALUES(?,?,?,?,?,?)',
      ['cmt_2', 'post_2', 'usr_parent', '孩子今天按这个课找到了中央 C，特别开心！', 'approved', isoHoursAgo(15)]);
    db.run('INSERT OR IGNORE INTO post_likes(post_id, user_id, created_at) VALUES(?,?,?)', ['post_1', 'usr_parent', isoHoursAgo(49)]);
    db.run('INSERT OR IGNORE INTO post_likes(post_id, user_id, created_at) VALUES(?,?,?)', ['post_1', 'usr_teacher', isoHoursAgo(48)]);
    db.run('INSERT OR IGNORE INTO post_likes(post_id, user_id, created_at) VALUES(?,?,?)', ['post_2', 'usr_parent', isoHoursAgo(18)]);
    db.run(
      `INSERT OR IGNORE INTO post_reviews(id, post_id, reviewer_id, decision, note, created_at)
       VALUES(?,?,?,?,?,?)`,
      ['rev_1', 'post_4', 'usr_admin', 'rejected', '含站外联系方式与营销导流，不符合社区规范。', isoHoursAgo(10)],
    );

    // ---- ecosystem ----
    const experts = [
      ['exp_piano_lin', 'usr_teacher', 'hh_star', '林老师 · 钢琴启蒙', '音乐学院硕士 / 10 年幼儿钢琴教学',
        '擅长用游戏化方式带 3–6 岁孩子走进音乐。回答时给出可执行的 10 分钟练习方案，并提醒保护手型与兴趣。',
        ['piano'], ['junior', 'middle', 'senior'], 'published', 'public', 126, 4.9],
      ['exp_montessori_zhou', 'usr_teacher', 'hh_star', '周老师 · 蒙氏日常', 'AMI 认证 / 幼儿园主教 8 年',
        '专注日常生活与感官教育。回答时先说明工作目的，再给材料清单与分步示范，最后提示观察要点。',
        ['montessori'], ['nursery', 'junior', 'middle'], 'published', 'public', 88, 4.8],
      ['exp_english_amy', 'usr_other', 'hh_other', 'Amy · 英语绘本', '亲子英语共读实践者',
        '用绘本与儿歌做可理解输入。回答使用简单英文 + 中文提示，给出亲子共读脚本。',
        ['english'], ['nursery', 'junior'], 'published', 'public', 54, 4.7],
      ['exp_math_chen', 'usr_teacher', 'hh_star', '陈老师 · 思维游戏', '学前教育教研员',
        '把数感与逻辑藏在生活游戏里，给出材料简单、可重复玩的方案。',
        ['thinking'], ['middle', 'senior'], 'pending_review', 'public', 0, 0],
    ] as const;
    for (const [id, owner, hid, name, title, prompt, subjects, classes, status, visibility, installs, rating] of experts) {
      db.run(
        `INSERT OR IGNORE INTO experts(id, owner_id, household_id, name, title, description, system_prompt, subjects,
          class_codes, status, visibility, installs, rating, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, owner, hid, name, title, prompt.slice(0, 42), prompt, JSON.stringify(subjects), JSON.stringify(classes),
          status, visibility, installs, rating, now, now],
      );
    }
    const skills = [
      ['skl_plan_week', 'usr_teacher', 'hh_star', 'weekly-plan', '一周学习计划生成器', '按年龄与进度生成均衡的一周计划草案',
        'workflow', { steps: ['读取最近进度', '按学科轮转选课', '校验每日时长', '输出计划与理由'] }, 'published', 'public', 64],
      ['skl_report_daily', 'usr_teacher', 'hh_star', 'daily-report', '每日学习汇报', '把当日学习数据转成家长可读的 3 句话汇报',
        'prompt', { template: '今天完成了 {lessons} 个活动，共 {minutes} 分钟，最投入的是 {best}。建议明天……' }, 'published', 'public', 41],
      ['skl_piano_10min', 'usr_teacher', 'hh_star', 'piano-10min', '钢琴 10 分钟陪练', '给出一首曲子的慢练分解步骤与鼓励话术',
        'prompt', { template: '先分手慢练 2 遍 → 只练难点小节 3 遍 → 合手 1 遍 → 录下来听一遍' }, 'published', 'public', 37],
    ] as const;
    for (const [id, owner, hid, code, name, description, kind, definition, status, visibility, installs] of skills) {
      db.run(
        `INSERT OR IGNORE INTO skills(id, owner_id, household_id, code, name, description, kind, definition, status, visibility, installs, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, owner, hid, code, name, description, kind, JSON.stringify(definition), status, visibility, installs, now, now],
      );
    }
    db.run('INSERT OR IGNORE INTO expert_skills(expert_id, skill_id) VALUES(?,?)', ['exp_piano_lin', 'skl_piano_10min']);
    db.run('INSERT OR IGNORE INTO expert_skills(expert_id, skill_id) VALUES(?,?)', ['exp_english_amy', 'skl_report_daily']);
    db.run('INSERT OR IGNORE INTO installations(id, household_id, user_id, item_type, item_id, config, created_at) VALUES(?,?,?,?,?,?,?)',
      ['ins_1', 'hh_star', 'usr_parent', 'expert', 'exp_english_amy', '{}', now]);
    const builtinTools = [
      { name: 'curriculum.search', description: '按关键词检索平台课程', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'plan.suggest', description: '基于孩子进度给出选课建议', input_schema: { type: 'object', properties: { childId: { type: 'string' } }, required: ['childId'] } },
      { name: 'report.summary', description: '汇总指定周期的学习数据', input_schema: { type: 'object', properties: { childId: { type: 'string' }, period: { type: 'string' } }, required: ['childId'] } },
    ];
    db.run(
      `INSERT OR IGNORE INTO connectors(id, owner_id, household_id, name, kind, base_url, auth_type, secret_enc, tools, description, status, visibility, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['con_star_toolbox', 'usr_teacher', 'hh_star', '星芽工具箱', 'builtin', null, 'none', null, JSON.stringify(builtinTools),
        '平台内置工具：课程检索、选课建议、学习数据汇总。', 'published', 'public', now, now],
    );
    db.run(
      `INSERT OR IGNORE INTO connectors(id, owner_id, household_id, name, kind, base_url, auth_type, secret_enc, tools, description, status, visibility, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['con_webhook_demo', 'usr_parent', 'hh_star', '家庭 Webhook（示例）', 'http', 'https://example.com/hooks/starbuddy', 'bearer', null,
        JSON.stringify([{ name: 'notify', description: '向家庭自动化服务发送学习提醒', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }]),
        '示例：把学习提醒推送到家庭自动化（需在允许域名中配置 example.com）。', 'draft', 'household', now, now],
    );
    db.run(
      `INSERT OR IGNORE INTO audit_logs(id, household_id, actor_id, action, entity, entity_id, detail, ip, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      ['aud_1', 'hh_star', 'usr_parent', 'plan.create', 'plan', 'pln_mili_1', '{"source":"ai"}', '127.0.0.1', isoHoursAgo(96)],
    );
    // ---- companion + wallet + inventory ----
    db.run('INSERT OR IGNORE INTO wallets(child_id, coins, total_earned, updated_at) VALUES(?,?,?,?)', ['chi_mili', 360, 360, now]);
    db.run('INSERT OR IGNORE INTO wallets(child_id, coins, total_earned, updated_at) VALUES(?,?,?,?)', ['chi_lele', 60, 60, now]);
    db.run(
      `INSERT OR IGNORE INTO pets(id, household_id, child_id, species, name, level, exp, hunger, happiness, energy, bond, mood, equipped, last_decay_at, adopted_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['pet_mili', 'hh_star', 'chi_mili', 'bunny', '团子', 3, 240, 78, 88, 74, 45, 'excited', JSON.stringify(['yellow-hat']), now, isoHoursAgo(24 * 12), now],
    );
    const inventory: [string, string, number, number][] = [
      ['carrot', 'food', 3, 0], ['cookie', 'food', 2, 0], ['honey', 'food', 1, 0],
      ['yellow-hat', 'clothing', 1, 1], ['yarn-ball', 'toy', 1, 0], ['moon-rug', 'decor', 1, 0],
    ];
    for (const [code, kind, qty, equipped] of inventory) {
      db.run(
        `INSERT OR IGNORE INTO pet_inventory(id, pet_id, item_code, qty, equipped, acquired_at)
         VALUES(?,?,?,?,?,?)`,
        [`inv_mili_${code}`, 'pet_mili', code, qty, equipped, now],
      );
    }
    setMeta(db, 'demo_version', '1');
    setMeta(db, 'seed_time', now);
  });
}

export function shouldSeedDemo(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  // Demo data requires BOTH switches. This prevents a single stray SEED_DEMO=true
  // from publishing known credentials in production.
  return config.seedDemo && config.demoMode;
}

export function seedShopItems(db: Db): void {
  if (meta(db, 'shop_version')) return;
  for (const item of SHOP_ITEMS) {
    db.run(
      `INSERT OR IGNORE INTO shop_items(code, kind, name, emoji, price, description, effect, sort)
       VALUES(?,?,?,?,?,?,?,?)`,
      [item.code, item.kind, item.name, item.emoji, item.price, item.description, JSON.stringify(item.effect), item.sort],
    );
  }
  setMeta(db, 'shop_version', '1');
}

export function seedDatabase(db: Db, opts: { demo?: boolean } = {}): void {
  seedCurriculum(db);
  seedShopItems(db);
  if (shouldSeedDemo(opts.demo)) seedDemo(db);
}
