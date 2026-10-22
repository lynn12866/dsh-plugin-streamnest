import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { StoredTask, TaskState } from '../../shared/src/contracts.js';
import { taskMessage } from '../../shared/src/task-messages.js';
import { MediaService } from '../src/media/media.service.js';
import type { MediaEngine } from '../src/media/media.engine.js';
import { promises as fs } from 'node:fs';
import { VaultStore } from '../src/storage/vault.store.js';

const fixtures: { directory: string; service: MediaService }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { directory, service } of fixtures.splice(0)) {
    await service.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-delete-'));
  const nativeUnlink = fs.unlink;
  const remove = vi.spyOn(fs, 'unlink').mockImplementation(nativeUnlink);
  const store = new VaultStore(directory);
  const service = new MediaService(store, {} as MediaEngine);
  await service.initialize();
  fixtures.push({ directory, service });
  const root = service.preferences().downloadDirectory;
  await mkdir(root);
  async function record(names: string[], state: TaskState = 'completed') {
    const id = randomUUID();
    const outputDirectory = join(root, id);
    await mkdir(outputDirectory);
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
      artifacts: names.map((name) => ({ name, bytes: 3 })),
      ...taskMessage(state),
      media: {
        id,
        url: `https://example.com/${id}`,
        title: names[0] ?? id,
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
  return { directory, root, service, store, remove, record };
}

describe('completed downloads permanent deletion', () => {
  it('deletes only registered files, removes successful/missing records, and keeps partial failures', async () => {
    const { service, store, record, remove } = await fixture();
    const first = await record(['video [literal]*.mp4', 'captions.srt']);
    const missing = await record(['already-gone.mp4']);
    const failed = await record(['locked.mp4']);
    const untouched = await record(['keep.mp4']);
    for (const task of [first, failed, untouched]) {
      for (const file of task.artifacts)
        await writeFile(join(task.outputDirectory, file.name), 'bytes');
    }
    await writeFile(join(first.outputDirectory, 'unregistered.mp4'), 'unregistered');
    const actualDelete = remove.getMockImplementation()!;
    remove.mockImplementation(async (path) => {
      if (basename(path) === 'locked.mp4') throw new Error('fixture permission denied');
      await actualDelete(path);
    });
    const result = await service.deleteDownloads({
      taskIds: [first.id, missing.id, failed.id],
      confirmDelete: true,
    });
    expect(result).toMatchObject({
      requested: 3,
      deletedFiles: 2,
      missingFiles: 1,
      removedRecords: 2,
      removedTaskIds: [first.id, missing.id],
      cancelled: false,
      failures: [{ taskId: failed.id, code: 'DELETE_FAILED' }],
    });
    expect(store.task(first.id)).toBeUndefined();
    expect(store.task(missing.id)).toBeUndefined();
    expect(service.get(failed.id).artifacts[0]?.exists).toBe(true);
    expect(await readFile(join(first.outputDirectory, 'unregistered.mp4'), 'utf8')).toBe(
      'unregistered',
    );
    expect(await readFile(join(untouched.outputDirectory, 'keep.mp4'), 'utf8')).toBe('bytes');
    expect((await stat(first.outputDirectory)).isDirectory()).toBe(true);
    expect(await service.restoreHistory(result.backupId!)).toMatchObject({ count: 2 });
    expect(service.get(first.id).artifacts.every((file) => file.exists === false)).toBe(true);
  });

  it('rejects missing confirmation or unfinished tasks before deleting any file', async () => {
    const { service, record, remove } = await fixture();
    const completed = await record(['video.mp4']);
    const paused = await record(['paused.mp4'], 'paused');
    await expect(
      service.deleteDownloads({ taskIds: [completed.id], confirmDelete: false }),
    ).rejects.toMatchObject({ code: 'DELETE_CONFIRM_REQUIRED' });
    await expect(
      service.deleteDownloads({ taskIds: [completed.id, paused.id], confirmDelete: true }),
    ).rejects.toMatchObject({ code: 'DELETE_COMPLETED_ONLY' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses traversal, symlinks, directories and files referenced by unselected records', async () => {
    const { directory, service, store, record, remove } = await fixture();
    const outside = join(directory, 'outside.mp4');
    await writeFile(outside, 'outside');
    const escaped = await record(['../../outside.mp4']);
    const linked = await record(['link.mp4']);
    await symlink(outside, join(linked.outputDirectory, 'link.mp4'));
    const folder = await record(['folder.mp4']);
    await mkdir(join(folder.outputDirectory, 'folder.mp4'));
    const shared = await record(['shared.mp4']);
    await writeFile(join(shared.outputDirectory, 'shared.mp4'), 'shared');
    const other = await record(['shared.mp4']);
    other.outputDirectory = shared.outputDirectory;
    store.saveTask(other);
    const result = await service.deleteDownloads({
      taskIds: [escaped.id, linked.id, folder.id, shared.id],
      confirmDelete: true,
    });
    expect(result.removedRecords).toBe(0);
    expect(result.failures.map((item) => item.code)).toEqual([
      'DELETE_PATH_UNSAFE',
      'DELETE_PATH_UNSAFE',
      'DELETE_PATH_UNSAFE',
      'DELETE_FILE_SHARED',
    ]);
    expect(remove).not.toHaveBeenCalled();
    expect(await readFile(outside, 'utf8')).toBe('outside');
    const both = await service.deleteDownloads({
      taskIds: [shared.id, other.id],
      confirmDelete: true,
    });
    expect(both).toMatchObject({ deletedFiles: 1, removedRecords: 2, failures: [] });
  });

  it('finishes reconciling a settled OS remove when cancellation arrives and leaves later files alone', async () => {
    const { service, record, remove } = await fixture();
    const first = await record(['first.mp4']);
    const second = await record(['second.mp4']);
    await writeFile(join(first.outputDirectory, 'first.mp4'), 'first');
    await writeFile(join(second.outputDirectory, 'second.mp4'), 'second');
    const controller = new AbortController();
    const actualDelete = remove.getMockImplementation()!;
    remove.mockImplementation(async (path) => {
      await actualDelete(path);
      controller.abort(new Error('fixture cancelled'));
      throw controller.signal.reason;
    });
    const result = await service.deleteDownloads(
      { taskIds: [first.id, second.id], confirmDelete: true },
      controller.signal,
    );
    expect(result).toMatchObject({
      deletedFiles: 1,
      removedRecords: 1,
      removedTaskIds: [first.id],
      cancelled: true,
    });
    expect(service.get(second.id).artifacts[0]?.exists).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports a SQL failure after deleting files and permits retry to clean the missing record', async () => {
    const { directory, service, store, record } = await fixture();
    const first = await record(['video.mp4']);
    await writeFile(join(first.outputDirectory, 'video.mp4'), 'video');
    const db = new DatabaseSync(join(directory, 'vault.sqlite'));
    try {
      db.exec(
        "CREATE TRIGGER reject_delete_files BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'fixture SQL failure'); END",
      );
      await expect(
        service.deleteDownloads({ taskIds: [first.id], confirmDelete: true }),
      ).rejects.toMatchObject({ code: 'DELETE_SYNC_FAILED', params: { deleted: 1 } });
      expect(store.task(first.id)).toBeDefined();
      expect(service.get(first.id).artifacts[0]?.exists).toBe(false);
      db.exec('DROP TRIGGER reject_delete_files');
      expect(
        await service.deleteDownloads({ taskIds: [first.id], confirmDelete: true }),
      ).toMatchObject({ deletedFiles: 0, missingFiles: 1, removedRecords: 1 });
    } finally {
      db.close();
    }
  });
});
