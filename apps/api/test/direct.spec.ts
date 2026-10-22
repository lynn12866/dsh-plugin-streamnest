import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { downloadDirectFile } from '../src/media/engines/direct.js';

const content = Buffer.alloc(6 * 1024 * 1024);
for (let index = 0; index < content.length; index++) content[index] = (index * 31) % 251;
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function fixture(rangeSupported = true) {
  const ranges: string[] = [];
  const server = createServer((request, response) => {
    const range = request.headers.range;
    if (range) ranges.push(range);
    const match = rangeSupported && range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    const start = match ? Number(match[1]) : 0;
    const end = match ? Number(match[2]) + 1 : content.length;
    response.writeHead(match ? 206 : 200, {
      'Content-Length': end - start,
      'Content-Type': 'video/mp4',
      ETag: '"fixture-v1"',
      ...(match ? { 'Content-Range': `bytes ${start}-${end - 1}/${content.length}` } : {}),
    });
    let cursor = start;
    const timer = setInterval(() => {
      const next = Math.min(end, cursor + 16 * 1024);
      response.write(content.subarray(cursor, next));
      cursor = next;
      if (cursor === end) {
        clearInterval(timer);
        response.end();
      }
    }, 2);
    response.once('close', () => clearInterval(timer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本地验收服务未监听。');
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-direct-'));
  return {
    ranges,
    directory,
    url: `http://127.0.0.1:${address.port}/fixture.mp4`,
    outputPath: join(directory, 'output.mp4'),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('真实 HTTP Range 与文件断点', () => {
  it('暂停后保存逐段检查点，继续下载得到同一 SHA-256', async () => {
    const source = await fixture();
    const controller = new AbortController();
    try {
      await expect(
        downloadDirectFile({
          url: source.url,
          pageUrl: source.url,
          outputPath: source.outputPath,
          signal: controller.signal,
          acceleration: { enabled: true, maxConnections: 3, aria2Path: '' },
          report: (progress) => {
            if (progress.downloadedBytes >= 256 * 1024) controller.abort(new Error('验收暂停'));
          },
        }),
      ).rejects.toThrow('验收暂停');
      const checkpoint = JSON.parse(await readFile(`${source.outputPath}.part.json`, 'utf8')) as {
        segments: { start: number; offset: number }[];
      };
      expect(checkpoint.segments.some((segment) => segment.offset > segment.start)).toBe(true);
      const requestsBeforeResume = source.ranges.length;
      await downloadDirectFile({
        url: source.url,
        pageUrl: source.url,
        outputPath: source.outputPath,
        signal: new AbortController().signal,
        acceleration: { enabled: true, maxConnections: 2, aria2Path: '' },
        report: () => undefined,
      });
      expect(sha256(await readFile(source.outputPath))).toBe(sha256(content));
      expect(
        source.ranges
          .slice(requestsBeforeResume)
          .some((range) => range !== 'bytes=0-0' && !range.startsWith('bytes=0-')),
      ).toBe(true);
      await expect(readFile(`${source.outputPath}.part.json`)).rejects.toThrow();
    } finally {
      await source.close();
    }
  });

  it('服务器不支持 Range 时重新顺序下载，不把旧稀疏文件当作完成', async () => {
    const source = await fixture(false);
    try {
      await writeFile(`${source.outputPath}.part`, Buffer.alloc(content.length));
      await writeFile(`${source.outputPath}.part.json`, '{}');
      await downloadDirectFile({
        url: source.url,
        pageUrl: source.url,
        outputPath: source.outputPath,
        signal: new AbortController().signal,
        report: () => undefined,
      });
      expect(sha256(await readFile(source.outputPath))).toBe(sha256(content));
    } finally {
      await source.close();
    }
  });
});
