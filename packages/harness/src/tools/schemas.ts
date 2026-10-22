import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools';

import { DOWNLOAD_MODES, TASK_STATES } from '../../../../apps/shared/src/contracts.js';

const string = { type: 'string', required: true } as const;
const number = { type: 'number', required: true } as const;
export const MESSAGE_PROPERTIES = {
  code: string,
  params: { type: 'object', additionalProperties: true, properties: {}, required: true },
  message: string,
} as const;

export const MESSAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: MESSAGE_PROPERTIES,
} as const satisfies ValueSchemaSpec;
export const MEDIA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    url: string,
    title: string,
    uploader: string,
    platform: string,
    duration: number,
    thumbnail: string,
    parsedAt: string,
    formats: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: string,
          label: string,
          extension: string,
          height: number,
          fps: number,
          bytes: number,
          hasAudio: { type: 'boolean', required: true },
        },
      },
    },
    audioTracks: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: string,
          language: string,
          label: string,
          formatId: { type: 'string' },
          isM3u8: { type: 'boolean' },
        },
      },
    },
    subtitles: { type: 'array', required: true, items: { type: 'string' } },
    audioFormats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: string,
          label: string,
          extension: string,
          bitrate: number,
          bytes: number,
        },
      },
    },
    parser: { type: 'string' },
    notice: { type: 'string' },
    noticeInfo: MESSAGE_SCHEMA,
  },
} as const satisfies ValueSchemaSpec;

export const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    media: { ...MEDIA_SCHEMA, required: true },
    request: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        mediaId: string,
        mode: { type: 'string', enum: DOWNLOAD_MODES, required: true },
        formatId: { type: 'string' },
        audioTrackId: { type: 'string' },
        audioFormatId: { type: 'string' },
        subtitleFormat: { type: 'string', enum: ['srt', 'source'] },
        subtitles: { type: 'array', items: { type: 'string' } },
      },
    },
    state: { type: 'string', enum: TASK_STATES, required: true },
    progress: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number,
    eta: number,
    ...MESSAGE_PROPERTIES,
    createdAt: string,
    updatedAt: string,
    outputDirectory: string,
    archived: { type: 'boolean', required: true },
    downloader: { type: 'string', enum: ['native', 'aria2', 'yt-dlp'] },
    artifacts: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { name: string, bytes: number, exists: { type: 'boolean' } },
      },
    },
  },
} as const satisfies ValueSchemaSpec;

export const DIRECTORY_SYNC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    directory: string,
    checkedAt: string,
    scanned: { type: 'integer', required: true },
    imported: { type: 'integer', required: true },
    removed: { type: 'integer', required: true },
    updated: { type: 'integer', required: true },
    skipped: { type: 'integer', required: true },
    backupId: { type: 'string' },
  },
} as const satisfies ValueSchemaSpec;

export const DELETE_DOWNLOADS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requested: { type: 'integer', required: true },
    deletedFiles: { type: 'integer', required: true },
    missingFiles: { type: 'integer', required: true },
    removedRecords: { type: 'integer', required: true },
    removedTaskIds: { type: 'array', required: true, items: { type: 'string' } },
    failures: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { taskId: string, ...MESSAGE_PROPERTIES },
      },
    },
    cancelled: { type: 'boolean', required: true },
    backupId: { type: 'string' },
  },
} as const satisfies ValueSchemaSpec;

export const PREFERENCES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    downloadDirectory: string,
    concurrency: { type: 'integer', required: true },
    fragments: { type: 'integer', required: true },
    proxy: string,
    cookieBrowser: {
      type: 'string',
      enum: ['', 'chrome', 'edge', 'firefox', 'safari', 'brave', 'chromium'],
      required: true,
    },
    cookiesFile: string,
    cookieProfile: { type: 'string' },
    filenameTemplate: { type: 'string' },
    preferredQuality: { type: 'string' },
    language: { type: 'string', enum: ['system', 'zh-CN', 'en-US'] },
    cookieStrategy: { type: 'string', enum: ['selected', 'auto'] },
    acceleration: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', required: true },
        maxConnections: { type: 'integer', required: true },
        aria2Path: string,
      },
    },
    binaryPaths: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        'yt-dlp': { type: 'string' },
        ffmpeg: { type: 'string' },
        ffprobe: { type: 'string' },
      },
    },
  },
} as const satisfies ValueSchemaSpec;

export const INSTALL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: {
      type: 'string',
      enum: ['idle', 'installing', 'completed', 'failed', 'cancelled'],
      required: true,
    },
    ...MESSAGE_PROPERTIES,
    downloaded: number,
    total: number,
  },
} as const satisfies ValueSchemaSpec;

export const RUNTIME_STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    platform: { type: 'string', required: true },
    managedDir: { type: 'string', required: true },
    results: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['yt-dlp', 'ffmpeg', 'ffprobe'], required: true },
          found: { type: 'boolean', required: true },
          path: { type: 'string' },
          version: { type: 'string' },
          source: { type: 'string' },
          reason: { type: 'string' },
          reasonInfo: MESSAGE_SCHEMA,
          managed: { type: 'boolean' },
          optional: { type: 'boolean' },
          requiredVersion: { type: 'string' },
          stale: { type: 'boolean' },
        },
      },
    },
  },
} as const satisfies ValueSchemaSpec;

export function jsonOutput<const S extends ValueSchemaSpec>(schema: S) {
  return {
    schema,
    render: (_args: unknown, value: unknown) => [
      { type: 'text' as const, text: JSON.stringify(value) },
    ],
  };
}
