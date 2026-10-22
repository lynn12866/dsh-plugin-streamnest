import { BRAND } from './brand.js';
import type { BusinessMessage } from './messages.js';

export const API_PREFIX = `/${BRAND.id}/api`;
export const DOWNLOAD_MODES = ['video', 'audio', 'subtitle'] as const;
export const TASK_STATES = [
  'queued',
  'downloading',
  'processing',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type DownloadMode = (typeof DOWNLOAD_MODES)[number];
export type TaskState = (typeof TASK_STATES)[number];
export type RuntimeKind = 'yt-dlp' | 'ffmpeg' | 'ffprobe';

export interface MediaFormat {
  id: string;
  label: string;
  extension: string;
  height: number;
  fps: number;
  bytes: number;
  hasAudio: boolean;
}

export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  formatId?: string;
  isM3u8?: boolean;
}

export interface AudioFormat {
  id: string;
  label: string;
  extension: string;
  bitrate: number;
  bytes: number;
}

export interface AccelerationSettings {
  enabled: boolean;
  maxConnections: number;
  aria2Path: string;
}

export interface MediaInfo {
  id: string;
  url: string;
  title: string;
  uploader: string;
  platform: string;
  duration: number;
  thumbnail: string;
  formats: MediaFormat[];
  audioTracks: AudioTrack[];
  subtitles: string[];
  parsedAt: string;
  audioFormats?: AudioFormat[];
  parser?: string;
  notice?: string;
  noticeInfo?: BusinessMessage;
}

export interface Preferences {
  downloadDirectory: string;
  concurrency: number;
  fragments: number;
  proxy: string;
  cookieBrowser: '' | 'chrome' | 'edge' | 'firefox' | 'safari' | 'brave' | 'chromium';
  cookiesFile: string;
  binaryPaths: Partial<Record<RuntimeKind, string>>;
  filenameTemplate?: string;
  preferredQuality?: string;
  language?: 'system' | 'zh-CN' | 'en-US';
  cookieStrategy?: 'selected' | 'auto';
  cookieProfile?: string;
  acceleration?: AccelerationSettings;
}

export interface DownloadRequest {
  mediaId: string;
  mode: DownloadMode;
  formatId?: string;
  audioTrackId?: string;
  audioFormatId?: string;
  subtitles?: string[];
  subtitleFormat?: 'srt' | 'source';
}

export interface MediaArtifact {
  name: string;
  bytes: number;
  exists?: boolean;
}

export interface DownloadTask extends BusinessMessage {
  id: string;
  media: MediaInfo;
  request: DownloadRequest;
  state: TaskState;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number;
  createdAt: string;
  updatedAt: string;
  outputDirectory: string;
  artifacts: MediaArtifact[];
  archived: boolean;
  downloader?: 'native' | 'aria2' | 'yt-dlp';
}

export interface StoredTask extends DownloadTask {
  preferences: Preferences;
}

export interface VaultState {
  version: 1;
  preferences: Preferences;
  media: MediaInfo[];
  tasks: StoredTask[];
}

export interface TaskPage {
  items: DownloadTask[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

export interface DirectorySyncResult {
  directory: string;
  checkedAt: string;
  scanned: number;
  imported: number;
  removed: number;
  updated: number;
  skipped: number;
  backupId?: string;
}

export interface DeleteDownloadsRequest {
  taskIds: string[];
  confirmDelete: boolean;
}

export interface DeleteDownloadsResult {
  requested: number;
  deletedFiles: number;
  missingFiles: number;
  removedRecords: number;
  removedTaskIds: string[];
  failures: (BusinessMessage & { taskId: string })[];
  cancelled: boolean;
  backupId?: string;
}

export interface RuntimeStatus {
  platform: string;
  managedDir: string;
  results: {
    kind: RuntimeKind;
    found: boolean;
    path?: string;
    version?: string;
    source?: string;
    reason?: string;
    reasonInfo?: BusinessMessage;
    managed?: boolean;
    optional?: boolean;
    requiredVersion?: string;
    stale?: boolean;
  }[];
}

export interface RuntimeInstall extends BusinessMessage {
  state: 'idle' | 'installing' | 'completed' | 'failed' | 'cancelled';
  downloaded: number;
  total: number;
}
