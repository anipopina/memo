import { serve } from '@hono/node-server';
import { createMcpApp } from './app';
import { MemoryNoteStore } from './store';

// A public, fixed fixture is deliberately not a real capability secret.
const token = 'AAAAAAAAAAAAAAAAAAAAAA';
const store = new MemoryNoteStore();
store.seed(token, 'MCP先行検証用のメモ\n');
const app = createMcpApp(store, 'http://127.0.0.1:8787');
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 });
console.info(
  'MCP spike listening on http://127.0.0.1:8787 (local fixtures only)',
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.close());
