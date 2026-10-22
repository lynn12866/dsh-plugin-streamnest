import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';

import { App } from '../../../apps/web/src/app';
import { StreamMark } from '../../../apps/web/src/components/stream-mark';
import { BRAND } from '../../../apps/shared/src/brand';

export const name = `${BRAND.id}-client`;
export const inject = ['slots'];

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: BRAND.id }, App));
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: BRAND.id, order: 50, label: BRAND.name },
      () => <StreamMark size={18} />,
    ),
  );
}
