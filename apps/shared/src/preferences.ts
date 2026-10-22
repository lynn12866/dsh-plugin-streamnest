import type { AccelerationSettings, Preferences } from './contracts.js';

export function normalizeAcceleration(value?: Partial<AccelerationSettings>): AccelerationSettings {
  const count = Number(value?.maxConnections);

  return {
    enabled: value?.enabled !== false,
    maxConnections: Number.isFinite(count) ? Math.max(1, Math.min(16, Math.trunc(count))) : 8,
    aria2Path: typeof value?.aria2Path === 'string' ? value.aria2Path.trim() : '',
  };
}

export function accelerationConnections(value?: AccelerationSettings): number {
  const normalized = normalizeAcceleration(value);
  return normalized.enabled ? normalized.maxConnections : 1;
}

/** 新字段补默认值，旧任务保留原保存目录与显式 Cookie 设置。 */
export function normalizePreferences(value: Preferences): Preferences {
  const binaryPaths = Object.fromEntries(
    Object.entries(value.binaryPaths ?? {}).filter(
      ([, file]) => typeof file === 'string' && file.trim(),
    ),
  );

  return {
    ...value,
    binaryPaths,
    filenameTemplate: value.filenameTemplate ?? '%(title).160B [%(id)s].%(ext)s',
    preferredQuality: value.preferredQuality ?? 'best',
    language: value.language ?? 'system',
    cookieStrategy: value.cookieStrategy ?? 'selected',
    acceleration: normalizeAcceleration(value.acceleration),
  };
}
