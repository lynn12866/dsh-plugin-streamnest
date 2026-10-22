import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { discoverRuntime } from '../src/runtime/runtime-discovery.js';
import type { Preferences } from '../../shared/src/contracts.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readdir: vi.fn((path: string) =>
    path.endsWith('/Downloads') ? new Promise(() => undefined) : Promise.resolve([]),
  ),
}));
vi.mock('../src/common/process.js', () => ({
  runProcess: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

describe('runtime discovery without installed tools', () => {
  it('returns missing dependencies without waiting on the protected Downloads directory', async () => {
    const preferences: Preferences = {
      downloadDirectory: '/tmp/media',
      concurrency: 1,
      fragments: 1,
      proxy: '',
      cookieBrowser: '',
      cookiesFile: '',
      binaryPaths: {},
    };
    const timeout = new AbortController();

    try {
      const result = await Promise.race([
        discoverRuntime('/tmp/streamnest-runtime', preferences, AbortSignal.timeout(1000)),
        delay(250, 'blocked', { signal: timeout.signal }),
      ]);

      expect(result).not.toBe('blocked');
      expect(result).toMatchObject({
        results: [
          { kind: 'yt-dlp', found: false },
          { kind: 'ffmpeg', found: false },
          { kind: 'ffprobe', found: false },
        ],
      });
    } finally {
      timeout.abort();
    }
  });
});
