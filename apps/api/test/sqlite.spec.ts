import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { VaultStore } from '../src/storage/vault.store.js';
import { MediaService } from '../src/media/media.service.js';
import type { MediaEngine } from '../src/media/media.engine.js';
import type { StoredTask, Preferences, VaultState } from '../../shared/src/contracts.js';
import { businessMessage } from '../../shared/src/messages.js';

const directories: string[] = [];
const stores: VaultStore[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-sqlite-'));
  directories.push(directory);
  const preferences: Preferences = {
    downloadDirectory: join(directory, 'media'),
    concurrency: 2,
    fragments: 4,
    proxy: '',
    cookieBrowser: '',
    cookiesFile: '',
    binaryPaths: {},
  };
  const store = new VaultStore(directory);
  stores.push(store);
  return { directory, preferences, store };
}

function task(preferences: Preferences, index = 0): StoredTask {
  const id = randomUUID();
  return {
    id,
    media: {
      id: randomUUID(),
      url: `https://example.com/${index}`,
      title: `媒体 ${index}`,
      uploader: '',
      platform: 'fixture',
      duration: 60,
      thumbnail: '',
      formats: [],
      audioTracks: [],
      subtitles: [],
      parsedAt: '',
    },
    request: { mediaId: randomUUID(), mode: 'video' },
    preferences,
    state: 'completed',
    progress: 100,
    downloadedBytes: 50,
    totalBytes: 50,
    speed: 0,
    eta: 0,
    ...businessMessage('TASK_COMPLETED'),
    createdAt: new Date(1_700_000_000_000 + index).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + index).toISOString(),
    outputDirectory: join(preferences.downloadDirectory, id),
    artifacts: [],
    archived: false,
  };
}

function connection(directory: string) {
  const db = new DatabaseSync(join(directory, 'vault.sqlite'));
  databases.push(db);
  return db;
}

async function legacy(directory: string, state: VaultState) {
  const contents = JSON.stringify(state, null, 2) + '\n';
  await writeFile(join(directory, 'vault.json'), contents);
  return contents;
}

describe('SQLite migration and recovery', () => {
  it('imports once, keeps an exact backup, and pauses interrupted tasks without starting downloads', async () => {
    const { store, directory, preferences } = await fixture();
    const completed = task(preferences);
    completed.archived = true;
    const interrupted = task(preferences, 1);
    interrupted.state = 'downloading';
    Object.assign(interrupted, businessMessage('TASK_DOWNLOADING'));
    const contents = await legacy(directory, {
      version: 1,
      preferences,
      media: [completed.media],
      tasks: [interrupted, completed],
    });
    const service = new MediaService(store, {} as MediaEngine);
    await service.initialize();
    expect(service.get(interrupted.id)).toMatchObject({
      state: 'paused',
      code: 'TASK_INTERRUPTED',
    });
    expect(service.list({ archived: true }).items[0]?.id).toBe(completed.id);
    const backups = (await readdir(directory)).filter((name) => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(directory, backups[0]!), 'utf8')).toBe(contents);
    expect(await readFile(join(directory, 'vault.json'), 'utf8')).toBe(contents);
    expect((await stat(join(directory, 'vault.sqlite'))).mode & 0o777).toBe(0o600);
    await service.updatePreferences({ concurrency: 3 });
    await service.remove(completed.id);
    await service.onModuleDestroy();

    await writeFile(join(directory, 'vault.json'), 'old JSON is no longer authoritative');
    await store.initialize(preferences);
    expect(store.preferences().concurrency).toBe(3);
    expect(store.task(completed.id)).toBeUndefined();
    expect(store.task(interrupted.id)?.state).toBe('paused');
    expect((await readdir(directory)).filter((name) => name.endsWith('.bak'))).toEqual(backups);
    const db = connection(directory);
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
  });

  it('rejects corrupt JSON and rolls back an interrupted import before allowing retry', async () => {
    const { store, directory, preferences } = await fixture();
    await writeFile(join(directory, 'vault.json'), '{broken');
    await expect(store.initialize(preferences)).rejects.toMatchObject({ code: 'VAULT_INVALID' });
    expect(await readFile(join(directory, 'vault.json'), 'utf8')).toBe('{broken');
    const record = task(preferences);
    const contents = await legacy(directory, {
      version: 1,
      preferences,
      media: [],
      tasks: [record, record],
    });
    await expect(store.initialize(preferences)).rejects.toThrow();
    const db = connection(directory);
    expect(db.prepare('SELECT count(*) AS count FROM tasks').get()?.count).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM preferences').get()?.count).toBe(0);
    expect(db.prepare("SELECT 1 FROM metadata WHERE key='initialized'").get()).toBeUndefined();
    const backups = (await readdir(directory)).filter((name) => name.endsWith('.bak'));
    expect(await readFile(join(directory, backups[0]!), 'utf8')).toBe(contents);
    await legacy(directory, { version: 1, preferences, media: [], tasks: [record] });
    await store.initialize(preferences);
    expect(store.task(record.id)?.state).toBe('completed');
  });

  it('backs up removal in the same transaction and restores both SQL and legacy backups idempotently', async () => {
    const { store, directory, preferences } = await fixture();
    await store.initialize(preferences);
    const record = task(preferences);
    store.insertTask(record);
    const db = connection(directory);
    db.exec(
      "CREATE TRIGGER reject_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'injected failure'); END",
    );
    expect(() => store.removeTasks([record.id])).toThrow('injected failure');
    expect(store.task(record.id)).toBeDefined();
    expect(db.prepare('SELECT count(*) AS count FROM record_backups').get()?.count).toBe(0);
    db.exec('DROP TRIGGER reject_delete');
    const removed = store.removeTasks([record.id]);
    expect(removed.count).toBe(1);
    expect(store.task(record.id)).toBeUndefined();
    expect((await store.restoreHistory(removed.backupId)).count).toBe(1);
    expect((await store.restoreHistory(removed.backupId)).count).toBe(0);
    expect(store.task(record.id)?.outputDirectory).toBe(record.outputDirectory);
    store.removeTasks([record.id]);
    const backupId = randomUUID();
    await mkdir(join(directory, 'record-backups'));
    await writeFile(
      join(directory, 'record-backups', `${backupId}.json`),
      JSON.stringify({ version: 1, tasks: [record] }),
    );
    expect((await store.restoreHistory(backupId)).count).toBe(1);
    expect(store.task(record.id)?.id).toBe(record.id);
  });
});

describe('incremental writes and SQL queries', () => {
  it('keeps previously archived failed and cancelled tasks visible in the simplified queue', async () => {
    const { store, preferences } = await fixture();
    await store.initialize(preferences);
    const failed = { ...task(preferences, 1), state: 'failed', archived: true } as StoredTask;
    const cancelled = { ...task(preferences, 2), state: 'cancelled', archived: true } as StoredTask;
    const paused = { ...task(preferences, 3), state: 'paused' } as StoredTask;
    for (const record of [failed, cancelled, paused, task(preferences, 4)])
      store.insertTask(record);

    const queue = store.list({ scope: 'queue', limit: 2 });
    expect(queue.total).toBe(3);
    expect(queue.items.map((item) => item.id)).toEqual([paused.id, cancelled.id]);
    expect(queue.nextOffset).toBe(2);
    expect(store.list({ scope: 'queue', offset: 2 }).items[0]?.id).toBe(failed.id);
    expect(store.list({ scope: 'queue', archived: false }).items.map((item) => item.id)).toEqual([
      paused.id,
    ]);
    expect(store.list({ scope: 'queue', query: failed.media.title }).items[0]?.id).toBe(failed.id);
  });

  it('paginates and searches large history with stable ordering and literal special characters', async () => {
    const { store, directory, preferences } = await fixture();
    const records = Array.from({ length: 1200 }, (_, index) => task(preferences, index));
    records[40]!.media.title = "百分比 % 下划线 _ 引号 ' 中文 É";
    records[41]!.archived = true;
    records[42]!.state = 'failed';
    await legacy(directory, { version: 1, preferences, media: [], tasks: records.reverse() });
    await store.initialize(preferences);
    const first = store.list({ limit: 100 });
    const next = store.list({ limit: 100, offset: first.nextOffset! });
    expect(first.total).toBe(1199);
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(200);
    expect(first.items[0]!.createdAt > first.items[99]!.createdAt).toBe(true);
    expect(store.list({ query: "_ 引号 ' 中文 é" }).total).toBe(1);
    const completedSearch = store.list({ scope: 'library', query: "_ 引号 ' 中文 é", limit: 1 });
    expect(completedSearch.items[0]?.media.title).toBe("百分比 % 下划线 _ 引号 ' 中文 É");
    expect(completedSearch.total).toBe(1);
    expect(completedSearch.nextOffset).toBeNull();
    expect(store.list({ query: "' OR 1=1 --" }).total).toBe(0);
    expect(store.list({ archived: true }).total).toBe(1);
    expect(store.list({ scope: 'queue' }).total).toBe(1);
    expect(store.list({ scope: 'library' }).total).toBe(1199);
    expect(store.list({ scope: 'library', archived: false }).total).toBe(1198);
    const completedLastPage = store.list({ scope: 'library', limit: 100, offset: 1100 });
    expect(completedLastPage.items).toHaveLength(99);
    expect(completedLastPage.items.some((item) => item.archived)).toBe(true);
    expect(completedLastPage.items.every((item) => item.state === 'completed')).toBe(true);
    expect(completedLastPage.nextOffset).toBeNull();
    expect(store.list({ offset: 1300 }).items).toEqual([]);
    expect(store.list({ offset: 1300 }).nextOffset).toBeNull();
  });

  it('writes only dirty progress rows, rolls back a failed batch, and cannot resurrect removed or ended tasks', async () => {
    const { store, directory, preferences } = await fixture();
    await store.initialize(preferences);
    const first = task(preferences, 1);
    const second = task(preferences, 2);
    for (const record of [first, second]) {
      record.state = 'queued';
      store.insertTask(record);
    }
    const a = store.claimQueued()!;
    const b = store.claimQueued()!;
    const db = connection(directory);
    db.exec(`CREATE TABLE payload_writes(id TEXT);
      CREATE TRIGGER track_payload AFTER UPDATE OF payload ON tasks BEGIN INSERT INTO payload_writes VALUES(NEW.id); END;`);
    a.progress = 25;
    b.progress = 50;
    store.saveProgress([a, b]);
    expect(store.task(a.id)?.progress).toBe(25);
    expect(store.task(b.id)?.progress).toBe(50);
    expect(db.prepare('SELECT count(*) AS count FROM payload_writes').get()?.count).toBe(0);
    db.exec(
      `CREATE TRIGGER reject_progress BEFORE UPDATE ON tasks WHEN NEW.id='${b.id}' BEGIN SELECT RAISE(ABORT,'injected failure'); END;`,
    );
    a.progress = 30;
    b.progress = 60;
    expect(() => store.saveProgress([a, b])).toThrow('injected failure');
    expect(store.task(a.id)?.progress).toBe(25);
    db.exec('DROP TRIGGER reject_progress');
    const completed = structuredClone(a);
    completed.state = 'completed';
    store.saveTask(completed);
    store.removeTasks([b.id]);
    store.saveProgress([a, b]);
    expect(store.task(a.id)?.state).toBe('completed');
    expect(store.task(b.id)).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS count FROM payload_writes').get()?.count).toBe(1);
  });

  it('imports once and preserves independent task writes from two actual processes', async () => {
    const { directory, preferences } = await fixture();
    const original = task(preferences);
    const contents = await legacy(directory, {
      version: 1,
      preferences,
      media: [],
      tasks: [original],
    });
    const source = `
      import 'reflect-metadata';
      import { randomUUID } from 'node:crypto';
      const { VaultStore } = await import(process.argv[1]);
      const store = new VaultStore(process.argv[2]);
      const template = JSON.parse(process.argv[4]);
      await store.initialize(template.preferences);
      for (let index=0; index<30; index++) {
        const record=structuredClone(template);
        record.id=randomUUID(); record.media.url+='/' + process.argv[3] + '/' + index;
        store.insertTask(record);
      }
      store.close();
    `;
    const url = pathToFileURL(resolve('lib/apps/api/src/storage/vault.store.js')).href;
    await Promise.all(
      ['a', 'b'].map((prefix) =>
        promisify(execFile)(process.execPath, [
          '--input-type=module',
          '-e',
          source,
          url,
          directory,
          prefix,
          JSON.stringify(original),
        ]),
      ),
    );
    const reader = new VaultStore(directory);
    stores.push(reader);
    await reader.initialize(preferences);
    expect(reader.list({ limit: 100 }).total).toBe(61);
    const backups = (await readdir(directory)).filter((name) => name.endsWith('.bak'));
    expect(backups.length).toBeGreaterThan(0);
    for (const backup of backups)
      expect(await readFile(join(directory, backup), 'utf8')).toBe(contents);
    expect(connection(directory).prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
  });
});
