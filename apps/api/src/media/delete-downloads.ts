import { lstat, realpath } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { StoredTask, DeleteDownloadsResult } from '../../../shared/src/contracts.js';
import {
  BusinessError,
  businessMessage,
  readBusinessMessage,
} from '../../../shared/src/messages.js';

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function info(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
}

/** Resolve registered files under the task's original download root, without following links. */
async function registeredFile(task: StoredTask, name: string) {
  const root = resolve(task.preferences.downloadDirectory);
  const directory = resolve(task.outputDirectory);
  const file = resolve(directory, name);
  if (!name || isAbsolute(name) || file === directory || !within(directory, file))
    throw new BusinessError('DELETE_PATH_UNSAFE');

  const canonicalRoot = await realpath(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return root;
  });
  const base = within(root, directory) ? root : canonicalRoot;
  if (!within(base, directory)) throw new BusinessError('DELETE_PATH_UNSAFE');

  const segments = relative(base, file).split(sep);
  let path = canonicalRoot;
  for (let index = 0; index < segments.length; index++) {
    path = resolve(path, segments[index]!);
    const entry = await info(path);
    if (!entry) return { path: resolve(canonicalRoot, relative(base, file)), entry: undefined };
    if (
      entry.isSymbolicLink() ||
      (index === segments.length - 1 ? !entry.isFile() : !entry.isDirectory())
    )
      throw new BusinessError('DELETE_PATH_UNSAFE');
  }
  return { path, entry: await info(path) };
}

export async function deleteDownloadFiles(
  tasks: readonly StoredTask[],
  allTasks: readonly StoredTask[],
  signal?: AbortSignal,
): Promise<DeleteDownloadsResult> {
  const selected = new Set(tasks.map((task) => task.id));
  const references = new Set<string>();
  const activeDirectories: string[] = [];
  const directories = new Map<string, string>();
  for (const task of allTasks) {
    signal?.throwIfAborted();
    if (selected.has(task.id)) continue;
    if (!directories.has(task.outputDirectory))
      directories.set(
        task.outputDirectory,
        await realpath(task.outputDirectory).catch(() => resolve(task.outputDirectory)),
      );
    const directory = directories.get(task.outputDirectory)!;
    for (const file of task.artifacts) references.add(resolve(directory, file.name));
    if (['queued', 'downloading', 'processing', 'paused'].includes(task.state))
      activeDirectories.push(directory);
  }

  const result: DeleteDownloadsResult = {
    requested: tasks.length,
    deletedFiles: 0,
    missingFiles: 0,
    removedRecords: 0,
    removedTaskIds: [],
    failures: [],
    cancelled: false,
  };
  const processed = new Set<string>();
  for (const task of tasks) {
    if (signal?.aborted) break;
    try {
      const files = await Promise.all(
        task.artifacts.map((file) => registeredFile(task, file.name)),
      );
      if (
        files.some(
          ({ path }) =>
            references.has(path) || activeDirectories.some((root) => within(root, path)),
        )
      )
        throw new BusinessError('DELETE_FILE_SHARED');

      let complete = true;
      for (const [index, file] of files.entries()) {
        if (signal?.aborted) {
          complete = false;
          break;
        }
        if (processed.has(file.path)) continue;

        const current = await registeredFile(task, task.artifacts[index]!.name);
        if (
          current.path !== file.path ||
          (current.entry &&
            (!file.entry ||
              current.entry.ino !== file.entry.ino ||
              current.entry.dev !== file.entry.dev))
        )
          throw new BusinessError('DELETE_PATH_UNSAFE');
        if (!current.entry) {
          result.missingFiles++;
          processed.add(file.path);
          continue;
        }
        try {
          await fs.unlink(file.path);
        } catch (error) {
          // Reconcile a file removed concurrently before reporting a failure.
          if (await info(file.path)) throw error;
        }
        if (await info(file.path))
          throw new Error('The file is still present at its original path.');

        result.deletedFiles++;
        processed.add(file.path);
      }
      if (complete) result.removedTaskIds.push(task.id);
    } catch (error) {
      result.failures.push({
        taskId: task.id,
        ...(signal?.aborted
          ? businessMessage('DELETE_CANCELLED')
          : (readBusinessMessage(error) ??
            businessMessage('DELETE_FAILED', {
              reason: (error instanceof Error ? error.message : String(error)).slice(-2_000),
            }))),
      });
    }
  }
  result.cancelled = signal?.aborted ?? false;
  return result;
}
