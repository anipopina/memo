import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../apps/server/app';
import { Notes } from '../apps/server/notes';
import { TokenVault } from '../apps/server/crypto';
import { SqliteRepository } from '../apps/server/sqlite';

it('Web and official MCP client share a durable conditional mutation service', async () => {
  const repo = new SqliteRepository(':memory:'),
    key = randomBytes(32).toString('base64');
  const notes = new Notes(repo, new TokenVault(key)),
    token = randomBytes(16).toString('base64url');
  await notes.create(token, 'one');
  let origin = '';
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      createApp(repo, { origin, vaultKey: key }).fetch(request),
  });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing_address');
  origin = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'memo-integration', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${token}`)),
    );
    const operation = {
      name: 'append_note',
      arguments: { content: '\ntwo', operation_id: randomUUID() },
    };
    await Promise.all([client.callTool(operation), client.callTool(operation)]);
    const response = await fetch(`${origin}/api/notes/${token}`),
      note = await response.json();
    expect(note).toMatchObject({ content: 'one\ntwo', version: 2 });
    await fetch(`${origin}/api/notes/${token}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'web',
        expectedVersion: 2,
        operationId: randomUUID(),
      }),
    });
    expect(
      JSON.stringify(
        await client.callTool({ name: 'read_note', arguments: {} }),
      ),
    ).toContain('web');
    expect(
      (
        await client.callTool({
          name: 'write_note',
          arguments: {
            content: 'stale',
            expected_version: 2,
            operation_id: randomUUID(),
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'read_note',
          arguments: { token: randomBytes(16).toString('base64url') },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.db.close();
  }
});
