import { HttpException } from '@nestjs/common';

import {
  businessMessage,
  errorMessage,
  readBusinessMessage,
  type BusinessCode,
  type BusinessMessage,
} from '../../../shared/src/messages.js';

/** The HTTP and Agent boundaries serialize the same service errors. */
export function businessErrorResponse(error: unknown, fallback?: BusinessCode): BusinessMessage {
  if (!(error instanceof HttpException)) return errorMessage(error, fallback);

  const response = error.getResponse();
  const known = readBusinessMessage(response);
  if (known) return known;

  const status = error.getStatus();
  const code =
    status === 400 ? 'VALIDATION_FAILED' : status === 404 ? 'ROUTE_NOT_FOUND' : 'REQUEST_FAILED';
  const value =
    typeof response === 'string' ? response : (response as { message?: unknown }).message;
  const detail = Array.isArray(value)
    ? value.join('; ')
    : typeof value === 'string'
      ? value
      : error.message;
  return businessMessage(code, { fields: detail }, detail);
}
