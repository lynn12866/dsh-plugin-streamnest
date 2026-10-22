import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-client-connection';
import Schema from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { API_PREFIX } from '../../../apps/shared/src/contracts.js';
import { createApplication } from '../../../apps/api/src/create-application.js';
import { MediaService } from '../../../apps/api/src/media/media.service.js';
import { RuntimeService } from '../../../apps/api/src/runtime/runtime.service.js';
import { registerAgentTools } from './tools/register.js';
import { SystemService } from '../../../apps/api/src/system/system.service.js';
import { NativeService } from '../../../apps/api/src/system/native.service.js';
import { JournalService } from '../../../apps/api/src/system/journal.service.js';
import { BRAND } from '../../../apps/shared/src/brand.js';

export const name = BRAND.id;
export const inject = ['webServer', 'connection', 'tools', 'sandboxPolicy'];
export interface Config {
  dataDirectory?: string;
}
export const Config = Schema.object({
  dataDirectory: Schema.string().description('拾流本地数据目录，默认 DSH_HOME/streamnest。'),
});

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const directory = resolve(
    config.dataDirectory ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), BRAND.id),
  );
  const { app, http } = await createApplication(directory);

  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (request, response) => {
        const admission = ctx.connection.admit(request);
        if ('rejection' in admission) {
          response.writeHead(admission.rejection);
          response.end();
          return;
        }
        http(request, response);
      },
    });
    return async () => {
      unregister();
      await app.close();
    };
  });
  ctx.effect(() =>
    registerAgentTools(ctx, app.get(MediaService), app.get(RuntimeService), {
      system: app.get(SystemService),
      native: app.get(NativeService),
      journal: app.get(JournalService),
    }),
  );
}
