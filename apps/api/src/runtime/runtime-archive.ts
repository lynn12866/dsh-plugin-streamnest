import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { openPromise } from 'yauzl';

import { BusinessError } from '../../../shared/src/messages.js';

/** Extract only the pinned regular file, directly to our candidate path. */
export async function extractRuntimeZip(
  archive: string,
  entryName: string,
  target: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const zip = await openPromise(archive, { autoClose: false, strictFileNames: true }).catch(() => {
    signal.throwIfAborted();
    throw new BusinessError('RUNTIME_ARCHIVE_INVALID');
  });
  const closed = new Promise<void>((resolve) => zip.once('close', resolve));
  let found = false;
  let count = 0;

  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      if (++count > 8_192) throw new BusinessError('RUNTIME_ARCHIVE_INVALID');
      if (entry.fileName !== entryName) continue;

      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (found || (type !== 0 && type !== 0o100000) || entry.uncompressedSize > 512 * 1024 * 1024)
        throw new BusinessError('RUNTIME_ARCHIVE_INVALID');

      found = true;
      const input = await zip.openReadStreamPromise(entry);
      await pipeline(input, createWriteStream(target, { mode: 0o700, flags: 'wx' }), { signal });
    }
    signal.throwIfAborted();
    if (!found) throw new BusinessError('RUNTIME_ARCHIVE_ENTRY_MISSING', { entry: entryName });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof BusinessError) throw error;

    throw new BusinessError('RUNTIME_ARCHIVE_INVALID');
  } finally {
    zip.close();
    await closed;
  }
}
