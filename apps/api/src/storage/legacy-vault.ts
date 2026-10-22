import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { VaultState } from '../../../shared/src/contracts.js';
import { TASK_STATES } from '../../../shared/src/contracts.js';
import { BusinessError } from '../../../shared/src/messages.js';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export async function readLegacyVault(directory: string) {
  let contents: Buffer;
  try {
    contents = await readFile(join(directory, 'vault.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(contents.toString('utf8'));
  } catch {
    throw new BusinessError('VAULT_INVALID');
  }
  if (
    !object(value) ||
    value.version !== 1 ||
    !object(value.preferences) ||
    !Array.isArray(value.media) ||
    !Array.isArray(value.tasks) ||
    value.media.some((media: unknown) => !object(media) || typeof media.id !== 'string') ||
    value.tasks.some((task: unknown) => {
      if (!object(task) || !object(task.media)) return true;
      return (
        typeof task.id !== 'string' ||
        !object(task.request) ||
        !object(task.preferences) ||
        !Array.isArray(task.artifacts) ||
        typeof task.createdAt !== 'string' ||
        typeof task.updatedAt !== 'string' ||
        typeof task.outputDirectory !== 'string' ||
        typeof task.archived !== 'boolean' ||
        !TASK_STATES.includes(task.state as (typeof TASK_STATES)[number]) ||
        ['progress', 'downloadedBytes', 'totalBytes', 'speed', 'eta'].some(
          (key) => typeof task[key] !== 'number' || !Number.isFinite(task[key]),
        ) ||
        ['title', 'platform', 'url'].some(
          (key) => typeof (task.media as Record<string, unknown>)[key] !== 'string',
        )
      );
    })
  )
    throw new BusinessError('VAULT_INVALID');

  const digest = createHash('sha256').update(contents).digest('hex');
  const backup = `vault.json.backup-${digest.slice(0, 16)}-${randomUUID()}.bak`;
  const temporary = join(directory, `${backup}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(directory, backup));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  return { state: value as unknown as VaultState, backup, digest };
}
