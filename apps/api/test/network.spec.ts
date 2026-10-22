import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { fetchNetwork } from '../src/common/network.js';

describe('受限网络代理', () => {
  it('每次重定向前都校验目标，不向被拒绝的目标发请求', async () => {
    let destinationRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/denied' }).end();
      } else {
        destinationRequests++;
        response.end('should never be fetched');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const visited: string[] = [];
    try {
      await expect(
        fetchNetwork(`${base}/redirect`, {
          validateUrl: (url) => {
            visited.push(url.pathname);
            if (url.pathname === '/denied') throw new Error('destination denied');
          },
        }),
      ).rejects.toThrow('destination denied');
      expect(visited).toEqual(['/redirect', '/denied']);
      expect(destinationRequests).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
