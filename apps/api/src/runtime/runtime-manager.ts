import { BusinessError } from '../../../shared/src/messages.js';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';

import type {
  Preferences,
  RuntimeInstall,
  RuntimeKind,
  RuntimeStatus,
} from '../../../shared/src/contracts.js';
import { DATA_DIRECTORY } from '../storage/vault.store.js';
import { discoverRuntime } from './runtime-discovery.js';
import { installRuntimeAsset } from './runtime-installer.js';
import { binaryName, RUNTIME_KINDS, runtimeAsset } from './runtime-manifest.js';
import { businessMessage, errorMessage } from '../../../shared/src/messages.js';

interface Detection {
  controller: AbortController;
  promise: Promise<RuntimeStatus>;
  readers: number;
  settled: boolean;
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

@Injectable()
export class RuntimeService implements OnModuleDestroy {
  private cache?: { key: string; time: number; status: RuntimeStatus };
  private readonly detections = new Map<string, Detection>();
  private readonly lifecycle = new AbortController();
  private installer?: AbortController;
  private installation?: Promise<void>;
  private installState: RuntimeInstall = {
    state: 'idle',
    ...businessMessage('NONE'),
    downloaded: 0,
    total: 0,
  };

  constructor(@Inject(DATA_DIRECTORY) private readonly dataDirectory: string) {}

  async status(
    preferences: Preferences,
    signal?: AbortSignal,
    force = false,
  ): Promise<RuntimeStatus> {
    signal?.throwIfAborted();
    const key = JSON.stringify(preferences.binaryPaths);
    if (!force && this.cache?.key === key && Date.now() - this.cache.time < 60_000)
      return structuredClone(this.cache.status);

    let operation = this.detections.get(key);
    if (!operation) {
      const controller = new AbortController();
      const current: Detection = {
        controller,
        readers: 0,
        settled: false,
        promise: Promise.resolve({} as RuntimeStatus),
      };
      current.promise = discoverRuntime(
        this.dataDirectory,
        preferences,
        AbortSignal.any([controller.signal, this.lifecycle.signal, AbortSignal.timeout(80_000)]),
      )
        .then((status) => {
          this.cache = { key, time: Date.now(), status };
          return status;
        })
        .finally(() => {
          current.settled = true;
          if (this.detections.get(key) === current) this.detections.delete(key);
        });
      this.detections.set(key, current);
      operation = current;
    }
    operation.readers++;
    try {
      return structuredClone(await waitFor(operation.promise, signal));
    } finally {
      operation.readers--;
      if (!operation.readers && !operation.settled)
        operation.controller.abort(new BusinessError('RUNTIME_DETECTION_CANCELLED'));
    }
  }

  async require(
    kind: RuntimeKind,
    preferences: Preferences,
    signal?: AbortSignal,
  ): Promise<string> {
    let status = await this.status(preferences, signal);
    let result = status.results.find((entry) => entry.kind === kind);
    if (!result?.found && result?.reasonInfo?.code === 'RUNTIME_DETECTION_TIMEOUT') {
      status = await this.status(preferences, signal, true);
      result = status.results.find((entry) => entry.kind === kind);
    }
    if (!result?.found || !result.path)
      throw new BusinessError('RUNTIME_UNAVAILABLE', { kind, reason: result?.reason ?? '' });
    return result.path;
  }

  progress(): RuntimeInstall {
    return structuredClone(this.installState);
  }

  install(kinds: RuntimeKind[], preferences: Preferences, force = false): RuntimeInstall {
    if (this.installer) throw new BusinessError('RUNTIME_INSTALL_BUSY');
    if (!kinds.length || kinds.some((kind) => !RUNTIME_KINDS.includes(kind)))
      throw new BusinessError('RUNTIME_KIND_INVALID');
    kinds.forEach((kind) => runtimeAsset(kind));
    const controller = new AbortController();
    this.installer = controller;
    this.installState = {
      state: 'installing',
      ...businessMessage('RUNTIME_INSTALL_PREPARING'),
      downloaded: 0,
      total: 0,
    };
    this.installation = (async () => {
      const signal = AbortSignal.any([
        controller.signal,
        this.lifecycle.signal,
        AbortSignal.timeout(1_800_000),
      ]);
      const existing = force ? undefined : await this.status(preferences, signal);
      for (const kind of [...new Set(kinds)]) {
        signal.throwIfAborted();
        if (!force && existing?.results.some((item) => item.kind === kind && item.found)) continue;
        this.installState = {
          state: 'installing',
          ...businessMessage('RUNTIME_INSTALL_DOWNLOADING', { kind }),
          downloaded: 0,
          total: 0,
        };
        await installRuntimeAsset({
          kind,
          target: join(this.dataDirectory, 'runtime/bin', binaryName(kind)),
          asset: runtimeAsset(kind),
          proxy: preferences.proxy,
          signal,
          progress: (downloaded, total) => {
            this.installState.downloaded = downloaded;
            this.installState.total = total;
          },
        });
      }
      this.cache = undefined;
      this.installState.state = 'completed';
      Object.assign(this.installState, businessMessage('RUNTIME_INSTALL_COMPLETED'));
    })()
      .catch((error: unknown) => {
        this.installState.state = controller.signal.aborted ? 'cancelled' : 'failed';
        Object.assign(
          this.installState,
          controller.signal.aborted
            ? businessMessage('RUNTIME_INSTALL_CANCELLED')
            : errorMessage(error, 'RUNTIME_INSTALL_FAILED'),
        );
      })
      .finally(() => {
        this.installer = undefined;
      });
    return this.progress();
  }

  async cancelInstall(): Promise<RuntimeInstall> {
    this.installer?.abort(new BusinessError('RUNTIME_INSTALL_CANCELLED'));
    await this.installation;
    return this.progress();
  }

  async onModuleDestroy(): Promise<void> {
    this.lifecycle.abort(new BusinessError('PLUGIN_STOPPED'));
    await this.cancelInstall();
    await Promise.allSettled([...this.detections.values()].map((item) => item.promise));
    await this.installation;
  }
}
