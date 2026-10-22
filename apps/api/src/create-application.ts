import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { API_PREFIX } from '../../shared/src/contracts.js';
import { AppModule } from './app.module.js';
import { MediaService } from './media/media.service.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { invalidDto } from './common/validation.js';
import { businessMessage } from '../../shared/src/messages.js';

export function localRequestPolicy(request: Request, response: Response, next: NextFunction) {
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
  let target: URL;
  try {
    target = new URL(`http://${request.headers.host ?? ''}`);
  } catch {
    response.status(403).json(businessMessage('REQUEST_FORBIDDEN'));
    return;
  }
  if (
    !allowed.has(target.hostname) ||
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') ||
    (request.headers.origin !== undefined && request.headers.origin !== target.origin) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  ) {
    response.status(403).json(businessMessage('REQUEST_FORBIDDEN'));
    return;
  }
  next();
}

export async function createApplication(
  directory: string,
  standalone = false,
): Promise<{ app: INestApplication; http: Express }> {
  const http = express();
  http.disable('x-powered-by');
  if (standalone) http.use(API_PREFIX, localRequestPolicy);
  http.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  const app = await NestFactory.create(AppModule.register(directory), new ExpressAdapter(http), {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  app.use(express.json({ limit: '64kb' }));
  app.setGlobalPrefix(API_PREFIX.slice(1));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      exceptionFactory: invalidDto,
    }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
  await app.init();
  try {
    await app.get(MediaService).initialize();
  } catch (error) {
    await app.close();
    throw error;
  }
  return { app, http };
}
