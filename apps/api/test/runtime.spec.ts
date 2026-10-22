import { businessMessage } from '../../shared/src/messages.js';
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';

import { RuntimeService } from '../src/runtime/runtime.service.js';
import * as discovery from '../src/runtime/runtime-discovery.js';
import type { MediaService } from '../src/media/media.service.js';
import type { Preferences, RuntimeStatus } from '../../shared/src/contracts.js';
import { createAgentTools } from '../../../packages/harness/src/tools/register.js';

const preferences: Preferences = {
  downloadDirectory: '/tmp/media',
  concurrency: 2,
  fragments: 4,
  proxy: '',
  cookieBrowser: '',
  cookiesFile: '',
  binaryPaths: {},
};
const status: RuntimeStatus = {
  platform: 'darwin/arm64',
  managedDir: '/tmp/runtime/bin',
  results: [
    {
      kind: 'yt-dlp',
      found: true,
      path: '/tmp/runtime/bin/yt-dlp',
      version: '2026.10.10.233141',
      source: 'managed',
      managed: true,
      optional: false,
    },
  ],
};
afterEach(() => vi.restoreAllMocks());

describe('TypeScript runtime to official Agent output', () => {
  it('returns canonical dependency status through the actual ToolRuntime', async () => {
    vi.spyOn(discovery, 'discoverRuntime').mockResolvedValue(status);
    const runtime = new RuntimeService('/tmp/runtime');
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools: () => () => undefined });
    const tools = new ToolRuntime(ctx);
    const service = { preferences: () => preferences } as MediaService;
    const definition = createAgentTools(ctx, service, runtime).find(
      (tool) => tool.name === 'media_runtime_status',
    )!;
    const dispose = tools.register(definition);
    try {
      const result = await tools.execute({
        name: definition.name,
        callId: 'typescript-runtime-protocol',
        arguments: {},
        signal: new AbortController().signal,
      });
      expect(result.isError).not.toBe(true);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: JSON.stringify({
          status,
          installation: { state: 'idle', ...businessMessage('NONE'), downloaded: 0, total: 0 },
        }),
      });
    } finally {
      dispose();
      await runtime.onModuleDestroy();
    }
  });

  it('rechecks an actual timeout result and does not turn it into a false missing-tool error', async () => {
    const detector = vi
      .spyOn(discovery, 'discoverRuntime')
      .mockResolvedValueOnce({
        ...status,
        results: [
          {
            kind: 'yt-dlp',
            found: false,
            reason: '执行超时',
            reasonInfo: businessMessage('RUNTIME_DETECTION_TIMEOUT'),
          },
        ],
      })
      .mockResolvedValueOnce(status);
    const runtime = new RuntimeService('/tmp/runtime');
    try {
      expect(await runtime.require('yt-dlp', preferences)).toBe('/tmp/runtime/bin/yt-dlp');
      expect(detector).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.onModuleDestroy();
    }
  });

  it('cancelling one waiter does not cancel another caller sharing the same detection', async () => {
    let finish!: (value: RuntimeStatus) => void;
    let probeSignal!: AbortSignal;
    vi.spyOn(discovery, 'discoverRuntime').mockImplementation((_dir, _prefs, signal) => {
      probeSignal = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const runtime = new RuntimeService('/tmp/runtime');
    const cancelled = new AbortController();
    const first = runtime.status(preferences, cancelled.signal);
    const second = runtime.status(preferences);
    cancelled.abort(new Error('cancelled caller'));
    await expect(first).rejects.toThrow('cancelled caller');
    expect(probeSignal.aborted).toBe(false);
    finish(status);
    expect(await second).toEqual(status);
    await runtime.onModuleDestroy();
  });
});
