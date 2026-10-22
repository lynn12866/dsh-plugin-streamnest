import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const render = vi.hoisted(() => vi.fn());
vi.mock('../src/common/process.js', () => ({ runProcess: render }));

import { ThumbnailService } from '../src/media/thumbnail.service.js';
import type { ParseCache } from '../src/media/parsing/cache.service.js';
import type { RuntimeService } from '../src/runtime/runtime.service.js';
import type { Preferences } from '../../shared/src/contracts.js';

const fixtures: { directory: string; service: ThumbnailService }[] = [];
afterEach(async () => {
  for (const { directory, service } of fixtures.splice(0)) {
    await service.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  }
  render.mockReset();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-thumbnail-'));
  const preferences: Preferences = {
    downloadDirectory: directory,
    concurrency: 1,
    fragments: 1,
    proxy: '',
    cookieBrowser: '',
    cookiesFile: '',
    binaryPaths: {},
  };
  const runtime = { require: vi.fn(async (kind: string) => `/fixture/${kind}`) };
  const service = new ThumbnailService(
    {} as ParseCache,
    runtime as unknown as RuntimeService,
    directory,
  );
  const source = join(directory, 'source.mp4');
  await writeFile(source, 'source bytes');
  fixtures.push({ directory, service });
  return { directory, service, preferences, source, runtime };
}

describe('local task thumbnails', () => {
  it('serializes duplicate requests, caches the result and invalidates after the media changes', async () => {
    const { service, source, preferences } = await fixture();
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    render.mockImplementation(async (binary: string, args: string[]) => {
      if (binary.endsWith('ffprobe')) return { stdout: '{"format":{"duration":"40"}}', stderr: '' };
      expect(args).toContain('file,pipe');
      expect(args[args.indexOf('-ss') + 1]).toBe('10');
      await writeFile(args.at(-1)!, image);
      return { stdout: '', stderr: '' };
    });
    const images = await Promise.all([
      service.getTask('fixture', source, preferences),
      service.getTask('fixture', source, preferences),
    ]);
    expect(images).toEqual([image, image]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(await readFile(source, 'utf8')).toBe('source bytes');
    await writeFile(source, 'modified video bytes');
    expect(await service.getTask('fixture', source, preferences)).toEqual(image);
    expect(render).toHaveBeenCalledTimes(4);
  });

  it('falls back to the first frame for videos shorter than one second', async () => {
    const { service, source, preferences } = await fixture();
    render.mockImplementation(async (binary: string, args: string[]) => {
      if (binary.endsWith('ffprobe'))
        return { stdout: '{"format":{"duration":"0.4"}}', stderr: '' };
      if (args[args.indexOf('-ss') + 1] === '0') await writeFile(args.at(-1)!, 'jpeg');
      return { stdout: '', stderr: '' };
    });
    expect(await service.getTask('short', source, preferences)).toEqual(Buffer.from('jpeg'));
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('generates an opening frame when FFprobe is unavailable', async () => {
    const { service, source, preferences, runtime } = await fixture();
    runtime.require.mockImplementation(async (kind: string) => {
      if (kind === 'ffprobe') throw new Error('FFprobe unavailable');
      return `/fixture/${kind}`;
    });
    render.mockImplementation(async (_binary: string, args: string[]) => {
      expect(args[args.indexOf('-ss') + 1]).toBe('1');
      await writeFile(args.at(-1)!, 'jpeg');
      return { stdout: '', stderr: '' };
    });
    expect(await service.getTask('without-probe', source, preferences)).toEqual(
      Buffer.from('jpeg'),
    );
    expect(render).toHaveBeenCalledTimes(1);
  });
});
