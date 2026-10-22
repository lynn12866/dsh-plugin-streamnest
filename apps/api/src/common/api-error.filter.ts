import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { businessErrorResponse } from './business-error.js';

/** Preserve actionable dependency/extractor messages without exposing a stack. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(error instanceof HttpException ? error.getStatus() : 503)
      .json(businessErrorResponse(error));
  }
}
