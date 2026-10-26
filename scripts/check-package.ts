import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

interface HarnessManifest {
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const isHarnessSdk = (name: string): boolean => name.startsWith('@deepseek-ai/dsh-');

export function validateHarnessDependencies(
  manifest: HarnessManifest,
  installedVersions: Readonly<Record<string, string>>,
): void {
  const development = Object.entries(manifest.devDependencies ?? {}).filter(([name]) =>
    isHarnessSdk(name),
  );
  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) =>
    isHarnessSdk(name),
  );
  const releases = new Set(development.map(([name]) => installedVersions[name]));

  assert(development.length > 0, 'Missing Harness development SDKs.');

  for (const [name, version] of [...development, ...peers]) {
    const installed = installedVersions[name];

    assert(installed, `Missing installed Harness SDK: ${name}`);
    assert.equal(
      version,
      installed,
      `Harness SDK ${name} declares ${version}, but the build uses ${installed}.`,
    );
  }

  assert.equal(releases.size, 1, 'Harness development SDKs must use one host release.');
}

const requiredFiles = [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/packages/harness/src/index.js',
  'lib/apps/api/src/runtime/assets.json',
  'lib/THIRD_PARTY_LICENSES.txt',
  'packages/harness/cordis.patch.yml',
  'packages/harness/locale/en.json',
  'packages/harness/locale/zh.json',
  'assets/logo.svg',
  'assets/reference-projects.json',
  'assets/screenshots/deepseek-harness-installed.png',
  'licenses/downvid.LICENSE',
  'licenses/wx_channels_download.LICENSE',
  'README.md',
  'README.en.md',
  'LICENSE',
];

export function validatePackageFiles(paths: readonly string[]): void {
  const files = new Set(paths);

  for (const path of requiredFiles) {
    assert(files.has(path), `Missing package file: ${path}`);
  }

  for (const path of files) {
    const compiled = path.startsWith('lib/') && path.endsWith('.js');
    const developmentFile =
      path.split('/').some((part) => ['test', 'tests', 'scripts', 'node_modules'].includes(part)) ||
      /\.(?:spec|test)\.js$/.test(path);

    assert(
      (compiled || requiredFiles.includes(path)) && !developmentFile,
      `Unexpected package file: ${path}`,
    );
  }
}

function checkPackage(): void {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ) as HarnessManifest;
  const sdkNames = new Set(
    [
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].filter(isHarnessSdk),
  );
  const installedVersions = Object.fromEntries(
    [...sdkNames].map((name) => {
      const installed = JSON.parse(
        readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'),
      ) as { version: string };

      return [name, installed.version];
    }),
  );

  validateHarnessDependencies(manifest, installedVersions);

  // Ignore lifecycle scripts here so build -> package inspection cannot recurse into verify.
  const args = [
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts=true',
    '--cache=.cache/npm-package-check',
  ];
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args;
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8' });

  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || `npm pack failed (${result.signal}).`);

  const reports = JSON.parse(result.stdout) as { files: { path: string }[] }[];
  const files = reports[0]?.files;

  assert.equal(reports.length, 1, 'Expected one npm package.');
  assert(Array.isArray(files), 'npm pack did not return package files.');
  validatePackageFiles(files.map((file) => file.path));
  console.log(
    `npm package verified: ${files.length} files; compiled runtime and required assets only.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkPackage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
