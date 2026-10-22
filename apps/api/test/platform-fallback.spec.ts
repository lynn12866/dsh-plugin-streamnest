import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaEngine } from '../src/media/media.engine.js';
import type { RuntimeService } from '../src/runtime/runtime.service.js';
import type { ParseCache } from '../src/media/parsing/cache.service.js';
import type { CookieService } from '../src/media/parsing/cookie.service.js';
import type { PlatformParser } from '../src/media/parsing/platform-parser.service.js';
import type { WechatService } from '../src/media/wechat/wechat.service.js';
import type { Preferences } from '../../shared/src/contracts.js';
import * as processRunner from '../src/common/process.js';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

afterEach(() => vi.restoreAllMocks());

const preferences: Preferences = {
  downloadDirectory: '/tmp/streamnest-fallback',
  concurrency: 1,
  fragments: 1,
  proxy: '',
  cookieBrowser: '',
  cookiesFile: '',
  binaryPaths: {},
};

function engineWithPlatformFailure(message: string): MediaEngine {
  const runtime = { require: async () => '/fixture/yt-dlp' } as unknown as RuntimeService;
  const cache = {
    find: async () => undefined,
    save: async () => undefined,
  } as unknown as ParseCache;
  const cookies = {
    validateSource: async () => undefined,
    prepare: async () => undefined,
    run: async (_settings: Preferences, runner: (args: string[]) => Promise<unknown>) => runner([]),
  } as unknown as CookieService;
  const platforms = {
    api: async () => {
      throw new Error(message);
    },
    browser: async () => {
      throw new Error('Browser did not find loaded media');
    },
  } as unknown as PlatformParser;

  return new MediaEngine(runtime, cache, cookies, platforms, {} as WechatService);
}

describe('platform errors survive the final extractor fallback', () => {
  it.each([
    ['Need captcha', 'verification-required'],
    ['Need login', 'authentication'],
    ['Platform HTTP 403 Forbidden', 'access-denied'],
  ])('keeps %s instead of claiming that the link is unsupported', async (message, category) => {
    vi.spyOn(processRunner, 'runProcess').mockRejectedValue(
      new Error('Unsupported URL: https://example.com/private-output'),
    );
    const engine = engineWithPlatformFailure(message);

    await expect(
      engine.parse('https://www.kuaishou.com/short-video/fixture', preferences),
    ).rejects.toThrow(`错误类别：${category}`);
  });

  it('still accepts a successful extractor after the platform requests need verification', async () => {
    vi.spyOn(processRunner, 'runProcess').mockResolvedValue({
      stdout: JSON.stringify({ id: 'fixture', title: 'Compatibility result' }),
      stderr: '',
    });
    const engine = engineWithPlatformFailure('Need captcha');
    const result = await engine.parse('https://www.kuaishou.com/short-video/fixture', preferences);

    expect(result.parser).toBe('yt-dlp');
    expect(result.title).toBe('Compatibility result');
  });
});
