import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import type { MediaInfo, Preferences, StoredTask } from '../../../shared/src/contracts.js';
import { businessMessage, BusinessError } from '../../../shared/src/messages.js';
import { normalizePreferences } from '../../../shared/src/preferences.js';
import { readLegacyVault } from './legacy-vault.js';
import { duplicateKey, progressValues, readTask, TASK_COLUMNS, taskValues } from './task-record.js';

export const DATA_DIRECTORY = Symbol('STREAMNEST_DATA_DIRECTORY');
const ACTIVE = "('queued', 'downloading', 'processing', 'paused')";
const PROGRESS_SET = `state=?, updated_at=?, progress=?, downloaded_bytes=?, total_bytes=?,
  speed=?, eta=?, code=?, params=?, message=?, downloader=?`;

export interface TaskQuery {
  scope?: string;
  query?: string;
  offset?: number;
  limit?: number;
  archived?: boolean;
}

@Injectable()
export class VaultStore {
  private database?: DatabaseSync;
  private statements = new Map<string, StatementSync>();

  constructor(@Inject(DATA_DIRECTORY) readonly directory: string) {}

  private get db(): DatabaseSync {
    if (!this.database) throw new Error('SQLite store is not open.');
    return this.database;
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private transaction<T>(operation: () => T, mode = 'IMMEDIATE'): T {
    this.db.exec(`BEGIN ${mode}`);
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async initialize(defaults: Preferences): Promise<void> {
    if (this.database) return;
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'vault.sqlite');
    const file = await open(path, 'a', 0o600);
    await file.close();
    this.database = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=5000');
      const deadline = Date.now() + 5_000;
      while (true) {
        try {
          this.db.exec('PRAGMA journal_mode=WAL');
          break;
        } catch (error) {
          // Concurrent journal-mode changes can return SQLITE_BUSY without using busy_timeout.
          if ((error as { errcode?: number })?.errcode !== 5 || Date.now() >= deadline) throw error;

          await delay(50);
        }
      }
      this.db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1) throw new BusinessError('VAULT_INVALID');
      this.transaction(() =>
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS media (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS tasks (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL, state TEXT NOT NULL, archived INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, progress REAL NOT NULL,
          downloaded_bytes REAL NOT NULL, total_bytes REAL NOT NULL, speed REAL NOT NULL, eta REAL NOT NULL,
          code TEXT NOT NULL, params TEXT NOT NULL, message TEXT NOT NULL, downloader TEXT,
          search_text TEXT NOT NULL, duplicate_key TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS tasks_archive_order ON tasks(archived, created_at DESC, seq DESC);
        CREATE INDEX IF NOT EXISTS tasks_archive_state_order ON tasks(archived, state, created_at DESC, seq DESC);
        CREATE INDEX IF NOT EXISTS tasks_queue_order ON tasks(state, created_at, seq);
        CREATE INDEX IF NOT EXISTS tasks_duplicate ON tasks(duplicate_key, state);
        CREATE TABLE IF NOT EXISTS record_backups (id TEXT PRIMARY KEY, created_at TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS record_backup_tasks (
          backup_id TEXT NOT NULL REFERENCES record_backups(id), task_id TEXT NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY(backup_id, task_id)
        ) STRICT;
        PRAGMA user_version=1;
      `),
      );
      if (this.statement("SELECT value FROM metadata WHERE key='initialized'").get()) return;

      const legacy = await readLegacyVault(this.directory);
      this.transaction(() => {
        // Another connection may have imported while the backup was being written.
        if (this.statement("SELECT value FROM metadata WHERE key='initialized'").get()) return;
        this.setPreferences(normalizePreferences(legacy?.state.preferences ?? defaults));
        for (const media of [...(legacy?.state.media ?? [])].reverse()) this.insertMedia(media);
        for (const task of [...(legacy?.state.tasks ?? [])].reverse()) this.insert(task);
        if (legacy) {
          this.statement('INSERT INTO metadata(key,value) VALUES (?,?)').run(
            'legacy_backup',
            legacy.backup,
          );
          this.statement('INSERT INTO metadata(key,value) VALUES (?,?)').run(
            'legacy_sha256',
            legacy.digest,
          );
        }
        this.statement('INSERT INTO metadata(key,value) VALUES (?,?)').run(
          'initialized',
          new Date().toISOString(),
        );
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  preferences(): Preferences {
    const row = this.statement('SELECT data FROM preferences WHERE id=1').get();
    if (!row) throw new BusinessError('VAULT_INVALID');
    return normalizePreferences(JSON.parse(String(row.data)) as Preferences);
  }

  setPreferences(value: Preferences): void {
    this.statement(
      'INSERT INTO preferences(id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    ).run(JSON.stringify(value));
  }

  private insertMedia(media: MediaInfo): void {
    this.statement(
      'INSERT INTO media(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    ).run(media.id, JSON.stringify(media));
  }

  saveMedia(media: MediaInfo): void {
    this.transaction(() => {
      this.statement('DELETE FROM media WHERE id=?').run(media.id);
      this.insertMedia(media);
      this.db.exec(
        'DELETE FROM media WHERE seq NOT IN (SELECT seq FROM media ORDER BY seq DESC LIMIT 50)',
      );
    });
  }

  media(id: string): MediaInfo | undefined {
    const row = this.statement('SELECT data FROM media WHERE id=?').get(id);
    return row ? (JSON.parse(String(row.data)) as MediaInfo) : undefined;
  }

  private insert(task: StoredTask): void {
    this.statement(
      `INSERT INTO tasks(id,${TASK_COLUMNS.join(',')}) VALUES (${Array(TASK_COLUMNS.length + 1)
        .fill('?')
        .join(',')})`,
    ).run(task.id, ...taskValues(task));
  }

  insertTask(task: StoredTask): void {
    this.transaction(() => {
      if (this.count() >= 5000) throw new BadRequestException(businessMessage('TASK_LIMIT'));
      if (
        this.statement(
          `SELECT 1 FROM tasks WHERE duplicate_key=? AND state IN ${ACTIVE} LIMIT 1`,
        ).get(duplicateKey(task))
      )
        throw new BadRequestException(businessMessage('TASK_DUPLICATE'));
      this.insert(task);
    });
  }

  saveTask(task: StoredTask): void {
    const result = this.statement(
      `UPDATE tasks SET ${TASK_COLUMNS.map((column) => `${column}=?`).join(',')} WHERE id=?`,
    ).run(...taskValues(task), task.id);
    if (!result.changes) throw new BusinessError('TASK_NOT_FOUND');
  }

  saveProgress(tasks: readonly StoredTask[]): void {
    if (!tasks.length) return;
    this.transaction(() => {
      const statement = this.statement(
        `UPDATE tasks SET ${PROGRESS_SET} WHERE id=? AND state IN ('downloading','processing')`,
      );
      for (const task of tasks) statement.run(...progressValues(task), task.id);
    });
  }

  pauseInterrupted(): void {
    const info = businessMessage('TASK_INTERRUPTED');
    this.statement(
      `UPDATE tasks SET state='paused', speed=0, eta=0, code=?, params=?, message=?
      WHERE state IN ('queued','downloading','processing')`,
    ).run(info.code, JSON.stringify(info.params), info.message);
  }

  task(id: string): StoredTask | undefined {
    const row = this.statement('SELECT * FROM tasks WHERE id=?').get(id);
    return row ? readTask(row) : undefined;
  }

  list(options: TaskQuery) {
    const where = ['1=1'];
    const parameters: SQLInputValue[] = [];
    if (
      (options.scope !== 'library' && options.scope !== 'queue') ||
      options.archived !== undefined
    ) {
      where.push('archived=?');
      parameters.push(Number(options.archived ?? false));
    }
    if (options.scope === 'library') where.push("state='completed'");
    else if (options.scope === 'queue') where.push("state<>'completed'");
    if (options.query?.trim()) {
      where.push('instr(search_text,?)>0');
      parameters.push(options.query.trim().toLowerCase());
    }
    const predicate = where.join(' AND ');
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 25;
    return this.transaction(() => {
      const total = Number(
        this.statement(`SELECT count(*) AS total FROM tasks WHERE ${predicate}`).get(...parameters)
          ?.total,
      );
      const items = this.statement(
        `SELECT * FROM tasks WHERE ${predicate} ORDER BY created_at DESC,seq DESC LIMIT ? OFFSET ?`,
      )
        .all(...parameters, limit, offset)
        .map(readTask);
      return {
        items,
        total,
        offset,
        nextOffset: offset + items.length < total ? offset + items.length : null,
      };
    }, 'DEFERRED');
  }

  claimQueued(): StoredTask | undefined {
    return this.transaction(() => {
      const row = this.statement(
        "SELECT * FROM tasks WHERE state='queued' ORDER BY created_at,seq LIMIT 1",
      ).get();
      if (!row) return undefined;
      const task = readTask(row);
      task.state = 'downloading';
      Object.assign(task, businessMessage('TASK_DOWNLOADING'));
      this.saveTask(task);
      return task;
    });
  }

  private count(): number {
    return Number(this.statement('SELECT count(*) AS total FROM tasks').get()?.total);
  }

  endedIds(scope: 'library' | 'ended'): string[] {
    const predicate =
      scope === 'library' ? "state='completed'" : "state IN ('completed','failed','cancelled')";
    return this.statement(`SELECT id FROM tasks WHERE ${predicate}`)
      .all()
      .map((row) => String(row.id));
  }

  tasksForSync(): StoredTask[] {
    return this.statement('SELECT * FROM tasks ORDER BY seq').all().map(readTask);
  }

  syncTasks(
    removed: readonly string[],
    imported: readonly StoredTask[],
    updated: readonly StoredTask[],
  ) {
    return this.transaction(() => {
      const backup = removed.length ? this.backupAndRemove(removed) : undefined;
      if (this.count() + imported.length > 5000)
        throw new BadRequestException(businessMessage('TASK_LIMIT'));

      for (const task of updated) this.saveTask(task);
      for (const task of imported) this.insert(task);
      return backup?.backupId;
    });
  }

  removeTasks(ids: readonly string[]): { count: number; backupId: string } {
    return this.transaction(() => this.backupAndRemove(ids));
  }

  private backupAndRemove(ids: readonly string[]): { count: number; backupId: string } {
    const backupId = randomUUID();
    this.statement('INSERT INTO record_backups(id,created_at) VALUES (?,?)').run(
      backupId,
      new Date().toISOString(),
    );
    let count = 0;
    for (const id of ids) {
      const task = this.task(id);
      if (!task) continue;
      this.statement('INSERT INTO record_backup_tasks(backup_id,task_id,data) VALUES (?,?,?)').run(
        backupId,
        id,
        JSON.stringify(task),
      );
      count += Number(this.statement('DELETE FROM tasks WHERE id=?').run(id).changes);
    }
    return { count, backupId };
  }

  async restoreHistory(id: string): Promise<{ count: number; backupId: string }> {
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id)) throw new BusinessError('BACKUP_ID_INVALID');
    let tasks: StoredTask[];
    if (this.statement('SELECT 1 FROM record_backups WHERE id=?').get(id)) {
      tasks = this.statement('SELECT data FROM record_backup_tasks WHERE backup_id=?')
        .all(id)
        .map((row) => JSON.parse(String(row.data)) as StoredTask);
    } else {
      const value = JSON.parse(
        await readFile(join(this.directory, 'record-backups', `${id}.json`), 'utf8'),
      ) as { version: number; tasks: StoredTask[] };
      if (value.version !== 1 || !Array.isArray(value.tasks))
        throw new BusinessError('BACKUP_INVALID');
      tasks = value.tasks;
    }
    if (
      tasks.some(
        (task) =>
          !task.id ||
          !task.media ||
          !task.request ||
          !['completed', 'failed', 'cancelled'].includes(task.state),
      )
    )
      throw new BusinessError('BACKUP_INVALID');
    return this.transaction(() => {
      const restored = tasks.filter((task) => !this.task(task.id));
      if (this.count() + restored.length > 5000)
        throw new BadRequestException(businessMessage('TASK_RESTORE_LIMIT'));
      for (const task of restored) this.insert(task);
      return { count: restored.length, backupId: id };
    });
  }

  close(): void {
    this.statements.clear();
    this.database?.close();
    this.database = undefined;
  }
}
