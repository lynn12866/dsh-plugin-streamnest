import { BusinessError } from '../../../../shared/src/messages.js';
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { effectiveLoginPreferences } from '../../../../shared/src/cookies.js';
import type { BusinessMessage } from '../../../../shared/src/messages.js';
import type { Preferences } from '../../../../shared/src/contracts.js';
import type { ExtractorInfo } from '../formats.js';
import { DATA_DIRECTORY } from '../../storage/vault.store.js';

export interface ParseRecord {
  id: string;
  url: string;
  createdAt: number;
  parser: string;
  extractorArgs: string[];
  info: ExtractorInfo;
  notice: string;
  noticeInfo?: BusinessMessage;
}

const PARSE_TTL = 30 * 60_000;
export const DOWNLOAD_CACHE_TTL = 20 * 60_000;

@Injectable()
export class ParseCache {
  private readonly directory: string;
  private readonly keys = new Map<string, string>();

  constructor(@Inject(DATA_DIRECTORY) directory: string) {
    this.directory = join(directory, 'parse-cache');
  }

  private async key(url: string, preferences: Preferences): Promise<string> {
    preferences = effectiveLoginPreferences(preferences);
    const changed = preferences.cookiesFile
      ? await stat(preferences.cookiesFile)
          .then((value) => value.mtimeMs)
          .catch(() => 0)
      : 0;
    return createHash('sha256')
      .update(
        JSON.stringify([
          url,
          preferences.proxy,
          preferences.cookieBrowser,
          preferences.cookieProfile ?? '',
          preferences.cookiesFile,
          changed,
          preferences.cookieStrategy,
        ]),
      )
      .digest('hex');
  }

  async find(url: string, preferences: Preferences): Promise<ParseRecord | undefined> {
    const id = this.keys.get(await this.key(url, preferences));
    return id ? this.get(id, PARSE_TTL) : undefined;
  }

  infoPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BusinessError('PARSE_CACHE_INVALID');
    return join(this.directory, `${id}.info.json`);
  }

  async get(id: string, maxAge = DOWNLOAD_CACHE_TTL): Promise<ParseRecord | undefined> {
    const path = this.infoPath(id).replace('.info.json', '.record.json');
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as ParseRecord;
      return value.id === id && Date.now() - value.createdAt < maxAge && value.info
        ? value
        : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
        return undefined;
      throw error;
    }
  }

  async save(record: ParseRecord, preferences: Preferences): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.infoPath(record.id);
    await writeFile(`${path}.tmp`, JSON.stringify(record.info), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    const metadata = path.replace('.info.json', '.record.json');
    await writeFile(`${metadata}.tmp`, JSON.stringify(record), { mode: 0o600 });
    await rename(`${metadata}.tmp`, metadata);
    this.keys.set(await this.key(record.url, preferences), record.id);
    const files = await readdir(this.directory);
    for (const file of files.filter((name) => name.endsWith('.record.json'))) {
      const target = join(this.directory, file);
      const metadata = await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!metadata) continue;
      const age = Date.now() - metadata.mtimeMs;
      if (age > PARSE_TTL) {
        await rm(target, { force: true });
        await rm(target.replace('.record.json', '.info.json'), { force: true });
      }
    }
    if (this.keys.size > 100) this.keys.delete(this.keys.keys().next().value!);
  }

  private enginePath(directory: string): string {
    return join(
      this.directory,
      `engine-${createHash('sha256').update(directory).digest('hex')}.json`,
    );
  }

  async engine(directory: string): Promise<'aria2' | 'native' | 'yt-dlp' | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.enginePath(directory), 'utf8'));
      return value === 'aria2' || value === 'native' || value === 'yt-dlp' ? value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async saveEngine(directory: string, engine: 'aria2' | 'native' | 'yt-dlp'): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.enginePath(directory), JSON.stringify(engine), { mode: 0o600 });
  }
}
