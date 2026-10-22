import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import { NATIVE_KINDS } from '../../../../apps/shared/src/system.js';
import { RUNTIME_STATUS_SCHEMA, MESSAGE_PROPERTIES } from './schemas.js';

const string = { type: 'string', required: true } as const;
const number = { type: 'number', required: true } as const;
const boolean = { type: 'boolean', required: true } as const;
const strings = { type: 'array', required: true, items: { type: 'string' } } as const;
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }], required: true } as const;
export const NATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    kind: { type: 'string', enum: NATIVE_KINDS, required: true },
    purpose: string,
    text: string,
    status: {
      type: 'string',
      enum: ['pending', 'completed', 'cancelled', 'expired'],
      required: true,
    },
    value: string,
    createdAt: string,
    ...MESSAGE_PROPERTIES,
  },
} as const satisfies ValueSchemaSpec;
export const DISK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    directory: string,
    resolvedDirectory: string,
    free: number,
    total: number,
    checkedAt: string,
  },
} as const satisfies ValueSchemaSpec;
export const DIAGNOSTICS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: string,
    platform: string,
    runtime: { ...RUNTIME_STATUS_SCHEMA, required: true },
    acceleration: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { found: boolean, path: nullableString, version: string, reason: string },
    },
    jsRuntime: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        available: boolean,
        path: nullableString,
        kind: {
          oneOf: [{ type: 'string', enum: ['node', 'deno'] }, { type: 'null' }],
          required: true,
        },
        name: string,
        version: { type: 'string' },
      },
    },
    cookies: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        enabled: boolean,
        strategy: string,
        manual: boolean,
        availableBrowsers: strings,
        hasSnapshot: boolean,
        snapshotAgeMs: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
        lastGoodBrowser: string,
      },
    },
    disk: { ...DISK_SCHEMA, required: true },
    browser: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { path: nullableString, installed: strings },
    },
  },
} as const satisfies ValueSchemaSpec;
