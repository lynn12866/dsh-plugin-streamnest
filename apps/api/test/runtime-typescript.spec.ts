import 'reflect-metadata';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { RuntimeService } from '../src/runtime/runtime-manager.js';
import { probeRuntime } from '../src/runtime/runtime-discovery.js';
import { installRuntimeAsset } from '../src/runtime/runtime-installer.js';
import { compareVersions, parseVersion, runtimeAsset } from '../src/runtime/runtime-manifest.js';
import type { Preferences } from '../../shared/src/contracts.js';

const preferences: Preferences = {
  downloadDirectory: '/tmp/media',
  concurrency: 1,
  fragments: 1,
  proxy: '',
  cookieBrowser: '',
  cookiesFile: '',
  binaryPaths: {},
};

describe('TypeScript runtime migration', () => {
  it('keeps current upstream versions and checksums for every supported platform', () => {
    for (const platform of ['darwin/arm64', 'darwin/x64', 'linux/x64', 'linux/arm64', 'win32/x64'])
      for (const kind of ['yt-dlp', 'ffmpeg', 'ffprobe'] as const) {
        const asset = runtimeAsset(kind, platform);
        expect(asset.url).toMatch(/^https:\/\//);
        if (kind !== 'yt-dlp') {
          expect(asset).toMatchObject({ format: 'zip', version: '9.0.2' });
          expect(asset.url).toContain('9.0.2');
          expect(new URL(asset.url).hostname).toBe(
            platform === 'win32/x64' ? 'github.com' : 'ffmpeg.martin-riedl.de',
          );
        }
        expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    expect(parseVersion('ffmpeg', 'yt-dlp version 6.0')).toBe('');
    expect(parseVersion('yt-dlp', '<html>2026.10.10</html>')).toBe('');
    expect(compareVersions('2026.10.10.233141', '2026.08.19')).toBe(1);
  });

  it.skipIf(process.platform === 'win32')(
    'shares one executable probe across concurrent API callers, then caches the result',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'streamnest-ts-runtime-'));
      const paths: Preferences['binaryPaths'] = {};
      for (const kind of ['yt-dlp', 'ffmpeg', 'ffprobe'] as const) {
        paths[kind] = join(directory, kind);
        await writeFile(
          paths[kind]!,
          `#!/bin/sh\nprintf '${kind === 'yt-dlp' ? '2026.10.10.233141' : `${kind} version 6.0`}\\n'\n`,
          { mode: 0o755 },
        );
      }
      const runtime = new RuntimeService(directory);
      try {
        const [first, second] = await Promise.all([
          runtime.status({ ...preferences, binaryPaths: paths }),
          runtime.status({ ...preferences, binaryPaths: paths }),
        ]);
        expect(first).toEqual(second);
        expect(first.results.every((result) => result.found && result.source === 'manual')).toBe(
          true,
        );
        await rm(paths['yt-dlp']!);
        expect(
          (await runtime.status({ ...preferences, binaryPaths: paths })).results[0]?.found,
        ).toBe(true);
        const invalid = join(directory, 'invalid');
        await writeFile(invalid, '#!/bin/sh\nprintf "not-a-version\\n"\n', { mode: 0o755 });
        await expect(probeRuntime('yt-dlp', invalid, AbortSignal.timeout(2000))).rejects.toThrow(
          '版本',
        );
      } finally {
        await runtime.onModuleDestroy();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'validates gzip SHA-256 before promotion; mismatch and cancellation preserve the old executable',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'streamnest-ts-install-'));
      const target = join(directory, 'yt-dlp');
      const binary = '#!/bin/sh\nprintf "2026.10.10.233141\\n"\n';
      const compressed = gzipSync(binary);
      const digest = createHash('sha256').update(compressed).digest('hex');
      const server = createServer((request, response) => {
        if (request.url === '/slow') {
          response.writeHead(200);
          response.write(compressed.subarray(0, 4));
          return;
        }
        response
          .writeHead(200, {
            'Content-Length': compressed.length,
            'Content-Type': 'application/gzip',
          })
          .end(compressed);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const controller = new AbortController();
      try {
        await writeFile(target, 'old executable');
        const input = {
          kind: 'yt-dlp' as const,
          target,
          asset: { url: base, sha256: '0'.repeat(64), format: 'gzip' as const },
          proxy: '',
          signal: controller.signal,
          progress: () => undefined,
        };
        await expect(installRuntimeAsset(input)).rejects.toThrow('SHA-256');
        expect(await readFile(target, 'utf8')).toBe('old executable');
        await expect(
          installRuntimeAsset({
            ...input,
            asset: { ...input.asset, url: `${base}/slow`, sha256: digest },
            progress: () => controller.abort(new Error('cancel fixture')),
          }),
        ).rejects.toThrow();
        expect(await readFile(target, 'utf8')).toBe('old executable');
        await installRuntimeAsset({
          ...input,
          asset: { url: base, sha256: digest, format: 'gzip' as const },
          signal: AbortSignal.timeout(3000),
        });
        expect(await readFile(target, 'utf8')).toBe(binary);
        await chmod(target, 0o755);
        expect(await probeRuntime('yt-dlp', target, AbortSignal.timeout(1000))).toBe(
          '2026.10.10.233141',
        );
      } finally {
        controller.abort();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
