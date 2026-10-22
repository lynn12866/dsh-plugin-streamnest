import { Module, type DynamicModule } from '@nestjs/common';

import { WechatService } from './media/wechat/wechat.service.js';
import { MediaController } from './media/media.controller.js';
import { MediaEngine } from './media/media.engine.js';
import { MediaService } from './media/media.service.js';
import { RuntimeService } from './runtime/runtime.service.js';
import { DATA_DIRECTORY, VaultStore } from './storage/vault.store.js';
import { ParseCache } from './media/parsing/cache.service.js';
import { CookieService } from './media/parsing/cookie.service.js';
import { PlatformParser } from './media/parsing/platform-parser.service.js';
import { BrowserPool } from './media/parsing/browser-pool.service.js';
import { NativeService } from './system/native.service.js';
import { SystemService } from './system/system.service.js';
import { JournalService } from './system/journal.service.js';
import { SystemController } from './system/system.controller.js';
import { ThumbnailService } from './media/thumbnail.service.js';

@Module({})
export class AppModule {
  static register(directory: string): DynamicModule {
    return {
      module: AppModule,
      controllers: [MediaController, SystemController],
      providers: [
        { provide: DATA_DIRECTORY, useValue: directory },
        VaultStore,
        RuntimeService,
        ParseCache,
        CookieService,
        BrowserPool,
        PlatformParser,
        WechatService,
        JournalService,
        NativeService,
        SystemService,
        MediaEngine,
        ThumbnailService,
        MediaService,
      ],
    };
  }
}
