import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { MediaEngine } from '../src/media/media.engine.js';
import { MediaService } from '../src/media/media.service.js';
import { RuntimeService } from '../src/runtime/runtime.service.js';
import { VaultStore } from '../src/storage/vault.store.js';
import { ParseCache } from '../src/media/parsing/cache.service.js';
import { CookieService } from '../src/media/parsing/cookie.service.js';
import { PlatformParser } from '../src/media/parsing/platform-parser.service.js';
import { BrowserPool } from '../src/media/parsing/browser-pool.service.js';
import type { DownloadRequest, MediaInfo, Preferences } from '../../shared/src/contracts.js';
import { BusinessError } from '../../shared/src/messages.js';

class FixtureEngine extends MediaEngine {
  active = 0;
  peak = 0;
  hold = false;
  override async parse(url: string): Promise<MediaInfo> {
    return {
      id: randomUUID(),
      url,
      title: '虚构媒体 · 队列验收',
      uploader: 'fixture',
      platform: 'fixture',
      duration: 1,
      thumbnail: '',
      formats: [],
      audioTracks: [],
      subtitles: ['en'],
      parsedAt: new Date().toISOString(),
    };
  }
  override async download(
    _media: MediaInfo,
    _request: DownloadRequest,
    _preferences: Preferences,
    directory: string,
    signal: AbortSignal,
    line: (value: string) => void,
  ) {
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          this.hold ? 10_000 : 50,
        );
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      line('[mv-progress]50|100|NA|10|5');
      await writeFile(join(directory, 'fixture.mp4'), 'fixture media bytes');
    } finally {
      this.active--;
    }
  }
}

const services: MediaService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onModuleDestroy()));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-test-'));
  const store = new VaultStore(directory);
  const cookies = new CookieService(directory);
  const engine = new FixtureEngine(
    new RuntimeService(directory),
    new ParseCache(directory),
    cookies,
    new PlatformParser(new BrowserPool(), cookies),
  );
  const service = new MediaService(store, engine);
  await service.initialize();
  services.push(service);
  return { directory, store, engine, service };
}

async function settled(service: MediaService) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      service
        .list()
        .items.every((task) => ['completed', 'failed', 'cancelled', 'paused'].includes(task.state))
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Fixture queue did not settle');
}

describe('persistent shared queue', () => {
  it('serves live progress immediately and batches only dirty tasks into SQLite', async () => {
    const { service, engine, store } = await fixture();
    const updates = new Map<string, (line: string) => void>();
    const releases: (() => void)[] = [];
    vi.spyOn(engine, 'download').mockImplementation(
      async (_media, _request, _preferences, directory, signal, line) => {
        updates.set(directory, line);
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          releases.push(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          });
        });
        await writeFile(join(directory, 'fixture.mp4'), 'fixture');
      },
    );
    const batch = vi.spyOn(store, 'saveProgress');
    const ids: string[] = [];
    for (let index = 0; index < 2; index++) {
      const media = await service.parse(`https://example.com/progress/${index}`);
      ids.push((await service.enqueue({ mediaId: media.id, mode: 'video' })).id);
    }
    await expect.poll(() => updates.size).toBe(2);
    for (let index = 1; index <= 50; index++)
      for (const line of updates.values()) line(`[mv-progress]${index}|100|NA|10|5`);
    expect(service.get(ids[0]!).progress).toBe(50);
    expect(store.task(ids[0]!)?.progress).toBe(0);
    expect(batch).not.toHaveBeenCalled();
    await expect.poll(() => store.task(ids[0]!)?.progress, { timeout: 2000 }).toBe(50);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0].map((task) => task.id).sort()).toEqual(ids.sort());
    releases.forEach((release) => release());
    await settled(service);
    for (const id of ids) expect(store.task(id)?.state).toBe('completed');
  });

  it('retries a failed terminal write while keeping its status available', async () => {
    const { service, store } = await fixture();
    const original = store.saveTask.bind(store);
    let fail = true;
    vi.spyOn(store, 'saveTask').mockImplementation((task) => {
      if (task.state === 'completed' && fail) {
        fail = false;
        throw new Error('injected write failure');
      }
      original(task);
    });
    const media = await service.parse('https://example.com/write-retry');
    const record = await service.enqueue({ mediaId: media.id, mode: 'video' });
    await settled(service);
    expect(service.get(record.id).code).toBe('TASK_SAVE_FAILED');
    await expect.poll(() => store.task(record.id)?.state, { timeout: 2000 }).toBe('completed');
    expect(service.get(record.id).state).toBe('completed');
  });

  it('preserves failure codes and parameters, then clears them after a successful retry', async () => {
    const { service, engine } = await fixture();
    vi.spyOn(engine, 'download').mockRejectedValueOnce(
      new BusinessError('DOWNLOAD_HTTP_FAILED', { status: 403, statusText: 'Forbidden' }),
    );
    const media = await service.parse('https://example.com/retry');
    const task = await service.enqueue({ mediaId: media.id, mode: 'video' });
    await settled(service);
    expect(service.get(task.id)).toMatchObject({
      state: 'failed',
      code: 'DOWNLOAD_HTTP_FAILED',
      params: { status: 403, statusText: 'Forbidden' },
    });
    await service.action(task.id, 'retry');
    await settled(service);
    expect(service.get(task.id)).toMatchObject({
      state: 'completed',
      code: 'TASK_COMPLETED',
      params: {},
    });
  });

  it('enforces concurrency and saves completed artifacts', async () => {
    const { service, engine, store } = await fixture();
    await service.updatePreferences({ concurrency: 2 });
    for (let index = 0; index < 4; index++) {
      const media = await service.parse(`https://example.com/${index}`);
      await service.enqueue({ mediaId: media.id, mode: 'video' });
    }
    await settled(service);
    expect(engine.peak).toBe(2);
    expect(service.list({ scope: 'library' }).total).toBe(4);
    const task = service.list().items[0]!;
    expect(task).toMatchObject({ code: 'TASK_COMPLETED', params: {} });
    const artifact = await service.artifact(task.id, 0);
    expect(await readFile(artifact.path, 'utf8')).toBe('fixture media bytes');
    await expect
      .poll(async () => store.list({ scope: 'library' }).total, {
        timeout: 2_000,
      })
      .toBe(4);
  });

  it('pauses, restarts safely, resumes and restores archives', async () => {
    const { service, engine, directory } = await fixture();
    engine.hold = true;
    const media = await service.parse('https://example.com/pause');
    const task = await service.enqueue({ mediaId: media.id, mode: 'video' });
    await service.action(task.id, 'pause');
    expect(engine.active).toBe(0);
    expect(service.get(task.id).state).toBe('paused');
    expect(service.get(task.id)).toMatchObject({ code: 'TASK_PAUSED', params: {} });
    await service.onModuleDestroy();
    services.splice(services.indexOf(service), 1);
    const replacement = new MediaService(new VaultStore(directory), engine);
    await replacement.initialize();
    services.push(replacement);
    expect(replacement.get(task.id).state).toBe('paused');
    engine.hold = false;
    await replacement.action(task.id, 'resume');
    await settled(replacement);
    await replacement.archive(task.id, true);
    expect(replacement.list({ scope: 'library' }).total).toBe(1);
    expect(replacement.list({ scope: 'library', archived: false }).total).toBe(0);
    expect(replacement.list({ archived: true }).total).toBe(1);
    await replacement.archive(task.id, false);
    expect(replacement.list({ scope: 'library' }).total).toBe(1);
  });

  it('validates format/subtitle membership and pagination', async () => {
    const { service } = await fixture();
    const media = await service.parse('https://example.com/test');
    await expect(
      service.enqueue({ mediaId: media.id, mode: 'video', formatId: 'not-a-format' }),
    ).rejects.toThrow();
    await expect(
      service.enqueue({ mediaId: media.id, mode: 'subtitle', subtitles: [] }),
    ).rejects.toThrow();
    await expect(
      service.enqueue({ mediaId: media.id, mode: 'subtitle', subtitles: ['invalid'] }),
    ).rejects.toThrow();
    expect(() => service.list({ limit: 1_000 })).toThrow();
    expect(() => service.list({ offset: Number.NaN })).toThrow();
  });

  it('preserves existing settings when a patch contains unset fields', async () => {
    const { service } = await fixture();
    const before = service.preferences();
    await service.updatePreferences({ concurrency: 1, downloadDirectory: undefined });
    expect(service.preferences().downloadDirectory).toBe(before.downloadDirectory);
    expect(service.preferences().concurrency).toBe(1);
  });
});
