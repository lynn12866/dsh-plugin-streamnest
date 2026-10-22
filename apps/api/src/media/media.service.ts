import { businessMessage, BusinessError } from '../../../shared/src/messages.js';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  DownloadRequest,
  DownloadTask,
  DirectorySyncResult,
  MediaInfo,
  MediaArtifact,
  Preferences,
  StoredTask,
  TaskPage,
  DeleteDownloadsRequest,
  DeleteDownloadsResult,
} from '../../../shared/src/contracts.js';
import { VaultStore } from '../storage/vault.store.js';
import { MediaEngine } from './media.engine.js';
import { parseProgress, POSTPROCESS_PREFIX, ENGINE_PREFIX } from './arguments.js';
import { normalizePreferences } from '../../../shared/src/preferences.js';
import { JournalService } from '../system/journal.service.js';
import { classifyParseError } from '../../../shared/src/parse-errors.js';
import { browserAccountError } from '../../../shared/src/cookies.js';
import { storedTaskMessage, taskMessage } from '../../../shared/src/task-messages.js';
import { validateUuid } from '../common/validation.js';
import { businessErrorResponse } from '../common/business-error.js';
import { planDirectorySync } from './directory-sync.js';
import { deleteDownloadFiles } from './delete-downloads.js';

export type TaskAction = 'pause' | 'resume' | 'retry' | 'cancel';

function publicTask(task: StoredTask): DownloadTask {
  const value = JSON.parse(JSON.stringify(task)) as StoredTask;
  Object.assign(value, storedTaskMessage(value));
  Reflect.deleteProperty(value, 'preferences');
  if (value.state === 'completed')
    value.artifacts = value.artifacts.map((artifact) => ({
      ...artifact,
      exists: existsSync(join(value.outputDirectory, artifact.name)),
    }));
  return value;
}

@Injectable()
export class MediaService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private liveTasks = new Map<string, StoredTask>();
  private dirtyProgress = new Map<string, StoredTask>();
  private pendingFinals = new Map<string, StoredTask>();
  private closed = false;
  private stopping = false;
  private mutating = false;
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private pending = Promise.resolve();
  private progressTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly store: VaultStore,
    private readonly engine: MediaEngine,
    private readonly journal?: JournalService,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize({
      downloadDirectory: join(this.store.directory, 'media'),
      concurrency: 2,
      fragments: 4,
      proxy: '',
      cookieBrowser: '',
      cookiesFile: '',
      binaryPaths: {},
    });
    this.store.pauseInterrupted();
  }

  preferences(): Preferences {
    return this.store.preferences();
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      this.mutating = true;

      try {
        return await operation();
      } finally {
        this.mutating = false;
        this.pump();
      }
    });
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    return this.exclusive(async () => {
      const before = this.preferences();
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      const binaryPatch = Object.fromEntries(
        Object.entries(patch.binaryPaths ?? {}).filter(([, value]) => value !== undefined),
      );
      const next = normalizePreferences({
        ...before,
        ...defined,
        binaryPaths: { ...before.binaryPaths, ...binaryPatch },
      });
      if (
        !next.filenameTemplate?.trim() ||
        /[\0\r\n]/.test(next.filenameTemplate) ||
        /(^|[\\/])\.\.([\\/]|$)/.test(next.filenameTemplate) ||
        isAbsolute(next.filenameTemplate)
      )
        throw new BadRequestException(businessMessage('FILENAME_TEMPLATE_INVALID'));
      if (next.acceleration?.aria2Path && !isAbsolute(next.acceleration.aria2Path))
        throw new BadRequestException(businessMessage('ARIA2_PATH_INVALID'));
      if (
        next.cookieProfile &&
        (!/^[\w .-]{1,100}$/.test(next.cookieProfile) || ['.', '..'].includes(next.cookieProfile))
      )
        throw new BadRequestException(businessMessage('BROWSER_PROFILE_INVALID'));
      if (!isAbsolute(next.downloadDirectory) || next.downloadDirectory.includes('\0'))
        throw new BadRequestException(businessMessage('DOWNLOAD_DIRECTORY_INVALID'));
      for (const value of [next.cookiesFile, ...Object.values(next.binaryPaths)]) {
        if (value && (!isAbsolute(value) || value.includes('\0')))
          throw new BadRequestException(businessMessage('DEPENDENCY_PATH_INVALID'));
      }
      if (next.proxy) {
        let proxy: URL;
        try {
          proxy = new URL(next.proxy);
        } catch {
          throw new BadRequestException(businessMessage('PROXY_INVALID'));
        }
        if (
          !['http:', 'https:', 'socks5:', 'socks5h:'].includes(proxy.protocol) ||
          proxy.username ||
          proxy.password
        )
          throw new BadRequestException(businessMessage('PROXY_UNSUPPORTED'));
      }
      const accountError = browserAccountError(next);

      if (accountError) throw new BadRequestException(businessMessage('BROWSER_ACCOUNT_REQUIRED'));

      if (next.cookieStrategy !== 'auto' && next.cookiesFile) {
        const file = await stat(next.cookiesFile);
        if (!file.isFile() || file.size > 10 * 1024 * 1024)
          throw new BadRequestException(businessMessage('COOKIE_FILE_TOO_LARGE'));
        const source = await open(next.cookiesFile, 'r');
        try {
          const prefix = Buffer.alloc(256);
          const { bytesRead } = await source.read(prefix, 0, prefix.length, 0);
          if (
            !/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/m.test(
              prefix.subarray(0, bytesRead).toString('utf8'),
            )
          )
            throw new BadRequestException(businessMessage('COOKIE_FILE_FORMAT_INVALID'));
        } finally {
          await source.close();
        }
      }
      this.store.setPreferences(next);
      this.pump();
      return this.preferences();
    });
  }

  async parse(url: string, signal?: AbortSignal): Promise<MediaInfo> {
    this.journal?.write('parse.start');
    let media: MediaInfo;
    try {
      media = await this.engine.parse(url, this.preferences(), signal);
    } catch (error) {
      this.journal?.write('parse.failed', { category: classifyParseError(String(error)) });
      throw error;
    }
    this.journal?.write('parse.completed', { parser: media.parser });
    signal?.throwIfAborted();
    return this.exclusive(async () => {
      this.store.saveMedia(media);
      return structuredClone(media);
    });
  }

  list(
    options: {
      scope?: string;
      query?: string;
      offset?: number;
      limit?: number;
      archived?: boolean;
    } = {},
  ): TaskPage {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 25;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException(businessMessage('PAGINATION_INVALID'));
    if (options.scope && !['all', 'queue', 'library'].includes(options.scope))
      throw new BadRequestException(businessMessage('TASK_SCOPE_INVALID'));
    const page = this.store.list(options);
    return {
      ...page,
      items: page.items.map((task) => publicTask(this.liveTasks.get(task.id) ?? task)),
    };
  }

  private task(id: string): StoredTask {
    validateUuid(id, 'taskId');
    const task = this.liveTasks.get(id) ?? this.store.task(id);
    if (!task) throw new NotFoundException(businessMessage('TASK_NOT_FOUND'));
    return task;
  }

  get(id: string): DownloadTask {
    return publicTask(this.task(id));
  }

  async enqueue(request: DownloadRequest): Promise<DownloadTask> {
    return this.exclusive(async () => {
      const media = this.store.media(request.mediaId);
      if (!media) throw new NotFoundException(businessMessage('PARSE_EXPIRED'));
      if (request.formatId && !media.formats.some((entry) => entry.id === request.formatId))
        throw new BadRequestException(businessMessage('FORMAT_NOT_FOUND'));
      if (
        request.audioTrackId &&
        !media.audioTracks.some((entry) => entry.id === request.audioTrackId)
      )
        throw new BadRequestException(businessMessage('AUDIO_TRACK_NOT_FOUND'));
      if (request.subtitles?.some((language) => !media.subtitles.includes(language)))
        throw new BadRequestException(businessMessage('SUBTITLE_NOT_FOUND'));
      if (
        request.audioFormatId &&
        !media.audioFormats?.some((entry) => entry.id === request.audioFormatId)
      )
        throw new BadRequestException(businessMessage('AUDIO_FORMAT_NOT_FOUND'));
      if (request.mode === 'subtitle' && !request.subtitles?.length)
        throw new BadRequestException(businessMessage('SUBTITLE_REQUIRED'));
      const id = randomUUID();
      const task: StoredTask = {
        id,
        media: structuredClone(media),
        request: structuredClone(request),
        state: 'queued',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        eta: 0,
        ...taskMessage('queued'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        outputDirectory: resolve(this.preferences().downloadDirectory, id),
        artifacts: [],
        archived: false,
        preferences: this.preferences(),
      };
      this.store.insertTask(task);
      this.pump();
      return publicTask(task);
    });
  }

  async action(id: string, action: TaskAction): Promise<DownloadTask> {
    return this.exclusive(async () => {
      const task = this.task(id);
      const before = structuredClone(task);
      const allowed: Record<TaskAction, string[]> = {
        pause: ['queued', 'downloading', 'processing'],
        resume: ['paused'],
        retry: ['failed', 'cancelled'],
        cancel: ['queued', 'downloading', 'processing', 'paused'],
      };
      if (!allowed[action].includes(task.state))
        throw new BadRequestException(businessMessage('TASK_ACTION_INVALID'));
      if (action === 'pause' || action === 'cancel') {
        task.state = action === 'pause' ? 'paused' : 'cancelled';
        const run = this.active.get(id);
        run?.controller.abort(new BusinessError('TASK_STOPPED'));
        await run?.promise;
      } else {
        // A retry keeps output identity and .part files while adopting repaired runtime settings.
        task.preferences = {
          ...this.preferences(),
          downloadDirectory: task.preferences.downloadDirectory,
        };
        task.state = 'queued';
        task.archived = false;
      }
      task.speed = 0;
      task.eta = 0;
      Object.assign(task, taskMessage(task.state));
      task.updatedAt = new Date().toISOString();
      try {
        this.store.saveTask(task);
      } catch (error) {
        if (action === 'resume' || action === 'retry') Object.assign(task, before);
        throw error;
      }
      this.pump();
      return publicTask(task);
    });
  }

  async archive(id: string, archived: boolean): Promise<DownloadTask> {
    return this.exclusive(async () => {
      const task = this.task(id);
      if (['queued', 'downloading', 'processing', 'paused'].includes(task.state))
        throw new BadRequestException(businessMessage('TASK_ARCHIVE_ACTIVE'));
      const before = task.archived;
      task.archived = archived;
      try {
        this.store.saveTask(task);
      } catch (error) {
        task.archived = before;
        throw error;
      }
      return publicTask(task);
    });
  }

  async remove(id: string, stopActive = false): Promise<{ count: number; backupId: string }> {
    return this.exclusive(async () => {
      const task = this.task(id);
      if (['queued', 'downloading', 'processing', 'paused'].includes(task.state)) {
        if (!stopActive) throw new BadRequestException(businessMessage('TASK_REMOVE_ACTIVE'));
        task.state = 'cancelled';
        Object.assign(task, taskMessage('cancelled'));
        const run = this.active.get(id);
        run?.controller.abort(new BusinessError('TASK_REMOVED'));
        await run?.promise;
      }
      if (['queued', 'downloading', 'processing', 'paused'].includes(task.state))
        throw new BadRequestException(businessMessage('TASK_REMOVE_ACTIVE'));
      this.store.saveTask(task);
      return this.removeRecords([task.id]);
    });
  }

  async clearHistory(
    scope: 'library' | 'ended' = 'library',
  ): Promise<{ count: number; backupId: string }> {
    return this.exclusive(async () => this.removeRecords(this.store.endedIds(scope)));
  }

  async syncDirectory(signal?: AbortSignal): Promise<DirectorySyncResult> {
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      let plan: Awaited<ReturnType<typeof planDirectorySync>>;
      try {
        plan = await planDirectorySync(this.store.tasksForSync(), this.preferences(), signal);
      } catch (error) {
        if (signal?.aborted || error instanceof BusinessError) throw error;
        throw new BusinessError('DIRECTORY_SYNC_FAILED', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      signal?.throwIfAborted();
      const backupId = this.store.syncTasks(plan.removed, plan.imported, plan.updated);
      for (const id of plan.removed) {
        this.liveTasks.delete(id);
        this.dirtyProgress.delete(id);
        this.pendingFinals.delete(id);
      }
      this.journal?.write('directory.synced');
      return {
        directory: plan.directory,
        checkedAt: new Date().toISOString(),
        scanned: plan.scanned,
        imported: plan.imported.length,
        removed: plan.removed.length,
        updated: plan.updated.length,
        skipped: plan.skipped,
        ...(backupId ? { backupId } : {}),
      };
    });
  }

  private removeRecords(ids: string[]): { count: number; backupId: string } {
    const result = this.store.removeTasks(ids);
    for (const id of ids) {
      this.dirtyProgress.delete(id);
      this.pendingFinals.delete(id);
      this.liveTasks.delete(id);
    }
    this.journal?.write('history.removed');
    return result;
  }

  async deleteDownloads(
    input: DeleteDownloadsRequest,
    signal?: AbortSignal,
  ): Promise<DeleteDownloadsResult> {
    return this.exclusive(async () => {
      if (input.confirmDelete !== true) throw new BusinessError('DELETE_CONFIRM_REQUIRED');
      if (!Array.isArray(input.taskIds) || !input.taskIds.length || input.taskIds.length > 100)
        throw new BadRequestException(businessMessage('VALIDATION_FAILED', { fields: 'taskIds' }));

      signal?.throwIfAborted();
      const tasks = [...new Set(input.taskIds)].map((id) => this.task(id));
      if (tasks.some((task) => task.state !== 'completed'))
        throw new BusinessError('DELETE_COMPLETED_ONLY');
      const result = await deleteDownloadFiles(tasks, this.store.tasksForSync(), signal);
      if (result.removedTaskIds.length) {
        try {
          const removed = this.removeRecords(result.removedTaskIds);
          result.removedRecords = removed.count;
          result.backupId = removed.backupId;
        } catch (error) {
          throw new BusinessError('DELETE_SYNC_FAILED', {
            deleted: result.deletedFiles,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      this.journal?.write('downloads.deleted');
      return result;
    });
  }

  async restoreHistory(backupId: string): Promise<{ count: number; backupId: string }> {
    return this.exclusive(async () => {
      const result = await this.store.restoreHistory(backupId);
      this.journal?.write('history.restored');
      return result;
    });
  }

  private flushProgress(): void {
    const tasks = [...this.dirtyProgress.values()];
    this.store.saveProgress(tasks);
    this.dirtyProgress.clear();
    for (const [id, task] of this.pendingFinals) {
      this.store.saveTask(task);
      this.pendingFinals.delete(id);
      this.liveTasks.delete(id);
    }
  }

  private scheduleProgress(): void {
    this.progressTimer ??= setTimeout(() => {
      this.progressTimer = undefined;
      try {
        this.flushProgress();
      } catch (error) {
        this.logger.error(error);
        if (!this.stopping) this.scheduleProgress();
      }
    }, 1_000);
  }

  private pump(): void {
    if (this.stopping || this.mutating) return;
    while (this.active.size < this.preferences().concurrency) {
      let task: StoredTask | undefined;
      try {
        task = this.store.claimQueued();
      } catch (error) {
        this.logger.error(error);
        break;
      }
      if (!task) break;
      const controller = new AbortController();
      this.liveTasks.set(task.id, task);
      this.journal?.write('download.start', { taskId: task.id });
      const promise = this.run(task, controller.signal).finally(() => {
        this.active.delete(task.id);
        if (!this.pendingFinals.has(task.id)) this.liveTasks.delete(task.id);
        this.pump();
      });
      this.active.set(task.id, { controller, promise });
    }
  }

  private async run(task: StoredTask, signal: AbortSignal): Promise<void> {
    try {
      await mkdir(task.outputDirectory, { recursive: true });
      await this.engine.download(
        task.media,
        task.request,
        task.preferences,
        task.outputDirectory,
        signal,
        (line) => {
          if (signal.aborted) return;
          const progress = parseProgress(line);
          if (progress) Object.assign(task, progress);
          if (line.startsWith(ENGINE_PREFIX)) {
            const engine = line.slice(ENGINE_PREFIX.length);
            if (engine === 'native' || engine === 'aria2' || engine === 'yt-dlp') {
              task.downloader = engine;
              this.journal?.write('download.engine', { taskId: task.id, engine });
            }
          }
          if (line.startsWith(POSTPROCESS_PREFIX)) {
            task.state = 'processing';
            Object.assign(task, taskMessage('processing'));
          }
          task.updatedAt = new Date().toISOString();
          this.dirtyProgress.set(task.id, task);
          this.scheduleProgress();
        },
      );
      signal.throwIfAborted();
      task.artifacts = await this.collectArtifacts(task.outputDirectory);
      if (!task.artifacts.length) throw new BusinessError('DOWNLOAD_OUTPUT_MISSING');
      task.state = 'completed';
      task.progress = 100;
      Object.assign(task, taskMessage('completed'));
      this.journal?.write('download.completed', { taskId: task.id, engine: task.downloader });
    } catch (error) {
      if (!signal.aborted) {
        task.state = 'failed';
        Object.assign(task, businessErrorResponse(error, 'TASK_FAILED'));
        this.journal?.write('download.failed', {
          taskId: task.id,
          category: classifyParseError(String(error)),
        });
      }
    } finally {
      task.speed = 0;
      task.eta = 0;
      task.updatedAt = new Date().toISOString();
      this.dirtyProgress.delete(task.id);
      try {
        this.store.saveTask(task);
      } catch (error) {
        Object.assign(task, businessMessage('TASK_SAVE_FAILED'));
        this.pendingFinals.set(task.id, task);
        if (!this.stopping) this.scheduleProgress();
        this.logger.error(error);
      }
    }
  }

  private async collectArtifacts(root: string, directory = root): Promise<MediaArtifact[]> {
    const artifacts: MediaArtifact[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['.native', '.aria2'].includes(entry.name))
          artifacts.push(...(await this.collectArtifacts(root, path)));
      } else if (
        entry.isFile() &&
        !/\.(?:part|part\.json|ytdl|temp|aria2)$/.test(entry.name) &&
        !entry.name.includes('.part-Frag')
      ) {
        artifacts.push({ name: relative(root, path), bytes: (await stat(path)).size });
      }
    }
    return artifacts;
  }

  async artifact(id: string, index: number): Promise<{ path: string; name: string }> {
    const task = this.task(id);
    const artifact = task.artifacts[index];
    if (task.state !== 'completed' || !Number.isInteger(index) || !artifact)
      throw new NotFoundException(businessMessage('ARTIFACT_NOT_FOUND'));
    const directory = await realpath(task.outputDirectory);
    const path = await realpath(join(directory, artifact.name));
    const pathWithin = relative(directory, path);
    if (pathWithin.startsWith(`..${sep}`) || pathWithin === '..' || isAbsolute(pathWithin))
      throw new BadRequestException(businessMessage('ARTIFACT_PATH_ESCAPE'));
    if (!(await stat(path)).isFile())
      throw new NotFoundException(businessMessage('ARTIFACT_MOVED'));
    return { path, name: artifact.name };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;
    clearTimeout(this.progressTimer);
    for (const [id, run] of this.active) {
      const task = this.task(id);
      task.state = 'paused';
      Object.assign(task, businessMessage('TASK_INTERRUPTED'));
      run.controller.abort(new BusinessError('PLUGIN_STOPPING'));
    }
    await Promise.all([...this.active.values()].map((run) => run.promise));
    await this.pending;
    try {
      this.flushProgress();
    } finally {
      this.store.close();
    }
  }
}
