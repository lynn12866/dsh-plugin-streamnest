import { BusinessError } from '../../../../apps/shared/src/messages.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import type {} from '@deepseek-ai/dsh-user-approval';

export async function authorize(
  ctx: Context,
  exec: ToolRunContext,
  reason: string,
  requireApproval = false,
): Promise<void> {
  exec.signal.throwIfAborted();
  if (!exec.agent) throw new BusinessError('AGENT_SESSION_REQUIRED');
  const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
  if (!requireApproval && policy.mode === 'danger-full-access') return;
  const approval = ctx.get('approval');
  if (!approval) throw new BusinessError('APPROVAL_UNAVAILABLE');
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    signal: exec.signal,
    reason,
    displayReason: { en: reason, zh: reason },
  });
  exec.signal.throwIfAborted();
  if (outcome !== 'allowed-once') throw new BusinessError('APPROVAL_DENIED', { outcome });
}
