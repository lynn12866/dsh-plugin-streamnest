import type { TaskState } from './contracts.js';
import {
  businessMessage,
  readBusinessMessage,
  type BusinessCode,
  type BusinessMessage,
} from './messages.js';

const STATE_CODES: Record<TaskState, BusinessCode> = {
  queued: 'TASK_QUEUED',
  downloading: 'TASK_DOWNLOADING',
  processing: 'TASK_PROCESSING',
  paused: 'TASK_PAUSED',
  completed: 'TASK_COMPLETED',
  failed: 'TASK_FAILED_UNKNOWN',
  cancelled: 'TASK_CANCELLED',
};

export function taskMessage(state: TaskState): BusinessMessage {
  return businessMessage(STATE_CODES[state]);
}

/** Version 1 records may predate codes; preserve their message without interpreting it. */
export function storedTaskMessage(task: { state: TaskState; message: string }): BusinessMessage {
  return (
    readBusinessMessage(task) ??
    (task.message
      ? businessMessage('LEGACY_MESSAGE', { reason: task.message }, task.message)
      : taskMessage(task.state))
  );
}
