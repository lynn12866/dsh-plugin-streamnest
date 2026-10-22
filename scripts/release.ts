import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const root = fileURLToPath(new URL('../', import.meta.url));

type NpmCommand = (args: readonly string[]) => void;

function executeNpm(args: readonly string[]): void {
  // Windows npm is a .cmd entry; only the fixed arguments below reach cmd.exe.
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : [...args];
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed (${result.status ?? result.signal}).`);
  }
}

export function release(args: readonly string[], run: NpmCommand = executeNpm): void {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
    throw new Error('Usage: pnpm release [--dry-run]');
  }

  if (args[0] === '--dry-run') {
    // prepack checks and builds the package; this path never authenticates or uploads.
    run(['pack', '--dry-run', '--ignore-scripts=false']);
    return;
  }

  run(['login', '--auth-type=web', `--registry=${registry}`]);
  run(['whoami', `--registry=${registry}`]);
  // Publishing the directory runs prepack; a failed check stops npm before upload.
  run(['publish', `--registry=${registry}`, '--access=public', '--ignore-scripts=false']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log(
      'pnpm release            Log in to npm, verify/build and publish the current version.',
    );
    console.log(
      'pnpm release --dry-run  Verify/build and preview package files without logging in.',
    );
  } else {
    try {
      release(process.argv.slice(2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
