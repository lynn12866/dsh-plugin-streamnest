import { parseMessage, BusinessError, businessMessage } from '../../../../shared/src/messages.js';
import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

import type { ExtractorInfo, ExtractorFormat } from '../formats.js';
import { fetchNetwork, type NetworkOptions } from '../../common/network.js';

const YUANBAO = 'https://yuanbao.tencent.com';
const CHANNELS = 'https://channels.weixin.qq.com';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const loginMessage =
  '视频号分享链接需要腾讯元宝登录状态。请在所选浏览器账号登录 https://yuanbao.tencent.com，保存设置后重新解析；使用 Cookie 文件时需重新导出该站登录信息。';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const positive = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const plain = (value: unknown) =>
  text(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function isWechatUrl(input: string): boolean {
  const url = new URL(input);
  return (
    (url.hostname === 'weixin.qq.com' && /^\/sph\/[\w-]+\/?$/.test(url.pathname)) ||
    (url.hostname === 'channels.weixin.qq.com' &&
      /^\/finder-preview\/pages\/(?:sph|feed)\/?$/.test(url.pathname))
  );
}

/** JSON.parse 之前保留 64 位密钥原文，禁止经过 JS Number 舍入。 */
export function parseWechatJSON(source: string): unknown {
  return JSON.parse(
    source.replace(/("(?:decodeKey|id)"\s*:\s*)(\d{16,})(?=\s*[,}])/g, '$1"$2"'),
  ) as unknown;
}

async function readJSON(response: Response): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new BusinessError('WECHAT_RESPONSE_EMPTY');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new BusinessError('WECHAT_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return object(parseWechatJSON(Buffer.concat(chunks).toString('utf8')));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function mediaURL(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/(?:^|\.)(?:video\.qq\.com|wxapp\.tc\.qq\.com|tc\.qq\.com|qpic\.cn)$/.test(url.hostname)
  )
    throw new BusinessError('WECHAT_CDN_INVALID');
  // Preserve signed CDN parameters, including the authorized preview's codec flag.
  return url.href;
}

export function normalizeWechatFeed(value: unknown, input: string): ExtractorInfo {
  const result = object(value);
  const data = object(result.data);
  if (Number(result.errCode ?? 0) !== 0)
    throw new BadRequestException(businessMessage('WECHAT_ACCESS_DENIED'));
  const error = object(data.errMsg);
  if (positive(error.type) || plain(error.title) || plain(error.content))
    throw new BadRequestException(
      parseMessage(
        'not-found',
        `[[parse-error:not-found]]${[plain(error.title), plain(error.content)].filter(Boolean).join('：').slice(0, 300) || '此视频不可播放。'}`,
      ),
    );
  const shared = object(data.feedInfo);
  if (Object.keys(shared).length) {
    if (Number(shared.mediaType) !== 4)
      throw new BadRequestException(businessMessage('WECHAT_SINGLE_VIDEO_ONLY'));
    const choices = [
      {
        id: 'wx-h264',
        codec: 'h264',
        label: 'H.264 · 兼容格式',
        url: text(object(shared.h264VideoInfo).videoUrl),
      },
      {
        id: 'wx-h265',
        codec: 'hevc',
        label: 'H.265 · 高效格式',
        url: text(object(shared.h265VideoInfo).videoUrl),
      },
    ].filter((entry) => entry.url);
    if (!choices.length && text(shared.videoUrl))
      choices.push({
        id: 'wx-default',
        codec: 'h264',
        label: '默认格式',
        url: text(shared.videoUrl),
      });
    if (!choices.length) throw new BusinessError('WECHAT_VIDEO_MISSING');
    return {
      id: new URL(input).searchParams.get('eid') || new URL(input).pathname.split('/').at(-1),
      title: plain(shared.description) || '视频号视频',
      uploader: text(object(data.authorInfo).nickname),
      extractor_key: '微信视频号',
      extractor: 'streamnest-wechat',
      webpage_url: input,
      thumbnail: text(shared.coverUrl),
      formats: choices.map((choice) => ({
        format_id: choice.id,
        url: mediaURL(choice.url),
        ext: 'mp4',
        protocol: 'https',
        vcodec: choice.codec,
        acodec: 'aac',
        quality_label: choice.label,
      })),
      http_headers: { Referer: `${CHANNELS}/`, 'User-Agent': USER_AGENT },
    };
  }
  const feed = object(data.object);
  const description = object(feed.objectDesc);
  if (Number(description.mediaType) !== 4)
    throw new BadRequestException(businessMessage('WECHAT_SINGLE_VIDEO_ONLY'));
  const media = object(Array.isArray(description.media) ? description.media[0] : undefined);
  const download = mediaURL(text(media.url) + text(media.urlToken));
  const decodeKey =
    typeof media.decodeKey === 'number' && Number.isSafeInteger(media.decodeKey)
      ? String(media.decodeKey)
      : text(media.decodeKey);
  if (decodeKey && (!/^\d{1,20}$/.test(decodeKey) || BigInt(decodeKey) > 0xffffffffffffffffn))
    throw new BusinessError('WECHAT_KEY_EXPIRED');
  const base: ExtractorFormat = {
    format_id: 'wx-default',
    url: download,
    ext: 'mp4',
    protocol: 'https',
    width: positive(media.width),
    height: positive(media.height),
    filesize: positive(media.fileSize),
    vcodec: 'h264',
    acodec: 'aac',
    wechat_decode_key: decodeKey,
  };
  const variants = Array.isArray(media.spec)
    ? media.spec
    : Array.isArray(feed.spec)
      ? feed.spec
      : [];
  const formats: ExtractorFormat[] = [base];
  const seen = new Set<string>();
  for (const raw of variants.slice(0, 30)) {
    const spec = object(raw);
    const id = text(spec.fileFormat);
    if (!/^[\w-]{1,80}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const url = new URL(download);
    url.searchParams.set('X-snsvideoflag', id);
    formats.push({
      ...base,
      format_id: `wx-${id}`,
      url: url.href,
      width: positive(spec.width),
      height: positive(spec.height),
      filesize: undefined,
      fps: positive(spec.vfps) || undefined,
    });
  }
  return {
    id: text(feed.id) || new URL(input).pathname.split('/').at(-1),
    title: plain(description.description) || '视频号视频',
    uploader: text(object(feed.contact).nickname),
    extractor_key: '微信视频号',
    extractor: 'streamnest-wechat',
    webpage_url: input,
    duration: positive(media.videoPlayLen),
    thumbnail: text(media.coverUrl) || text(media.thumbUrl),
    formats,
    http_headers: { Referer: `${CHANNELS}/`, 'User-Agent': USER_AGENT },
  };
}

export async function fetchWechatInfo(
  input: string,
  cookie: string,
  options: Pick<NetworkOptions, 'proxy' | 'signal'>,
  request: typeof fetchNetwork = fetchNetwork,
): Promise<ExtractorInfo> {
  let page = new URL(input);
  if (!isWechatUrl(input)) throw new BusinessError('WECHAT_URL_INVALID');
  if (!page.searchParams.get('eid') || !page.searchParams.get('token')) {
    if (!cookie)
      throw new BadRequestException(
        parseMessage('authentication', `[[parse-error:authentication]]${loginMessage}`),
      );
    const payload = JSON.stringify({ type: 'video_channel_url', url: input, scene: 1 });
    const response = await request(`${YUANBAO}/api/weixin/get_parse_result`, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: YUANBAO,
        Referer: `${YUANBAO}/`,
        Cookie: cookie,
        'Content-Length': String(Buffer.byteLength(payload)),
      },
      body: payload,
      validateUrl: (url) => {
        if (url.origin !== YUANBAO) throw new BusinessError('YUANBAO_REDIRECT_INVALID');
      },
    });
    if ([401, 403].includes(response.status)) {
      await response.body?.cancel();
      throw new BadRequestException(
        parseMessage('authentication', `[[parse-error:authentication]]${loginMessage}`),
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BusinessError('WECHAT_SHARE_HTTP_FAILED', { status: response.status });
    }
    const result = await readJSON(response);
    const playable = text(object(result.data).playable_url);
    if (result.code !== 0 || !playable)
      throw new BadRequestException(businessMessage('WECHAT_LOGIN_REQUIRED'));
    page = new URL(playable);
  }
  if (page.origin !== CHANNELS || !page.searchParams.get('eid') || !page.searchParams.get('token'))
    throw new BusinessError('WECHAT_PARAMETERS_MISSING');
  const url = new URL(`${CHANNELS}/finder-preview/api/feed/get_feed_info`);
  url.searchParams.set(
    '_rid',
    `${Math.floor(Date.now() / 1000).toString(16)}-${randomBytes(4).toString('hex')}`,
  );
  url.searchParams.set('_pageUrl', `${CHANNELS}/finder-preview/pages/feed`);
  const payload = JSON.stringify({
    baseReq: { generalToken: page.searchParams.get('token') },
    exportId: page.searchParams.get('eid'),
  });
  const response = await request(url.href, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: CHANNELS,
      Referer: page.href,
      'User-Agent': USER_AGENT,
      'Content-Length': String(Buffer.byteLength(payload)),
    },
    body: payload,
    validateUrl: (target) => {
      if (target.origin !== CHANNELS) throw new BusinessError('WECHAT_REDIRECT_INVALID');
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new BusinessError('WECHAT_DETAILS_HTTP_FAILED', { status: response.status });
  }
  return normalizeWechatFeed(await readJSON(response), input);
}
