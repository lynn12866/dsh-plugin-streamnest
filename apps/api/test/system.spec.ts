import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { MediaService } from '../src/media/media.service.js';
import type { MediaEngine } from '../src/media/media.engine.js';
import { RuntimeService } from '../src/runtime/runtime.service.js';
import { VaultStore } from '../src/storage/vault.store.js';
import { NativeService } from '../src/system/native.service.js';
import { SystemService } from '../src/system/system.service.js';
import { JournalService } from '../src/system/journal.service.js';
import {
  CookieService,
  cookieMatchesHost,
  parseNetscapeCookies,
} from '../src/media/parsing/cookie.service.js';
import { createAgentTools } from '../../../packages/harness/src/tools/register.js';
import type { Preferences, StoredTask } from '../../shared/src/contracts.js';
import * as browserPaths from '../src/media/parsing/browser-paths.js';

describe('记录、原生交互和官方工具契约', () => {
  it('only rotates auto cookie sources after read errors, then reuses a private snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-cookie-policy-'));
    const installed = vi
      .spyOn(browserPaths, 'getInstalledBrowsers')
      .mockReturnValue(['chrome', 'edge']);
    const preferences: Preferences = {
      downloadDirectory: directory,
      concurrency: 1,
      fragments: 1,
      proxy: '',
      cookieStrategy: 'auto',
      cookieBrowser: '',
      cookiesFile: '',
      binaryPaths: {},
    };
    try {
      const service = new CookieService(directory);
      const attempted: string[] = [];
      await service.run(preferences, async (args) => {
        const browser = args[1]!;
        attempted.push(browser);
        if (browser === 'chrome') throw new Error('cookies database is locked');

        expect(browser).toBe('edge');
        await writeFile(args[3]!, '# Netscape HTTP Cookie File\n');
        return true;
      });
      expect(attempted).toEqual(['chrome', 'edge']);
      await service.run(
        preferences,
        async (args) => {
          expect(args[0]).toBe('--cookies');
          return true;
        },
        undefined,
        true,
      );
      const stopped: string[] = [];
      await expect(
        new CookieService(directory).run(preferences, async (args) => {
          stopped.push(args[1]!);
          throw new Error('HTTP Error 403: Forbidden');
        }),
      ).rejects.toThrow('403');
      expect(stopped).toEqual(['edge']);
    } finally {
      installed.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('通过真实 ToolRuntime 移除和恢复记录，保留实际文件，并返回原生选择结果', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-system-'));
    const store = new VaultStore(directory);
    const journal = new JournalService(directory);
    const media = new MediaService(store, {} as MediaEngine, journal);
    const runtime = new RuntimeService(directory);
    const native = new NativeService();
    const cookies = new CookieService(directory);
    const system = new SystemService(directory, runtime, media, cookies, journal);
    const preferences: Preferences = {
      downloadDirectory: join(directory, 'media'),
      concurrency: 2,
      fragments: 4,
      proxy: '',
      cookieBrowser: '',
      cookiesFile: '',
      binaryPaths: {},
    };
    const id = randomUUID();
    const outputDirectory = join(preferences.downloadDirectory, id);
    await mkdir(outputDirectory, { recursive: true });
    const artifact = join(outputDirectory, 'fixture.mp4');
    await writeFile(artifact, 'owned fixture bytes');
    const task: StoredTask = {
      id,
      state: 'completed',
      progress: 100,
      downloadedBytes: 19,
      totalBytes: 19,
      speed: 0,
      eta: 0,
      message: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      outputDirectory,
      artifacts: [{ name: 'fixture.mp4', bytes: 19 }],
      archived: false,
      preferences,
      request: { mediaId: randomUUID(), mode: 'video' },
      media: {
        id: randomUUID(),
        url: 'https://example.com/fixture.mp4',
        title: '文件保留验收',
        uploader: '',
        platform: 'fixture',
        duration: 1,
        thumbnail: '',
        formats: [],
        audioTracks: [],
        subtitles: [],
        parsedAt: new Date().toISOString(),
      },
    };
    await writeFile(
      join(directory, 'vault.json'),
      JSON.stringify({ version: 1, preferences, tasks: [task], media: [] }),
    );
    await media.initialize();
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools: () => () => undefined });
    ctx.provide('sandboxPolicy', {
      resolve: () => ({ mode: 'danger-full-access' }),
    } as unknown as Context['sandboxPolicy']);
    const tools = new ToolRuntime(ctx);
    const definitions = createAgentTools(ctx, media, runtime, { system, native, journal });
    const disposers = definitions.map((definition) => tools.register(definition));
    const agent = { session: {} } as unknown as ToolRunContext['agent'];
    async function execute(name: string, args: Record<string, unknown>) {
      const result = await tools.execute({
        name,
        arguments: args,
        callId: randomUUID(),
        signal: new AbortController().signal,
        agent,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const content = result.content[0];
      if (content?.type !== 'text') throw new Error('工具没有返回标准 JSON 文本。');
      return JSON.parse(content.text) as Record<string, unknown>;
    }
    try {
      expect(new Set(definitions.map((definition) => definition.name)).size).toBe(27);
      await execute('media_preferences_update', {
        binaryPaths: {},
        language: 'en-US',
        acceleration: { enabled: true, maxConnections: 4, aria2Path: '' },
      });
      expect((await execute('media_preferences_get', {})).binaryPaths).toEqual({});
      await execute('media_preferences_update', {
        binaryPaths: { 'yt-dlp': join(directory, 'yt-dlp') },
      });
      await execute('media_preferences_update', {
        binaryPaths: { ffmpeg: join(directory, 'ffmpeg') },
      });
      expect(media.preferences().binaryPaths['yt-dlp']).toBe(join(directory, 'yt-dlp'));
      const disk = await execute('media_disk_space', {});
      expect(disk.total).toBeGreaterThan(0);
      await execute('media_task_archive', { taskId: id, archived: true });
      const completed = await execute('media_tasks_list', { scope: 'library', limit: 1 });
      expect(completed.total).toBe(1);
      expect(completed.items).toEqual([expect.objectContaining({ id, archived: true })]);
      expect((await execute('media_tasks_list', { scope: 'library', archived: false })).total).toBe(
        0,
      );
      const cleared = await execute('media_history_clear', { scope: 'library' });
      expect(cleared.count).toBe(1);
      expect(media.list({ scope: 'library' }).total).toBe(0);
      expect(await readFile(artifact, 'utf8')).toBe('owned fixture bytes');
      await execute('media_history_restore', { backupId: cleared.backupId });
      const restored = await execute('media_task_get', { taskId: id });
      expect(restored.state).toBe('completed');
      expect(media.get(id).artifacts[0]?.exists).toBe(true);
      const choice = await execute('media_native_request', {
        kind: 'pick-folder',
        purpose: '在独立验收目录选择保存位置',
      });
      expect(choice.status).toBe('pending');
      await native.complete(String(choice.id), directory);
      const result = await execute('media_native_result', { id: choice.id });
      expect(result.status).toBe('completed');
      expect(result.value).toBe(directory);
      const log = await execute('media_logs_get', {});
      expect(log.lines).toEqual(
        expect.arrayContaining([expect.stringContaining('history.removed')]),
      );
      const cleanup = await execute('media_logs_clear', {});
      expect(await readFile(join(journal.directory, String(cleanup.backup)), 'utf8')).toContain(
        'history.removed',
      );
      expect((await journal.read()).lines).toEqual([]);
    } finally {
      disposers.forEach((dispose) => dispose());
      await media.onModuleDestroy();
      await journal.read();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('Cookie 运行副本不改写用户文件，并严格匹配 Cookie 域名', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-cookie-'));
    try {
      const path = join(directory, 'provided.txt');
      const contents =
        '# Netscape HTTP Cookie File\n#HttpOnly_.douyin.com\tTRUE\t/\tTRUE\t0\tfixture\tdummy-value\n';
      await writeFile(path, contents);
      const service = new CookieService(directory);
      const preferences: Preferences = {
        downloadDirectory: directory,
        concurrency: 1,
        fragments: 1,
        proxy: '',
        cookieBrowser: '',
        cookiesFile: path,
        binaryPaths: {},
      };
      await service.run(preferences, async (args) => {
        expect(args[0]).toBe('--cookies');
        expect(args[1]).not.toBe(path);
        await writeFile(args[1]!, '# changed by child');
        return true;
      });
      expect(await readFile(path, 'utf8')).toBe(contents);
      const cookie = parseNetscapeCookies(contents)[0]!;
      expect(cookieMatchesHost(cookie, 'www.douyin.com')).toBe(true);
      expect(cookieMatchesHost(cookie, 'evil-douyin.com')).toBe(false);
      expect(cookieMatchesHost(cookie, 'douyin.com.evil.test')).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
