import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';

// Use tsc output to exercise the real Nest decorator metadata, not a Vite substitute.
const { createApplication } = await import('../../../lib/apps/api/src/create-application.js');
const apps: INestApplication[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-http-'));
  const { app } = await createApplication(directory, true);
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return (await app.getUrl()) + '/streamnest/api';
}

describe('real Nest HTTP boundary', () => {
  it('validates single/batch deletion requests before deleting files and synchronizes records after success', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-delete-http-'));
    const { app } = await createApplication(directory, true);
    try {
      await app.listen(0, '127.0.0.1');
      const url = (await app.getUrl()) + '/streamnest/api';
      const preferences = await (await fetch(url + '/preferences')).json();
      await mkdir(preferences.downloadDirectory);
      await writeFile(join(preferences.downloadDirectory, 'one [literal].mp4'), 'one');
      await writeFile(join(preferences.downloadDirectory, 'two.mp4'), 'two');
      await fetch(url + '/library/sync', { method: 'POST' });
      const page = await (await fetch(url + '/tasks?scope=library')).json();
      const taskIds = page.items.map((task: { id: string }) => task.id);
      const post = (body: unknown) =>
        fetch(url + '/library/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      for (const body of [
        { taskIds, confirmDelete: false },
        { taskIds: [], confirmDelete: true },
        { taskIds: [taskIds[0], taskIds[0]], confirmDelete: true },
        { taskIds: ['../escape'], confirmDelete: true },
        { taskIds, confirmDelete: true, arbitraryPath: '/tmp' },
      ]) {
        const response = await post(body);
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe('VALIDATION_FAILED');
      }
      expect((await stat(join(preferences.downloadDirectory, 'one [literal].mp4'))).isFile()).toBe(
        true,
      );
      expect((await stat(join(preferences.downloadDirectory, 'two.mp4'))).isFile()).toBe(true);
      const single = await post({ taskIds: [taskIds[0]], confirmDelete: true });
      expect(await single.json()).toMatchObject({
        deletedFiles: 1,
        removedRecords: 1,
        failures: [],
      });
      const batch = await post({ taskIds: [taskIds[1]], confirmDelete: true });
      expect(await batch.json()).toMatchObject({
        deletedFiles: 1,
        removedRecords: 1,
        failures: [],
      });
      expect((await (await fetch(url + '/tasks?scope=library')).json()).total).toBe(0);
      expect(await (await fetch(url + '/library/sync', { method: 'POST' })).json()).toMatchObject({
        imported: 0,
        removed: 0,
      });
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('synchronizes filesystem changes through HTTP and keeps removed records recoverable', async () => {
    const url = await fixture();
    const preferences = await (await fetch(url + '/preferences')).json();
    const initial = await fetch(url + '/library/sync', { method: 'POST' });
    expect(initial.status).toBe(201);
    expect(await initial.json()).toMatchObject({ imported: 0, removed: 0, updated: 0 });
    expect((await stat(preferences.downloadDirectory)).isDirectory()).toBe(true);
    const file = join(preferences.downloadDirectory, 'local.mp4');
    await writeFile(file, 'local media fixture');
    const added = await fetch(url + '/library/sync', { method: 'POST' });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({ imported: 1, removed: 0 });
    const page = await (await fetch(url + '/tasks?scope=library')).json();
    expect(page.total).toBe(1);
    expect(page.items[0].media.platform).toBe('Local');
    await rm(file);
    const removed = await (await fetch(url + '/library/sync', { method: 'POST' })).json();
    expect(removed).toMatchObject({ imported: 0, removed: 1 });
    expect((await (await fetch(url + '/tasks?scope=library')).json()).total).toBe(0);
    const restored = await fetch(url + '/history/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: removed.backupId }),
    });
    expect(await restored.json()).toMatchObject({ count: 1 });
    const task = await (await fetch(url + `/tasks/${page.items[0].id}`)).json();
    expect(task.artifacts[0].exists).toBe(false);
    const thumbnail = await fetch(url + `/tasks/${task.id}/thumbnail`);
    expect(thumbnail.status).toBe(404);
    expect((await thumbnail.json()).code).toBe('ARTIFACT_NOT_FOUND');
  });
  it('shares preference writes and rejects unknown/null/out-of-range fields', async () => {
    const url = await fixture();
    const response = await fetch(url + '/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 3 }),
    });
    expect(response.status).toBe(200);
    const preferences = await (await fetch(url + '/preferences')).json();
    expect(preferences.concurrency).toBe(3);
    expect(typeof preferences.downloadDirectory).toBe('string');
    for (const body of [
      { concurrency: 0 },
      { concurrency: null },
      { injected: 'invalid' },
      { downloadDirectory: '../../tmp' },
    ]) {
      const rejected = await fetch(url + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(rejected.status).toBe(400);
    }
  });

  it('blocks cross-origin writes and rejects private media input', async () => {
    const url = await fixture();
    const crossOrigin = await fetch(url + '/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: '{}',
    });
    expect(crossOrigin.status).toBe(403);
    const privateUrl = await fetch(url + '/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/private' }),
    });
    expect(privateUrl.status).toBe(400);
    const invalidPage = await fetch(url + '/tasks?limit=0');
    expect(invalidPage.status).toBe(400);
  });

  it('rejects empty account selections at save time without changing saved settings', async () => {
    const url = await fixture();

    for (const cookieBrowser of ['chrome', 'edge', 'firefox', 'brave', 'chromium']) {
      const response = await fetch(url + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookieStrategy: 'selected', cookieBrowser, cookieProfile: '' }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).message).toContain('请选择要使用的浏览器账号');
      expect((await (await fetch(url + '/preferences')).json()).cookieBrowser).toBe('');
    }
    const response = await fetch(url + '/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookieBrowser: 'safari', cookieProfile: '' }),
    });
    expect(response.status).toBe(200);
  });
});
