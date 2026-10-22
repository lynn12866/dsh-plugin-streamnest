import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../../common/process.js';
import type { AccelerationStatus } from './types.js';

export function isSupportedAria2Version(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return !!match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 36));
}

/** 显式使用目标平台路径语义，覆盖 GUI 旧 PATH 和搬迁后的 Scoop/WinGet。 */
export function aria2Candidates(
  manual = '',
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  managed = '',
): string[] {
  if (manual) return [manual];
  const win = platform === 'win32';
  const paths = win ? path.win32 : path.posix;
  const name = win ? 'aria2c.exe' : 'aria2c';
  const candidates = [env.STREAMNEST_ARIA2_PATH || '', managed ? paths.join(managed, name) : ''];
  for (const dir of (env.PATH || '').split(win ? ';' : ':').filter(Boolean))
    candidates.push(paths.join(dir, name));
  if (win) {
    const local = env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local');
    const programs = env.ProgramFiles || 'C:\\Program Files';
    const data = env.ProgramData || 'C:\\ProgramData';
    for (const scoop of [
      env.SCOOP || paths.join(home, 'scoop'),
      env.SCOOP_GLOBAL || paths.join(data, 'scoop'),
    ]) {
      candidates.push(
        paths.join(scoop, 'shims', name),
        paths.join(scoop, 'apps', 'aria2', 'current', name),
      );
    }
    for (const dir of [paths.join(local, 'Microsoft', 'WinGet'), paths.join(programs, 'WinGet')])
      candidates.push(paths.join(dir, 'Links', name));
    candidates.push(
      paths.join(env.ChocolateyInstall || paths.join(data, 'chocolatey'), 'bin', name),
    );
  } else {
    for (const dir of [
      '/usr/bin',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      paths.join(home, '.local', 'bin'),
    ])
      candidates.push(paths.join(dir, name));
  }
  return [...new Set(candidates.filter(Boolean))];
}

export async function detectAria2(
  manual = '',
  managed = '',
  signal?: AbortSignal,
): Promise<AccelerationStatus> {
  const deadline = Date.now() + 6000;
  for (const candidate of aria2Candidates(
    manual,
    process.platform,
    process.env,
    os.homedir(),
    managed,
  )) {
    signal?.throwIfAborted();
    try {
      if (!fs.statSync(candidate).isFile()) continue;
    } catch {
      continue;
    }
    if (Date.now() >= deadline) break;
    let version = '';
    try {
      const { stdout } = await runProcess(candidate, ['--version'], {
        signal,
        timeoutMs: Math.min(2000, deadline - Date.now()),
      });
      version = /aria2 version (\d+(?:\.\d+)+)/i.exec(stdout)?.[1] ?? '';
    } catch {
      signal?.throwIfAborted();
    }
    if (isSupportedAria2Version(version))
      return { found: true, path: candidate, version, reason: '' };
    if (manual && version)
      return {
        found: false,
        path: null,
        version,
        reason: 'aria2 版本过旧，需要 1.36.0 或更新版本',
      };
  }
  return {
    found: false,
    path: null,
    version: '',
    reason: manual ? '所选文件不是可运行的 aria2c' : '未找到 aria2c，使用内置下载器',
  };
}
