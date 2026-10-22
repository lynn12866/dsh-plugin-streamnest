import { BusinessError } from '../../../../shared/src/messages.js';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser, type BrowserContext } from 'puppeteer-core';

import { getChromiumPath } from './browser-paths.js';

interface BrowserEntry {
  browser: Promise<Browser>;
  active: number;
  timer?: ReturnType<typeof setTimeout>;
}

@Injectable()
export class BrowserPool implements OnModuleDestroy {
  private readonly entries = new Map<string, BrowserEntry>();

  async run<T>(
    proxy: string,
    signal: AbortSignal,
    operation: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    let entry = this.entries.get(proxy);
    if (!entry) {
      const executablePath = getChromiumPath();
      if (!executablePath) throw new BusinessError('BROWSER_NOT_FOUND');
      entry = {
        active: 0,
        browser: puppeteer.launch({
          headless: true,
          executablePath,
          args: proxy ? [`--proxy-server=${proxy}`] : [],
        }),
      };
      this.entries.set(proxy, entry);
      const started = entry;
      void entry.browser
        .then((browser) => {
          browser.once('disconnected', () => {
            clearTimeout(started.timer);
            if (this.entries.get(proxy) === started) this.entries.delete(proxy);
          });
        })
        .catch(() => {
          if (this.entries.get(proxy) === started) this.entries.delete(proxy);
        });
    }
    clearTimeout(entry.timer);
    entry.active++;
    let context: BrowserContext | undefined;
    const abort = () => {
      void context?.close().catch(() => undefined);
    };
    try {
      const browser = await entry.browser;
      signal.throwIfAborted();
      context = await browser.createBrowserContext();
      signal.addEventListener('abort', abort, { once: true });
      signal.throwIfAborted();
      return await operation(context);
    } finally {
      signal.removeEventListener('abort', abort);
      await context?.close().catch(() => undefined);
      entry.active--;
      if (!entry.active) {
        const idle = entry;
        idle.timer = setTimeout(() => {
          if (idle.active || this.entries.get(proxy) !== idle) return;
          this.entries.delete(proxy);
          void idle.browser.then((browser) => browser.close()).catch(() => undefined);
        }, 30_000);
        idle.timer.unref();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    entries.forEach((entry) => clearTimeout(entry.timer));
    await Promise.all(
      entries.map((entry) =>
        entry.browser.then((browser) => browser.close()).catch(() => undefined),
      ),
    );
  }
}
