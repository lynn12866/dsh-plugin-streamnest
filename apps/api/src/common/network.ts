import { BusinessError } from '../../../shared/src/messages.js';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export interface NetworkOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  proxy?: string;
  timeoutMs?: number;
  validateUrl?: (url: URL) => void | Promise<void>;
}

/** 同一传输层用于平台 API、CDN、缩略图与代理测试；保留证书校验。 */
async function requestOnce(url: URL, options: NetworkOptions): Promise<Response> {
  options.signal?.throwIfAborted();
  if (!['http:', 'https:'].includes(url.protocol)) throw new BusinessError('HTTP_ONLY');
  const agent = !options.proxy
    ? undefined
    : options.proxy.startsWith('socks')
      ? new SocksProxyAgent(options.proxy)
      : url.protocol === 'https:'
        ? new HttpsProxyAgent(options.proxy)
        : new HttpProxyAgent(options.proxy);

  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? requestHttps : requestHttp;
    const request = send(
      url,
      { method: options.method ?? 'GET', headers: options.headers, agent, signal: options.signal },
      (incoming) => {
        clearTimeout(headerTimer);
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
        }
        incoming.once('close', () => agent?.destroy());
        const status = incoming.statusCode ?? 502;
        const withoutBody = options.method === 'HEAD' || [204, 205, 304].includes(status);
        const encoding = incoming.headers['content-encoding'];
        const decompressor =
          encoding === 'gzip'
            ? createGunzip()
            : encoding === 'br'
              ? createBrotliDecompress()
              : encoding === 'deflate'
                ? createInflate()
                : undefined;
        if (decompressor) {
          incoming.once('error', (error) => decompressor.destroy(error));
          headers.delete('content-encoding');
          headers.delete('content-length');
        }
        const stream = decompressor ? incoming.pipe(decompressor) : incoming;
        const body = withoutBody ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>);
        if (withoutBody) incoming.resume();
        const result = new Response(body, { status, statusText: incoming.statusMessage, headers });
        Object.defineProperty(result, 'url', { value: url.href });
        resolve(result);
      },
    );
    const headerTimer = setTimeout(
      () => request.destroy(new BusinessError('RESPONSE_TIMEOUT')),
      options.timeoutMs ?? 30_000,
    );
    headerTimer.unref();
    request.setTimeout(options.timeoutMs ?? 30_000, () =>
      request.destroy(new BusinessError('CONNECTION_TIMEOUT')),
    );
    request.once('error', (error) => {
      clearTimeout(headerTimer);
      agent?.destroy();
      reject(error);
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}

export async function fetchNetwork(input: string, options: NetworkOptions = {}): Promise<Response> {
  let url = new URL(input);
  let current = { ...options, headers: { ...options.headers } };
  for (let redirects = 0; redirects <= 8; redirects++) {
    await current.validateUrl?.(url);
    const response = await requestOnce(url, current);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel();
    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      current.headers = Object.fromEntries(
        Object.entries(current.headers).filter(
          ([name]) => !['cookie', 'authorization'].includes(name.toLowerCase()),
        ),
      );
    }
    if (
      response.status === 303 ||
      ([301, 302].includes(response.status) && current.method === 'POST')
    )
      current = { ...current, method: 'GET', body: undefined };
    url = next;
  }
  throw new BusinessError('TOO_MANY_REDIRECTS');
}
