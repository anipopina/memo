import { afterEach, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpApp } from '../spikes/mcp/app';
import { MemoryNoteStore } from '../spikes/mcp/store';

const token = 'AAAAAAAAAAAAAAAAAAAAAA';
const other = 'BBBBBBBBBBBBBBBBBBBBBQ';
const servers: ServerType[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if ('closeAllConnections' in server) server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function setup() {
  const store = new MemoryNoteStore();
  store.seed(token, 'one');
  store.seed(other, 'private other note');
  // The ephemeral port is known before the first request reaches the app.
  let origin = '';
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => createMcpApp(store, origin).fetch(request),
  });
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing address');
  origin = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'memo-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${token}`)),
  );
  return { client, store, origin };
}

it('uses the official MCP HTTP client for read, conditional write, append and identical retry', async () => {
  const { client, store } = await setup();
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
    'read_note',
    'write_note',
    'append_note',
  ]);
  const read = await client.callTool({ name: 'read_note', arguments: {} });
  expect(JSON.stringify(read)).toContain('one');
  const operation = randomUUID();
  const write = {
    name: 'write_note',
    arguments: { content: 'two', expected_version: 1, operation_id: operation },
  };
  expect((await client.callTool(write)).isError).not.toBe(true);
  await client.callTool(write);
  expect(store.read(token)).toEqual({ content: 'two', version: 2 });
  const conflict = await client.callTool({
    ...write,
    arguments: { ...write.arguments, operation_id: randomUUID() },
  });
  expect(conflict.isError).toBe(true);
  expect(JSON.stringify(conflict)).toContain('version_conflict');
  const append = {
    name: 'append_note',
    arguments: { content: '\nthree', operation_id: randomUUID() },
  };
  await Promise.all([client.callTool(append), client.callTool(append)]);
  expect(store.read(token)).toEqual({ content: 'two\nthree', version: 3 });
  expect(store.read(other)).toEqual({
    content: 'private other note',
    version: 1,
  });
});

it('rejects cross-note arguments, malformed tokens and hostile Origins', async () => {
  const { client, origin } = await setup();
  expect(
    (await client.callTool({ name: 'read_note', arguments: { token: other } }))
      .isError,
  ).toBe(true);
  const hostile = await fetch(`${origin}/mcp/${token}`, {
    method: 'POST',
    headers: {
      origin: 'https://attacker.example',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  expect(hostile.status).toBe(403);
  expect(hostile.headers.get('cache-control')).toBe('no-store');
  expect((await fetch(`${origin}/mcp/AAAAAAAAAAAAAAAAAAAAAB`)).status).toBe(
    404,
  );
  expect(
    (
      await fetch(`${origin}/mcp/${token}`, {
        headers: { accept: 'text/event-stream' },
      })
    ).status,
  ).toBe(405);
});
