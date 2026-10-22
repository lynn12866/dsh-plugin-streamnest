import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import type { SystemService } from '../../../../apps/api/src/system/system.service.js';
import type { NativeService } from '../../../../apps/api/src/system/native.service.js';
import type { JournalService } from '../../../../apps/api/src/system/journal.service.js';
import {
  NativeRequestDto,
  BrowserProfilesDto,
  OpenFileDto,
  ProxyTestDto,
} from '../../../../apps/api/src/system/system.dto.js';
import { validateDto } from '../../../../apps/api/src/common/validation.js';
import { NATIVE_KINDS } from '../../../../apps/shared/src/system.js';
import { jsonOutput, MESSAGE_PROPERTIES } from './schemas.js';
import { DIAGNOSTICS_SCHEMA, DISK_SCHEMA, NATIVE_SCHEMA } from './system-schemas.js';
import { authorize } from './permissions.js';

export interface AgentInfrastructure {
  system: SystemService;
  native: NativeService;
  journal: JournalService;
}

export function createSystemTools(ctx: Context, { system, native, journal }: AgentInfrastructure) {
  return [
    defineTool({
      name: 'media_browser_profiles',
      description:
        '列出指定浏览器的配置名称和账号标识供用户选择，仅读取账号元数据，不读取 Cookie 或密码。多个账号时必须请用户指定，不代替用户猜测。',
      parameters: {
        browser: {
          type: 'string',
          enum: ['chrome', 'edge', 'firefox', 'safari', 'brave', 'chromium'],
          required: true,
        },
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          profiles: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                account: { type: 'string', required: true },
                label: { type: 'string', required: true },
              },
            },
          },
          ...MESSAGE_PROPERTIES,
          permissionRequired: { type: 'boolean' },
          metadataPath: { type: 'string' },
        },
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        const dto = await validateDto(BrowserProfilesDto, args);
        return system.browserProfiles(dto.browser);
      },
    }),
    defineTool({
      name: 'media_diagnostics',
      description:
        '查看工具版本、aria2、Node/Deno、浏览器、Cookie 来源元数据和磁盘空间；不读取 Cookie 内容。',
      parameters: { force: { type: 'boolean' } },
      output: jsonOutput(DIAGNOSTICS_SCHEMA),
      timeoutMs: 120_000,
      execute: (args, exec) => system.diagnostics(args.force, exec.signal),
    }),
    defineTool({
      name: 'media_disk_space',
      description: '查看拾流下载目录所在磁盘的可用及总空间，单位为字节。',
      parameters: {},
      output: jsonOutput(DISK_SCHEMA),
      isConcurrencySafe: () => true,
      execute: (_args, exec) => {
        exec.signal.throwIfAborted();
        return system.diskSpace();
      },
    }),
    defineTool({
      name: 'media_proxy_test',
      description:
        '测试已配置或明确指定的 HTTP(S)/SOCKS5 代理与公开网站连通性，返回延迟和状态；留空代理表示直连。',
      parameters: { proxy: { type: 'string' }, url: { type: 'string' } },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          connected: { type: 'boolean', required: true },
          latencyMs: { type: 'number', required: true },
          status: { type: 'integer', required: true },
          ...MESSAGE_PROPERTIES,
        },
      }),
      timeoutMs: 30_000,
      async execute(args, exec) {
        const dto = await validateDto(ProxyTestDto, args);
        return system.proxyTest(dto.proxy, dto.url, exec.signal);
      },
    }),
    defineTool({
      name: 'media_native_request',
      description:
        '请求用户在拾流页面选择本机文件/目录，或确认读取剪贴板中的媒体链接、写入指定文本。返回 pending 后用 media_native_result 查询；不会擅自读取或返回剪贴板其他内容。',
      parameters: {
        kind: { type: 'string', enum: NATIVE_KINDS, required: true },
        purpose: { type: 'string', required: true },
        text: { type: 'string' },
      },
      output: jsonOutput(NATIVE_SCHEMA),
      async execute(args, exec) {
        const dto = await validateDto(NativeRequestDto, args);
        await authorize(ctx, exec, `请求用户确认原生操作：${dto.kind}。`);
        return native.create(dto.kind, dto.purpose, dto.text);
      },
    }),
    defineTool({
      name: 'media_native_result',
      description:
        '查看此前原生选择/剪贴板操作的用户确认结果。pending 时提示用户打开拾流完成，cancelled/expired 时不继续。',
      parameters: { id: { type: 'string', required: true } },
      output: jsonOutput(NATIVE_SCHEMA),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        return native.get(args.id);
      },
    }),
    defineTool({
      name: 'media_file_open',
      description:
        '用本机默认程序打开已完成文件、在文件管理器定位，或打开任务/下载/运行工具/日志目录。不会读取文件内容。',
      parameters: {
        target: {
          type: 'string',
          enum: ['artifact', 'reveal', 'task-folder', 'download-directory', 'runtime', 'logs'],
          required: true,
        },
        taskId: { type: 'string' },
        index: { type: 'integer' },
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          target: { type: 'string', required: true },
          path: { type: 'string', required: true },
        },
      }),
      async execute(args, exec) {
        const dto = await validateDto(OpenFileDto, args);
        await authorize(ctx, exec, '在本机打开所选媒体文件或目录。');
        return system.open(dto.target, dto.taskId, dto.index);
      },
    }),
    defineTool({
      name: 'media_logs_get',
      description: '读取拾流最近最多 500 行脱敏事件日志，不含 URL、Cookie 或原始进程输出。',
      parameters: { limit: { type: 'integer' } },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: { type: 'array', required: true, items: { type: 'string' } },
          bytes: { type: 'number', required: true },
          error: { type: 'string', required: true },
        },
      }),
      execute: (args, exec) => {
        exec.signal.throwIfAborted();
        return journal.read(args.limit);
      },
    }),
    defineTool({
      name: 'media_logs_clear',
      description: '清空当前日志，将原内容保存为本机备份；不操作媒体文件。',
      parameters: {},
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          cleared: { type: 'boolean', required: true },
          backup: { type: 'string', required: true },
        },
      }),
      async execute(_args, exec) {
        await authorize(ctx, exec, '清空拾流当前日志并保留备份。');
        return journal.clear();
      },
    }),
    defineTool({
      name: 'media_error_report',
      description:
        '生成可复制的脱敏反馈草稿，仅含错误分类和版本。不会自动提交 Issue 或发送给任何人。',
      parameters: { taskId: { type: 'string' } },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          body: { type: 'string', required: true },
        },
      }),
      execute: (args) => system.errorReport(args.taskId),
    }),
  ];
}
