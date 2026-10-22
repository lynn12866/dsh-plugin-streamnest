import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);

export const harnessInputStyle = join(
  dirname(require.resolve('@deepseek-ai/dsh-client-ui-primitives')),
  'Input.module.css',
);

// Compact inputs follow the installed official Button.sm geometry, never a separate scale.
export async function readHarnessCompactInputCSS() {
  const source = await readFile(
    join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-primitives')), 'Button.module.css'),
    'utf8',
  );
  const compact = /\.sm\s*\{([^}]+)\}/.exec(source)?.[1];
  if (!compact) throw new Error('Official Button.sm size rules were not found.');
  const value = (property) => {
    const result = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(compact)?.[1]?.trim();
    if (!result) throw new Error(`Official Button.sm is missing ${property}.`);
    return result;
  };
  // The host can insert its default Input stylesheet after a plugin is mounted.
  const selector = ':is(.mv-panel, .mv-dialog-content) .mv-compact-input';
  return `${selector} { height: ${value('height')}; border-radius: ${value('border-radius')}; padding: ${value('padding')}; }\n${selector} input { font-size: ${value('font-size')}; line-height: ${value('line-height')}; }\n`;
}

// Preview uses the exact styles shipped by Harness; Desktop inherits its existing theme.
export async function readHarnessThemeCSS() {
  const file = require.resolve('@deepseek-ai/dsh-client-ui-theme/client');
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest);
  const styles = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith('_css_default') &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      styles.push(node.initializer.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  if (styles.length === 0) throw new Error('Harness theme stylesheet was not found.');

  return styles.join('\n');
}

export function harnessPreviewTheme() {
  const id = '\0harness-theme.css';

  return {
    name: 'harness-preview-theme',
    enforce: 'pre',
    resolveId(specifier) {
      if (specifier === 'virtual:harness-theme.css') return id;
      if (specifier === 'virtual:harness-compact-input.css') return '\0harness-compact-input.css';
      if (specifier === 'katex/dist/katex.min.css') return '\0unused-math-renderer.css';
    },
    async load(specifier) {
      if (specifier === id) return readHarnessThemeCSS();
      if (specifier === '\0harness-compact-input.css') return readHarnessCompactInputCSS();
      if (specifier === '\0unused-math-renderer.css') return '';
    },
  };
}
