import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { businessMessage, BusinessError, readBusinessMessage } from '../../shared/src/messages.js';
import { storedTaskMessage } from '../../shared/src/task-messages.js';
import { displayMessage, messageFromError, ApiBusinessError } from '../../web/src/messages.js';
import { setLanguage } from '../../web/src/i18n.js';
import { createAgentTools } from '../../../packages/harness/src/tools/register.js';
import { RuntimeService } from '../src/runtime/runtime-manager.js';
import type { MediaService as MediaServiceType } from '../src/media/media.service.js';
import type { Preferences } from '../../shared/src/contracts.js';
import * as installer from '../src/runtime/runtime-installer.js';

// Compiled Nest classes retain the actual decorator metadata.
const { createApplication } = await import('../../../lib/apps/api/src/create-application.js');
const { MediaService } = await import('../../../lib/apps/api/src/media/media.service.js');

afterEach(() => {
  vi.restoreAllMocks();
  setLanguage('system');
});

describe('business message contract', () => {
  it('keeps parameters for later language changes and falls back for unknown codes and old records', () => {
    const value = messageFromError(
      new ApiBusinessError(
        businessMessage('RUNTIME_INSTALL_DOWNLOADING', { kind: 'ffmpeg' }, 'fallback'),
      ),
    );
    setLanguage('en-US');
    expect(displayMessage(value)).toBe('Downloading and verifying ffmpeg…');
    setLanguage('zh-CN');
    expect(displayMessage(value)).toBe('正在下载并校验 ffmpeg…');
    expect(displayMessage({ code: 'FUTURE_CODE', params: {}, message: 'future fallback' })).toBe(
      'future fallback',
    );
    expect(
      displayMessage(storedTaskMessage({ state: 'failed', message: 'legacy diagnostic' })),
    ).toBe('legacy diagnostic');
    expect(storedTaskMessage({ state: 'paused', message: '' }).code).toBe('TASK_PAUSED');
    expect(
      readBusinessMessage({ code: 'INVALID', params: { reason: {} }, message: 'invalid' }),
    ).toBeUndefined();
    expect(displayMessage(businessMessage('PROXY_HTTP_STATUS', { status: 0 }))).toContain('HTTP 0');
  });

  it('returns identical HTTP and official Agent failure payloads, including DTO and schema validation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamnest-business-http-'));
    const { app } = await createApplication(directory, true);
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools: () => () => undefined });
    ctx.provide('sandboxPolicy', {
      resolve: () => ({ mode: 'danger-full-access' }),
    } as unknown as Context['sandboxPolicy']);
    const tools = new ToolRuntime(ctx);
    const disposers = createAgentTools(
      ctx,
      app.get(MediaService) as unknown as MediaServiceType,
      {} as RuntimeService,
    ).map((tool) => tools.register(tool));

    try {
      await app.listen(0, '127.0.0.1');
      const url = (await app.getUrl()) + '/streamnest/api';
      for (const [path, name, args, body] of [
        ['/tasks/missing', 'media_task_get', { taskId: 'missing' }, undefined],
        [
          '/tasks/00000000-0000-4000-8000-000000000000',
          'media_task_get',
          { taskId: '00000000-0000-4000-8000-000000000000' },
          undefined,
        ],
        ['/preferences', 'media_preferences_update', { concurrency: 0 }, { concurrency: 0 }],
        [
          '/preferences',
          'media_preferences_update',
          { concurrency: 'invalid' },
          { concurrency: 'invalid' },
        ],
        ['/preferences', 'media_preferences_update', { injected: true }, { injected: true }],
        [
          '/preferences',
          'media_preferences_update',
          { downloadDirectory: '../invalid' },
          { downloadDirectory: '../invalid' },
        ],
      ] as const) {
        const response = await fetch(
          url + path,
          body
            ? {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }
            : {},
        );
        expect(response.ok).toBe(false);
        const payload = await response.json();
        expect(payload).toEqual(
          expect.objectContaining({
            code: expect.any(String),
            params: expect.any(Object),
            message: expect.any(String),
          }),
        );
        const result = await tools.execute({
          name,
          callId: path,
          arguments: args,
          signal: new AbortController().signal,
          agent: { session: {} } as unknown as ToolRunContext['agent'],
        });
        expect(result.isError).toBe(true);
        const content = result.content[0];
        expect(content?.type).toBe('text');
        if (content?.type !== 'text') throw new Error('Missing Agent error JSON');
        expect(JSON.parse(content.text)).toEqual(payload);
      }
    } finally {
      disposers.forEach((dispose) => dispose());
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exposes dependency download params, hash failures and settled cancellation without stale params', async () => {
    const preferences = { proxy: '', binaryPaths: {} } as Preferences;
    const runtime = new RuntimeService('/tmp/streamnest-business-runtime');
    const install = vi
      .spyOn(installer, 'installRuntimeAsset')
      .mockRejectedValue(new BusinessError('RUNTIME_HASH_MISMATCH'));

    try {
      runtime.install(['ffmpeg'], preferences, true);
      await expect.poll(() => runtime.progress().state).toBe('failed');
      expect(runtime.progress()).toMatchObject({ code: 'RUNTIME_HASH_MISMATCH', params: {} });
      let closed = false;
      install.mockImplementation(
        ({ signal }) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                setTimeout(() => {
                  closed = true;
                  reject(signal.reason);
                }, 10);
              },
              { once: true },
            );
          }),
      );
      runtime.install(['ffmpeg'], preferences, true);
      expect(runtime.progress()).toMatchObject({
        code: 'RUNTIME_INSTALL_DOWNLOADING',
        params: { kind: 'ffmpeg' },
      });
      const cancelled = await runtime.cancelInstall();
      expect(closed).toBe(true);
      expect(cancelled).toMatchObject({
        state: 'cancelled',
        code: 'RUNTIME_INSTALL_CANCELLED',
        params: {},
      });
      install.mockResolvedValue(undefined);
      runtime.install(['ffmpeg'], preferences, true);
      await expect.poll(() => runtime.progress().state).toBe('completed');
      expect(runtime.progress()).toMatchObject({ code: 'RUNTIME_INSTALL_COMPLETED', params: {} });
    } finally {
      await runtime.onModuleDestroy();
    }
  });
});
