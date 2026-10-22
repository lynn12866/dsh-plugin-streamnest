import type { BrowserProfile } from './system.js';

export function browserSupportsProfiles(browser: string): boolean {
  return ['chrome', 'edge', 'firefox', 'brave', 'chromium'].includes(browser);
}

/** 仅保留账号标签；Local State 的加密密钥及其他字段不传输、不缓存。 */
export function chromiumProfiles(content: string): BrowserProfile[] {
  const value = JSON.parse(content) as {
    profile?: {
      info_cache?: Record<string, { name?: string; user_name?: string; gaia_name?: string }>;
    };
  };
  return Object.entries(value.profile?.info_cache ?? {})
    .filter(([id]) => /^(?:Default|Profile \d+)$/.test(id))
    .map(([id, info]) => {
      const name = (info.name?.trim() || info.gaia_name?.trim() || id).slice(0, 100);
      const account = (info.user_name?.trim() || '').slice(0, 300);
      return { id, name, account, label: account ? `${name} · ${account}` : `${name} · ${id}` };
    });
}
