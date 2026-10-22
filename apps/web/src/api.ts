import { ApiBusinessError, LocalizedError } from './messages';
import { readBusinessMessage, type BusinessMessage } from '../../shared/src/messages';
import {
  API_PREFIX,
  type DownloadRequest,
  type DownloadTask,
  type DirectorySyncResult,
  type MediaInfo,
  type Preferences,
  type RuntimeInstall,
  type RuntimeKind,
  type RuntimeStatus,
  type TaskPage,
  type DeleteDownloadsResult,
} from '../../shared/src/contracts';
import type {
  BrowserProfileList,
  NativeInteraction,
  NativeKind,
  SystemDiagnostics,
} from '../../shared/src/system';
import { setLanguage } from './i18n';

function applyLanguage(preferences: Preferences): Preferences {
  setLanguage(preferences.language);
  return preferences;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => undefined)) as
      | {
          message?: string | string[];
        }
      | undefined;
    const business = readBusinessMessage(error);
    if (business) throw new ApiBusinessError(business);
    if (!error?.message)
      throw new LocalizedError(
        response.status >= 500 ? 'errors.serviceUnavailable' : 'errors.requestFailed',
      );

    throw new Error(Array.isArray(error.message) ? error.message.join('; ') : error.message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  parse: (url: string, signal: AbortSignal) =>
    request<MediaInfo>('/parse', { method: 'POST', body: JSON.stringify({ url }), signal }),
  enqueue: (input: DownloadRequest) =>
    request<DownloadTask>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  tasks: (
    scope: string,
    query: string,
    offset: number,
    archived: boolean | undefined,
    signal: AbortSignal,
  ) => {
    const parameters = new URLSearchParams({ scope, query, offset: String(offset), limit: '20' });
    if (archived !== undefined) parameters.set('archived', String(archived));

    return request<TaskPage>(`/tasks?${parameters}`, { signal });
  },
  action: (id: string, action: 'pause' | 'resume' | 'retry' | 'cancel') =>
    request<DownloadTask>(`/tasks/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  preferences: () => request<Preferences>('/preferences').then(applyLanguage),
  updatePreferences: (preferences: Preferences) =>
    request<Preferences>('/preferences', {
      method: 'PATCH',
      body: JSON.stringify(preferences),
    }).then(applyLanguage),
  runtime: (force = false) =>
    request<{ status: RuntimeStatus; installation: RuntimeInstall }>(`/runtime?force=${force}`),
  install: (kinds: RuntimeKind[], force = false) =>
    request<RuntimeInstall>('/runtime/install', {
      method: 'POST',
      body: JSON.stringify({ kinds, force }),
    }),
  cancelInstall: () => request<RuntimeInstall>('/runtime/cancel', { method: 'POST' }),
  restoreHistory: (backupId: string) =>
    request<{ count: number; backupId: string }>('/history/restore', {
      method: 'POST',
      body: JSON.stringify({ backupId }),
    }),
  syncDirectory: () => request<DirectorySyncResult>('/library/sync', { method: 'POST' }),
  deleteDownloads: (taskIds: string[]) =>
    request<DeleteDownloadsResult>('/library/delete', {
      method: 'POST',
      body: JSON.stringify({ taskIds, confirmDelete: true }),
    }),
  diagnostics: (force = false) => request<SystemDiagnostics>(`/system/diagnostics?force=${force}`),
  diskSpace: () => request<SystemDiagnostics['disk']>('/system/disk'),
  importBrowserProfiles: (
    browser: Exclude<Preferences['cookieBrowser'], ''>,
    sourcePath: string,
    profiles: BrowserProfileList['profiles'],
  ) =>
    request<BrowserProfileList>('/system/browser-profiles', {
      method: 'POST',
      body: JSON.stringify({
        browser,
        sourcePath,
        profiles: profiles.map(({ id, name, account }) => ({ id, name, account })),
      }),
    }),
  browserProfiles: (browser: Exclude<Preferences['cookieBrowser'], ''>) =>
    request<BrowserProfileList>(`/system/browser-profiles?browser=${browser}`),
  proxyTest: (proxy: string, url?: string) =>
    request<BusinessMessage & { connected: boolean; latencyMs: number; status: number }>(
      '/system/proxy-test',
      { method: 'POST', body: JSON.stringify({ proxy, url }) },
    ),
  open: (
    target: 'artifact' | 'reveal' | 'task-folder' | 'download-directory' | 'runtime' | 'logs',
    taskId?: string,
    index = 0,
  ) =>
    request<{ accepted: boolean; target: string; path: string }>('/system/open', {
      method: 'POST',
      body: JSON.stringify({ target, taskId, index }),
    }),
  logs: () => request<{ lines: string[]; bytes: number; error: string }>('/system/logs'),
  clearLogs: () =>
    request<{ cleared: boolean; backup: string }>('/system/logs/clear', { method: 'POST' }),
  errorReport: (taskId?: string) =>
    request<{ title: string; body: string }>(
      `/system/error-report${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`,
    ),
  nativeRequest: (kind: NativeKind, purpose: string, text = '') =>
    request<NativeInteraction>('/system/native', {
      method: 'POST',
      body: JSON.stringify({ kind, purpose, text }),
    }),
  nativePending: () => request<{ requests: NativeInteraction[] }>('/system/native'),
  nativeComplete: (id: string, value: string, cancelled = false) =>
    request<NativeInteraction>(`/system/native/${id}`, {
      method: 'POST',
      body: JSON.stringify({ value, cancelled }),
    }),
};
