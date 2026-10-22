import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';
import { ZipFile as ReadZipFile } from 'yauzl';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installRuntimeAsset } from '../src/runtime/runtime-installer.js';
import { probeRuntime } from '../src/runtime/runtime-discovery.js';
import type { RuntimeAsset } from '../src/runtime/runtime-manifest.js';

async function archive(
  entries: { name: string; contents: string | Buffer; mode?: number }[],
): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries)
    zip.addBuffer(Buffer.from(entry.contents), entry.name, { mode: entry.mode ?? 0o100755 });
  zip.end();
  return result;
}

async function fixture(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-runtime-zip-'));
  const server = createServer((_request, response) =>
    response.writeHead(200, { 'Content-Length': bytes.length }).end(bytes),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const asset: RuntimeAsset = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: 'zip',
    entry: 'package/bin/ffmpeg',
    version: '9.0.2',
  };
  return {
    directory,
    asset,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const executable = (kind = 'ffmpeg', version = '9.0.2') =>
  `#!/bin/sh\nprintf '${kind} version ${version}\\n'\n`;

describe.skipIf(process.platform === 'win32')('pinned ZIP runtime installation', () => {
  it('installs exactly the requested FFmpeg/FFprobe member and accepts release build suffixes', async () => {
    const data = await fixture(
      await archive([
        {
          name: 'package/bin/ffmpeg',
          contents: executable('ffmpeg', '9.0.2-essentials_build-www.gyan.dev'),
        },
        { name: 'package/bin/ffprobe', contents: executable('ffprobe') },
        { name: 'package/unrelated.txt', contents: 'Do not extract this file' },
      ]),
    );
    try {
      for (const kind of ['ffmpeg', 'ffprobe'] as const) {
        const target = join(data.directory, kind);
        await installRuntimeAsset({
          kind,
          target,
          asset: { ...data.asset, format: 'zip', entry: `package/bin/${kind}` },
          proxy: '',
          signal: AbortSignal.timeout(3000),
          progress: () => undefined,
        });
        expect(await probeRuntime(kind, target, AbortSignal.timeout(1000))).toMatch(
          /^9\.0\.2(?:-|$)/,
        );
      }
      expect((await readdir(data.directory)).sort()).toEqual(['ffmpeg', 'ffprobe']);
    } finally {
      await data.close();
    }
  });

  it.each([
    'checksum',
    'missing',
    'duplicate',
    'symlink',
    'traversal',
    'corrupt',
    'version',
  ] as const)(
    'preserves the previous executable and cleans temporary files after a %s failure',
    async (failure) => {
      let entries = [
        {
          name: 'package/bin/ffmpeg',
          contents: executable('ffmpeg', failure === 'version' ? '8.1.3' : '9.0.2'),
          mode: failure === 'symlink' ? 0o120777 : 0o100755,
        },
      ];
      if (failure === 'missing') entries = [{ ...entries[0]!, name: 'ffmpeg' }];
      if (failure === 'duplicate') entries.push({ ...entries[0]! });
      if (failure === 'traversal') entries.push({ ...entries[0]!, name: 'outside' });
      let bytes = await archive(entries);
      if (failure === 'traversal')
        bytes = Buffer.from(bytes.toString('latin1').replaceAll('outside', '../evil'), 'latin1');
      if (failure === 'corrupt') bytes = Buffer.from('not a ZIP archive');
      const data = await fixture(bytes);
      try {
        const target = join(data.directory, 'ffmpeg');
        await writeFile(target, 'previous executable');
        await expect(
          installRuntimeAsset({
            kind: 'ffmpeg',
            target,
            asset: {
              ...data.asset,
              sha256: failure === 'checksum' ? '0'.repeat(64) : data.asset.sha256,
            },
            proxy: '',
            signal: AbortSignal.timeout(3000),
            progress: () => undefined,
          }),
        ).rejects.toMatchObject({
          code:
            failure === 'checksum'
              ? 'RUNTIME_HASH_MISMATCH'
              : failure === 'version'
                ? 'RUNTIME_VERSION_MISMATCH'
                : failure === 'missing'
                  ? 'RUNTIME_ARCHIVE_ENTRY_MISSING'
                  : 'RUNTIME_ARCHIVE_INVALID',
        });
        expect(await readFile(target, 'utf8')).toBe('previous executable');
        expect(await readdir(data.directory)).toEqual(['ffmpeg']);
      } finally {
        await data.close();
      }
    },
  );

  it('cancels during ZIP extraction and waits for streams to close before cleanup', async () => {
    const bytes = await archive([
      { name: 'package/bin/ffmpeg', contents: Buffer.alloc(32 * 1024 * 1024, 65) },
    ]);
    const data = await fixture(bytes);
    const controller = new AbortController();
    let inputClosed = false;
    const open = ReadZipFile.prototype.openReadStreamPromise;
    const opened = vi
      .spyOn(ReadZipFile.prototype, 'openReadStreamPromise')
      .mockImplementation(async function (this: ReadZipFile, ...args) {
        const input = await open.apply(this, args);
        input.once('close', () => {
          inputClosed = true;
        });
        input.once('data', () => controller.abort(new Error('cancel ZIP extraction')));
        return input;
      });
    try {
      const target = join(data.directory, 'ffmpeg');
      await writeFile(target, 'previous executable');
      await expect(
        installRuntimeAsset({
          kind: 'ffmpeg',
          target,
          asset: data.asset,
          proxy: '',
          signal: controller.signal,
          progress: () => undefined,
        }),
      ).rejects.toThrow('cancel ZIP extraction');
      expect(inputClosed).toBe(true);
      expect(await readFile(target, 'utf8')).toBe('previous executable');
      expect(await readdir(data.directory)).toEqual(['ffmpeg']);
    } finally {
      opened.mockRestore();
      await data.close();
    }
  });
});
