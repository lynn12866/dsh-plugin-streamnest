import type { Preferences } from './contracts.js';
import { browserSupportsProfiles } from './browser-profiles.js';

export function browserAccountError(preferences: Preferences): string | undefined {
  if (
    preferences.cookieStrategy !== 'auto' &&
    !preferences.cookiesFile &&
    browserSupportsProfiles(preferences.cookieBrowser) &&
    !preferences.cookieProfile?.trim()
  )
    return '请选择要使用的浏览器账号，或提供 Cookie 文件；不会自动使用默认账号。';
}

/** 自动模式保留手动表单草稿，但实际请求不使用隐藏的手动来源。 */
export function effectiveLoginPreferences(preferences: Preferences): Preferences {
  if (preferences.cookieStrategy === 'auto')
    return { ...preferences, cookieBrowser: '', cookieProfile: '', cookiesFile: '' };

  return browserSupportsProfiles(preferences.cookieBrowser)
    ? preferences
    : { ...preferences, cookieProfile: '' };
}

export function browserCookieSource(
  preferences: Preferences,
  browser: string = preferences.cookieBrowser,
): string {
  const profile =
    preferences.cookieStrategy !== 'auto' && browserSupportsProfiles(browser)
      ? preferences.cookieProfile?.trim()
      : '';

  return profile && browser ? `${browser}:${profile}` : browser;
}
