import type { MediaFormat, MediaInfo } from '../../../shared/src/contracts.js';

export interface ExtractorFormat {
  url?: string;
  /** Private parse-cache metadata, never exposed by normalizeInfo. */
  wechat_decode_key?: string;
  format_id?: string;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  protocol?: string;
  height?: number;
  fps?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  abr?: number;
  language?: string;
  format_note?: string;
  width?: number;
  quality_label?: string;
  http_headers?: Record<string, string>;
}

export interface ExtractorInfo extends ExtractorFormat {
  id?: string;
  title?: string;
  uploader?: string;
  extractor_key?: string;
  duration?: number;
  thumbnail?: string;
  formats?: ExtractorFormat[];
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
  is_live?: boolean;
  webpage_url?: string;
  description?: string;
  extractor?: string;
  _type?: string;
  entries?: ExtractorInfo[];
}

const numeric = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

export function normalizeFormats(info: ExtractorInfo): MediaFormat[] {
  // Generic direct-file extractors put the selected format at the top level.
  const available = info.formats?.length
    ? info.formats
    : info.url
      ? [{ ...info, format_id: info.format_id ?? 'best' }]
      : [];
  const candidates = available.filter(
    (format) =>
      format.vcodec !== 'none' &&
      (numeric(format.height) > 0 || typeof format.url === 'string') &&
      typeof format.format_id === 'string',
  );
  const directHeights = new Set(
    candidates
      .filter((format) => !format.protocol?.includes('m3u8'))
      .map((format) => format.height),
  );
  const formats = new Map<string, MediaFormat>();

  for (const format of candidates.sort((a, b) => numeric(b.tbr) - numeric(a.tbr))) {
    if (format.protocol?.includes('m3u8') && directHeights.has(format.height)) continue;

    const height = numeric(format.height);
    const fps = numeric(format.fps);
    const key = `${height}:${fps}:${height ? '' : (format.quality_label ?? '')}`;
    if (formats.has(key)) continue;

    formats.set(key, {
      id: format.format_id!,
      label: height
        ? `${height >= 2160 ? '4K' : height >= 1440 ? '2K' : `${height}P`}${fps > 30 ? ` · ${fps}fps` : ''}`
        : format.quality_label?.slice(0, 100) ||
          `原始格式 · ${(format.ext ?? 'mp4').toUpperCase()}`,
      extension: format.ext ?? 'mp4',
      height,
      fps,
      bytes:
        numeric(format.filesize) ||
        numeric(format.filesize_approx) ||
        Math.floor((numeric(format.tbr) * 1000 * numeric(info.duration)) / 8),
      hasAudio: format.acodec !== 'none',
    });
  }

  return [...formats.values()].sort((a, b) => b.height - a.height || b.fps - a.fps);
}

export function normalizeInfo(info: ExtractorInfo, url: string, id: string): MediaInfo {
  const tracks = (info.formats ?? [])
    .filter(
      (format) =>
        format.vcodec === 'none' && format.acodec !== 'none' && format.language && format.format_id,
    )
    .sort((a, b) => numeric(b.abr) - numeric(a.abr));
  const languages = new Map<string, { id: string; language: string; label: string }>();

  for (const track of tracks) {
    if (languages.has(track.language!)) continue;
    languages.set(track.language!, {
      id: track.format_id!,
      language: track.language!,
      label: track.language!,
    });
  }

  const m3u8Tracks = new Map<string, ExtractorFormat>();
  for (const format of info.formats ?? []) {
    if (!format.protocol?.includes('m3u8') || !format.language || !format.format_id) continue;
    const previous = m3u8Tracks.get(format.language);
    if (!previous || numeric(format.height) > numeric(previous.height))
      m3u8Tracks.set(format.language, format);
  }
  const audioTracks =
    m3u8Tracks.size > 1
      ? [...m3u8Tracks.entries()].map(([language, format]) => ({
          id: format.format_id!,
          formatId: format.format_id!,
          language,
          label: language,
          // HLS may expose separate language audio streams or complete AV variants.
          // Only a complete AV variant replaces the selected video format.
          isM3u8: format.vcodec !== 'none',
        }))
      : [...languages.values()];
  const audioFormats = (info.formats ?? [])
    .filter((format) => format.vcodec === 'none' && format.acodec !== 'none' && format.format_id)
    .sort((left, right) => numeric(right.abr) - numeric(left.abr))
    .filter(
      (format, index, list) =>
        list.findIndex((other) => numeric(other.abr) === numeric(format.abr)) === index,
    )
    .slice(0, 6)
    .map((format) => ({
      id: format.format_id!,
      label: numeric(format.abr) ? `${numeric(format.abr)} kbps` : (format.format_note ?? '音频'),
      extension: format.ext ?? 'm4a',
      bitrate: numeric(format.abr),
      bytes: numeric(format.filesize) || numeric(format.filesize_approx),
    }));

  return {
    id,
    url,
    title: (info.title ?? '未命名媒体').slice(0, 500),
    uploader: (info.uploader ?? '').slice(0, 200),
    platform: info.extractor_key ?? new URL(url).hostname,
    duration: numeric(info.duration),
    thumbnail: /^https?:\/\//.test(info.thumbnail ?? '') ? info.thumbnail! : '',
    formats: normalizeFormats(info),
    audioTracks,
    audioFormats,
    subtitles: [
      ...new Set([
        ...Object.keys(info.subtitles ?? {}),
        ...Object.keys(info.automatic_captions ?? {}),
      ]),
    ].sort(),
    parsedAt: new Date().toISOString(),
  };
}
