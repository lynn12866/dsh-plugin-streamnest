import { parseMessage } from '../../shared/src/messages.js';
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { fetchWechatInfo, normalizeWechatFeed, parseWechatJSON } from '../src/media/wechat/api.js';
import {
  decodeWechatFile,
  decodeWechatPrefix,
  wechatKeyStream,
} from '../src/media/wechat/decode.js';
import { normalizeInfo } from '../src/media/formats.js';
import { CookieService } from '../src/media/parsing/cookie.service.js';
import { commonArguments } from '../src/media/arguments.js';
import type { Preferences } from '../../shared/src/contracts.js';
import type { fetchNetwork } from '../src/common/network.js';

const share = 'https://weixin.qq.com/sph/AU1HnNZI4l';
const full = {
  errCode: 0,
  data: {
    object: {
      id: '123',
      contact: { nickname: '作者' },
      objectDesc: {
        description: '测试视频',
        mediaType: 4,
        media: [
          {
            url: 'https://finder.video.qq.com/stodownload?encfilekey=x',
            urlToken: '&token=y',
            decodeKey: '18446744073709551615',
            width: 720,
            height: 1280,
            videoPlayLen: 12,
            fileSize: 200000,
            spec: [{ fileFormat: 'hd', width: 720, height: 1280 }],
          },
        ],
      },
    },
  },
};
const preview = {
  errCode: 0,
  data: {
    authorInfo: { nickname: '作者' },
    errMsg: { type: 0 },
    feedInfo: {
      mediaType: 4,
      description: '预览视频',
      h264VideoInfo: {
        videoUrl: 'https://finder.video.qq.com/file?token=keep&X-snsvideoflag=hd&sign=keep-sign',
      },
      h265VideoInfo: {
        videoUrl: 'https://finder.video.qq.com/file?token=keep&X-snsvideoflag=hevc&sign=keep-sign',
      },
    },
  },
};

describe('WeChat provider', () => {
  it('keeps uint64 IDs and decode keys exact before JSON.parse and omits secrets from public media', () => {
    expect(parseWechatJSON('{"id":18446744073709551615,"decodeKey":18446744073709551615}')).toEqual(
      { id: '18446744073709551615', decodeKey: '18446744073709551615' },
    );
    const raw = normalizeWechatFeed(full, share);
    expect(raw.formats?.[0]?.wechat_decode_key).toBe('18446744073709551615');
    const publicInfo = normalizeInfo(raw, share, 'media-id');
    expect(publicInfo.title).toBe('测试视频');
    expect(JSON.stringify(publicInfo)).not.toMatch(
      /decode_key|18446744073709551615|encfilekey|token=y/,
    );
  });

  it('handles the real preview response shape and preserves its signed CDN query', () => {
    const raw = normalizeWechatFeed(preview, share);
    expect(raw.formats).toHaveLength(2);
    expect(raw.formats?.[0]?.url).toContain('X-snsvideoflag=hd&sign=keep-sign');
    expect(normalizeInfo(raw, share, 'id').formats.map((f) => f.id)).toEqual([
      'wx-h264',
      'wx-h265',
    ]);
  });

  it('sends Yuanbao cookies only to Yuanbao and playback parameters only to Channels, with Content-Length', async () => {
    const calls: { host: string; cookie?: string; body: string }[] = [];
    const request: typeof fetchNetwork = async (url, options = {}) => {
      const target = new URL(url);
      await options.validateUrl?.(target);
      calls.push({
        host: target.hostname,
        cookie: options.headers?.Cookie,
        body: options.body ?? '',
      });
      expect(options.headers?.['Content-Length']).toBe(String(Buffer.byteLength(options.body!)));
      return Response.json(
        calls.length === 1
          ? {
              code: 0,
              data: {
                playable_url:
                  'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=opaque-id&token=opaque-token',
              },
            }
          : preview,
      );
    };
    const info = await fetchWechatInfo(share, 'session=fixture-only', {}, request);
    expect(info.title).toBe('预览视频');
    expect(calls.map((c) => c.host)).toEqual(['yuanbao.tencent.com', 'channels.weixin.qq.com']);
    expect(calls[0]?.cookie).toBe('session=fixture-only');
    expect(calls[1]?.cookie).toBeUndefined();
    expect(calls[0]?.body).not.toContain('opaque-token');
    expect(calls[1]?.body).toContain('opaque-token');
  });

  it('reports missing/expired login and real unavailability without hard-coded unsupported errors', async () => {
    await expect(fetchWechatInfo(share, '', {})).rejects.toThrow('登录');
    await expect(
      fetchWechatInfo(share, 'fixture', {}, async () => new Response(null, { status: 401 })),
    ).rejects.toThrow('authentication');
    expect(() =>
      normalizeWechatFeed(
        { data: { errMsg: { type: 1, title: '视频已删除', content: '<b>无法播放</b>' } } },
        share,
      ),
    ).toThrow('视频已删除：无法播放');
    expect(() => normalizeWechatFeed({ data: { feedInfo: { mediaType: 2 } } }, share)).toThrow(
      '图集',
    );
    expect(() =>
      normalizeWechatFeed(
        {
          ...preview,
          data: {
            ...preview.data,
            feedInfo: {
              ...preview.data.feedInfo,
              h264VideoInfo: { videoUrl: 'http://127.0.0.1/file' },
              h265VideoInfo: {},
            },
          },
        },
        share,
      ),
    ).toThrow('腾讯 CDN');
  });

  it('rejects a foreign playable origin before forwarding any derived parameter', async () => {
    let calls = 0;
    await expect(
      fetchWechatInfo(share, 'fixture', {}, async () => {
        calls++;
        return Response.json({
          code: 0,
          data: { playable_url: 'https://example.com/?eid=id&token=secret' },
        });
      }),
    ).rejects.toThrow('播放参数');
    expect(calls).toBe(1);
  });
});

describe('ISAAC64 compatibility', () => {
  // Generated by the pinned upstream Go decoder, including the 256-word refill boundary.
  it.each([
    ['0', 'e1662af3b7e59867c919ad19055fc8cecea2b154d37e1459b2f96d1da14cef1f'],
    ['1', '39d98f5b25cc52f0996f7ef9e1022156cb029901be6a11ebbdd7469c6ffd5839'],
    ['123456789', '1f972db9d304b9c779a59f9830f1b03c98e247a4e1102d926996dd61b60d8e67'],
    ['18446744073709551615', '5afbffd76305e81467f97c6370fa07916e9b197611bf5c357a854eb92a6354a1'],
  ])('matches the full 128 KiB reference vector for key %s', (key, hash) => {
    expect(createHash('sha256').update(wechatKeyStream(key, 131072)).digest('hex')).toBe(hash);
  });

  it('decodes to a separate file, preserves the tail and original, rejects bad keys and existing destinations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-wx-'));
    try {
      const original = Buffer.alloc(180000, 0x7a);
      original.write('ftyp', 4, 'ascii');
      const encrypted = decodeWechatPrefix(original, '123456789');
      const source = join(directory, 'source');
      const output = join(directory, 'decoded.mp4');
      await writeFile(source, encrypted);
      await decodeWechatFile(source, output, '123456789', new AbortController().signal);
      expect(await readFile(output)).toEqual(original);
      expect(await readFile(source)).toEqual(encrypted);
      await expect(
        decodeWechatFile(source, join(directory, 'bad.mp4'), '1', new AbortController().signal),
      ).rejects.toThrow('校验失败');
      await expect(
        decodeWechatFile(source, output, '123456789', new AbortController().signal),
      ).rejects.toThrow('EEXIST');
      expect(await readFile(output)).toEqual(original);
      await expect(
        decodeWechatFile(source, join(directory, 'cancel.mp4'), '123456789', AbortSignal.abort()),
      ).rejects.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('automatic login ignores all hidden manual fields without deleting the saved choices', async () => {
  const preferences = {
    cookieStrategy: 'auto',
    cookieBrowser: 'chrome',
    cookieProfile: 'Profile 4',
    cookiesFile: '/hidden/never-read.txt',
    proxy: '',
  } as Preferences;
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-wx-auto-'));
  try {
    const cookies = new CookieService(directory);
    expect((await cookies.status(preferences)).manual).toBe(false);
    expect(await cookies.fileForPlatform(preferences)).toBeUndefined();
    expect(commonArguments(preferences)).not.toContain('--cookies');
    expect(commonArguments(preferences)).not.toContain('--cookies-from-browser');
    expect(preferences.cookieProfile).toBe('Profile 4');
    expect(preferences.cookiesFile).toBe('/hidden/never-read.txt');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Wechat login refresh', () => {
  it('retries authentication once with the same selected account and a fresh snapshot', async () => {
    const { vi } = await import('vitest');
    const { BadRequestException } = await import('@nestjs/common');
    const api = await import('../src/media/wechat/api.js');
    const { WechatService } = await import('../src/media/wechat/wechat.service.js');
    const request = vi
      .spyOn(api, 'fetchWechatInfo')
      .mockRejectedValueOnce(new BadRequestException(parseMessage('authentication', 'expired')))
      .mockResolvedValueOnce({ title: 'refreshed' });
    const prepare = vi.fn(async () => undefined);
    const cookies = { prepare, cookies: async () => [] } as unknown as CookieService;
    const runtime = { require: async () => '/fixture/yt-dlp' };
    const preferences = {
      cookieStrategy: 'selected',
      cookieBrowser: 'chrome',
      cookieProfile: 'Profile 4',
      cookiesFile: '',
      proxy: '',
    } as Preferences;
    try {
      const service = new WechatService(runtime as never, cookies);
      expect((await service.parse(share, preferences, new AbortController().signal)).title).toBe(
        'refreshed',
      );
      expect(prepare.mock.calls.map((args) => (args as unknown[])[3])).toEqual([false, true]);
      expect(
        prepare.mock.calls.every(
          (args) => ((args as unknown[])[0] as Preferences).cookieProfile === 'Profile 4',
        ),
      ).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      request.mockRestore();
    }
  });

  it('keeps a manual file authoritative and never substitutes browser cookies when it is expired', async () => {
    const { vi } = await import('vitest');
    const { BadRequestException } = await import('@nestjs/common');
    const api = await import('../src/media/wechat/api.js');
    const { WechatService } = await import('../src/media/wechat/wechat.service.js');
    const request = vi
      .spyOn(api, 'fetchWechatInfo')
      .mockRejectedValue(new BadRequestException(parseMessage('authentication', 'expired')));
    const prepare = vi.fn(async () => undefined);
    const service = new WechatService(
      { require: async () => '/fixture/yt-dlp' } as never,
      { prepare, cookies: async () => [] } as unknown as CookieService,
    );
    try {
      await expect(
        service.parse(
          share,
          { cookieStrategy: 'selected', cookiesFile: '/fixture/cookies.txt' } as Preferences,
          new AbortController().signal,
        ),
      ).rejects.toThrow('expired');
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      request.mockRestore();
    }
  });

  it('refreshes a real cached snapshot via the selected source while preserving the default cache behavior', async () => {
    const { vi } = await import('vitest');
    const runner = await import('../src/common/process.js');
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-wx-refresh-'));
    let sequence = 0;
    const process = vi.spyOn(runner, 'runProcess').mockImplementation(async (_binary, args) => {
      expect(args[2]).toBe('chrome:Profile 4');
      const path = args[4]!;
      await writeFile(
        path,
        '# Netscape HTTP Cookie File\n.yuanbao.tencent.com\tTRUE\t/\tTRUE\t0\tauth\tfixture-' +
          ++sequence +
          '\n',
      );
      return { stdout: '', stderr: '' };
    });
    const preferences = {
      cookieStrategy: 'selected',
      cookieBrowser: 'chrome',
      cookieProfile: 'Profile 4',
      cookiesFile: '',
    } as Preferences;
    try {
      const service = new CookieService(directory);
      await service.prepare(preferences, '/fixture/yt-dlp');
      await service.prepare(preferences, '/fixture/yt-dlp');
      expect(process).toHaveBeenCalledTimes(1);
      await service.prepare(preferences, '/fixture/yt-dlp', undefined, true);
      expect(process).toHaveBeenCalledTimes(2);
      expect((await service.cookies(preferences, 'yuanbao.tencent.com'))[0]?.value).toBe(
        'fixture-2',
      );
    } finally {
      process.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
