import { parseMessage, BusinessError } from '../../../../shared/src/messages.js';
import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';

import type { Preferences } from '../../../../shared/src/contracts.js';
import type { ExtractorInfo } from '../formats.js';
import { classifyParseError, parseDiagnostic } from '../../../../shared/src/parse-errors.js';
import { fetchNetwork } from '../../common/network.js';
import { BrowserPool } from './browser-pool.service.js';
import { CookieService } from './cookie.service.js';
import {
  findPlatformDetail,
  isPlatformVideoSource,
  platformInfo,
  parsePlatformScript,
  platformVideoId,
  at,
  list,
  text,
  type Platform,
} from './platform-data.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const KUAISHOU_QUERY =
  'query VisionVideoDetail($photoId: String!) { visionVideoDetail(photoId: $photoId) { status photo { id duration caption coverUrl photoUrl photoH265Url manifest { version businessType mediaType adaptationSet { id duration representation { id url width height avgBitrate } } } } llsid } }';

function platformResponseError(platform: Platform, value: unknown): Error | undefined {
  if (platform !== 'kuaishou') return undefined;

  const messages = list(at(value, 'errors'))
    .map((error) => text(at(error, 'message')))
    .join('\n');

  return classifyParseError(messages) === 'unknown'
    ? undefined
    : new BusinessError(
        parseMessage(classifyParseError(messages)).code,
        {},
        parseDiagnostic(messages),
      );
}

@Injectable()
export class PlatformParser {
  constructor(
    private readonly browsers: BrowserPool,
    private readonly cookies: CookieService,
  ) {}

  async api(
    platform: Platform,
    url: string,
    preferences: Preferences,
    signal: AbortSignal,
  ): Promise<ExtractorInfo> {
    const origin = platform === 'douyin' ? 'https://www.douyin.com' : 'https://www.kuaishou.com';
    const cookies = await this.cookies.cookies(preferences, new URL(origin).hostname);
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Referer: `${origin}/`,
      Accept: 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
    if (cookies.length)
      headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    let id = platformVideoId(platform, url);
    if (!id) {
      const response = await fetchNetwork(url, {
        headers,
        signal,
        proxy: preferences.proxy,
        timeoutMs: 12_000,
      });
      id = platformVideoId(platform, response.url);
      await response.body?.cancel();
    }
    if (!id) throw new BusinessError('PLATFORM_VIDEO_ID_MISSING');
    const endpoint =
      platform === 'douyin'
        ? `${origin}/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(id)}&aid=6383&channel=channel_pc_web&detail_list=1`
        : `${origin}/graphql`;
    const response = await fetchNetwork(endpoint, {
      method: platform === 'douyin' ? 'GET' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body:
        platform === 'douyin'
          ? undefined
          : JSON.stringify({
              operationName: 'VisionVideoDetail',
              variables: { photoId: id },
              query: KUAISHOU_QUERY,
            }),
      signal,
      proxy: preferences.proxy,
      timeoutMs: 12_000,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new BusinessError('PLATFORM_HTTP_FAILED', { status: response.status });
    }
    const payload: unknown = await response.json();
    const failure = platformResponseError(platform, payload);

    if (failure) throw failure;

    const detail = findPlatformDetail(platform, payload, id);
    if (!detail) throw new BusinessError('PLATFORM_DETAILS_MISSING');
    return platformInfo(platform, detail, url);
  }

  async browser(
    platform: Platform,
    url: string,
    preferences: Preferences,
    signal: AbortSignal,
  ): Promise<ExtractorInfo> {
    return this.browsers.run(preferences.proxy, signal, async (context) => {
      const host = platform === 'douyin' ? 'www.douyin.com' : 'www.kuaishou.com';
      const cookies = await this.cookies.cookies(preferences, host);
      if (cookies.length)
        await context.setCookie(
          ...cookies.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            expires: cookie.expiry > 0 ? cookie.expiry : -1,
          })),
        );
      const page = await context.newPage();
      const userAgent = await context.browser().userAgent();
      await page.setViewport({ width: 1920, height: 1080 });
      const responses: Promise<unknown>[] = [];
      page.on('response', (response) => {
        if (
          /\/aweme\/v1\/(?:web\/|multi\/)?aweme\/detail|\/graphql|\/rest\/wd\/photo\/(?:info|detail)/.test(
            response.url(),
          )
        )
          responses.push(response.json().catch(() => undefined));
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const id = platformVideoId(platform, page.url()) || platformVideoId(platform, url);
      let failure: Error | undefined;

      if (platform === 'kuaishou' && id) {
        const response = await page
          .evaluate(
            async (body) => {
              const result = await fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
              });
              return (await result.json()) as unknown;
            },
            JSON.stringify({
              operationName: 'VisionVideoDetail',
              variables: { photoId: id },
              query: KUAISHOU_QUERY,
            }),
          )
          .catch(() => undefined);
        const detail = findPlatformDetail(platform, response, id);
        if (detail) return platformInfo(platform, detail, url);
        failure = platformResponseError(platform, response);
      }
      const deadline = Date.now() + 15_000;
      let consumed = 0;

      // 静态装饰视频会早于真实播放器出现；必须等到当前视频详情或已加载的媒体。
      while (Date.now() < deadline) {
        signal.throwIfAborted();

        const batch = responses.slice(consumed);
        consumed += batch.length;

        for (const response of await Promise.all(batch)) {
          failure ??= platformResponseError(platform, response);

          const detail = findPlatformDetail(platform, response, id);
          if (detail)
            return {
              ...platformInfo(platform, detail, url),
              http_headers: { 'User-Agent': userAgent, Referer: `https://${host}/` },
            };
        }

        const state = await page.evaluate(() => {
          const values: unknown[] = [];
          const scope = window as unknown as Record<string, unknown>;
          for (const key of [
            '_SSR_HYDRATED_DATA',
            '__INITIAL_STATE__',
            '__APOLLO_STATE__',
            '__DATA__',
            'KS_DATA',
            '__NEXT_DATA__',
          ])
            if (scope[key]) values.push(scope[key]);

          const scripts = Array.from(document.querySelectorAll('script'))
            .filter(
              (script) =>
                script.type === 'application/json' ||
                /(?:window\.)?(?:_SSR_HYDRATED_DATA|__INITIAL_STATE__)\s*=/.test(
                  script.textContent ?? '',
                ),
            )
            .map((script) => (script.textContent ?? '').slice(0, 4_000_000));

          return { values, scripts };
        });
        const detail = findPlatformDetail(
          platform,
          [...state.values, ...state.scripts.map(parsePlatformScript)],
          id,
        );
        if (detail)
          return {
            ...platformInfo(platform, detail, url),
            http_headers: { 'User-Agent': userAgent, Referer: `https://${host}/` },
          };

        const candidates = await page.evaluate(() => {
          const title =
            document
              .querySelector('[data-e2e="video-desc"], .video-title, .title, h1')
              ?.textContent?.trim() || document.title;
          const uploader =
            document
              .querySelector('[data-e2e="video-author"], .user-name, [class*="author"]')
              ?.textContent?.trim() || '';

          return Array.from(document.querySelectorAll('video')).map((video) => ({
            url: video.currentSrc || video.src || video.querySelector('source')?.src || '',
            title,
            uploader,
            thumbnail: video.poster,
            duration: Number.isFinite(video.duration) ? video.duration : 0,
            width: video.videoWidth,
            height: video.videoHeight,
          }));
        });
        const dom = candidates.find(
          (candidate) =>
            candidate.duration > 0 &&
            candidate.width > 0 &&
            isPlatformVideoSource(platform, candidate.url, candidate.title),
        );
        if (dom)
          return {
            id: id || String(Date.now()),
            title: dom.title,
            uploader: dom.uploader,
            thumbnail: dom.thumbnail,
            duration: dom.duration,
            webpage_url: url,
            extractor_key: platform === 'douyin' ? 'Douyin' : 'Kuaishou',
            http_headers: { 'User-Agent': userAgent, Referer: `https://${host}/` },
            formats: [
              {
                format_id: 'browser-original',
                url: dom.url,
                ext: 'mp4',
                vcodec: 'unknown',
                acodec: 'unknown',
                width: dom.width,
                height: dom.height,
              },
            ],
          };

        await delay(300, undefined, { signal });
      }

      throw failure ?? new BusinessError('BROWSER_VIDEO_MISSING');
    });
  }
}
