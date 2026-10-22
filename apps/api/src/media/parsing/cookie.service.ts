import { BusinessError } from '../../../../shared/src/messages.js';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Preferences } from '../../../../shared/src/contracts.js';
import {
  browserAccountError,
  browserCookieSource,
  effectiveLoginPreferences,
} from '../../../../shared/src/cookies.js';
import { DATA_DIRECTORY } from '../../storage/vault.store.js';
import { getInstalledBrowsers } from './browser-paths.js';
import { runProcess } from '../../common/process.js';

export interface BrowserCookie {
  domain: string;
  includeSubdomains: boolean;
  path: string;
  secure: boolean;
  expiry: number;
  name: string;
  value: string;
}

export function parseNetscapeCookies(content: string): BrowserCookie[] {
  return content.split(/\r?\n/).flatMap((raw) => {
    const line = raw.replace(/^#HttpOnly_/, '');
    if (!line.trim() || line.startsWith('#')) return [];
    const [domain, subdomains, path, secure, expires, name, ...values] = line.split('\t');
    if (!domain || !path || !name || !values.length) return [];
    const expiry = Number(expires) || 0;
    if (expiry && expiry < Date.now() / 1000) return [];
    return [
      {
        domain,
        includeSubdomains: subdomains === 'TRUE',
        path,
        secure: secure === 'TRUE',
        expiry,
        name,
        value: values.join('\t'),
      },
    ];
  });
}

export function cookieMatchesHost(cookie: BrowserCookie, hostname: string): boolean {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  const target = hostname.toLowerCase();
  return (
    target === domain ||
    ((cookie.includeSubdomains || cookie.domain.startsWith('.')) && target.endsWith(`.${domain}`))
  );
}

export function isCookieReadError(error: unknown): boolean {
  return /could not (?:find|copy).*cookie|failed to (?:decrypt|load cookies)|cookies? database|keyring|keychain|secretstorage|kwallet|unsupported (?:browser|keyring)|database is locked|unable to open database|netscape format|invalid (?:length|expires)|operation not permitted|permission denied|access is denied|binarycookies/i.test(
    String(error),
  );
}

interface CookieSource {
  kind: 'none' | 'file' | 'browser';
  value: string;
  label: string;
}

@Injectable()
export class CookieService {
  private readonly directory: string;
  private readonly failures = new Map<string, number>();

  constructor(@Inject(DATA_DIRECTORY) directory: string) {
    this.directory = join(directory, 'login-snapshots');
  }

  private key(preferences: Preferences): string {
    preferences = effectiveLoginPreferences(preferences);
    return createHash('sha256')
      .update(
        JSON.stringify([
          preferences.cookieStrategy ?? 'selected',
          preferences.cookieBrowser,
          preferences.cookiesFile,
          preferences.cookieProfile ?? '',
        ]),
      )
      .digest('hex');
  }

  private snapshot(preferences: Preferences): string {
    return join(this.directory, `${this.key(preferences)}.txt`);
  }

  private enabled(preferences: Preferences): boolean {
    return (
      !!preferences.cookiesFile ||
      !!preferences.cookieBrowser ||
      preferences.cookieStrategy === 'auto'
    );
  }

  async status(preferences: Preferences) {
    preferences = effectiveLoginPreferences(preferences);
    const snapshot = this.enabled(preferences)
      ? await stat(this.snapshot(preferences)).catch(() => undefined)
      : undefined;
    const meta = snapshot
      ? await readFile(`${this.snapshot(preferences)}.json`, 'utf8')
          .then((value) => JSON.parse(value) as { browser?: string })
          .catch(() => ({}) as { browser?: string })
      : undefined;
    return {
      enabled: this.enabled(preferences),
      strategy: preferences.cookieStrategy ?? 'selected',
      manual: !!preferences.cookiesFile,
      availableBrowsers: getInstalledBrowsers(),
      hasSnapshot: !!snapshot,
      snapshotAgeMs: snapshot ? Date.now() - snapshot.mtimeMs : null,
      lastGoodBrowser: meta?.browser ?? '',
    };
  }

  async fileForPlatform(preferences: Preferences): Promise<string | undefined> {
    preferences = effectiveLoginPreferences(preferences);
    if (preferences.cookiesFile) return preferences.cookiesFile;
    if (!this.enabled(preferences)) return undefined;
    const path = this.snapshot(preferences);
    const file = await stat(path).catch(() => undefined);
    return file && Date.now() - file.mtimeMs < 30 * 60_000 ? path : undefined;
  }

  async cookies(preferences: Preferences, hostname: string): Promise<BrowserCookie[]> {
    preferences = effectiveLoginPreferences(preferences);
    await this.validateSource(preferences);
    const file = await this.fileForPlatform(preferences);
    if (!file) return [];
    const content = await readFile(file, 'utf8');
    return parseNetscapeCookies(content).filter((cookie) => cookieMatchesHost(cookie, hostname));
  }

  async validateSource(preferences: Preferences): Promise<void> {
    const error = browserAccountError(preferences);

    if (error) throw new BusinessError('BROWSER_ACCOUNT_REQUIRED');
  }

  async prepare(
    preferences: Preferences,
    binary: string,
    signal?: AbortSignal,
    refresh = false,
  ): Promise<void> {
    preferences = effectiveLoginPreferences(preferences);
    await this.validateSource(preferences);
    if (
      !this.enabled(preferences) ||
      preferences.cookiesFile ||
      (!refresh && (await this.fileForPlatform(preferences)))
    )
      return;
    if (refresh) this.failures.clear();

    await this.run(
      preferences,
      async (args) => {
        if (args[0] !== '--cookies-from-browser') return;

        try {
          // yt-dlp 在检查 URL 之前导出 Cookie；无 URL 会以 2 退出，但不会请求任何网站。
          await runProcess(binary, ['--ignore-config', ...args], { signal, timeoutMs: 45_000 });
        } catch (error) {
          if (!String(error).includes('You must provide at least one URL.')) throw error;
        }

        const content = await readFile(args[3]!, 'utf8');
        if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/m.test(content))
          throw new BusinessError('COOKIE_SNAPSHOT_INVALID');
      },
      signal,
      !refresh,
    );
  }

  async run<T>(
    preferences: Preferences,
    runner: (args: string[]) => Promise<T>,
    signal?: AbortSignal,
    preferSnapshot = false,
  ): Promise<T> {
    preferences = effectiveLoginPreferences(preferences);
    signal?.throwIfAborted();
    await this.validateSource(preferences);
    if (!this.enabled(preferences)) return runner([]);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const sources: CookieSource[] = [];
    const status = await this.status(preferences);
    const fresh = status.snapshotAgeMs !== null && status.snapshotAgeMs < 30 * 60_000;
    const addSnapshot = () =>
      sources.push({ kind: 'file', value: this.snapshot(preferences), label: 'snapshot' });
    if (preferences.cookiesFile)
      sources.push({ kind: 'file', value: preferences.cookiesFile, label: 'manual' });
    else {
      if (preferSnapshot && fresh) addSnapshot();
      const browsers =
        preferences.cookieStrategy === 'auto'
          ? status.availableBrowsers
          : [preferences.cookieBrowser];
      browsers
        .filter(
          (name) =>
            name &&
            Date.now() - (this.failures.get(browserCookieSource(preferences, name)) ?? 0) >
              10 * 60_000,
        )
        .sort(
          (left, right) =>
            Number(right === status.lastGoodBrowser) - Number(left === status.lastGoodBrowser),
        )
        .forEach((name) =>
          sources.push({
            kind: 'browser',
            value: browserCookieSource(preferences, name),
            label: name,
          }),
        );
      if (status.hasSnapshot && !(preferSnapshot && fresh)) addSnapshot();
    }
    sources.push({ kind: 'none', value: '', label: 'none' });
    let failure: unknown;
    for (const source of sources) {
      signal?.throwIfAborted();
      const temporary = join(this.directory, `temporary-${randomUUID()}.txt`);
      let args: string[];
      try {
        if (source.kind === 'file') {
          await copyFile(source.value, temporary);
          await chmod(temporary, 0o600);
          args = ['--cookies', temporary];
        } else
          args =
            source.kind === 'browser'
              ? ['--cookies-from-browser', source.value, '--cookies', temporary]
              : [];
      } catch (error) {
        failure = error;
        await rm(temporary, { force: true });
        continue;
      }
      try {
        const result = await runner(args);
        if (source.kind === 'browser') {
          this.failures.delete(source.value);
          const generated = await stat(temporary).catch(() => undefined);
          if (generated?.size) {
            const destination = this.snapshot(preferences);
            const staging = `${destination}.${randomUUID()}.tmp`;
            await copyFile(temporary, staging);
            await chmod(staging, 0o600);
            await rename(staging, destination);
            await writeFile(`${destination}.json`, JSON.stringify({ browser: source.value }), {
              mode: 0o600,
            });
          }
        }
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        if (!isCookieReadError(error)) throw error;
        failure = error;
        if (source.kind === 'browser') this.failures.set(source.value, Date.now());
      } finally {
        await rm(temporary, { force: true });
      }
    }
    throw failure ?? new BusinessError('COOKIE_SOURCE_UNAVAILABLE');
  }
}
