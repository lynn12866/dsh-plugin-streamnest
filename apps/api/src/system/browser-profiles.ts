import { BusinessError, businessMessage } from '../../../shared/src/messages.js';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Preferences } from '../../../shared/src/contracts.js';
import type { BrowserProfile, BrowserProfileList } from '../../../shared/src/system.js';

import { chromiumProfiles } from '../../../shared/src/browser-profiles.js';
export { chromiumProfiles } from '../../../shared/src/browser-profiles.js';

type Browser = Exclude<Preferences['cookieBrowser'], ''>;

function profileDirectory(browser: Browser): string | undefined {
  const home = homedir();
  const names: Partial<Record<Browser, string>> =
    process.platform === 'darwin'
      ? {
          chrome: 'Google/Chrome',
          edge: 'Microsoft Edge',
          brave: 'BraveSoftware/Brave-Browser',
          chromium: 'Chromium',
        }
      : process.platform === 'win32'
        ? {
            chrome: 'Google/Chrome/User Data',
            edge: 'Microsoft/Edge/User Data',
            brave: 'BraveSoftware/Brave-Browser/User Data',
            chromium: 'Chromium/User Data',
          }
        : {
            chrome: 'google-chrome',
            edge: 'microsoft-edge',
            brave: 'BraveSoftware/Brave-Browser',
            chromium: 'chromium',
          };
  if (!names[browser]) return;
  return join(
    process.platform === 'darwin'
      ? join(home, 'Library/Application Support')
      : process.platform === 'win32'
        ? process.env.LOCALAPPDATA || join(home, 'AppData/Local')
        : process.env.XDG_CONFIG_HOME || join(home, '.config'),
    names[browser]!,
  );
}

export function browserMetadataPath(browser: Browser): string | undefined {
  const directory = profileDirectory(browser);
  return directory ? join(directory, 'Local State') : undefined;
}

export async function saveBrowserProfiles(
  dataDirectory: string,
  browser: Browser,
  sourcePath: string,
  profiles: BrowserProfile[],
): Promise<BrowserProfileList> {
  const expected = browserMetadataPath(browser);
  if (!expected || resolve(sourcePath) !== resolve(expected))
    throw new BusinessError('BROWSER_METADATA_INVALID');
  if (
    !profiles.length ||
    profiles.length > 100 ||
    profiles.some((profile) => !/^(?:Default|Profile \d+)$/.test(profile.id))
  )
    throw new BusinessError('BROWSER_ACCOUNTS_MISSING');
  const clean = profiles.map(({ id, name, account }) => ({
    id,
    name,
    account,
    label: account ? `${name} · ${account}` : `${name} · ${id}`,
  }));
  const directory = join(dataDirectory, 'browser-accounts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${browser}.json`),
    JSON.stringify({ profiles: clean, readAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  return { profiles: clean, ...businessMessage('BROWSER_PROFILES_IMPORTED') };
}

export async function browserProfiles(
  browser: Browser,
  dataDirectory?: string,
): Promise<BrowserProfileList> {
  const directory = profileDirectory(browser);
  if (directory) {
    try {
      const profiles = chromiumProfiles(await readFile(join(directory, 'Local State'), 'utf8'));
      return { profiles, ...businessMessage(profiles.length ? 'NONE' : 'BROWSER_PROFILES_EMPTY') };
    } catch (error) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      const profiles = entries
        .filter((entry) => entry.isDirectory() && /^(?:Default|Profile \d+)$/.test(entry.name))
        .map((entry) => ({ id: entry.name, name: entry.name, account: '', label: entry.name }));
      const permission = ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '');
      let cached: BrowserProfile[] = [];
      if (dataDirectory)
        cached = await readFile(join(dataDirectory, 'browser-accounts', `${browser}.json`), 'utf8')
          .then((value) => (JSON.parse(value) as { profiles: BrowserProfile[] }).profiles)
          .catch(() => []);
      return {
        profiles: cached.length ? cached : profiles,
        ...businessMessage(
          cached.length
            ? 'BROWSER_PROFILES_CACHED'
            : permission
              ? 'BROWSER_PROFILES_PERMISSION'
              : profiles.length
                ? 'BROWSER_PROFILES_NAMES_UNAVAILABLE'
                : 'BROWSER_PROFILES_MISSING',
        ),
        ...(permission
          ? { permissionRequired: true, metadataPath: join(directory, 'Local State') }
          : {}),
      };
    }
  }
  if (browser === 'safari')
    return {
      profiles: [{ id: '', name: 'Safari', account: '', label: 'Safari · 默认配置' }],
      ...businessMessage('BROWSER_SAFARI_DEFAULT'),
    };
  if (browser === 'firefox') {
    const base =
      process.platform === 'darwin'
        ? join(homedir(), 'Library/Application Support/Firefox')
        : process.platform === 'win32'
          ? join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'), 'Mozilla/Firefox')
          : join(homedir(), '.mozilla/firefox');
    const content = await readFile(join(base, 'profiles.ini'), 'utf8').catch(() => '');
    const profiles = content.split(/\r?\n\[/).flatMap((block) => {
      const name = /^Name=(.+)$/m.exec(block)?.[1]?.trim();
      const path = /^Path=(.+)$/m.exec(block)?.[1]?.trim();
      if (!name || !path) return [];
      const id = path.split(/[\\/]/).at(-1)!;
      return /^[\w .-]{1,100}$/.test(id) ? [{ id, name, account: '', label: name }] : [];
    });
    return { profiles, ...businessMessage(profiles.length ? 'NONE' : 'BROWSER_FIREFOX_MISSING') };
  }
  return { profiles: [], ...businessMessage('BROWSER_PROFILES_UNSUPPORTED') };
}
