import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { MediaService } from '../../../../apps/api/src/media/media.service.js';
import { RuntimeService } from '../../../../apps/api/src/runtime/runtime.service.js';
import { validateDto } from '../../../../apps/api/src/common/validation.js';
import {
  ArchiveTaskDto,
  CreateDownloadDto,
  InstallRuntimeDto,
  ParseMediaDto,
  TaskActionDto,
  UpdatePreferencesDto,
  RemoveTaskDto,
  ClearHistoryDto,
  RestoreHistoryDto,
  DeleteDownloadsDto,
} from '../../../../apps/api/src/media/dto/media.dto.js';
import { DOWNLOAD_MODES } from '../../../../apps/shared/src/contracts.js';
import { authorize } from './permissions.js';
import { createSystemTools, type AgentInfrastructure } from './system-tools.js';
import { withBusinessErrors } from './business-errors.js';
import {
  INSTALL_SCHEMA,
  RUNTIME_STATUS_SCHEMA,
  MEDIA_SCHEMA,
  PREFERENCES_SCHEMA,
  TASK_SCHEMA,
  DIRECTORY_SYNC_SCHEMA,
  DELETE_DOWNLOADS_SCHEMA,
  jsonOutput,
} from './schemas.js';

export function createAgentTools(
  ctx: Context,
  service: MediaService,
  runtime: RuntimeService,
  infrastructure?: AgentInfrastructure,
) {
  const basic = [
    defineTool({
      name: 'media_downloads_delete',
      description:
        '永久删除指定已完成下载的已登记文件，并同步清理 SQLite 记录。taskIds 为 1–100 个明确选中的任务 ID，单条与批量共用。操作无法撤销，不移入垃圾篓；必须先向用户展示目标并再次确认，获得明确同意后传 confirmDelete=true，再通过宿主审批。只删除登记文件，不递归删除目录；拒绝越界、符号链接和其他未选中记录共享的文件。文件已不存在时清理记录；失败项目保留记录。backupId 仅备份记录，不能恢复文件。',
      parameters: {
        taskIds: { type: 'array', required: true, items: { type: 'string' } },
        confirmDelete: { type: 'boolean', required: true },
      },
      output: jsonOutput(DELETE_DOWNLOADS_SCHEMA),
      timeoutMs: 300_000,
      async execute(args, exec) {
        const dto = await validateDto(DeleteDownloadsDto, args);
        exec.signal.throwIfAborted();
        const tasks = dto.taskIds.map((id) => service.get(id));
        await authorize(
          ctx,
          exec,
          `再次确认：永久删除以下 ${tasks.length} 项下载的登记文件并清理记录。无法撤销，不移入垃圾篓：\n${tasks.map((task) => `${task.media.title}\n${task.outputDirectory}\n${task.artifacts.map((file) => file.name).join('\n')}`).join('\n\n')}`,
          true,
        );
        return service.deleteDownloads(dto, exec.signal);
      },
    }),
    defineTool({
      name: 'media_directory_sync',
      description:
        '同步当前配置的下载目录与 SQLite：递归导入未登记的非空音视频文件，清理文件已不存在的已完成记录，更新文件大小。只处理当前目录，跳过符号链接、隐藏目录、临时文件及未完成任务目录；不重新下载、不删除文件。返回 imported/removed/updated 数量，backupId 可用 media_history_restore 撤销移除。',
      parameters: {},
      output: jsonOutput(DIRECTORY_SYNC_SCHEMA),
      timeoutMs: 180_000,
      async execute(_args, exec) {
        exec.signal.throwIfAborted();
        await authorize(
          ctx,
          exec,
          '同步当前下载目录：导入未登记音视频，移除失效记录并保留撤销备份；不删除文件。',
        );
        return service.syncDirectory(exec.signal);
      },
    }),
    defineTool({
      name: 'media_parse',
      description:
        '解析一个公开媒体链接，返回 mediaId、清晰度、音轨和字幕语言。只解析首条，拒绝直播与内网链接；视频号分享链接使用腾讯元宝登录态转换，再查询视频号详情；已有 Cookie 设置时需要宿主授权。',
      parameters: { url: { type: 'string', required: true } },
      output: jsonOutput(MEDIA_SCHEMA),
      timeoutMs: 180_000,
      async execute(args, exec) {
        const dto = await validateDto(ParseMediaDto, args);
        const preferences = service.preferences();
        if (
          preferences.cookieBrowser ||
          preferences.cookiesFile ||
          preferences.cookieStrategy === 'auto'
        )
          await authorize(
            ctx,
            exec,
            /(?:weixin\.qq\.com|channels\.weixin\.qq\.com)/.test(dto.url)
              ? '使用所选来源的元宝登录态解析视频号：元宝 Cookie 仅发元宝，播放参数发视频号官方接口，下载从返回的腾讯 CDN 获取。'
              : '使用已配置的浏览器登录状态或 Cookie 解析媒体链接。',
          );
        return service.parse(dto.url, exec.signal);
      },
    }),
    defineTool({
      name: 'media_tasks_list',
      description:
        '查看拾流下载记录。scope 为 queue / library / all，最多 100 条。queue 返回未完成任务，library 返回已完成下载，均默认包含旧归档记录；显式传 archived 可筛选归档状态。',
      parameters: {
        scope: { type: 'string', enum: ['queue', 'library', 'all'] },
        query: { type: 'string' },
        offset: { type: 'integer' },
        limit: { type: 'integer' },
        archived: { type: 'boolean' },
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: TASK_SCHEMA, required: true },
          total: { type: 'integer', required: true },
          offset: { type: 'integer', required: true },
          nextOffset: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
        },
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        return service.list(args);
      },
    }),
    defineTool({
      name: 'media_task_get',
      description: '根据任务 ID 查看最新进度、错误和输出文件名，不读取媒体文件内容。',
      parameters: { taskId: { type: 'string', required: true } },
      output: jsonOutput(TASK_SCHEMA),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        return service.get(args.taskId);
      },
    }),
    defineTool({
      name: 'media_download',
      description:
        '使用 media_parse 返回的 mediaId 添加后台下载。mode=audio 固定转换为 MP3，无需传输出格式；格式与音轨 ID 必须来自解析结果。字幕模式必须选语言。返回后任务继续运行，用 media_task_get 查看；取消 Agent 回复不会取消已入队任务。',
      parameters: {
        mediaId: { type: 'string', required: true, description: 'media_parse 返回的 mediaId。' },
        mode: {
          type: 'string',
          enum: DOWNLOAD_MODES,
          required: true,
          description: 'video 下载视频并合并音轨；audio 提取并转换为 MP3；subtitle 仅下载字幕。',
        },
        formatId: {
          type: 'string',
          description: '仅视频模式使用，取 media_parse 返回的 formats[].id；省略则自动选择画质。',
        },
        audioTrackId: {
          type: 'string',
          description: '取 media_parse 返回的 audioTracks[].id，选择视频或音频任务的语言音轨。',
        },
        audioFormatId: {
          type: 'string',
          description:
            '仅音频模式使用，取 media_parse 返回的 audioFormats[].id，选择源音频码率；省略则自动选择。它不是输出扩展名，不要传 mp3；输出固定为 MP3。',
        },
        subtitleFormat: { type: 'string', enum: ['srt', 'source'] },
        subtitles: { type: 'array', items: { type: 'string' } },
      },
      output: jsonOutput(TASK_SCHEMA),
      async execute(args, exec) {
        const dto = await validateDto(CreateDownloadDto, args);
        await authorize(ctx, exec, '下载所选媒体并写入拾流配置的下载目录；任务将在后台继续。');
        exec.signal.throwIfAborted();
        return service.enqueue(dto);
      },
    }),
    defineTool({
      name: 'media_task_control',
      description:
        '暂停、继续、重试或取消单个任务。暂停保留 .part 文件；继续和重试会再次访问原网站。取消保留文件。',
      parameters: {
        taskId: { type: 'string', required: true },
        action: { type: 'string', enum: ['pause', 'resume', 'retry', 'cancel'], required: true },
      },
      output: jsonOutput(TASK_SCHEMA),
      async execute(args, exec) {
        const dto = await validateDto(TaskActionDto, { action: args.action });
        await authorize(ctx, exec, `对下载任务执行 ${dto.action}。`);
        return service.action(args.taskId, dto.action);
      },
    }),
    defineTool({
      name: 'media_task_archive',
      description: '归档或恢复已结束的任务。归档可逆，媒体文件与下载记录均保留。',
      parameters: {
        taskId: { type: 'string', required: true },
        archived: { type: 'boolean', required: true },
      },
      output: jsonOutput(TASK_SCHEMA),
      async execute(args, exec) {
        const dto = await validateDto(ArchiveTaskDto, { archived: args.archived });
        await authorize(ctx, exec, dto.archived ? '归档该下载记录。' : '恢复该下载记录。');
        return service.archive(args.taskId, dto.archived);
      },
    }),
    defineTool({
      name: 'media_preferences_get',
      description: '查看拾流下载目录、并发、代理、Cookie 来源和依赖路径。不会读取 Cookie 内容。',
      parameters: {},
      output: jsonOutput(PREFERENCES_SCHEMA),
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        exec.signal.throwIfAborted();
        return service.preferences();
      },
    }),
    defineTool({
      name: 'media_task_remove',
      description:
        '移除一条任务记录，媒体文件保留。活动任务必须明确 stopActive=true 才会先停止。返回备份 ID 可用 media_history_restore 撤销。',
      parameters: { taskId: { type: 'string', required: true }, stopActive: { type: 'boolean' } },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          backupId: { type: 'string', required: true },
        },
      }),
      async execute(args, exec) {
        const dto = await validateDto(RemoveTaskDto, { stopActive: args.stopActive });
        await authorize(
          ctx,
          exec,
          dto.stopActive
            ? '停止并移除该任务记录，媒体文件保留。'
            : '移除该任务记录，媒体文件保留。',
        );
        return service.remove(args.taskId, dto.stopActive);
      },
    }),
    defineTool({
      name: 'media_history_clear',
      description:
        '清空记录并保留媒体文件。library 清空所有已完成记录（含归档）；ended 清理全部已结束记录，保留活动任务。返回备份 ID 可撤销。',
      parameters: { scope: { type: 'string', enum: ['library', 'ended'] } },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          backupId: { type: 'string', required: true },
        },
      }),
      async execute(args, exec) {
        const dto = await validateDto(ClearHistoryDto, { scope: args.scope ?? 'library' });
        await authorize(
          ctx,
          exec,
          dto.scope === 'library'
            ? '清空媒体库全部已完成记录，文件保留。'
            : '移除全部已结束的下载与媒体库记录，文件保留。',
        );
        return service.clearHistory(dto.scope);
      },
    }),
    defineTool({
      name: 'media_history_restore',
      description: '使用移除/清空操作返回的 backupId 恢复记录。不重新下载，不自动启动任务。',
      parameters: { backupId: { type: 'string', required: true } },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          backupId: { type: 'string', required: true },
        },
      }),
      async execute(args, exec) {
        const dto = await validateDto(RestoreHistoryDto, args);
        await authorize(ctx, exec, '从本机备份恢复下载记录。');
        return service.restoreHistory(dto.backupId);
      },
    }),
    defineTool({
      name: 'media_preferences_update',
      description:
        '修改拾流设置。路径必须为绝对路径；并发 1–4，分片 1–16。Cookie 来源应由用户明确指定。新设置作用于后续任务，继续或重试也会使用新运行设置。',
      parameters: {
        downloadDirectory: { type: 'string' },
        concurrency: { type: 'integer' },
        fragments: { type: 'integer' },
        proxy: { type: 'string' },
        cookieBrowser: {
          type: 'string',
          enum: ['', 'chrome', 'edge', 'firefox', 'safari', 'brave', 'chromium'],
          description:
            '空值表示不读取浏览器 Cookie；手动模式下若提供 cookiesFile，仍优先使用文件。Safari 使用默认来源；其他浏览器需明确指定 cookieProfile。',
        },
        cookiesFile: { type: 'string' },
        cookieProfile: {
          type: 'string',
          description:
            '所选浏览器的配置目录名，例如 Profile 4。手动模式选择支持账号的浏览器且未提供 Cookie 文件时必须指定；留空会拒绝保存和解析，不会自动读取默认账号。Safari 不使用此字段。',
        },
        filenameTemplate: { type: 'string' },
        preferredQuality: {
          type: 'string',
          enum: ['best', '2160', '1440', '1080', '720', '480', '360'],
        },
        language: { type: 'string', enum: ['system', 'zh-CN', 'en-US'] },
        cookieStrategy: { type: 'string', enum: ['selected', 'auto'] },
        acceleration: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', required: true },
            maxConnections: { type: 'integer', required: true },
            aria2Path: { type: 'string', required: true },
          },
        },
        binaryPaths: {
          type: 'object',
          additionalProperties: false,
          properties: {
            'yt-dlp': { type: 'string' },
            ffmpeg: { type: 'string' },
            ffprobe: { type: 'string' },
          },
        },
      },
      output: jsonOutput(PREFERENCES_SCHEMA),
      async execute(args, exec) {
        const dto = await validateDto(UpdatePreferencesDto, args);
        await authorize(ctx, exec, '修改拾流的下载、网络或登录来源设置。');
        return service.updatePreferences(dto);
      },
    }),
    defineTool({
      name: 'media_runtime_status',
      description:
        '探测 yt-dlp / FFmpeg / FFprobe 的安装状态，并查看当前依赖安装进度。不会自动下载依赖。',
      parameters: {},
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { ...RUNTIME_STATUS_SCHEMA, required: true },
          installation: { ...INSTALL_SCHEMA, required: true },
        },
      }),
      timeoutMs: 100_000,
      async execute(_args, exec) {
        return {
          status: await runtime.status(service.preferences(), exec.signal),
          installation: runtime.progress(),
        };
      },
    }),
    defineTool({
      name: 'media_runtime_install',
      description:
        '下载并校验选定依赖，仅写入拾流托管目录。后台执行，使用 media_runtime_status 查看进度。',
      parameters: {
        force: {
          type: 'boolean',
          description: '强制重新下载托管版本；更新旧版本时使用，不覆盖用户指定的路径。',
        },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['yt-dlp', 'ffmpeg', 'ffprobe'] },
          required: true,
        },
      },
      output: jsonOutput(INSTALL_SCHEMA),
      async execute(args, exec) {
        const dto = await validateDto(InstallRuntimeDto, args);
        await authorize(ctx, exec, '从依赖清单下载并安装所选 yt-dlp / FFmpeg 工具到拾流托管目录。');
        return runtime.install(dto.kinds, service.preferences(), dto.force);
      },
    }),
    defineTool({
      name: 'media_runtime_cancel',
      description: '取消正在进行的依赖安装，已完成安装的依赖保留。',
      parameters: {},
      output: jsonOutput(INSTALL_SCHEMA),
      async execute(_args, exec) {
        await authorize(ctx, exec, '取消拾流运行依赖安装。');
        return runtime.cancelInstall();
      },
    }),
    defineTool({
      name: 'media_artifact_get',
      description:
        '获取已完成任务的一个输出文件路径、名称和大小。索引从 0 开始；不会将二进制内容送入模型。文件移动后会报错。',
      parameters: {
        taskId: { type: 'string', required: true },
        index: { type: 'integer', required: true },
      },
      output: jsonOutput({
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        return service.artifact(args.taskId, args.index);
      },
    }),
  ];
  return [...basic, ...(infrastructure ? createSystemTools(ctx, infrastructure) : [])].map(
    withBusinessErrors,
  );
}

export function registerAgentTools(
  ctx: Context,
  service: MediaService,
  runtime: RuntimeService,
  infrastructure?: AgentInfrastructure,
): () => void {
  const disposers = createAgentTools(ctx, service, runtime, infrastructure).map((tool) =>
    ctx.tools.register(tool),
  );
  return () => disposers.forEach((dispose) => dispose());
}
