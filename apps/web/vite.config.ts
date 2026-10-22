import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { API_PREFIX } from '../shared/src/contracts';
import {
  harnessInputStyle,
  harnessPreviewTheme,
} from '../../packages/harness/scripts/ui-library.mjs';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [harnessPreviewTheme()],
  resolve: { alias: { 'harness:input-style': harnessInputStyle } },
  esbuild: { jsx: 'automatic' },
  server: {
    port: 5179,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] },
    proxy: {
      [API_PREFIX]: {
        target: 'http://127.0.0.1:4322',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            if (
              ['http://127.0.0.1:5179', 'http://localhost:5179'].includes(
                incoming.headers.origin ?? '',
              )
            )
              request.setHeader('origin', 'http://127.0.0.1:4322');
          });
        },
      },
    },
  },
});
