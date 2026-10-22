import { BadRequestException, Injectable } from '@nestjs/common';
import type { Preferences } from '../../../../shared/src/contracts.js';
import { RuntimeService } from '../../runtime/runtime.service.js';
import { CookieService } from '../parsing/cookie.service.js';
import { fetchWechatInfo } from './api.js';
import { effectiveLoginPreferences } from '../../../../shared/src/cookies.js';
import { readBusinessMessage } from '../../../../shared/src/messages.js';

@Injectable()
export class WechatService {
  constructor(
    private readonly runtime: RuntimeService,
    private readonly cookies: CookieService,
  ) {}

  async parse(url: string, preferences: Preferences, signal: AbortSignal) {
    preferences = effectiveLoginPreferences(preferences);
    const input = new URL(url);
    const request = (cookie: string) =>
      fetchWechatInfo(url, cookie, { signal, proxy: preferences.proxy });
    // Feed links carrying their own playback parameters do not need Yuanbao credentials.
    if (input.searchParams.get('eid') && input.searchParams.get('token')) return request('');
    const binary = await this.runtime.require('yt-dlp', preferences, signal);
    const readCookie = async (refresh: boolean) => {
      await this.cookies.prepare(preferences, binary, signal, refresh);
      const selected = await this.cookies.cookies(preferences, 'yuanbao.tencent.com');
      return selected
        .filter((entry) => !/[\r\n;]/.test(entry.name + entry.value))
        .map((entry) => `${entry.name}=${entry.value}`)
        .join('; ');
    };
    try {
      return await request(await readCookie(false));
    } catch (error) {
      signal.throwIfAborted();
      const code =
        error instanceof BadRequestException
          ? readBusinessMessage(error.getResponse())?.code
          : undefined;
      if (
        preferences.cookiesFile ||
        !['PARSE_AUTHENTICATION', 'WECHAT_LOGIN_REQUIRED'].includes(code ?? '')
      )
        throw error;
      // A fresh sign-in must not be hidden behind the 30-minute browser snapshot cache.
      return request(await readCookie(true));
    }
  }
}
