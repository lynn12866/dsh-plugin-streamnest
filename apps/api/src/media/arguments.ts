import { dirname } from 'node:path';

import type { DownloadRequest, MediaInfo, Preferences } from '../../../shared/src/contracts.js';
import { browserCookieSource, effectiveLoginPreferences } from '../../../shared/src/cookies.js';

export const PROGRESS_PREFIX = '[mv-progress]';
export const FILE_PREFIX = '[mv-file]';
export const POSTPROCESS_PREFIX = '[mv-process]';
export const ENGINE_PREFIX = '[mv-engine]';

export function commonArguments(
  preferences: Preferences,
  options: { cookies?: boolean; runtime?: boolean } = {},
): string[] {
  preferences = effectiveLoginPreferences(preferences);
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--playlist-items',
    '1',
    '--encoding',
    'utf-8',
    '--socket-timeout',
    '20',
    '--retries',
    '3',
  ];
  if (preferences.proxy) args.push('--proxy', preferences.proxy);
  if (options.cookies !== false && preferences.cookiesFile)
    args.push('--cookies', preferences.cookiesFile);
  else if (options.cookies !== false && preferences.cookieBrowser)
    args.push('--cookies-from-browser', browserCookieSource(preferences));

  // Harness runs on Node; never use the Electron launcher as a JS runtime.
  if (options.runtime !== false && !process.versions.electron)
    args.push('--js-runtimes', `node:${process.execPath}`);
  return args;
}

export function downloadArguments(
  media: MediaInfo,
  request: DownloadRequest,
  preferences: Preferences,
  outputDirectory: string,
  ffmpeg?: string,
  context?: {
    cookieArgs: string[];
    jsRuntime?: { kind: string; path: string };
    extractorArgs: string[];
    cachePath?: string;
    aria2Path?: string;
  },
): string[] {
  const format = media.formats.find((entry) => entry.id === request.formatId);
  const track = media.audioTracks.find((entry) => entry.id === request.audioTrackId);
  const audio = track?.id ?? 'bestaudio';
  const preferredHeight = Number(preferences.preferredQuality);
  const bestVideo =
    preferredHeight > 0
      ? `bv*[height<=${preferredHeight}]+${audio}/b[height<=${preferredHeight}]`
      : `bv*+${audio}/b`;
  const selector = track?.isM3u8
    ? (track.formatId ?? track.id)
    : !format
      ? bestVideo
      : format.hasAudio && !track
        ? `${format.id}/bv*+ba/b`
        : `${format.id}+${audio}/${format.id}/bv*+ba/b`;
  const args = [
    ...commonArguments(preferences, context ? { cookies: false, runtime: !context.jsRuntime } : {}),
    '--no-overwrites',
    '--continue',
    '--newline',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    '--progress-template',
    `postprocess:${POSTPROCESS_PREFIX}%(progress.status)s`,
    '--print',
    `after_move:${FILE_PREFIX}%(filepath)s`,
    '--concurrent-fragments',
    String(preferences.fragments),
    '--http-chunk-size',
    '10M',
    '--paths',
    outputDirectory,
    '-o',
    completeFilenameTemplate(preferences.filenameTemplate),
  ];
  if (ffmpeg) args.push('--ffmpeg-location', dirname(ffmpeg));

  if (request.mode === 'subtitle') args.push('--skip-download');
  else if (request.mode === 'audio')
    args.push(
      '-f',
      request.audioFormatId ?? track?.id ?? 'bestaudio/best',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
    );
  else args.push('-f', selector, '--merge-output-format', 'mp4');

  if (request.subtitles?.length)
    args.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      request.subtitles.join(','),
      '--sub-format',
      'srt/best',
    );
  if (request.subtitles?.length && request.subtitleFormat !== 'source')
    args.push('--convert-subs', 'srt');

  if (context) {
    args.push(...context.cookieArgs, ...context.extractorArgs);
    if (context.jsRuntime)
      args.push('--js-runtimes', `${context.jsRuntime.kind}:${context.jsRuntime.path}`);
    if (context.aria2Path) {
      const connections =
        preferences.acceleration?.enabled === false
          ? 1
          : (preferences.acceleration?.maxConnections ?? 8);
      args.push(
        '--downloader',
        `http:${context.aria2Path}`,
        '--downloader',
        'dash,m3u8:native',
        '--downloader-args',
        `aria2c:--no-conf=true --max-connection-per-server=${connections} --split=${connections} --min-split-size=1M --file-allocation=none --max-tries=3 --retry-wait=2 --connect-timeout=15 --timeout=30 --auto-save-interval=1 --check-certificate=true --enable-color=false --human-readable=false --summary-interval=1`,
        '--paths',
        `temp:${outputDirectory}/.aria2`,
      );
    }
  }
  if (context?.cachePath) args.push('--load-info-json', context.cachePath);
  else args.push('--', media.url);
  return args;
}

export function completeFilenameTemplate(template = '%(title).160B [%(id)s].%(ext)s'): string {
  return template.includes('%(ext)') ? template : `${template}.%(ext)s`;
}

export function parseProgress(line: string) {
  if (!line.startsWith(PROGRESS_PREFIX)) return undefined;

  const values = line
    .slice(PROGRESS_PREFIX.length)
    .split('|')
    .map((value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(0, number) : 0;
    });
  const [downloadedBytes = 0, exact = 0, estimate = 0, speed = 0, eta = 0] = values;
  const totalBytes = exact || estimate;

  return {
    downloadedBytes,
    totalBytes,
    speed,
    eta,
    progress: totalBytes ? Math.min(99, (downloadedBytes / totalBytes) * 100) : 0,
  };
}
