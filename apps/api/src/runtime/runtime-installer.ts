import { BusinessError } from '../../../shared/src/messages.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import type { RuntimeKind } from '../../../shared/src/contracts.js';
import { fetchNetwork } from '../common/network.js';
import type { RuntimeAsset } from './runtime-manifest.js';
import { probeRuntime } from './runtime-discovery.js';
import { BRAND } from '../../../shared/src/brand.js';
import { extractRuntimeZip } from './runtime-archive.js';

interface InstallOptions {
  kind: RuntimeKind;
  target: string;
  asset: RuntimeAsset;
  proxy: string;
  signal: AbortSignal;
  progress: (downloaded: number, total: number) => void;
}

/** 校验、解压、可执行探测全部成功后再替换旧版本；取消和校验失败保留旧文件。 */
export async function installRuntimeAsset(options: InstallOptions): Promise<void> {
  const { target, asset, signal } = options;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.download`;
  const candidate = `${target}.${randomUUID()}.candidate`;
  const backup = `${target}.${randomUUID()}.backup`;
  let promoted = false;
  try {
    const response = await fetchNetwork(asset.url, {
      proxy: options.proxy,
      signal,
      timeoutMs: 30_000,
      headers: {
        'User-Agent': `${BRAND.englishName}/${BRAND.version}`,
        'Accept-Encoding': 'identity',
      },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new BusinessError('RUNTIME_DOWNLOAD_FAILED', { status: response.status });
    }
    const total = Number(response.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    const file = await open(temporary, 'wx', 0o600);
    let downloaded = 0;
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        hash.update(chunk);
        await file.writeFile(chunk);
        downloaded += chunk.length;
        options.progress(downloaded, total);
      }
    } finally {
      await file.close();
    }
    if (hash.digest('hex') !== asset.sha256) throw new BusinessError('RUNTIME_HASH_MISMATCH');
    signal.throwIfAborted();
    if (asset.format === 'zip') await extractRuntimeZip(temporary, asset.entry, candidate, signal);
    else if (asset.format === 'gzip')
      await pipeline(
        createReadStream(temporary),
        createGunzip(),
        createWriteStream(candidate, { mode: 0o700, flags: 'wx' }),
        { signal },
      );
    else await copyFile(temporary, candidate);
    await chmod(candidate, 0o755);
    const version = await probeRuntime(options.kind, candidate, signal, 45_000);
    if (
      asset.version &&
      version !== asset.version &&
      !version.startsWith(`${asset.version}-`) &&
      !version.startsWith(`${asset.version}+`)
    )
      throw new BusinessError('RUNTIME_VERSION_MISMATCH', {
        kind: options.kind,
        expected: asset.version,
        actual: version,
      });
    signal.throwIfAborted();
    if (process.platform === 'win32' && (await stat(target).catch(() => undefined))) {
      await rename(target, backup);
      try {
        await rename(candidate, target);
      } catch (error) {
        await rename(backup, target);
        throw error;
      }
    } else await rename(candidate, target);
    promoted = true;
  } finally {
    await Promise.all([
      rm(temporary, { force: true }),
      rm(candidate, { force: true }),
      ...(promoted ? [rm(backup, { force: true })] : []),
    ]);
  }
}
