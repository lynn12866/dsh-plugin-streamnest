import { Inject, Injectable } from '@nestjs/common';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { DATA_DIRECTORY } from '../storage/vault.store.js';

@Injectable()
export class JournalService {
  readonly directory: string;
  private readonly path: string;
  private pending = Promise.resolve();
  private lastError = '';

  constructor(@Inject(DATA_DIRECTORY) directory: string) {
    this.directory = join(directory, 'logs');
    this.path = join(this.directory, 'streamnest.log');
  }

  /** 仅记录允许公开的类别与内部 ID；不写 URL、代理、Cookie、标题或原始输出。 */
  write(
    event: string,
    data: {
      taskId?: string;
      parser?: string;
      engine?: string;
      category?: string;
      state?: string;
    } = {},
  ): void {
    const safe = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value && /^[\w.-]{1,100}$/.test(value)),
    );
    const line = `${new Date().toISOString()} ${event.replace(/[^\w.-]/g, '').slice(0, 60)} ${JSON.stringify(safe)}\n`;
    const operation = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const size = await stat(this.path)
        .then((value) => value.size)
        .catch(() => 0);
      if (size > 512 * 1024) await rename(this.path, `${this.path}.previous`);
      await appendFile(this.path, line, { mode: 0o600 });
    });
    this.pending = operation.catch((error: NodeJS.ErrnoException) => {
      this.lastError = error.code ?? 'LOG_WRITE_FAILED';
    });
  }

  async read(limit = 200): Promise<{ lines: string[]; bytes: number; error: string }> {
    await this.pending;
    const content = await readFile(this.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    return {
      lines: content
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(500, limit))),
      bytes: Buffer.byteLength(content),
      error: this.lastError,
    };
  }

  async clear(): Promise<{ cleared: boolean; backup: string }> {
    const operation = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const backup = `cleared-${randomUUID()}.log`;
      try {
        await rename(this.path, join(this.directory, backup));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await writeFile(this.path, '', { mode: 0o600 });
      return { cleared: true, backup };
    });
    this.pending = operation.then(
      () => undefined,
      (error: NodeJS.ErrnoException) => {
        this.lastError = error.code ?? 'LOG_WRITE_FAILED';
      },
    );
    return operation;
  }
}
