import { businessMessage } from '../../../shared/src/messages.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { stat } from 'node:fs/promises';

import type { NativeInteraction, NativeKind } from '../../../shared/src/system.js';
import { extractMediaLink } from '../../../shared/src/links.js';
import { validateUuid } from '../common/validation.js';

@Injectable()
export class NativeService {
  private readonly requests = new Map<string, NativeInteraction>();

  create(kind: NativeKind, purpose: string, text = ''): NativeInteraction {
    this.expire();
    if ([...this.requests.values()].filter((value) => value.status === 'pending').length >= 8)
      throw new BadRequestException(businessMessage('NATIVE_PENDING_LIMIT'));
    if (!['pick-folder', 'pick-file', 'clipboard-read', 'clipboard-write'].includes(kind))
      throw new BadRequestException(businessMessage('NATIVE_KIND_INVALID'));
    if (text.length > 4096 || purpose.length > 300)
      throw new BadRequestException(businessMessage('NATIVE_DESCRIPTION_TOO_LONG'));
    const request: NativeInteraction = {
      id: randomUUID(),
      kind,
      purpose,
      text: kind === 'clipboard-write' ? text : '',
      status: 'pending',
      value: '',
      createdAt: new Date().toISOString(),
      ...businessMessage('NATIVE_CONFIRM'),
    };
    this.requests.set(request.id, request);
    return structuredClone(request);
  }

  private expire(): void {
    for (const request of this.requests.values()) {
      const age = Date.now() - new Date(request.createdAt).getTime();
      if (request.status === 'pending' && age > 10 * 60_000) {
        request.status = 'expired';
        Object.assign(request, businessMessage('NATIVE_EXPIRED'));
      }
      if (age > 60 * 60_000) this.requests.delete(request.id);
    }
  }

  pending(): NativeInteraction[] {
    this.expire();
    return [...this.requests.values()]
      .filter((request) => request.status === 'pending')
      .map((value) => structuredClone(value));
  }

  get(id: string): NativeInteraction {
    validateUuid(id, 'id');
    this.expire();
    const request = this.requests.get(id);
    if (!request) throw new NotFoundException(businessMessage('NATIVE_NOT_FOUND'));
    return structuredClone(request);
  }

  async complete(id: string, value: string, cancelled = false): Promise<NativeInteraction> {
    const request = this.get(id);
    if (request.status !== 'pending')
      throw new BadRequestException(businessMessage('NATIVE_ENDED'));
    if (cancelled) {
      request.status = 'cancelled';
      Object.assign(request, businessMessage('NATIVE_CANCELLED'));
    } else if (request.kind === 'pick-folder' || request.kind === 'pick-file') {
      if (!isAbsolute(value) || value.includes('\0'))
        throw new BadRequestException(businessMessage('LOCAL_PATH_REQUIRED'));
      const info = await stat(value);
      if (request.kind === 'pick-folder' ? !info.isDirectory() : !info.isFile())
        throw new BadRequestException(businessMessage('LOCAL_PATH_TYPE_INVALID'));
      request.value = resolve(value);
      request.status = 'completed';
    } else {
      if (request.kind === 'clipboard-read') {
        let url: URL;
        try {
          url = new URL(extractMediaLink(value));
        } catch {
          throw new BadRequestException(businessMessage('CLIPBOARD_URL_MISSING'));
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new BadRequestException(businessMessage('CLIPBOARD_URL_MISSING'));
        request.value = url.href;
      } else request.value = request.text;
      request.status = 'completed';
    }
    if (request.status === 'completed') Object.assign(request, businessMessage('NATIVE_COMPLETED'));
    this.requests.set(id, request);
    return structuredClone(request);
  }
}
