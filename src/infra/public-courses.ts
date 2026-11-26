import type { Db } from './db.ts';
import { sha256 } from '../core/security.ts';
import { newId, nowIso } from '../core/security.ts';
import { buildBlocks, lessonMinutes } from './lesson-blocks.ts';
import { LEVELS, PUBLIC_PACKS, SUBJECTS, SYLLABUS, TERM, type PublicPack, type SubjectCode } from './curriculum-data.ts';

const SUBJECT_BY_CODE = Object.fromEntries(SUBJECTS.map(s => [s.code, s])) as Record<SubjectCode, (typeof SUBJECTS)[number]>;

function meta(db: Db, key: string): string | undefined {
  return db.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key])?.value;
}
function setMeta(db: Db, key: string, value: string): void {
  db.run('INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
function tokenPool(subject: SubjectCode, level: string): string[] {
  return SYLLABUS[subject][level as keyof typeof SYLLABUS[SubjectCode]].flatMap(u => u.lessons.flatMap(([, focus]) => focus));
}

export type PackImportResult = {
  code: string; version: string; status: 'active' | 'quarantined' | 'skipped';
  lessons: number; name: string;
};

export function importPack(db: Db, pack: PublicPack, opts: { autoApprove?: boolean } = {}): PackImportResult {
  const existingPack = db.get<{ id: string }>('SELECT id FROM course_packs WHERE source_code = ? AND code = ? AND version = ?',
    [pack.sourceCode, pack.code, pack.version]);
  if (existingPack) {
    return { code: pack.code, version: pack.version, status: 'skipped', lessons: 0, name: pack.name };
  }
  const source = db.get<{ name: string; homepage: string; url: string }>('SELECT name, homepage, url FROM public_sources WHERE code = ?', [pack.sourceCode]);
  if (!source) throw new Error(`unknown public source: ${pack.sourceCode}`);
  const status = opts.autoApprove ? 'active' : 'quarantined';
  const frameworkId = `fw_${pack.subject}_${pack.classCode}`;
  let lessonsImported = 0;
  const checksumParts: unknown[] = [];
  const packId = `cpk_${pack.code}_${pack.version.replace(/[^0-9]/g, '')}`;

  db.tx(() => {
    db.run(
      `INSERT OR IGNORE INTO frameworks(id, subject_code, class_code, term, title, objectives, source_code, version, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [frameworkId, pack.subject, pack.classCode, TERM, `${SUBJECT_BY_CODE[pack.subject].name} · ${LEVELS.find(l => l.code === pack.classCode)!.name}体系`,
        JSON.stringify(pack.units.map(u => u.objective)), null, 1, nowIso()],
    );
    pack.units.forEach((unit, ui) => {
      const unitId = `unt_pack_${pack.code}_u${ui + 1}`;
      db.run(
        `INSERT INTO units(id, framework_id, code, title, seq, objective, source_code) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(framework_id, code) DO UPDATE SET title = excluded.title, objective = excluded.objective, source_code = excluded.source_code`,
        [unitId, frameworkId, `P_${pack.code}_U${ui + 1}`, unit.title, 90 + ui, unit.objective, pack.sourceCode],
      );
      unit.lessons.forEach(([title, focus], li) => {
        const lessonId = `lsn_pack_${pack.code}_u${ui + 1}_l${li + 1}`;
        const minutes = lessonMinutes(pack.subject, pack.classCode) + 5;
        const blocks = buildBlocks({
          subject: pack.subject, level: pack.classCode, title, focus: [...focus], objective: unit.objective,
          unitTitle: unit.title, index: 100 + ui * 10 + li, pool: tokenPool(pack.subject, pack.classCode),
          resource: { url: source.homepage || source.url, source: source.name, license: pack.license },
        });
        const blocksJson = JSON.stringify(blocks);
        const meta = { title, minutes, objective: `${pack.name}：${unit.objective}（${title}）`, tags: ['公开课程', pack.name, ...focus], sourceCode: pack.sourceCode };
        const checksum = sha256(blocksJson + JSON.stringify(meta));
        checksumParts.push({ lessonId, blocks: checksum, meta });
        const current = db.get<{ version: number; is_published: number }>('SELECT version, is_published FROM lessons WHERE id = ?', [lessonId]);
        if (status === 'active') {
          db.run(
            `INSERT INTO lessons(id, unit_id, code, title, seq, minutes, objective, blocks, tags, source_code, version, is_published)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(unit_id, code) DO UPDATE SET title = excluded.title, minutes = excluded.minutes,
               objective = excluded.objective, blocks = excluded.blocks, tags = excluded.tags,
               source_code = excluded.source_code, version = lessons.version + 1, is_published = 1`,
            [lessonId, unitId, `P${ui + 1}L${li + 1}`, title, li + 1, minutes, meta.objective,
              blocksJson, JSON.stringify(meta.tags), pack.sourceCode, 1, 1],
          );
        } else if (!current) {
          // 新课时先以未发布状态落地，旧课时保持在线，等管理员审批后原子切换
          db.run(
            `INSERT INTO lessons(id, unit_id, code, title, seq, minutes, objective, blocks, tags, source_code, version, is_published)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`,
            [lessonId, unitId, `P${ui + 1}L${li + 1}`, title, li + 1, minutes, meta.objective,
              blocksJson, JSON.stringify(meta.tags), pack.sourceCode, 1],
          );
        }
        const nextVersion = Number(current?.version || 0) + 1;
        db.run(
          `INSERT OR IGNORE INTO lesson_versions(id, lesson_id, pack_id, version, blocks, checksum, meta, created_at)
           VALUES(?,?,?,?,?,?,?,?)`,
          [newId(), lessonId, packId, nextVersion, blocksJson, checksum, JSON.stringify(meta), nowIso()],
        );
        lessonsImported += 1;
      });
    });
    const packChecksum = sha256(JSON.stringify({ code: pack.code, version: pack.version, lessons: checksumParts }));
    db.run(
      `INSERT INTO course_packs(id, source_code, code, name, subject_code, class_code, term, version, checksum, lessons_imported, imported_at, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [packId, pack.sourceCode, pack.code, pack.name, pack.subject, pack.classCode, TERM, pack.version,
        packChecksum, lessonsImported, nowIso(), status],
    );
    db.run('UPDATE public_sources SET last_synced_at = ?, version = ? WHERE code = ?', [nowIso(), pack.version, pack.sourceCode]);
    setMeta(db, `pack_${pack.code}_version`, pack.version);
  });

  return { code: pack.code, version: pack.version, status, lessons: lessonsImported, name: pack.name };
}

export function syncPublicCourses(db: Db, opts: { autoApprove?: boolean } = {}): PackImportResult[] {
  return PUBLIC_PACKS.map(pack => importPack(db, pack, opts));
}

export function approvePack(db: Db, packId: string): { pack: unknown; lessons: number } {
  const pack = db.get<{ id: string; code: string; status: string }>('SELECT id, code, status FROM course_packs WHERE id = ?', [packId]);
  if (!pack) throw new Error('course pack not found');
  const versions = db.all<{ lesson_id: string; version: number; blocks: string; meta: string }>(
    'SELECT lesson_id, version, blocks, meta FROM lesson_versions WHERE pack_id = ?', [packId],
  );
  db.tx(() => {
    if (versions.length) {
      // 同一个课程包的旧课时先下线，再一次性应用待审版本，避免审核期间无课可学
      db.run(
        `UPDATE lessons SET is_published = 0 WHERE source_code IS NOT NULL AND id IN (
           SELECT l.id FROM lessons l JOIN units un ON un.id = l.unit_id WHERE un.code LIKE ?)`,
        [`P_${pack.code}_U%`],
      );
      for (const version of versions) {
        const meta = JSON.parse(version.meta) as { title: string; minutes: number; objective: string; tags: string[] };
        db.run(
          `UPDATE lessons SET title = ?, minutes = ?, objective = ?, blocks = ?, tags = ?, version = ?, is_published = 1 WHERE id = ?`,
          [meta.title, meta.minutes, meta.objective, version.blocks, JSON.stringify(meta.tags || []), version.version, version.lesson_id],
        );
      }
    } else {
      const lessonIds = db.all<{ id: string }>(
        `SELECT l.id FROM lessons l JOIN units un ON un.id = l.unit_id
         WHERE un.code LIKE ? AND l.source_code IS NOT NULL`, [`P_${pack.code}_U%`],
      );
      for (const lesson of lessonIds) db.run('UPDATE lessons SET is_published = 1 WHERE id = ?', [lesson.id]);
    }
    db.run("UPDATE course_packs SET status = 'active' WHERE id = ?", [packId]);
  });
  return { pack, lessons: versions.length };
}
