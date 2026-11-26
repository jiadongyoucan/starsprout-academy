import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.ts';
import { log } from '../core/logger.ts';
import { migrations } from './migrations.ts';

type Param = string | number | null | Uint8Array;
type Row = Record<string, any>;

function normalize(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number') return Number.isFinite(p) ? p : null;
    if (typeof p === 'string') return p;
    if (p instanceof Uint8Array) return p;
    if (typeof p === 'bigint') return Number(p);
    return JSON.stringify(p);
  });
}

export class Db {
  private sqlite: DatabaseSync;
  private depth = 0;

  constructor(file: string = config.dbFile) {
    this.sqlite = new DatabaseSync(file);
    this.sqlite.exec('PRAGMA journal_mode = WAL;');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.sqlite.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    const current = Number((this.sqlite.prepare('PRAGMA user_version').get() as Row)?.user_version ?? 0);
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      log.info('db_migration', { version: migration.version });
      this.sqlite.exec('BEGIN');
      try {
        this.sqlite.exec(migration.sql);
        this.sqlite.exec(`PRAGMA user_version = ${migration.version}`);
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
    const result = this.sqlite.prepare(sql).run(...normalize(params));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
    return this.sqlite.prepare(sql).get(...normalize(params)) as T | undefined;
  }

  all<T = Row>(sql: string, params: unknown[] = []): T[] {
    return this.sqlite.prepare(sql).all(...normalize(params)) as T[];
  }

  exec(sql: string): void {
    this.sqlite.exec(sql);
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.sqlite.exec('BEGIN');
    this.depth = 1;
    try {
      const result = fn();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
