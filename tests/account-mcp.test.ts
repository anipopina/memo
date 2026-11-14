import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { createApp } from '../apps/server/app';
import { OAuth } from '../apps/server/oauth';
import { Notes } from '../apps/server/notes';
import { hash, TokenVault } from '../apps/server/crypto';
import { nowSeconds } from '../apps/server/repository';
import { SqliteRepository } from '../apps/server/sqlite';

it('official SDK discovers OAuth, registers, exchanges PKCE, and operates only on the account list', async () => {
  const repo = new SqliteRepository(':memory:'),
    vaultKey = randomBytes(32).toString('base64');
  let origin = '';
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (r) => createApp(repo, { origin, vaultKey }).fetch(r),
  });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing_address');
  origin = `http://127.0.0.1:${address.port}`;
  const oauth = new OAuth(repo, origin),
    notes = new Notes(repo, new TokenVault(vaultKey));
  let clientInfo: OAuthClientInformationMixed | undefined,
    tokens: OAuthTokens | undefined,
    verifier = '',
    authorize: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: 'https://client.test/callback',
    clientMetadata: {
      client_name: 'SDK AI',
      redirect_uris: ['https://client.test/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    clientInformation: () => clientInfo,
    saveClientInformation: (value) => {
      clientInfo = value;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    codeVerifier: () => verifier,
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    redirectToAuthorization: (value) => {
      authorize = value;
    },
    state: () => 'sdk-state',
  };
  const url = new URL(`${origin}/mcp/account`);
  const first = new StreamableHTTPClientTransport(url, {
    authProvider: provider,
  });
  let client = new Client({ name: 'account-integration', version: '1' });
  try {
    await expect(client.connect(first)).rejects.toThrow();
    expect(authorize).toBeDefined();
    const nav = await fetch(authorize!, { redirect: 'manual' });
    expect(nav.status).toBe(302);
    const request = new URL(nav.headers.get('location')!).searchParams.get(
      'request',
    )!;
    const session = randomBytes(32).toString('base64url');
    await repo.commit([
      {
        key: { pk: `session#${hash(session)}`, sk: 'session' },
        expected: null,
        value: { account: 'alice', expires: nowSeconds() + 3600 } as {
          account: string;
          expires: number;
        },
      },
    ]);
    const approval = await fetch(`${origin}/api/oauth/decision`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `memo_local=${session}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ request, allow: true }),
    });
    expect(approval.status).toBe(200);
    const callback = new URL((await approval.json()).redirect);
    expect(callback.searchParams.get('state')).toBe('sdk-state');
    await first.finishAuth(callback.searchParams.get('code')!);
    expect(tokens?.access_token).toBeTruthy();
    await client.close();
    client = new Client({ name: 'account-integration', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(url, { authProvider: provider }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'append_note',
      'create_note',
      'list_notes',
      'read_note',
      'search_notes',
      'write_note',
    ]);
    expect(
      tools.find((tool) => tool.name === 'read_note')?.outputSchema,
    ).toMatchObject({
      type: 'object',
      properties: {
        token: { type: 'string' },
        url: { type: 'string' },
        mcp_url: { type: 'string' },
        content: { type: 'string' },
        version: { type: 'integer' },
      },
      required: expect.arrayContaining([
        'token',
        'url',
        'mcp_url',
        'content',
        'version',
      ]),
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const operation_id = randomUUID();
    const created = await call('create_note', {
      content: '決定事項\n一緒にテスト ABC',
      operation_id,
    });
    expect(created.url).toBe(`${origin}/${created.token}`);
    expect(created.mcp_url).toBe(`${origin}/mcp/${created.token}`);
    expect(
      await call('create_note', {
        content: '決定事項\n一緒にテスト ABC',
        operation_id,
      }),
    ).toEqual(created);
    expect((await notes.list('alice')).length).toBe(1);
    expect(
      (
        await client.callTool({
          name: 'create_note',
          arguments: { content: 'different', operation_id },
        })
      ).isError,
    ).toBe(true);
    const other = randomBytes(16).toString('base64url');
    await notes.create(other, 'other-private', 'bob');
    expect((await call('list_notes', {})).notes).toHaveLength(1);
    expect((await call('search_notes', { query: 'abc' })).notes[0].token).toBe(
      created.token,
    );
    expect(
      (await call('search_notes', { query: 'other-private' })).notes,
    ).toEqual([]);
    const expectRead = async (
      token: string,
      content: string,
      version: number,
    ) => {
      const result = await client.callTool({
        name: 'read_note',
        arguments: { token },
      });
      const expected = {
        token,
        url: `${origin}/${token}`,
        mcp_url: `${origin}/mcp/${token}`,
        content,
        version,
      };
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(expected);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(expected) },
      ]);
    };
    await expectRead(created.token, '決定事項\n一緒にテスト ABC', 1);
    await call('write_note', {
      token: created.token,
      content: '改訂',
      expected_version: 1,
      operation_id: randomUUID(),
    });
    expect(
      (
        await client.callTool({
          name: 'write_note',
          arguments: {
            token: created.token,
            content: '古い',
            expected_version: 1,
            operation_id: randomUUID(),
          },
        })
      ).isError,
    ).toBe(true);
    const append = {
      token: created.token,
      content: '\n追記',
      operation_id: randomUUID(),
    };
    await call('append_note', append);
    await call('append_note', append);
    await expectRead(created.token, '改訂\n追記', 3);
    for (const name of ['read_note', 'write_note', 'append_note']) {
      expect(
        (
          await client.callTool({
            name,
            arguments: {
              token: other,
              ...(name === 'read_note'
                ? {}
                : {
                    content: 'no',
                    operation_id: randomUUID(),
                    ...(name === 'write_note' ? { expected_version: 1 } : {}),
                  }),
            },
          })
        ).isError,
      ).toBe(true);
    }
    const second = randomBytes(16).toString('base64url');
    await notes.create(second, '別の本文', 'alice');
    await expectRead(second, '別の本文', 1);
    const firstPage = await call('list_notes', { limit: 1 });
    expect(firstPage.notes).toHaveLength(1);
    expect(firstPage.next_cursor).toBeTruthy();
    const lastPage = await call('list_notes', {
      limit: 1,
      cursor: firstPage.next_cursor,
    });
    expect(lastPage.notes).toHaveLength(1);
    expect(lastPage.next_cursor).toBeNull();
    expect(lastPage.notes[0].token).not.toBe(firstPage.notes[0].token);
    const emptyPage = await call('search_notes', {
      query: 'does-not-exist',
      limit: 1,
    });
    expect(emptyPage.notes).toEqual([]);
    expect(emptyPage.next_cursor).toBeTruthy();
    await notes.remove('alice', second);
    const narrowed = await oauth.token(
      new URLSearchParams({
        client_id: clientInfo!.client_id,
        grant_type: 'refresh_token',
        refresh_token: tokens!.refresh_token!,
        resource: oauth.resource,
        scope: 'memo:read',
      }),
    );
    const readOnly = new Client({ name: 'read-only', version: '1' });
    try {
      await readOnly.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: { Authorization: `Bearer ${narrowed.access_token}` },
          },
        }),
      );
      expect(
        (await readOnly.listTools()).tools.map((t) => t.name).sort(),
      ).toEqual(['list_notes', 'read_note', 'search_notes']);
      expect(
        (
          await readOnly.callTool({
            name: 'create_note',
            arguments: { content: 'forbidden', operation_id: randomUUID() },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await readOnly.callTool({
            name: 'write_note',
            arguments: {
              token: created.token,
              content: 'forbidden',
              expected_version: 3,
              operation_id: randomUUID(),
            },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await readOnly.close();
    }
    await notes.remove('alice', created.token);
    expect(
      (
        await client.callTool({
          name: 'read_note',
          arguments: { token: created.token },
        })
      ).isError,
    ).toBe(true);
    expect((await notes.read(created.token)).content).toBe('改訂\n追記');
    expect((await call('list_notes', {})).notes).toEqual([]);
    const [grant] = await oauth.grants('alice');
    await oauth.revokeGrant('alice', grant.id);
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens!.access_token}` },
    });
    expect(response.status).toBe(401);
  } finally {
    await client.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.db.close();
  }
});

it('creation retry is atomic, account-bound, encrypted, size-limited and counted once against its quota', async () => {
  const repo = new SqliteRepository(':memory:');
  const notes = new Notes(
    repo,
    new TokenVault(randomBytes(32).toString('base64')),
  );
  try {
    const op = randomUUID();
    const results = await Promise.all([
      notes.createInAccount('alice', 'one', op),
      notes.createInAccount('alice', 'one', op),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await notes.list('alice')).toHaveLength(1);
    expect((await notes.createInAccount('bob', 'one', op)).token).not.toBe(
      results[0].token,
    );
    expect(
      JSON.stringify(await repo.query('account#alice', 'create-operation#')),
    ).not.toContain(results[0].token);
    await expect(
      notes.createInAccount('alice', 'changed', op),
    ).rejects.toMatchObject({ code: 'operation_id_reused' });
    await expect(
      notes.createInAccount('alice', 'x'.repeat(256 * 1024 + 1), randomUUID()),
    ).rejects.toThrow('note_too_large');
    for (let i = 0; i < 29; i++)
      await notes.createInAccount('alice', `note ${i}`, randomUUID());
    await expect(
      notes.createInAccount('alice', 'over quota', randomUUID()),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await notes.createInAccount('alice', 'one', op)).toEqual(results[0]);
  } finally {
    repo.db.close();
  }
});
