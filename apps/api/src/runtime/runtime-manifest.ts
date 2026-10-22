import { BusinessError } from '../../../shared/src/messages.js';
import type { RuntimeKind } from '../../../shared/src/contracts.js';
import assets from './assets.json' with { type: 'json' };

export const RUNTIME_KINDS: RuntimeKind[] = ['yt-dlp', 'ffmpeg', 'ffprobe'];
export const YTDLP_VERSION = assets.ytDlpTag;
export const FFMPEG_VERSION = assets.ffmpegVersion;
export type RuntimeAsset = {
  url: string;
  sha256: string;
  version?: string;
} & ({ format: 'binary' | 'gzip' } | { format: 'zip'; entry: string });

export function runtimeAsset(
  kind: RuntimeKind,
  platform = `${process.platform}/${process.arch}`,
): RuntimeAsset {
  if (kind === 'yt-dlp') {
    const table: Record<string, { name: string; sha256: string } | undefined> = assets.ytdlp;
    const asset = table[platform];
    if (!asset) throw new BusinessError('RUNTIME_PLATFORM_UNSUPPORTED', { platform, kind });

    return {
      url: `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${assets.ytDlpTag}/${asset.name}`,
      sha256: asset.sha256,
      format: 'binary',
    };
  }
  const table: Record<string, { url: string; sha256: string; entry: string } | undefined> =
    Object.fromEntries(Object.entries(assets.ffmpeg).map(([key, value]) => [key, value[kind]]));
  const asset = table[platform];
  if (!asset) throw new BusinessError('RUNTIME_PLATFORM_UNSUPPORTED', { platform, kind });

  return {
    url: asset.url,
    sha256: asset.sha256,
    format: 'zip',
    entry: asset.entry,
    version: FFMPEG_VERSION,
  };
}

export function binaryName(kind: RuntimeKind): string {
  return process.platform === 'win32' ? `${kind}.exe` : kind;
}

export function parseVersion(kind: RuntimeKind, output: string): string {
  const first = output.trim().split(/\r?\n/)[0] ?? '';
  if (kind === 'yt-dlp') return /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(first) ? first : '';
  return new RegExp(`^${kind} version (\\S+)`).exec(first)?.[1] ?? '';
}

export function compareVersions(left: string, right: string): number {
  const a = left.match(/\d+/g)?.map(Number) ?? [];
  const b = right.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return Math.sign((a[i] ?? 0) - (b[i] ?? 0));
  }
  return 0;
}
