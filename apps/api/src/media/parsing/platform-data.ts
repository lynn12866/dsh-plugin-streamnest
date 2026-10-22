import { BusinessError } from '../../../../shared/src/messages.js';
import type { ExtractorFormat, ExtractorInfo } from '../formats.js';

export type Platform = 'douyin' | 'kuaishou';
export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export const number = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
export const at = (value: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (current, key) => (typeof key === 'number' ? list(current)[key] : object(current)[key]),
    value,
  );

export function platformOf(url: string): Platform | undefined {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'douyin.com' || host.endsWith('.douyin.com')) return 'douyin';
  if (host === 'kuaishou.com' || host.endsWith('.kuaishou.com')) return 'kuaishou';
  return undefined;
}

export function platformVideoId(platform: Platform, url: string): string {
  return (
    (platform === 'douyin' ? /\/video\/(\d+)/ : /\/short-video\/([^/?&#]+)/).exec(url)?.[1] ?? ''
  );
}

/** 页面数据可能为 JSON、URL 编码 JSON 或旧版 window 赋值；只解析数据，不执行脚本。 */
export function parsePlatformScript(content: string): unknown {
  let source = content.trim();

  try {
    if (/^%(?:7b|5b)/i.test(source)) source = decodeURIComponent(source);

    const assignment = /(?:window\.)?(?:_SSR_HYDRATED_DATA|__INITIAL_STATE__)\s*=\s*/.exec(source);
    if (assignment) source = source.slice(assignment.index + assignment[0].length);

    return JSON.parse(source.replace(/;\s*$/, '')) as unknown;
  } catch {
    return undefined;
  }
}

/** Static site animations and challenge clips must never appear as user media. */
export function isPlatformVideoSource(platform: Platform, source: string, title: string): boolean {
  if (!title.trim()) return false;

  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    return !(
      (platform === 'douyin' &&
        (url.hostname === 'douyinstatic.com' || url.hostname.endsWith('.douyinstatic.com'))) ||
      /(?:^|\/)(?:captcha|verify|challenge)(?:\/|[._-])/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** 在响应/SSR 树里定位当前视频，避免误选推荐流的其他视频。 */
export function findPlatformDetail(
  platform: Platform,
  value: unknown,
  expectedId = '',
): JsonObject | undefined {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  for (let count = 0; pending.length && count < 2_000; count++) {
    const next = pending.shift()!;
    const current = object(next.value);
    const id = text(current.aweme_id ?? current.photoId ?? current.id);
    const valid =
      platform === 'douyin'
        ? !!current.video && !!current.aweme_id
        : !!(current.photoUrl || current.mvUrls || current.mainMvUrls || current.manifest);
    if (valid && (!expectedId || !id || id === expectedId)) return current;
    if (next.depth >= 9) continue;
    for (const child of (Array.isArray(next.value) ? next.value : Object.values(current)).slice(
      0,
      300,
    )) {
      if (child && typeof child === 'object') pending.push({ value: child, depth: next.depth + 1 });
    }
  }
  return undefined;
}

export function platformInfo(platform: Platform, detail: JsonObject, url: string): ExtractorInfo {
  const formats: ExtractorFormat[] = [];
  const add = (value: unknown, id: string, fallback?: JsonObject) => {
    const entry = object(value);
    const source = text(entry.url ?? at(entry, 'play_addr', 'url_list', 0));
    if (!/^https?:\/\//.test(source)) return;
    const label = text(entry.gear_name ?? entry.quality);
    const height =
      number(entry.height ?? at(entry, 'play_addr', 'height') ?? fallback?.height) ||
      number(/(\d{3,4})/.exec(label)?.[1]);
    const bitrate = number(entry.avgBitrate ?? entry.bit_rate) / 1000;
    const estimatedBitrate =
      height >= 1080 ? 5_000_000 : height >= 720 ? 2_500_000 : height >= 480 ? 1_500_000 : 800_000;
    formats.push({
      format_id: id,
      url: source,
      ext: 'mp4',
      vcodec: 'h264',
      acodec: 'aac',
      height,
      width: number(entry.width ?? fallback?.width),
      fps: number(entry.fps ?? entry.frameRate) || 30,
      filesize: number(entry.size ?? entry.data_size ?? at(entry, 'play_addr', 'data_size')),
      filesize_approx: Math.floor(((bitrate ? bitrate * 1000 : estimatedBitrate) * duration) / 8),
      tbr: bitrate,
      quality_label: label,
    });
  };
  const duration =
    number(platform === 'douyin' ? at(detail, 'video', 'duration') : detail.duration) / 1000;
  if (platform === 'douyin') {
    const video = object(detail.video);
    list(video.bit_rate).forEach((entry, index) => add(entry, `dy-${index}`));
    if (!formats.length)
      add(
        { ...object(video.play_addr), url: at(video, 'play_addr', 'url_list', 0) },
        'dy-original',
        video,
      );
  } else {
    const adaptations = at(detail, 'manifest', 'adaptationSet');
    for (const adaptation of Array.isArray(adaptations) ? adaptations : [adaptations])
      list(at(adaptation, 'representation')).forEach((entry, index) =>
        add(entry, `ks-${formats.length}-${index}`),
      );
    list(detail.mvUrls).forEach((entry, index) => add(entry, `ks-mv-${index}`));
    if (!formats.length)
      list(detail.mainMvUrls).forEach((entry, index) => add(entry, `ks-main-${index}`, detail));
    if (!formats.length) add({ url: detail.photoUrl, size: detail.size }, 'ks-original', detail);
  }
  if (!formats.length) throw new BusinessError('PLATFORM_VIDEO_MISSING');
  return {
    id: text(detail.aweme_id ?? detail.photoId ?? detail.id) || platformVideoId(platform, url),
    title: text(detail.desc ?? detail.caption) || (platform === 'douyin' ? '抖音视频' : '快手视频'),
    description: text(detail.desc ?? detail.caption),
    uploader: text(at(detail, 'author', 'nickname') ?? detail.userName ?? detail.authorName),
    duration,
    thumbnail: text(
      at(detail, 'video', 'cover', 'url_list', 0) ??
        at(detail, 'coverUrls', 0, 'url') ??
        detail.coverUrl,
    ),
    webpage_url: url,
    extractor_key: platform === 'douyin' ? 'Douyin' : 'Kuaishou',
    extractor: platform,
    formats,
  };
}
