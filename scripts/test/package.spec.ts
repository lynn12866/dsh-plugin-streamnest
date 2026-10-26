import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { validateHarnessDependencies, validatePackageFiles } from '../check-package.js';

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

describe('published Harness compatibility', () => {
  const tools = '@deepseek-ai/dsh-tools';
  const primitives = '@deepseek-ai/dsh-client-ui-primitives';
  const previous = '1.2.3-rc.1';
  const current = '1.2.3-rc.2';
  const manifest = {
    peerDependencies: { [tools]: current, '@deepseek-ai/cordis': '~4.0.5' },
    devDependencies: { [tools]: current, [primitives]: current, typescript: '^6.0.0' },
  };

  it('accepts peers built against one matching SDK release', () => {
    expect(() =>
      validateHarnessDependencies(manifest, { [tools]: current, [primitives]: current }),
    ).not.toThrow();
  });

  it('rejects updating the advertised peers without updating the build SDKs', () => {
    expect(() =>
      validateHarnessDependencies(
        { ...manifest, devDependencies: { [tools]: previous, [primitives]: previous } },
        { [tools]: previous, [primitives]: previous },
      ),
    ).toThrow(`Harness SDK ${tools} declares ${current}, but the build uses ${previous}.`);
  });

  it('rejects mixing host releases even when each installed SDK matches its declaration', () => {
    expect(() =>
      validateHarnessDependencies(
        { ...manifest, devDependencies: { [tools]: current, [primitives]: previous } },
        { [tools]: current, [primitives]: previous },
      ),
    ).toThrow('Harness development SDKs must use one host release.');
  });

  it('rejects a stale installation or a non-exact peer declaration', () => {
    expect(() =>
      validateHarnessDependencies(manifest, { [tools]: previous, [primitives]: previous }),
    ).toThrow('but the build uses');
    expect(() =>
      validateHarnessDependencies(
        { ...manifest, peerDependencies: { [tools]: `^${current}` } },
        { [tools]: current, [primitives]: current },
      ),
    ).toThrow('but the build uses');
  });
});

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
