import { businessMessage, BusinessError } from '../../../shared/src/messages.js';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Preferences } from '../../../shared/src/contracts.js';
import { isRefererThumbnail } from '../../../shared/src/thumbnail.js';
import { fetchNetwork } from '../common/network.js';
import { ParseCache } from './parsing/cache.service.js';
import { validateMediaUrl } from './media.engine.js';
import { RuntimeService } from '../runtime/runtime.service.js';
import { DATA_DIRECTORY } from '../storage/vault.store.js';
import { runProcess } from '../common/process.js';

const MAX_BYTES = 8 * 1024 * 1024;

@Injectable()
export class ThumbnailService implements OnModuleDestroy {
  private pending = Promise.resolve();
  private readonly lifecycle = new AbortController();

  constructor(
    private readonly cache: ParseCache,
    private readonly runtime: RuntimeService,
    @Inject(DATA_DIRECTORY) private readonly dataDirectory: string,
  ) {}

  async getTask(
    id: string,
    path: string,
    preferences: Preferences,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const combined = AbortSignal.any([this.lifecycle.signal, ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const info = await stat(path);
    const digest = createHash('sha256')
      .update(`v2:${path}:${info.size}:${info.mtimeMs}`)
      .digest('hex');
    const directory = join(this.dataDirectory, 'thumbnails');
    const target = join(directory, `${id}-${digest.slice(0, 24)}.jpg`);
    const cached = await readFile(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (cached) return cached;

    const operation = this.pending.then(async () => {
      combined.throwIfAborted();
      const existing = await readFile(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (existing) return existing;

      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `${randomUUID()}.jpg`);
      try {
        const binary = await this.runtime.require('ffmpeg', preferences, combined);
        let seekTime = 1;
        try {
          const probe = await this.runtime.require('ffprobe', preferences, combined);
          const result = await runProcess(
            probe,
            [
              '-v',
              'error',
              '-protocol_whitelist',
              'file,pipe',
              '-show_entries',
              'format=duration',
              '-of',
              'json',
              path,
            ],
            { signal: combined, timeoutMs: 15_000 },
          );
          const duration = Number(
            (JSON.parse(result.stdout) as { format?: { duration?: string } }).format?.duration,
          );
          if (Number.isFinite(duration) && duration > 0) seekTime = Math.min(duration / 4, 60);
        } catch (error) {
          if (combined.aborted) throw error;
          // FFprobe is optional; FFmpeg can still provide an opening frame.
        }
        for (const seek of [String(seekTime), '0']) {
          await runProcess(
            binary,
            [
              '-nostdin',
              '-v',
              'error',
              '-y',
              '-protocol_whitelist',
              'file,pipe',
              '-ss',
              seek,
              '-i',
              path,
              '-an',
              '-sn',
              '-dn',
              '-frames:v',
              '1',
              '-vf',
              'scale=192:108:force_original_aspect_ratio=decrease',
              '-q:v',
              '4',
              '-threads',
              '1',
              '-f',
              'image2',
              temporary,
            ],
            { signal: combined, timeoutMs: 15_000 },
          );
          const image = await readFile(temporary).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return undefined;
          });
          if (!image?.length) continue;

          combined.throwIfAborted();
          await rename(temporary, target);
          return image;
        }
        throw new NotFoundException(businessMessage('ARTIFACT_NOT_FOUND'));
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async onModuleDestroy(): Promise<void> {
    this.lifecycle.abort(new BusinessError('PLUGIN_STOPPING'));
    await this.pending;
  }

  /** 仅代理已解析媒体的已知图片 CDN，不接受任意 URL，也不转发登录凭据。 */
  async get(id: string, preferences: Preferences, signal?: AbortSignal) {
    const record = await this.cache.get(id, 30 * 60_000);
    if (!record?.info.thumbnail) throw new NotFoundException(businessMessage('THUMBNAIL_EXPIRED'));
    const timeout = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
    const response = await fetchNetwork(record.info.thumbnail, {
      proxy: preferences.proxy,
      signal: timeout,
      headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' },
      validateUrl: async (url) => {
        if (!isRefererThumbnail(url.href))
          throw new BadRequestException(businessMessage('THUMBNAIL_SOURCE_INVALID'));
        await validateMediaUrl(url.href, timeout);
      },
    });
    const type = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
    if (!response.ok || !/^image\/(jpeg|png|gif|webp|avif)$/.test(type) || !response.body) {
      await response.body?.cancel();
      throw new BadRequestException(businessMessage('THUMBNAIL_MISSING'));
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new BadRequestException(businessMessage('THUMBNAIL_TOO_LARGE'));
        chunks.push(value);
      }
      return { type, body: Buffer.concat(chunks, size) };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
