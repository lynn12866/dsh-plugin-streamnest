import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

import { harnessInputStyle, readHarnessCompactInputCSS } from './ui-library.mjs';

const require = createRequire(import.meta.url);
await rm('lib', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'], {
  stdio: 'inherit',
});

const bundle = await build({
  entryPoints: ['packages/harness/src/client.tsx'],
  bundle: true,
  write: false,
  outfile: 'lib/client.bundle.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  legalComments: 'inline',
  metafile: true,
  minify: false,
  plugins: [
    {
      name: 'harness-primitives',
      setup(builder) {
        builder.onResolve({ filter: /^harness:input-style$/ }, () => ({ path: harnessInputStyle }));
        builder.onResolve({ filter: /^katex\/dist\/katex\.min\.css$/ }, () => ({
          path: 'unused-math',
          namespace: 'unused-math',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'unused-math' }, () => ({
          contents: '',
          loader: 'css',
        }));
        builder.onResolve({ filter: /\.css$/ }, (args) => {
          if (!args.importer.includes('@deepseek-ai/dsh-client-ui-primitives')) return;
          return {
            path: args.path.startsWith('.')
              ? resolve(dirname(args.importer), args.path)
              : require.resolve(args.path),
            sideEffects: false,
          };
        });
      },
    },
  ],
});
const css = `${bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}\n${await readFile('apps/web/src/styles.css', 'utf8')}\n${await readHarnessCompactInputCSS()}`;
const javascript = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
if (!javascript) throw new Error('客户端构建没有生成 JavaScript。');

await mkdir('lib', { recursive: true });
await writeFile(
  'lib/client.js',
  `window.__ModuleLoader__.load({
  id: 'dsh-plugin-streamnest',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const style = document.querySelector('style[data-plugin-css="streamnest"]') ?? document.createElement('style');
    style.dataset.pluginCss = 'streamnest';
    style.textContent = ${JSON.stringify(css)};
    if (!style.isConnected) document.head.appendChild(style);
    ${javascript}
    return module.exports;
  },
});\n`,
);
await writeFile('lib/index.js', "export * from './packages/harness/src/index.js';\n");

const bundled = new Set();
for (const output of Object.values(bundle.metafile.outputs)) {
  for (const [input, metadata] of Object.entries(output.inputs)) {
    if (!metadata.bytesInOutput || !input.includes('node_modules/')) continue;
    const dependencyStart = input.lastIndexOf('node_modules/') + 'node_modules/'.length;
    const match = input.slice(dependencyStart).match(/^((?:@[^/]+\/)?[^/]+)\//);
    if (match) bundled.add(resolve(input.slice(0, dependencyStart), match[1]));
  }
}
const references = JSON.parse(await readFile('assets/reference-projects.json', 'utf8'));
const licenses = ['参考实现来源与许可\n'];
for (const project of Object.values(references)) {
  const license = await readFile(project.licenseFile, 'utf8');
  licenses.push(`${project.name}\n作者：${project.author}\n来源：${project.url}\n\n${license}`);
}
licenses.push('客户端捆绑依赖许可\n');
for (const directory of [...bundled].sort()) {
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const name = metadata.name;
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try {
      license = await readFile(resolve(directory, filename), 'utf8');
      break;
    } catch {
      /* Try the package's next license filename. */
    }
  }
  if (!license) throw new Error(`捆绑依赖 ${name} 缺少许可文本。`);
  licenses.push(`${name} ${metadata.version}\n\n许可：${metadata.license}\n\n${license.trim()}\n`);
}
await writeFile('lib/THIRD_PARTY_LICENSES.txt', licenses.join('\n'));
console.log('已构建 Harness Host / Client 插件。');
