import { businessMessage } from '../../../shared/src/messages.js';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { stat, statfs, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { RuntimeService } from '../runtime/runtime.service.js';
import { MediaService } from '../media/media.service.js';
import { DATA_DIRECTORY } from '../storage/vault.store.js';
import { CookieService } from '../media/parsing/cookie.service.js';
import { getChromiumPath, getInstalledBrowsers } from '../media/parsing/browser-paths.js';
import { detectAria2 } from '../media/engines/aria2.js';
import { checkJsRuntime } from '../media/engines/js-runtime.js';
import { fetchNetwork } from '../common/network.js';
import { validateMediaUrl } from '../media/media.engine.js';
import { JournalService } from './journal.service.js';
import { safeIssueReport } from '../../../shared/src/parse-errors.js';
import type { SystemDiagnostics } from '../../../shared/src/system.js';
import { browserProfiles, saveBrowserProfiles } from './browser-profiles.js';
import type { BrowserProfilesDto, ImportBrowserProfilesDto } from './system.dto.js';
import { BRAND } from '../../../shared/src/brand.js';

export type OpenTarget =
  'artifact' | 'reveal' | 'task-folder' | 'download-directory' | 'runtime' | 'logs';

@Injectable()
export class SystemService {
  constructor(
    @Inject(DATA_DIRECTORY) readonly directory: string,
    private readonly runtime: RuntimeService,
    private readonly media: MediaService,
    private readonly cookies: CookieService,
    private readonly journal: JournalService,
  ) {}

  browserProfiles(browser: BrowserProfilesDto['browser']) {
    return browserProfiles(browser, this.directory);
  }
  importBrowserProfiles(dto: ImportBrowserProfilesDto) {
    return saveBrowserProfiles(
      this.directory,
      dto.browser,
      dto.sourcePath,
      dto.profiles.map((profile) => ({ ...profile, label: '' })),
    );
  }

  async diskSpace(directory = this.media.preferences().downloadDirectory) {
    if (!isAbsolute(directory)) throw new BadRequestException(businessMessage('DIRECTORY_INVALID'));
    let existing = resolve(directory);
    while (!(await stat(existing).catch(() => undefined))) {
      const parent = dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const space = await statfs(existing, { bigint: true });
    return {
      directory,
      resolvedDirectory: existing,
      free: Number(space.bavail * space.bsize),
      total: Number(space.blocks * space.bsize),
      checkedAt: new Date().toISOString(),
    };
  }

  async proxyTest(
    proxy = this.media.preferences().proxy,
    url = 'https://www.gstatic.com/generate_204',
    signal?: AbortSignal,
  ) {
    if (proxy) {
      let parsed: URL;
      try {
        parsed = new URL(proxy);
      } catch {
        throw new BadRequestException(businessMessage('PROXY_INVALID'));
      }
      if (
        !['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw new BadRequestException(businessMessage('PROXY_CREDENTIALS'));
    }
    const target = await validateMediaUrl(url, signal);
    const start = Date.now();
    try {
      const response = await fetchNetwork(target, {
        method: 'HEAD',
        proxy,
        signal,
        timeoutMs: 10_000,
      });
      await response.body?.cancel();
      return {
        connected: response.ok,
        latencyMs: Date.now() - start,
        status: response.status,
        ...businessMessage(
          response.ok ? 'PROXY_CONNECTED' : 'PROXY_HTTP_STATUS',
          response.ok ? {} : { status: response.status },
        ),
      };
    } catch {
      signal?.throwIfAborted();
      return {
        connected: false,
        latencyMs: Date.now() - start,
        status: 0,
        ...businessMessage('PROXY_FAILED'),
      };
    }
  }

  async diagnostics(force = false, signal?: AbortSignal): Promise<SystemDiagnostics> {
    const preferences = this.media.preferences();
    const [runtime, acceleration, jsRuntime, cookies, disk] = await Promise.all([
      this.runtime.status(preferences, signal, force),
      detectAria2(
        preferences.acceleration?.aria2Path ?? '',
        join(this.directory, 'runtime/bin'),
        signal,
      ),
      checkJsRuntime(signal),
      this.cookies.status(preferences),
      this.diskSpace(),
    ]);
    return {
      version: BRAND.version,
      platform: `${process.platform}-${process.arch}`,
      runtime,
      acceleration,
      jsRuntime,
      cookies,
      disk,
      browser: { path: getChromiumPath(), installed: getInstalledBrowsers() },
    };
  }

  async errorReport(taskId?: string): Promise<{ title: string; body: string }> {
    const message = taskId ? this.media.get(taskId).message : 'unknown';
    const report = safeIssueReport(message, '');
    return {
      title: report.title.replace('[Bug]', '[拾流]'),
      body: `${report.body}\n\n插件版本：${BRAND.version}\n请确认已移除个人信息后，再将草稿提交给维护者。`,
    };
  }

  async open(target: OpenTarget, taskId?: string, index = 0) {
    let path: string;
    if (target === 'artifact' || target === 'reveal') {
      if (!taskId) throw new BadRequestException(businessMessage('TASK_REQUIRED'));
      path = (await this.media.artifact(taskId, index)).path;
    } else if (target === 'task-folder') {
      if (!taskId) throw new BadRequestException(businessMessage('TASK_REQUIRED'));
      path = this.media.get(taskId).outputDirectory;
    } else if (target === 'runtime') path = join(this.directory, 'runtime/bin');
    else if (target === 'logs') path = this.journal.directory;
    else if (target === 'download-directory') path = this.media.preferences().downloadDirectory;
    else throw new BadRequestException(businessMessage('OPEN_TARGET_INVALID'));
    if (!['artifact', 'reveal'].includes(target)) await mkdir(path, { recursive: true });
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer.exe'
          : 'xdg-open';
    const args =
      process.platform === 'darwin' && target === 'reveal'
        ? ['-R', path]
        : process.platform === 'win32' && target === 'reveal'
          ? [`/select,${path}`]
          : [target === 'reveal' ? dirname(path) : path];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    this.journal.write('system.open', { category: target });
    return { accepted: true, target, path };
  }
}
