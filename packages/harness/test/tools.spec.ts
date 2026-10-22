import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime, type ToolRunContext } from '@deepseek-ai/dsh-tools';

import { createAgentTools } from '../src/tools/register.js';
import type { MediaService } from '../../../apps/api/src/media/media.service.js';
import type { RuntimeService } from '../../../apps/api/src/runtime/runtime.service.js';

function fixture(outcome: string = 'allowed-once') {
  const request = vi.fn(async () => outcome);
  const ctx = {
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
    get: () => ({ request }),
  } as unknown as Context;
  const service = {
    preferences: () => ({
      downloadDirectory: '/tmp/media',
      concurrency: 2,
      fragments: 4,
      proxy: '',
      cookieBrowser: '',
      cookiesFile: '',
      binaryPaths: {},
    }),
    updatePreferences: vi.fn(async () => service.preferences()),
    get: vi.fn((id: string) => ({
      id,
      media: { title: 'fixture' },
      outputDirectory: '/tmp/media',
      artifacts: [{ name: 'fixture.mp4' }],
    })),
    deleteDownloads: vi.fn(async () => ({
      requested: 1,
      deletedFiles: 1,
      missingFiles: 0,
      removedRecords: 1,
      removedTaskIds: ['00000000-0000-4000-8000-000000000001'],
      failures: [],
      cancelled: false,
    })),
    syncDirectory: vi.fn(async () => ({
      directory: '/tmp/media',
      checkedAt: new Date().toISOString(),
      scanned: 0,
      imported: 0,
      removed: 0,
      updated: 0,
      skipped: 0,
    })),
    list: () => ({ items: [], total: 0, offset: 0, nextOffset: null }),
  };
  const runtime = {} as RuntimeService;
  const tools = createAgentTools(ctx, service as unknown as MediaService, runtime);
  const exec = {
    name: 'media_preferences_update',
    callId: 'fixture',
    signal: new AbortController().signal,
    agent: { session: {} },
  } as unknown as ToolRunContext;
  return { request, service, tools, exec };
}

describe('official defineTool registration', () => {
  it('requires approval before directory synchronization and passes the cancellation signal', async () => {
    const denied = fixture('denied');
    await expect(
      denied.tools.find((tool) => tool.name === 'media_directory_sync')!.execute({}, denied.exec),
    ).rejects.toThrow('未获批准');
    expect(denied.service.syncDirectory).not.toHaveBeenCalled();
    const allowed = fixture();
    await allowed.tools
      .find((tool) => tool.name === 'media_directory_sync')!
      .execute({}, allowed.exec);
    expect(allowed.service.syncDirectory).toHaveBeenCalledWith(allowed.exec.signal);
  });
  it('provides seventeen core tools with enforceable output schemas', () => {
    const { tools } = fixture();
    expect(tools.length).toBe(17);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(17);
    for (const tool of tools) expect(tool.output.schema).toHaveProperty('type', 'object');
  });

  it('requires explicit confirmation and approval before permanently deleting completed downloads', async () => {
    const args = { taskIds: ['00000000-0000-4000-8000-000000000001'], confirmDelete: true };
    const denied = fixture('denied');
    const tool = denied.tools.find((item) => item.name === 'media_downloads_delete')!;
    await expect(tool.execute({ ...args, confirmDelete: false }, denied.exec)).rejects.toThrow();
    expect(denied.request).not.toHaveBeenCalled();
    await expect(tool.execute(args, denied.exec)).rejects.toThrow('未获批准');
    expect(denied.service.deleteDownloads).not.toHaveBeenCalled();
    const allowed = fixture();
    await allowed.tools
      .find((item) => item.name === 'media_downloads_delete')!
      .execute(args, allowed.exec);
    expect(allowed.service.deleteDownloads).toHaveBeenCalledWith(args, allowed.exec.signal);
    expect(allowed.request).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('永久删除'),
      }),
    );
  });

  it('registers into the official runtime and dispatches validated canonical output', async () => {
    const fixtureData = fixture();
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools: () => () => undefined });
    const runtime = new ToolRuntime(ctx);
    const definitions = createAgentTools(
      ctx,
      fixtureData.service as unknown as MediaService,
      {} as RuntimeService,
    );
    const dispose = definitions.map((tool) => runtime.register(tool));

    try {
      expect(runtime.schemas().map((tool) => tool.name)).toContain('media_download');
      const result = await runtime.execute({
        name: 'media_tasks_list',
        callId: 'fixture-runtime',
        arguments: { scope: 'library' },
        signal: new AbortController().signal,
      });
      expect(result.isError).not.toBe(true);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: JSON.stringify({ items: [], total: 0, offset: 0, nextOffset: null }),
      });
    } finally {
      dispose.forEach((release) => release());
    }
  });

  it('checks DTO bounds before invoking permissions or mutations', async () => {
    const { tools, service, request, exec } = fixture();
    await expect(
      tools
        .find((tool) => tool.name === 'media_preferences_update')!
        .execute({ concurrency: 0 }, exec),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it('does not mutate after denied approval', async () => {
    const { tools, service, request, exec } = fixture('denied');
    await expect(
      tools
        .find((tool) => tool.name === 'media_preferences_update')!
        .execute({ concurrency: 1 }, exec),
    ).rejects.toThrow('未获批准');
    expect(request).toHaveBeenCalledOnce();
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it('routes read-only list through the shared service without approval', async () => {
    const { tools, request, exec } = fixture();
    expect(await tools.find((tool) => tool.name === 'media_tasks_list')!.execute({}, exec)).toEqual(
      { items: [], total: 0, offset: 0, nextOffset: null },
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('respects cancellation before writing', async () => {
    const { tools, service, exec } = fixture();
    const controller = new AbortController();
    controller.abort(new Error('cancelled fixture'));
    await expect(
      tools
        .find((tool) => tool.name === 'media_preferences_update')!
        .execute({ concurrency: 1 }, { ...exec, signal: controller.signal }),
    ).rejects.toThrow('cancelled fixture');
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });
});
