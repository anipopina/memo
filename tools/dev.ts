import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { createServer } from 'vite';
import { createApp } from '../apps/server/app';
import { SqliteRepository } from '../apps/server/sqlite';
const directory = process.env.MEMO_DATA_DIR ?? '.memo';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keyFile = `${directory}/vault-key`;
if (!existsSync(keyFile))
  writeFileSync(keyFile, randomBytes(32).toString('base64'), {
    flag: 'wx',
    mode: 0o600,
  });
const repo = new SqliteRepository(`${directory}/memo.sqlite`),
  vaultKey = readFileSync(keyFile, 'utf8').trim();
const handlers = new Map<string, ReturnType<typeof createApp>>();
const originsByHost = new Map<string, string>();
const api = serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) => {
    // HTTPS terminates at Tailscale; same-origin GETs may omit Origin.
    // Resolve only configured hosts, preserving their public scheme.
    const origin =
      request.headers.get('Origin') ??
      originsByHost.get(new URL(request.url).host);
    const app = origin ? handlers.get(origin) : undefined;
    return app
      ? app.fetch(request)
      : new Response('Forbidden', { status: 403 });
  },
});
await new Promise<void>((resolve) =>
  api.listening ? resolve() : api.once('listening', resolve),
);
const address = api.address();
if (!address || typeof address === 'string') throw new Error('invalid_address');
const index = process.argv.indexOf('--port'),
  port = index >= 0 ? Number(process.argv[index + 1]) : 5173;
const server = await createServer({
  configFile: 'apps/web/vite.config.ts',
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${address.port}` },
      '/mcp': { target: `http://127.0.0.1:${address.port}` },
      '/.well-known': { target: `http://127.0.0.1:${address.port}` },
    },
    headers: {
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  },
});
await server.listen();
const web = server.httpServer!.address();
if (!web || typeof web === 'string') throw new Error('invalid_address');
for (const origin of [
  `http://localhost:${web.port}`,
  `http://127.0.0.1:${web.port}`,
  'https://gtune2023.tail4432be.ts.net',
  process.env.MEMO_ORIGIN,
].filter((value): value is string => !!value)) {
  handlers.set(origin, createApp(repo, { origin, vaultKey }));
  originsByHost.set(new URL(origin).host, origin);
}
console.info(`Local: http://127.0.0.1:${web.port}`);
async function close() {
  await server.close();
  api.close();
  repo.db.close();
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
