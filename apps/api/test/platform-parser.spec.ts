import 'reflect-metadata';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'puppeteer-core';

import type { Preferences } from '../../shared/src/contracts.js';
import { CookieService } from '../src/media/parsing/cookie.service.js';
import type { BrowserPool } from '../src/media/parsing/browser-pool.service.js';
import { PlatformParser } from '../src/media/parsing/platform-parser.service.js';
import { findPlatformDetail, parsePlatformScript } from '../src/media/parsing/platform-data.js';
import * as processRunner from '../src/common/process.js';
import * as network from '../src/common/network.js';

const url = 'https://www.douyin.com/video/7477530780223180089';
const preferences: Preferences = {
  downloadDirectory: '/tmp/streamnest-platform',
  concurrency: 1,
  fragments: 1,
  proxy: '',
  cookieStrategy: 'selected',
  cookieBrowser: 'chrome',
  cookiesFile: '',
  binaryPaths: {},
};
const detail = {
  aweme_id: '7477530780223180089',
  desc: '来自央视新闻',
  video: {
    duration: 27_817,
    play_addr: { url_list: ['https://v.example.com/current.mp4'], width: 720, height: 1280 },
  },
};

afterEach(() => vi.restoreAllMocks());

function parserWithEvaluations(values: unknown[], pageUrl = url) {
  const evaluate = vi.fn();
  values.forEach((value) => evaluate.mockResolvedValueOnce(value));
  const page = { setViewport: vi.fn(), on: vi.fn(), goto: vi.fn(), url: () => pageUrl, evaluate };
  const context = {
    browser: () => ({ userAgent: async () => 'Original HeadlessChrome/150' }),
    newPage: async () => page,
  } as unknown as BrowserContext;
  const browsers = {
    run: (_proxy: string, _signal: AbortSignal, operation: (value: BrowserContext) => unknown) =>
      operation(context),
  } as BrowserPool;
  const cookies = { cookies: async () => [] } as unknown as CookieService;

  return new PlatformParser(browsers, cookies);
}

describe('Douyin browser compatibility regressions', () => {
  it('reads encoded RENDER_DATA and legacy assignments without executing script', () => {
    const data = { recommendations: [{ ...detail, aweme_id: 'other' }], current: detail };
    const encoded = parsePlatformScript(encodeURIComponent(JSON.stringify(data)));
    expect(findPlatformDetail('douyin', encoded, detail.aweme_id)).toEqual(detail);
    expect(parsePlatformScript(`window.__INITIAL_STATE__ = ${JSON.stringify(data)};`)).toEqual(
      data,
    );
    expect(parsePlatformScript('window.__INITIAL_STATE__ = alert(1)')).toBeUndefined();
  });

  it('waits past the loaded static animation until current video data arrives', async () => {
    const parser = parserWithEvaluations([
      { values: [], scripts: [] },
      [
        {
          url: 'https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/uuu_265.mp4',
          title: '站点动画',
          duration: 2.6,
          width: 100,
        },
      ],
      { values: [], scripts: [encodeURIComponent(JSON.stringify({ current: detail }))] },
    ]);
    const result = await parser.browser('douyin', url, preferences, AbortSignal.timeout(2000));

    expect(result.id).toBe(detail.aweme_id);
    expect(result.duration).toBe(27.817);
    expect(result.formats?.[0]?.url).toBe('https://v.example.com/current.mp4');
    expect(result.http_headers?.['User-Agent']).toBe('Original HeadlessChrome/150');
  });

  it('selects the loaded content player after a decorative video element', async () => {
    const parser = parserWithEvaluations([
      { values: [], scripts: [] },
      [
        {
          url: 'https://lf-douyin-pc-web.douyinstatic.com/uuu_265.mp4',
          title: detail.desc,
          duration: 2.6,
          width: 100,
        },
        {
          url: 'https://v.example.com/current.mp4',
          title: detail.desc,
          duration: 27.817,
          width: 720,
          height: 1280,
          uploader: '作者',
          thumbnail: '',
        },
      ],
    ]);
    const result = await parser.browser('douyin', url, preferences, AbortSignal.timeout(2000));

    expect(result.formats?.[0]?.url).toBe('https://v.example.com/current.mp4');
    expect(result.duration).toBe(27.817);
  });

  it('prepares the selected browser before platform requests and reuses a private fresh snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-platform-cookie-'));
    const runner = vi.spyOn(processRunner, 'runProcess').mockImplementation(async (_bin, args) => {
      expect(args.slice(0, 4)).toEqual([
        '--ignore-config',
        '--cookies-from-browser',
        'chrome:Profile 4',
        '--cookies',
      ]);
      await writeFile(
        args[4]!,
        '# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tTRUE\t0\tfixture\tvalue\n',
      );
      throw new Error('yt-dlp: error: You must provide at least one URL.');
    });

    try {
      const cookies = new CookieService(directory);
      await cookies.prepare({ ...preferences, cookieProfile: 'Profile 4' }, '/fixture/yt-dlp');
      await cookies.prepare({ ...preferences, cookieProfile: 'Profile 4' }, '/fixture/yt-dlp');
      const file = (await cookies.fileForPlatform({ ...preferences, cookieProfile: 'Profile 4' }))!;

      expect(runner).toHaveBeenCalledTimes(1);
      expect(await cookies.fileForPlatform(preferences)).toBeUndefined();
      expect(
        (await cookies.cookies({ ...preferences, cookieProfile: 'Profile 4' }, 'www.douyin.com'))
          .length,
      ).toBe(1);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, 'utf8')).toContain('Netscape HTTP Cookie File');
    } finally {
      runner.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Kuaishou detail compatibility', () => {
  const kuaishouUrl = 'https://www.kuaishou.com/short-video/fixture-current';
  const payload = {
    data: {
      visionVideoDetail: {
        status: 1,
        photo: {
          id: 'fixture-current',
          duration: 12633,
          caption: '快手回归样本',
          manifest: {
            adaptationSet: [
              {
                representation: [
                  {
                    id: 'main',
                    url: 'https://media.example.com/current.mp4',
                    width: 720,
                    height: 1280,
                    avgBitrate: 900000,
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };

  it('accepts the live detail schema without requesting removed representation fields', async () => {
    const request = vi
      .spyOn(network, 'fetchNetwork')
      .mockImplementation(async (_input, options) => {
        const body = JSON.parse(options!.body!) as {
          query: string;
          variables: { photoId: string };
        };

        expect(body.variables.photoId).toBe('fixture-current');

        if (/\b(?:size|type)\b/.test(body.query))
          return new Response(
            JSON.stringify({
              errors: [{ message: 'Cannot query field on VisionVideoSetRepresentation' }],
            }),
            { status: 400 },
          );

        return Response.json(payload);
      });
    const parser = parserWithEvaluations([]);
    const result = await parser.api(
      'kuaishou',
      kuaishouUrl,
      preferences,
      AbortSignal.timeout(2000),
    );

    expect(request).toHaveBeenCalledOnce();
    expect(result.id).toBe('fixture-current');
    expect(result.duration).toBe(12.633);
    expect(result.formats?.[0]).toMatchObject({ height: 1280, width: 720 });
  });

  it('also reads detail through the browser context query', async () => {
    const parser = parserWithEvaluations([payload], kuaishouUrl);
    const result = await parser.browser(
      'kuaishou',
      kuaishouUrl,
      preferences,
      AbortSignal.timeout(2000),
    );

    expect(result.id).toBe('fixture-current');
    expect(result.formats?.[0]?.url).toBe('https://media.example.com/current.mp4');
  });

  it('reports the observed captcha response without exposing its raw message', async () => {
    vi.spyOn(network, 'fetchNetwork').mockResolvedValue(
      Response.json({ errors: [{ message: 'Need captcha opaque-account-value' }], data: null }),
    );
    const parser = parserWithEvaluations([]);
    const request = parser.api('kuaishou', kuaishouUrl, preferences, AbortSignal.timeout(2000));

    await expect(request).rejects.toThrow('错误类别：verification-required');
    await expect(request).rejects.not.toThrow('opaque-account-value');
  });
});
