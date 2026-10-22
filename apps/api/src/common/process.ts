import { BusinessError } from '../../../shared/src/messages.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

/** Kill the full process group, including FFmpeg, and settle only after close. */
function terminate(child: ChildProcess): void {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

export function runProcess(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number; line?: (line: string) => void } = {},
): Promise<ProcessResult> {
  options.signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const decoder = new StringDecoder('utf8');

    const stop = () => {
      terminate(child);
      killTimer ??= setTimeout(() => {
        if (!child.pid || process.platform === 'win32') return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already closed. */
        }
      }, 3_000);
      killTimer.unref();
    };
    const timer =
      options.timeoutMs === 0
        ? undefined
        : setTimeout(() => {
            failure = new BusinessError('PROCESS_TIMEOUT');
            stop();
          }, options.timeoutMs ?? 3_600_000);
    timer?.unref();
    options.signal?.addEventListener('abort', stop, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += decoder.write(chunk);
      if (stdout.length > 8 * 1024 * 1024) {
        if (options.line) stdout = stdout.slice(-512_000);
        else {
          failure = new BusinessError('PROCESS_OUTPUT_LIMIT');
          stop();
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-16_000);
    });
    const readers = options.line
      ? [child.stdout, child.stderr].map((stream) => {
          const reader = createInterface({ input: stream });
          reader.on('line', options.line!);
          return reader;
        })
      : [];

    child.on('error', (error) => {
      failure = error;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', stop);
      readers.forEach((reader) => reader.close());

      if (options.signal?.aborted) return reject(options.signal.reason);
      if (failure) return reject(failure);
      if (code !== 0)
        return reject(
          new BusinessError('PROCESS_FAILED', {
            reason: stderr.trim().slice(-2_000) || String(code),
            exitCode: code ?? -1,
          }),
        );

      resolve({ stdout: stdout + decoder.end(), stderr });
    });
  });
}
