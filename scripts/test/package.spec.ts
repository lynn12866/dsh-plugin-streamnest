import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { validatePackageFiles } from '../check-package.js';

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

describe('published package contents', () => {
  it('rejects source files, maps and development files even inside the output directory', () => {
    for (const path of [
      'apps/api/src/main.ts',
      'apps/web/src/app.tsx',
      'lib/apps/api/src/main.ts',
      'lib/client.js.map',
      'scripts/release.ts',
      'lib/test/runtime.js',
      'lib/runtime.spec.js',
      'lib/scripts/build.js',
      'node_modules/fixture/index.js',
    ]) {
      expect(() => validatePackageFiles([...requiredFiles, path])).toThrow(
        `Unexpected package file: ${path}`,
      );
    }
  });

  it('rejects incomplete packages missing a runtime dependency, host entry or original license', () => {
    for (const missing of [
      'lib/client.js',
      'lib/apps/api/src/runtime/assets.json',
      'packages/harness/cordis.patch.yml',
      'licenses/wx_channels_download.LICENSE',
    ]) {
      expect(() => validatePackageFiles(requiredFiles.filter((path) => path !== missing))).toThrow(
        `Missing package file: ${missing}`,
      );
    }
  });

  it('keeps session-delete command semantics with no legacy publishing entry', async () => {
    const { scripts } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(scripts['publish:npm']).toBeUndefined();
    expect(scripts.release).toBe('node --experimental-strip-types scripts/release.ts');
    expect(scripts.check).toBe('pnpm format:check && pnpm lint && pnpm typecheck');
    expect(scripts.verify).toBe('pnpm check && pnpm build && pnpm test');
    expect(scripts.prepack).toBe('pnpm verify');
  });
});
