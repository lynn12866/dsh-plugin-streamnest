import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { StoredTask, TaskState } from '../../shared/src/contracts.js';
import { taskMessage } from '../../shared/src/task-messages.js';
import { MediaService } from '../src/media/media.service.js';
import type { MediaEngine } from '../src/media/media.engine.js';
import { VaultStore } from '../src/storage/vault.store.js';

const fixtures: { directory: string; service: MediaService }[] = [];
afterEach(async () => {
  for (const { directory, service } of fixtures.splice(0)) {
    await service.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-sync-'));
  const store = new VaultStore(directory);
  const service = new MediaService(store, {} as MediaEngine);
  await service.initialize();
  fixtures.push({ directory, service });
  const root = service.preferences().downloadDirectory;
  await mkdir(root);
  async function record(name: string, state: TaskState = 'completed', outputRoot = root) {
    const id = randomUUID();
    const outputDirectory = join(outputRoot, id);
    await mkdir(outputDirectory, { recursive: true });
    const now = new Date().toISOString();
    const task: StoredTask = {
      id,
      state,
      archived: false,
      progress: 100,
      speed: 0,
      eta: 0,
      downloadedBytes: 3,
      totalBytes: 3,
      createdAt: now,
      updatedAt: now,
      preferences: service.preferences(),
      outputDirectory,
      request: { mediaId: id, mode: 'video' },
      artifacts: [{ name, bytes: 3 }],
      ...taskMessage(state),
      media: {
        id,
        url: `https://example.com/${id}`,
        title: name,
        uploader: '',
        platform: 'fixture',
        duration: 1,
        thumbnail: '',
        formats: [],
        audioTracks: [],
        subtitles: [],
        parsedAt: now,
      },
    };
    store.insertTask(task);
    return task;
  }
  return { directory, store, service, root, record };
}

describe('download directory synchronization', () => {
  it('creates the unused default directory when synchronizing before the first download', async () => {
    const { service, root } = await fixture();
    await rm(root, { recursive: true });

    expect(await service.syncDirectory()).toMatchObject({
      directory: root,
      imported: 0,
      removed: 0,
      updated: 0,
      scanned: 0,
    });
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it('prepares a new download directory without changing records from another directory', async () => {
    const { service, store, root, record } = await fixture();
    const previous = await record('previous.mp4');
    await writeFile(join(previous.outputDirectory, 'previous.mp4'), 'existing video bytes');
    const selected = join(root, 'new-downloads');
    await service.updatePreferences({ downloadDirectory: selected });

    expect(await service.syncDirectory()).toMatchObject({
      directory: selected,
      imported: 0,
      removed: 0,
      updated: 0,
    });
    expect((await stat(selected)).isDirectory()).toBe(true);
    expect(store.task(previous.id)).toEqual(previous);
  });

  it('imports real media, removes missing records with backup, updates sizes and skips unfinished or unsafe paths', async () => {
    const { directory, store, service, root, record } = await fixture();
    const kept = await record('kept.mp4');
    await writeFile(join(kept.outputDirectory, 'kept.mp4'), 'existing video bytes');
    const missing = await record('deleted.mp4');
    await writeFile(join(missing.outputDirectory, 'captions.srt'), 'retained subtitles');
    const paused = await record('unfinished.mp4', 'paused');
    await writeFile(join(paused.outputDirectory, 'unfinished.mp4'), 'partial track');
    const outside = await record('offline.mp4', 'completed', join(directory, 'previous-folder'));
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'new.MP4'), 'new video');
    await writeFile(join(root, 'sound.mp3'), 'new audio');
    await writeFile(join(root, 'file.mp4.part'), 'incomplete');
    await writeFile(join(root, 'file.temp.mp4'), 'temporary merge');
    await writeFile(join(root, 'zero.mp4'), '');
    await mkdir(join(root, '.native'));
    await writeFile(join(root, '.native', 'fragment.mp4'), 'fragment');
    await writeFile(join(directory, 'outside.mp4'), 'outside bytes');
    await symlink(join(directory, 'outside.mp4'), join(root, 'linked.mp4'));

    const result = await service.syncDirectory();
    expect(result).toMatchObject({ imported: 2, removed: 1, updated: 1 });
    expect(result.backupId).toBeTruthy();
    expect(store.task(missing.id)).toBeUndefined();
    expect(store.task(kept.id)?.artifacts[0]?.bytes).toBe(20);
    expect(store.task(paused.id)?.state).toBe('paused');
    expect(store.task(outside.id)?.id).toBe(outside.id);
    const added = service
      .list({ scope: 'library', limit: 100 })
      .items.filter((task) => task.media.platform === 'Local');
    expect(added.map((task) => task.request.mode).sort()).toEqual(['audio', 'video']);
    expect(added.every((task) => task.state === 'completed' && task.artifacts[0]?.exists)).toBe(
      true,
    );
    expect(await readFile(join(root, 'nested', 'new.MP4'), 'utf8')).toBe('new video');
    expect(await readFile(join(missing.outputDirectory, 'captions.srt'), 'utf8')).toBe(
      'retained subtitles',
    );
    expect(await service.syncDirectory()).toMatchObject({ imported: 0, removed: 0, updated: 0 });
    expect(await service.restoreHistory(result.backupId!)).toMatchObject({ count: 1 });
    expect(service.get(missing.id).artifacts[0]?.exists).toBe(false);
  });

  it('keeps all records when the configured root is unavailable and makes cancellation non-mutating', async () => {
    const { service, store, root, record } = await fixture();
    const missing = await record('missing.mp4');
    const controller = new AbortController();
    const operation = service.syncDirectory(controller.signal);
    queueMicrotask(() => controller.abort(new Error('fixture cancelled')));
    await expect(operation).rejects.toThrow('fixture cancelled');
    expect(store.task(missing.id)?.id).toBe(missing.id);
    await rm(root, { recursive: true });
    await expect(service.syncDirectory()).rejects.toMatchObject({ code: 'DIRECTORY_SYNC_FAILED' });
    expect(store.task(missing.id)?.id).toBe(missing.id);
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not replace a dangling directory alias with an empty directory', async () => {
    const { directory, service, root } = await fixture();
    const target = join(directory, 'unavailable-volume');
    await rm(root, { recursive: true });
    await symlink(target, root);

    await expect(service.syncDirectory()).rejects.toMatchObject({ code: 'DIRECTORY_SYNC_FAILED' });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back removals and their backup if importing a file fails', async () => {
    const { directory, service, store, root, record } = await fixture();
    const missing = await record('gone.mp4');
    await writeFile(join(root, 'new.mp4'), 'new bytes');
    const db = new DatabaseSync(join(directory, 'vault.sqlite'));
    try {
      db.exec(
        "CREATE TRIGGER reject_sync BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'injected sync failure'); END",
      );
      await expect(service.syncDirectory()).rejects.toThrow('injected sync failure');
      expect(store.task(missing.id)?.id).toBe(missing.id);
      expect(db.prepare('SELECT COUNT(*) AS count FROM record_backups').get()?.count).toBe(0);
      expect(await readFile(join(root, 'new.mp4'), 'utf8')).toBe('new bytes');
      db.exec('DROP TRIGGER reject_sync');
      expect(await service.syncDirectory()).toMatchObject({ imported: 1, removed: 1 });
    } finally {
      db.close();
    }
  });

  it('recognizes existing records through a configured folder alias without duplicate imports', async () => {
    const { directory, service, root, record } = await fixture();
    const kept = await record('kept.mp4');
    await writeFile(join(kept.outputDirectory, 'kept.mp4'), 'abc');
    const alias = join(directory, 'media-alias');
    await symlink(root, alias);
    await service.updatePreferences({ downloadDirectory: alias });
    expect(await service.syncDirectory()).toMatchObject({ imported: 0, removed: 0, updated: 0 });
  });
});
