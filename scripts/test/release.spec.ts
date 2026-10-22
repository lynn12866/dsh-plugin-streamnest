import { describe, expect, it, vi } from 'vitest';

import { release } from '../release.js';

const registry = '--registry=https://registry.npmjs.org/';

describe('npm publication boundaries', () => {
  it.each(['Login cancelled', 'Authentication failed'])(
    'stops before identity verification or upload when login fails: %s',
    (message) => {
      const failure = new Error(message);
      const run = vi.fn(() => {
        throw failure;
      });

      expect(() => release([], run)).toThrow(failure);
      expect(run.mock.calls).toEqual([[['login', '--auth-type=web', registry]]]);
    },
  );

  it('does not publish when identity verification fails', () => {
    const failure = new Error('Identity verification failed');
    const run = vi.fn((args: readonly string[]) => {
      if (args[0] === 'whoami') throw failure;
    });

    expect(() => release([], run)).toThrow(failure);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(['login', 'whoami']);
  });

  it('previews the package with lifecycle checks and no authentication or upload', () => {
    const run = vi.fn();

    release(['--dry-run'], run);

    expect(run.mock.calls).toEqual([[['pack', '--dry-run', '--ignore-scripts=false']]]);
  });

  it('rejects unknown, repeated and shell injection arguments before invoking npm', () => {
    for (const args of [
      ['--registry=https://example.com/'],
      ['--dry-run', '--dry-run'],
      ['--dry-run', '--access=private'],
      ['--dry-run; npm publish'],
      ['--dry-run && npm publish'],
    ]) {
      const run = vi.fn();

      expect(() => release(args, run)).toThrow('Usage: pnpm release [--dry-run]');
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('uses verified public publication and propagates upload failures', () => {
    const failure = new Error('Publication rejected');
    const run = vi.fn((args: readonly string[]) => {
      if (args[0] === 'publish') throw failure;
    });

    expect(() => release([], run)).toThrow(failure);
    expect(run.mock.calls).toEqual([
      [['login', '--auth-type=web', registry]],
      [['whoami', registry]],
      [['publish', registry, '--access=public', '--ignore-scripts=false']],
    ]);
  });
});
