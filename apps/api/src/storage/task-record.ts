import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

import type { StoredTask } from '../../../shared/src/contracts.js';
import { normalizePreferences } from '../../../shared/src/preferences.js';
import { storedTaskMessage } from '../../../shared/src/task-messages.js';

export const TASK_COLUMNS = [
  'payload',
  'state',
  'archived',
  'created_at',
  'updated_at',
  'progress',
  'downloaded_bytes',
  'total_bytes',
  'speed',
  'eta',
  'code',
  'params',
  'message',
  'downloader',
  'search_text',
  'duplicate_key',
] as const;

export function duplicateKey(task: Pick<StoredTask, 'media' | 'request'>): string {
  const request = task.request;
  return JSON.stringify([
    task.media.url,
    request.mode,
    request.formatId ?? '',
    request.audioTrackId ?? '',
    request.audioFormatId ?? '',
    request.subtitleFormat ?? 'srt',
    [...(request.subtitles ?? [])].sort(),
  ]);
}

export function progressValues(task: StoredTask): SQLInputValue[] {
  const info = storedTaskMessage(task);
  return [
    task.state,
    task.updatedAt,
    task.progress,
    task.downloadedBytes,
    task.totalBytes,
    task.speed,
    task.eta,
    info.code,
    JSON.stringify(info.params),
    info.message,
    task.downloader ?? null,
  ];
}

export function taskValues(task: StoredTask): SQLInputValue[] {
  return [
    JSON.stringify({
      media: task.media,
      request: task.request,
      preferences: task.preferences,
      outputDirectory: task.outputDirectory,
      artifacts: task.artifacts,
    }),
    task.state,
    Number(task.archived),
    task.createdAt,
    ...progressValues(task).slice(1),
    `${task.media.title} ${task.media.platform} ${task.media.url}`.toLowerCase(),
    duplicateKey(task),
  ];
}

export function readTask(row: Record<string, SQLOutputValue>): StoredTask {
  const payload = JSON.parse(String(row.payload)) as Pick<
    StoredTask,
    'media' | 'request' | 'preferences' | 'outputDirectory' | 'artifacts'
  >;
  return {
    ...payload,
    preferences: normalizePreferences(payload.preferences),
    id: String(row.id),
    state: row.state as StoredTask['state'],
    archived: !!row.archived,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    progress: Number(row.progress),
    downloadedBytes: Number(row.downloaded_bytes),
    totalBytes: Number(row.total_bytes),
    speed: Number(row.speed),
    eta: Number(row.eta),
    code: row.code as StoredTask['code'],
    params: JSON.parse(String(row.params)),
    message: String(row.message),
    ...(row.downloader ? { downloader: row.downloader as StoredTask['downloader'] } : {}),
  };
}
