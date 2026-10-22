import {
  parseMessage,
  BusinessError,
  businessMessage,
  type BusinessMessage,
} from '../../../shared/src/messages.js';
import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { DownloadRequest, MediaInfo, Preferences } from '../../../shared/src/contracts.js';
import { RuntimeService } from '../runtime/runtime.service.js';
import { runProcess } from '../common/process.js';
import {
  commonArguments,
  completeFilenameTemplate,
  downloadArguments,
  FILE_PREFIX,
  ENGINE_PREFIX,
  POSTPROCESS_PREFIX,
  PROGRESS_PREFIX,
  parseProgress,
} from './arguments.js';
import { normalizeInfo, type ExtractorInfo } from './formats.js';
import { extractMediaLink } from '../../../shared/src/links.js';
import { isRefererThumbnail, thumbnailPath } from '../../../shared/src/thumbnail.js';
import {
  classifyParseError,
  parseDiagnostic,
  type ParseErrorKind,
} from '../../../shared/src/parse-errors.js';
import { fetchNetwork } from '../common/network.js';
import { CookieService, isCookieReadError } from './parsing/cookie.service.js';
import { ParseCache, type ParseRecord } from './parsing/cache.service.js';
import { PlatformParser } from './parsing/platform-parser.service.js';
import { platformOf } from './parsing/platform-data.js';
import {
  nextYoutubeRetry,
  youtubeExtractorArgs,
  type YoutubeRetryState,
} from './parsing/youtube-retry.js';
import { downloadDirectFile } from './engines/direct.js';
import { checkJsRuntime } from './engines/js-runtime.js';
import { detectAria2 } from './engines/aria2.js';
import { parseAria2Progress } from './engines/aria2-progress.js';
import { WechatService } from './wechat/wechat.service.js';
import { isWechatUrl } from './wechat/api.js';
import { decodeWechatFile } from './wechat/decode.js';

function privateAddress(address: string): boolean {
  if (address.includes(':')) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:')) return privateAddress(value.slice(7));
    return value === '::1' || value === '::' || /^(fc|fd|fe[89ab])/.test(value);
  }
  const octets = address.split('.').map(Number);
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export async function validateMediaUrl(input: string, signal?: AbortSignal): Promise<string> {
  let url: URL;
  try {
    url = new URL(extractMediaLink(input));
  } catch {
    throw new BadRequestException(businessMessage('MEDIA_URL_INVALID'));
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    input.length > 4_096
  )
    throw new BadRequestException(businessMessage('MEDIA_URL_CREDENTIALS'));
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local'))
    throw new BadRequestException(businessMessage('MEDIA_URL_PUBLIC_REQUIRED'));
  signal?.throwIfAborted();
  const records = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  signal?.throwIfAborted();
  if (!records.length || records.some((record) => privateAddress(record.address)))
    throw new BadRequestException(businessMessage('MEDIA_URL_PRIVATE'));
  url.hash = '';
  return url.href;
}

@Injectable()
export class MediaEngine {
  constructor(
    private readonly runtime: RuntimeService,
    private readonly cache: ParseCache,
    private readonly cookies: CookieService,
    private readonly platforms: PlatformParser,
    private readonly wechat: WechatService,
  ) {}

  async parse(
    input: string,
    preferences: Preferences,
    externalSignal?: AbortSignal,
    refresh = false,
  ): Promise<MediaInfo> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(150_000),
      ...(externalSignal ? [externalSignal] : []),
    ]);
    const url = await validateMediaUrl(input, signal);
    await this.cookies.validateSource(preferences);
    const cached = refresh ? undefined : await this.cache.find(url, preferences);
    if (cached) return this.media(cached);
    if (isWechatUrl(url)) {
      const info = await this.wechat.parse(url, preferences, signal);
      return this.save(
        url,
        info,
        'wechat',
        [],
        preferences,
        businessMessage('PARSE_WECHAT_RESOLVED'),
      );
    }
    const platform = platformOf(url);
    const attempts: string[] = [];
    const failures = new Set<ParseErrorKind>();
    if (platform) {
      try {
        const binary = await this.runtime.require('yt-dlp', preferences, signal);
        await this.cookies.prepare(preferences, binary, signal);
      } catch {
        signal.throwIfAborted();
      }

      for (const method of ['api', 'browser'] as const) {
        try {
          const info = await this.platforms[method](platform, url, preferences, signal);
          return await this.save(
            url,
            info,
            `${platform}-${method}`,
            [],
            preferences,
            businessMessage(attempts.length ? 'PARSE_BROWSER_RECOVERED' : 'NONE'),
          );
        } catch (error) {
          signal.throwIfAborted();
          attempts.push(`${platform}-${method}`);
          failures.add(classifyParseError(String(error)));
        }
      }
    }
    try {
      return await this.parseWithYtdlp(url, preferences, signal, attempts);
    } catch (error) {
      signal.throwIfAborted();

      if (!platform || classifyParseError(String(error)) !== 'unsupported-url') throw error;

      const priority: ParseErrorKind[] = [
        'verification-required',
        'authentication',
        'access-denied',
        'rate-limit',
        'not-found',
        'network',
      ];
      const category = priority.find((kind) => failures.has(kind)) ?? 'unknown';

      throw new BadRequestException(
        parseMessage(category, parseDiagnostic(`[[parse-error:${category}]]`)),
      );
    }
  }

  private media(record: ParseRecord): MediaInfo {
    if (record.info.is_live) throw new BadRequestException(businessMessage('LIVE_UNSUPPORTED'));
    return {
      ...normalizeInfo(record.info, record.url, record.id),
      ...(isRefererThumbnail(record.info.thumbnail ?? '')
        ? { thumbnail: thumbnailPath(record.id) }
        : {}),
      parser: record.parser,
      notice: record.notice,
      noticeInfo:
        record.noticeInfo ??
        businessMessage(
          record.notice ? 'LEGACY_MESSAGE' : 'NONE',
          { reason: record.notice },
          record.notice,
        ),
    };
  }

  private async save(
    url: string,
    info: ExtractorInfo,
    parser: string,
    extractorArgs: string[],
    preferences: Preferences,
    notice: BusinessMessage = businessMessage('NONE'),
  ): Promise<MediaInfo> {
    const record: ParseRecord = {
      id: randomUUID(),
      createdAt: Date.now(),
      url,
      info,
      parser,
      extractorArgs,
      notice: notice.message,
      noticeInfo: notice,
    };
    const media = this.media(record);
    await this.cache.save(record, preferences);
    return media;
  }

  private async parseWithYtdlp(
    url: string,
    preferences: Preferences,
    signal: AbortSignal,
    attempts: string[],
  ): Promise<MediaInfo> {
    const binary = await this.runtime.require('yt-dlp', preferences, signal);
    const host = new URL(url).hostname;
    const youtube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
    const twitter = /(^|\.)(?:x|twitter)\.com$/.test(host);
    const js = youtube ? await checkJsRuntime(signal) : undefined;
    if (youtube && !js?.available)
      throw new BadRequestException(businessMessage('PARSE_RUNTIME_UNAVAILABLE'));
    const status = youtube ? await this.runtime.status(preferences, signal) : undefined;
    const version = status?.results.find((entry) => entry.kind === 'yt-dlp')?.version ?? '';
    let state: YoutubeRetryState = { manifests: false, client: '' };
    let extractorArgs: string[] = [];
    let retries = 0;
    try {
      const result = await this.cookies.run(
        preferences,
        async (cookieArgs) => {
          while (true) {
            signal.throwIfAborted();
            const extra = youtube ? youtubeExtractorArgs(state) : extractorArgs;
            const base = commonArguments(preferences, { cookies: false, runtime: !youtube });
            if (js?.kind && js.path) base.push('--js-runtimes', `${js.kind}:${js.path}`);
            try {
              const result = await runProcess(
                binary,
                [
                  ...base,
                  '--dump-single-json',
                  '--skip-download',
                  ...extra,
                  ...cookieArgs,
                  '--',
                  url,
                ],
                { signal, timeoutMs: 90_000 },
              );
              extractorArgs = extra;
              return result;
            } catch (error) {
              signal.throwIfAborted();
              if (isCookieReadError(error)) throw error;
              const next =
                youtube && retries < 2 ? nextYoutubeRetry(String(error), state, version) : null;
              if (next) {
                state = next;
                retries++;
                continue;
              }
              if (twitter && !extractorArgs.length) {
                extractorArgs = ['--extractor-args', 'twitter:api=syndication'];
                continue;
              }
              throw error;
            }
          }
        },
        signal,
      );
      let info = JSON.parse(result.stdout) as ExtractorInfo;
      if (info._type === 'playlist') info = info.entries?.find((entry) => !!entry) ?? info;
      return this.save(
        url,
        info,
        'yt-dlp',
        extractorArgs,
        preferences,
        retries || extractorArgs.length || attempts.length
          ? businessMessage('PARSE_COMPATIBILITY_RECOVERED')
          : businessMessage('NONE'),
      );
    } catch (error) {
      signal.throwIfAborted();
      throw new BadRequestException(
        parseMessage(
          classifyParseError(String(error)),
          `[[parse-error:${classifyParseError(String(error))}]]${parseDiagnostic(String(error), { ytdlp: version, runtime: js?.kind && js.version ? `${js.kind}@${js.version}` : undefined })}`,
        ),
      );
    }
  }

  async download(
    media: MediaInfo,
    request: DownloadRequest,
    preferences: Preferences,
    directory: string,
    signal: AbortSignal,
    line: (value: string) => void,
  ): Promise<void> {
    await validateMediaUrl(media.url, signal);
    const binary = await this.runtime.require('yt-dlp', preferences, signal);
    let record = await this.cache.get(media.id);
    if (!record && (platformOf(media.url) || isWechatUrl(media.url))) {
      const refreshed = await this.parse(media.url, preferences, signal, true);
      record = await this.cache.get(refreshed.id);
    }
    let lock = await this.cache.engine(directory);
    const candidates =
      record?.info.formats
        ?.filter((entry) => entry.vcodec !== 'none' && entry.url)
        .sort(
          (left, right) =>
            (right.height ?? 0) - (left.height ?? 0) || (right.tbr ?? 0) - (left.tbr ?? 0),
        ) ?? [];
    const selected = media.formats.find((entry) => entry.id === request.formatId);
    const selectedRaw = candidates.find((entry) => entry.format_id === request.formatId);
    const heightLimit = Number(preferences.preferredQuality) || Infinity;
    const direct =
      selectedRaw ??
      (selected?.height
        ? candidates.find(
            (entry) => entry.height === selected.height && (entry.fps ?? 0) === selected.fps,
          )
        : undefined) ??
      (!request.formatId
        ? candidates.find((entry) => !entry.height || entry.height <= heightLimit)
        : undefined) ??
      (record?.info.url ? record.info : undefined);
    if (record?.parser === 'wechat') {
      if (!direct?.url || request.mode === 'subtitle')
        throw new BusinessError('WECHAT_FORMAT_UNAVAILABLE');
      await this.cache.saveEngine(directory, 'native');
      line(`${ENGINE_PREFIX}native`);
      await this.nativeDownload(
        binary,
        record,
        direct,
        media,
        request,
        preferences,
        directory,
        signal,
        line,
      );
      return;
    }
    const native =
      request.mode === 'video' &&
      !request.subtitles?.length &&
      !request.audioTrackId &&
      !!direct?.url &&
      (record?.parser !== 'yt-dlp' || /\.(?:mp4|webm|mov)(?:\?|$)/i.test(media.url));
    if (native && (!lock || lock === 'native')) {
      await this.cache.saveEngine(directory, 'native');
      line(`${ENGINE_PREFIX}native`);
      try {
        await this.nativeDownload(
          binary,
          record!,
          direct!,
          media,
          request,
          preferences,
          directory,
          signal,
          line,
        );
        return;
      } catch (error) {
        signal.throwIfAborted();
        lock = undefined;
        if (classifyParseError(String(error)) === 'network')
          line(`${POSTPROCESS_PREFIX}直链重试失败，切换兼容下载器。`);
      }
    }
    // SRT 转换也需要 FFmpeg；源字幕可直接保存。
    const ffmpeg =
      request.mode === 'subtitle' && request.subtitleFormat === 'source'
        ? undefined
        : await this.runtime.require('ffmpeg', preferences, signal);
    const js = /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(media.url).hostname)
      ? await checkJsRuntime(signal)
      : undefined;
    const acceleration = preferences.acceleration;
    const aria2 =
      lock === 'aria2' ||
      (!lock && acceleration?.enabled !== false && (acceleration?.maxConnections ?? 8) > 1)
        ? await detectAria2(acceleration?.aria2Path ?? '', '', signal)
        : undefined;
    if (lock === 'aria2' && !aria2?.path) throw new BusinessError('ARIA2_RESUME_REQUIRED');
    const aria2Path = request.mode !== 'subtitle' && aria2?.path ? aria2.path : undefined;
    await this.cache.saveEngine(directory, aria2Path ? 'aria2' : 'yt-dlp');
    line(`${ENGINE_PREFIX}${aria2Path ? 'aria2' : 'yt-dlp'}`);
    await this.cookies.run(
      preferences,
      async (cookieArgs) => {
        let started = false;
        const progress = (value: string) => {
          if (
            (parseProgress(value)?.downloadedBytes ?? 0) > 0 ||
            value.startsWith(POSTPROCESS_PREFIX) ||
            value.startsWith(FILE_PREFIX)
          )
            started = true;
          const aria = parseAria2Progress(value);
          if (aria)
            line(
              `${PROGRESS_PREFIX}${aria.downloaded}|${aria.total}|NA|${aria.speed}|${aria.speed ? (aria.total - aria.downloaded) / aria.speed : 0}`,
            );
          line(value);
        };
        const context = {
          cookieArgs,
          extractorArgs: record?.extractorArgs ?? [],
          jsRuntime: js?.kind && js.path ? { kind: js.kind, path: js.path } : undefined,
          aria2Path,
          cachePath: record ? this.cache.infoPath(record.id) : undefined,
        };
        try {
          return await runProcess(
            binary,
            downloadArguments(media, request, preferences, directory, ffmpeg, context),
            { signal, line: progress, timeoutMs: 0 },
          );
        } catch (error) {
          signal.throwIfAborted();
          if (started || !context.cachePath || isCookieReadError(error)) throw error;
          return runProcess(
            binary,
            downloadArguments(media, request, preferences, directory, ffmpeg, {
              ...context,
              cachePath: undefined,
            }),
            { signal, line: progress, timeoutMs: 0 },
          );
        }
      },
      signal,
      true,
    );
  }

  private async nativeDownload(
    binary: string,
    record: ParseRecord,
    direct: NonNullable<ExtractorInfo['formats']>[number],
    media: MediaInfo,
    request: DownloadRequest,
    preferences: Preferences,
    directory: string,
    signal: AbortSignal,
    line: (value: string) => void,
  ): Promise<void> {
    const name = await runProcess(
      binary,
      [
        ...commonArguments(preferences, { cookies: false }),
        '--load-info-json',
        this.cache.infoPath(record.id),
        '--skip-download',
        '--print',
        'filename',
        '--paths',
        directory,
        '-o',
        completeFilenameTemplate(preferences.filenameTemplate),
        '-f',
        direct.format_id ?? request.formatId ?? 'best',
      ],
      { signal, timeoutMs: 45_000 },
    );
    const output = resolve(directory, name.stdout.trim().split('\n').at(-1) ?? '');
    const inside = relative(resolve(directory), output);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new BusinessError('OUTPUT_PATH_ESCAPE');
    const temporary = join(directory, '.native', inside);
    await mkdir(dirname(temporary), { recursive: true });
    await downloadDirectFile({
      url: direct.url!,
      pageUrl: media.url,
      outputPath: temporary,
      signal,
      acceleration: preferences.acceleration,
      request: (url, options = {}) =>
        fetchNetwork(url, {
          ...options,
          proxy: preferences.proxy,
          ...(record.parser === 'wechat'
            ? {
                validateUrl: async (url: URL) => {
                  await validateMediaUrl(url.href, signal);
                },
              }
            : {}),
          headers: {
            ...record.info.http_headers,
            ...direct.http_headers,
            ...options.headers,
            'Accept-Encoding': 'identity',
          },
        }),
      report: (value) =>
        line(
          `${PROGRESS_PREFIX}${value.downloadedBytes}|${value.totalBytes}|NA|${value.speed}|${value.eta}`,
        ),
    });
    signal.throwIfAborted();
    await mkdir(dirname(output), { recursive: true });
    if (record.parser === 'wechat') {
      const decoded = `${temporary}.decoded-${randomUUID()}.mp4`;
      const audio = `${temporary}.audio-${randomUUID()}.mp3`;
      try {
        line(`${POSTPROCESS_PREFIX}正在处理视频号媒体文件…`);
        await decodeWechatFile(temporary, decoded, direct.wechat_decode_key ?? '', signal);
        const probe = await this.runtime.require('ffprobe', preferences, signal);
        const verified = await runProcess(
          probe,
          ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', decoded],
          { signal, timeoutMs: 30_000 },
        );
        const streams = (JSON.parse(verified.stdout) as { streams?: { codec_type: string }[] })
          .streams;
        if (!streams?.some((stream) => stream.codec_type === 'video'))
          throw new BusinessError('WECHAT_VIDEO_TRACK_MISSING');
        if (request.mode === 'audio') {
          const ffmpeg = await this.runtime.require('ffmpeg', preferences, signal);
          await runProcess(
            ffmpeg,
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-nostdin',
              '-y',
              '-i',
              decoded,
              '-vn',
              '-codec:a',
              'libmp3lame',
              '-b:a',
              '192k',
              audio,
            ],
            { signal, timeoutMs: 0 },
          );
          const audioOutput = output.replace(/\.[^./\\]+$/, '') + '.mp3';
          await rename(audio, audioOutput);
          line(`${FILE_PREFIX}${audioOutput}`);
        } else {
          await rename(decoded, output);
          line(`${FILE_PREFIX}${output}`);
        }
        await rm(temporary, { force: true });
        return;
      } finally {
        await Promise.all([rm(decoded, { force: true }), rm(audio, { force: true })]);
      }
    }
    await rename(temporary, output);
    line(`${FILE_PREFIX}${output}`);
  }
}
