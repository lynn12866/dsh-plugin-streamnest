import 'reflect-metadata';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { Preferences } from '../../shared/src/contracts.js';
import { commonArguments } from '../src/media/arguments.js';
import { CookieService } from '../src/media/parsing/cookie.service.js';

const preferences: Preferences = {
  downloadDirectory: '/tmp/streamnest-cookie-source',
  concurrency: 1,
  fragments: 1,
  proxy: '',
  cookieStrategy: 'selected',
  cookieBrowser: '',
  cookieProfile: '',
  cookiesFile: '',
  binaryPaths: {},
};
const contents =
  '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tfixture\tdummy-value\n';

describe('explicit login sources', () => {
  it('stops before running an extractor when a profile browser has no chosen account', async () => {
    const service = new CookieService('/unused-cookie-source-fixture');
    const runner = vi.fn();

    for (const cookieBrowser of ['chrome', 'edge', 'firefox', 'brave', 'chromium'] as const) {
      const selected = { ...preferences, cookieBrowser, cookieProfile: '  ' };

      await expect(service.run(selected, runner)).rejects.toThrow('不会自动使用默认账号');
      await expect(service.cookies(selected, 'example.com')).rejects.toThrow('请选择');
    }
    expect(runner).not.toHaveBeenCalled();
  });

  it('disabled browser with no file uses no credentials or an earlier browser snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-disabled-source-'));

    try {
      const service = new CookieService(directory);
      const selected = {
        ...preferences,
        cookieBrowser: 'chrome' as const,
        cookieProfile: 'Profile 4',
      };
      await service.run(selected, async (args) => writeFile(args[3]!, contents));
      expect(await service.fileForPlatform(selected)).toBeDefined();

      const disabled = { ...selected, cookieBrowser: '' as const };
      const runner = vi.fn(async (args: string[]) => expect(args).toEqual([]));
      await service.run(disabled, runner);

      expect(runner).toHaveBeenCalledTimes(1);
      expect(await service.fileForPlatform(disabled)).toBeUndefined();
      expect(await service.cookies(disabled, 'example.com')).toEqual([]);
      expect(await service.status(disabled)).toMatchObject({ enabled: false, hasSnapshot: false });
      expect(commonArguments(disabled)).not.toContain('--cookies-from-browser');
      expect(commonArguments(disabled)).not.toContain('--cookies');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('a manual file works with a disabled browser or an empty browser account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-manual-source-'));

    try {
      const cookiesFile = join(directory, 'provided.txt');
      await writeFile(cookiesFile, contents);
      const service = new CookieService(directory);

      for (const cookieBrowser of ['', 'chrome'] as const) {
        const selected = { ...preferences, cookieBrowser, cookiesFile };
        await service.run(selected, async (args) => {
          expect(args[0]).toBe('--cookies');
          expect(args).not.toContain('--cookies-from-browser');
          expect(args[1]).not.toBe(cookiesFile);
          expect(await readFile(args[1]!, 'utf8')).toBe(contents);
        });
        expect(await service.cookies(selected, 'example.com')).toHaveLength(1);
      }
      expect(await readFile(cookiesFile, 'utf8')).toBe(contents);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('Safari uses its default source and ignores a stale hidden profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-safari-source-'));

    try {
      const selected = {
        ...preferences,
        cookieBrowser: 'safari' as const,
        cookieProfile: 'Profile 4',
      };
      const service = new CookieService(directory);
      await service.run(selected, async (args) => {
        expect(args.slice(0, 2)).toEqual(['--cookies-from-browser', 'safari']);
      });
      expect(commonArguments(selected)).toContain('safari');
      expect(commonArguments(selected)).not.toContain('safari:Profile 4');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
