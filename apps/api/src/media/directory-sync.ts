import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { Preferences, StoredTask } from '../../../shared/src/contracts.js';
import { mediaFileMode } from '../../../shared/src/media-files.js';
import { BusinessError } from '../../../shared/src/messages.js';
import { taskMessage } from '../../../shared/src/task-messages.js';

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export async function planDirectorySync(
  tasks: readonly StoredTask[],
  preferences: Preferences,
  signal?: AbortSignal,
) {
  const root = resolve(preferences.downloadDirectory);
  const removed: string[] = [];
  const updated: StoredTask[] = [];
  const imported: StoredTask[] = [];
  const files = new Map<string, { size: number; mtimeMs: number }>();
  const ignored = new Set<string>();
  const taskDirectories = new Map<string, string>();
  let skipped = 0;
  let entries = 0;
  signal?.throwIfAborted();
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
      tasks.some((task) => within(root, resolve(task.outputDirectory)))
    )
      throw error;

    signal?.throwIfAborted();
    await mkdir(root, { recursive: true, mode: 0o700 });
    canonicalRoot = await realpath(root);
  }
  if (!(await lstat(canonicalRoot)).isDirectory())
    throw new BusinessError('DIRECTORY_SYNC_FAILED', { reason: 'Not a directory' });

  for (const task of tasks) {
    signal?.throwIfAborted();
    let directory = resolve(task.outputDirectory);
    if (!within(root, directory)) {
      const canonical = await realpath(directory).catch(() => undefined);
      if (!canonical || !within(canonicalRoot, canonical)) continue;
      directory = resolve(root, relative(canonicalRoot, canonical));
    }
    taskDirectories.set(task.id, directory);
    if (task.state !== 'completed') ignored.add(directory);
  }

  const excluded = (path: string) => {
    for (let current = path; within(root, current); current = dirname(current)) {
      if (ignored.has(current)) return true;
      if (current === root) break;
    }
    return false;
  };
  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (++entries > 50_000) throw new BusinessError('DIRECTORY_SYNC_LIMIT');

      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || excluded(path)) {
        ignored.add(path);
        skipped++;
        continue;
      }
      const canonical = await realpath(path);
      if (!within(canonicalRoot, canonical)) throw new BusinessError('ARTIFACT_PATH_ESCAPE');

      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile()) {
        const info = await lstat(path);
        if (!info.isFile()) throw new BusinessError('DIRECTORY_SYNC_FAILED', { reason: path });

        files.set(path, { size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  await scan(root);
  signal?.throwIfAborted();

  const owned = new Set<string>();
  for (const task of tasks) {
    signal?.throwIfAborted();
    const directory = taskDirectories.get(task.id);
    if (task.state !== 'completed' || !directory || excluded(directory)) continue;

    const paths = task.artifacts.map((artifact) => {
      const path = resolve(directory, artifact.name);
      if (!within(directory, path)) throw new BusinessError('ARTIFACT_PATH_ESCAPE');
      return path;
    });
    if (paths.some(excluded)) continue;

    const primary = task.artifacts.filter(
      (artifact) => mediaFileMode(artifact.name) === task.request.mode,
    );
    const expected = primary.length ? primary : task.artifacts;
    if (!expected.some((artifact) => files.has(resolve(directory, artifact.name)))) {
      removed.push(task.id);
      continue;
    }
    paths.forEach((path) => owned.add(path));
    const artifacts = task.artifacts.map((artifact, index) => {
      const file = files.get(paths[index]!);
      return file ? { ...artifact, bytes: file.size } : artifact;
    });
    if (artifacts.some((artifact, index) => artifact.bytes !== task.artifacts[index]!.bytes))
      updated.push({ ...task, artifacts, updatedAt: new Date().toISOString() });
  }

  for (const [path, info] of files) {
    signal?.throwIfAborted();
    const mode = mediaFileMode(path);
    if (
      !mode ||
      !info.size ||
      owned.has(path) ||
      /\.(?:part[-.]|(?:temp|tmp|f\d+)\.)/i.test(basename(path))
    )
      continue;

    const id = randomUUID();
    const now = new Date().toISOString();
    const mediaId = randomUUID();
    imported.push({
      id,
      state: 'completed',
      progress: 100,
      downloadedBytes: info.size,
      totalBytes: info.size,
      speed: 0,
      eta: 0,
      ...taskMessage('completed'),
      createdAt: new Date(info.mtimeMs).toISOString(),
      updatedAt: now,
      outputDirectory: dirname(path),
      artifacts: [{ name: basename(path), bytes: info.size }],
      archived: false,
      preferences,
      request: { mediaId, mode },
      media: {
        id: mediaId,
        url: '',
        title: basename(path, extname(path)),
        uploader: '',
        platform: 'Local',
        duration: 0,
        thumbnail: '',
        formats: [],
        audioTracks: [],
        subtitles: [],
        parsedAt: now,
      },
    });
  }
  return {
    directory: root,
    imported,
    removed,
    updated,
    scanned: [...files.keys()].filter((path) => mediaFileMode(path)).length,
    skipped,
  };
}
