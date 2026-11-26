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
  const existing = db.get<{ id: string }>('SELECT id FROM course_packs WHERE source_code = ? AND code = ? AND version = ?',
    [pack.sourceCode, pack.code, pack.version]);
  if (existing) {
    return { code: pack.code, version: pack.version, status: 'skipped', lessons: 0, name: pack.name };
  }
  const source = db.get<{ name: string; homepage: string; url: string }>('SELECT name, homepage, url FROM public_sources WHERE code = ?', [pack.sourceCode]);
  if (!source) throw new Error(`unknown public source: ${pack.sourceCode}`);
  const status = opts.autoApprove ? 'active' : 'quarantined';
  const frameworkId = `fw_${pack.subject}_${pack.classCode}`;
  let lessonsImported = 0;

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
        const blocks = buildBlocks({
          subject: pack.subject, level: pack.classCode, title, focus: [...focus], objective: unit.objective,
          unitTitle: unit.title, index: 100 + ui * 10 + li, pool: tokenPool(pack.subject, pack.classCode),
          resource: { url: source.homepage || source.url, source: source.name, license: pack.license },
        });
        db.run(
          `INSERT INTO lessons(id, unit_id, code, title, seq, minutes, objective, blocks, tags, source_code, version, is_published)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(unit_id, code) DO UPDATE SET title = excluded.title, minutes = excluded.minutes,
             objective = excluded.objective, blocks = excluded.blocks, tags = excluded.tags,
             source_code = excluded.source_code, version = lessons.version + 1, is_published = excluded.is_published`,
          [
            lessonId, unitId, `P${ui + 1}L${li + 1}`, title, li + 1,
            lessonMinutes(pack.subject, pack.classCode) + 5, `${pack.name}：${unit.objective}（${title}）`,
            JSON.stringify(blocks), JSON.stringify(['公开课程', pack.name, ...focus]), pack.sourceCode,
            1, status === 'active' ? 1 : 0,
          ],
        );
        lessonsImported += 1;
      });
    });
    db.run(
      `INSERT INTO course_packs(id, source_code, code, name, subject_code, class_code, term, version, checksum, lessons_imported, imported_at, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`cpk_${pack.code}_${pack.version.replace(/[^0-9]/g, '')}`, pack.sourceCode, pack.code, pack.name, pack.subject,
        pack.classCode, TERM, pack.version, `v${pack.version}-${lessonsImported}`, lessonsImported, nowIso(), status],
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
  const lessonIds = db.all<{ id: string }>(
    `SELECT l.id FROM lessons l JOIN units un ON un.id = l.unit_id
     WHERE un.code LIKE ? AND l.source_code IS NOT NULL`,
    [`P_${pack.code}_U%`],
  );
  db.tx(() => {
    db.run("UPDATE course_packs SET status = 'active' WHERE id = ?", [packId]);
    for (const lesson of lessonIds) db.run('UPDATE lessons SET is_published = 1 WHERE id = ?', [lesson.id]);
  });
  return { pack, lessons: lessonIds.length };
}

