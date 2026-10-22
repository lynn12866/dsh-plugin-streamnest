import {
  BusinessError,
  businessMessage,
  errorMessage,
  type BusinessMessage,
} from '../../../shared/src/messages.js';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

import type { Preferences, RuntimeKind, RuntimeStatus } from '../../../shared/src/contracts.js';
import { runProcess } from '../common/process.js';
import {
  binaryName,
  compareVersions,
  parseVersion,
  RUNTIME_KINDS,
  YTDLP_VERSION,
  FFMPEG_VERSION,
} from './runtime-manifest.js';

type Result = RuntimeStatus['results'][number];
interface Candidate {
  path: string;
  source: 'manual' | 'managed' | 'system' | 'scanned';
}

export async function probeRuntime(
  kind: RuntimeKind,
  path: string,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<string> {
  const file = await stat(path);
  if (!file.isFile()) throw new BusinessError('RUNTIME_FILE_INVALID');
  await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
  const result = await runProcess(path, [kind === 'yt-dlp' ? '--version' : '-version'], {
    signal,
    timeoutMs,
  });
  const version = parseVersion(kind, result.stdout || result.stderr);
  if (!version) throw new BusinessError('RUNTIME_VERSION_INVALID');
  return version;
}

async function searchPaths(signal: AbortSignal): Promise<string[]> {
  let value = process.env.PATH ?? '';
  const shell = process.env.SHELL;
  if (process.platform !== 'win32' && shell && isAbsolute(shell)) {
    try {
      const result = await runProcess(shell, ['-l', '-c', 'printf %s "$PATH"'], {
        signal,
        timeoutMs: 3000,
      });
      value += delimiter + result.stdout;
    } catch {
      signal.throwIfAborted();
    }
  }
  return [...new Set(value.split(delimiter).filter(isAbsolute))];
}

function commonDirectories(): string[] {
  const home = homedir();
  if (process.platform === 'win32')
    return [
      join(home, 'scoop/shims'),
      join(home, 'AppData/Local/Microsoft/WinGet/Links'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ffmpeg/bin'),
      'C:\\ffmpeg\\bin',
      join(process.env.ProgramData ?? 'C:\\ProgramData', 'chocolatey/bin'),
    ];
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/opt/local/bin',
    join(home, '.local/bin'),
    join(home, 'bin'),
  ];
}

/** 只枚举受限目录中的文件名，不读取文件内容；不扫描浏览器配置。 */
async function scannedCandidates(kind: RuntimeKind, signal: AbortSignal): Promise<Candidate[]> {
  const pending = [join(homedir(), 'bin'), join(homedir(), '.local/bin')].map((path) => ({
    path,
    depth: 0,
  }));
  const found: Candidate[] = [];
  const deadline = Date.now() + 3000;
  let count = 0;
  while (pending.length && count < 5000 && Date.now() < deadline && found.length < 3) {
    signal.throwIfAborted();
    const next = pending.shift()!;
    const entries = await readdir(next.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++count > 5000) break;
      const path = join(next.path, entry.name);
      if (entry.isFile() && entry.name === binaryName(kind))
        found.push({ path, source: 'scanned' });
      if (
        entry.isDirectory() &&
        next.depth < 3 &&
        !entry.name.startsWith('.') &&
        !['node_modules', 'Library'].includes(entry.name)
      )
        pending.push({ path, depth: next.depth + 1 });
    }
  }
  return found;
}

export async function discoverRuntime(
  directory: string,
  preferences: Preferences,
  signal: AbortSignal,
): Promise<RuntimeStatus> {
  const managedDir = join(directory, 'runtime/bin');
  const paths = [...(await searchPaths(signal)), ...commonDirectories()];
  const results = await Promise.all(
    RUNTIME_KINDS.map(async (kind): Promise<Result> => {
      const candidates: Candidate[] = [
        ...(preferences.binaryPaths[kind]
          ? [{ path: preferences.binaryPaths[kind]!, source: 'manual' as const }]
          : []),
        { path: join(managedDir, binaryName(kind)), source: 'managed' },
        ...paths.map((path) => ({ path: join(path, binaryName(kind)), source: 'system' as const })),
      ];
      const visited = new Set<string>();
      const budget = AbortSignal.any([signal, AbortSignal.timeout(65_000)]);
      let reasonInfo: BusinessMessage = businessMessage('RUNTIME_NOT_FOUND');
      let stale = false;
      const attempt = async (candidate: Candidate): Promise<Result | undefined> => {
        const path = resolve(candidate.path);
        if (visited.has(path)) return;
        visited.add(path);
        if (!(await stat(path).catch(() => undefined))?.isFile()) return;
        try {
          const version = await probeRuntime(
            kind,
            path,
            budget,
            candidate.source === 'system' ? 5000 : 30_000,
          );
          const requiredVersion = kind === 'yt-dlp' ? YTDLP_VERSION : FFMPEG_VERSION;
          const minimum =
            kind === 'yt-dlp' || candidate.source === 'managed' ? requiredVersion : '4';
          if (compareVersions(version, minimum) < 0) {
            stale = true;
            reasonInfo = businessMessage('RUNTIME_STALE', { kind, version });
            return;
          }
          return {
            kind,
            found: true,
            optional: kind === 'ffprobe',
            path,
            version,
            source: candidate.source,
            managed: candidate.source === 'managed',
            requiredVersion,
          };
        } catch (error) {
          signal.throwIfAborted();
          reasonInfo = budget.aborted
            ? businessMessage('RUNTIME_DETECTION_TIMEOUT')
            : errorMessage(error);
        }
      };
      for (const candidate of candidates) {
        const result = await attempt(candidate);
        if (result) return result;
        if (budget.aborted) break;
      }
      if (!budget.aborted)
        for (const candidate of await scannedCandidates(kind, signal)) {
          const result = await attempt(candidate);
          if (result) return result;
          if (budget.aborted) break;
        }
      return {
        kind,
        found: false,
        optional: kind === 'ffprobe',
        reason: reasonInfo.message,
        reasonInfo,
        stale,
        requiredVersion: kind === 'yt-dlp' ? YTDLP_VERSION : FFMPEG_VERSION,
      };
    }),
  );
  return { platform: `${process.platform}/${process.arch}`, managedDir, results };
}
