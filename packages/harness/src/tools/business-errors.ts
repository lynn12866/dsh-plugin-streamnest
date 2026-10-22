import { ToolArgsError, type ToolDefinition } from '@deepseek-ai/dsh-tools';

import { businessErrorResponse } from '../../../../apps/api/src/common/business-error.js';
import { businessMessage, readBusinessMessage } from '../../../../apps/shared/src/messages.js';

/** Keep official failure/cancellation semantics and project business data to model content. */
export function withBusinessErrors(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    async execute(args, exec) {
      try {
        return await tool.execute(args, exec);
      } catch (error) {
        if (exec.signal.aborted) throw error;

        const value =
          error instanceof ToolArgsError
            ? businessMessage('VALIDATION_FAILED', {
                fields: [
                  ...new Set(
                    error.violations.map(
                      (violation) => /"([^"]+)"/.exec(violation)?.[1] ?? 'input',
                    ),
                  ),
                ]
                  .sort()
                  .join(', '),
              })
            : businessErrorResponse(error);
        // The SDK preserves Error.message in its failure envelope. JSON carries the full contract.
        throw new Error(JSON.stringify(value));
      }
    },
    finalizeContent(exec, result) {
      if (!result.isError) return tool.finalizeContent?.(exec, result);

      let value;
      try {
        value = readBusinessMessage(JSON.parse(result.error.message));
      } catch {
        // SDK timeout/policy failures have no application payload.
      }
      return [
        {
          type: 'text',
          text: JSON.stringify(value ?? businessErrorResponse(new Error(result.error.message))),
        },
      ];
    },
  };
}
