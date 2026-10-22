import type { BusinessMessage } from './messages.js';
import type { RuntimeStatus } from './contracts.js';

export const NATIVE_KINDS = [
  'pick-folder',
  'pick-file',
  'clipboard-read',
  'clipboard-write',
] as const;
export type NativeKind = (typeof NATIVE_KINDS)[number];

export interface BrowserProfile {
  id: string;
  name: string;
  account: string;
  label: string;
}
export interface BrowserProfileList extends BusinessMessage {
  profiles: BrowserProfile[];
  permissionRequired?: boolean;
  metadataPath?: string;
}

export interface NativeInteraction extends BusinessMessage {
  id: string;
  kind: NativeKind;
  purpose: string;
  text: string;
  status: 'pending' | 'completed' | 'cancelled' | 'expired';
  value: string;
  createdAt: string;
}

export interface SystemDiagnostics {
  version: string;
  platform: string;
  runtime: RuntimeStatus;
  acceleration: { found: boolean; path: string | null; version: string; reason: string };
  jsRuntime: {
    available: boolean;
    path: string | null;
    kind: 'node' | 'deno' | null;
    name: string;
    version?: string;
  };
  cookies: {
    enabled: boolean;
    strategy: string;
    manual: boolean;
    availableBrowsers: string[];
    hasSnapshot: boolean;
    snapshotAgeMs: number | null;
    lastGoodBrowser: string;
  };
  disk: {
    directory: string;
    resolvedDirectory: string;
    free: number;
    total: number;
    checkedAt: string;
  };
  browser: { path: string | null; installed: string[] };
}
