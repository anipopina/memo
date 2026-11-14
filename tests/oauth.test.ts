import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { OAuth, OAUTH } from '../apps/server/oauth';
import { SqliteRepository } from '../apps/server/sqlite';
import { createApp } from '../apps/server/app';
import { hash } from '../apps/server/crypto';
import { nowSeconds } from '../apps/server/repository';
const origin = 'https://memo.test';
const redirect = 'https://client.test/callback';
const repos: SqliteRepository[] = [];
afterEach(() => {
  vi.useRealTimers();
  repos.splice(0).forEach((r) => r.db.close());
});
async function fixture(method = 'none') {
  const repo = new SqliteRepository(':memory:');
  repos.push(repo);
  const oauth = new OAuth(repo, origin);
  const client = await oauth.register({
    client_name: 'Test AI',
    redirect_uris: [redirect],
    token_endpoint_auth_method: method,
  });
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirect,
    resource: oauth.resource,
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: 'client-state',
    scope: 'memo:read memo:create memo:write',
  });
  const request = new URL(await oauth.authorize(params)).searchParams.get(
    'request',
  )!;
  const grant = async (account = 'alice', allow = true) =>
    new URL(await oauth.decide(request, account, allow));
  const exchange = (code: string) =>
    new URLSearchParams({
      client_id: client.client_id,
      grant_type: 'authorization_code',
      redirect_uri: redirect,
      resource: oauth.resource,
      code,
      code_verifier: verifier,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    });
  return { repo, oauth, client, params, request, grant, exchange };
}

describe('OAuth authorization code and token lifecycle', () => {
  it('validates metadata and only permits exact registered redirects and S256', async () => {
    const f = await fixture();
    expect(await f.oauth.request(f.request)).toEqual({
      clientName: 'Test AI',
      redirectOrigin: 'https://client.test',
      scopes: ['memo:read', 'memo:create', 'memo:write'],
    });
    for (const [name, value] of [
      ['redirect_uri', `${redirect}/other`],
      ['resource', 'https://other.test/mcp'],
      ['code_challenge_method', 'plain'],
      ['response_type', 'token'],
      ['scope', 'admin'],
    ]) {
      const p = new URLSearchParams(f.params);
      p.set(name, value);
      await expect(f.oauth.authorize(p)).rejects.toBeInstanceOf(Error);
    }
    for (const value of [
      'http://remote.test/cb',
      'https://client.test/cb#fragment',
      'javascript:alert(1)',
      'https://user:pass@client.test/cb',
    ]) {
      await expect(
        f.oauth.register({ redirect_uris: [value] }),
      ).rejects.toBeInstanceOf(Error);
    }
    expect(f.oauth.metadata()).toMatchObject({
      code_challenge_methods_supported: ['S256'],
      issuer: origin,
    });
  });
  it('returns state and issuer on approval, hashes secrets, enforces client/redirect/PKCE/resource and single-use codes', async () => {
    const f = await fixture('client_secret_post'),
      callback = await f.grant();
    expect(callback.searchParams.get('state')).toBe('client-state');
    expect(callback.searchParams.get('iss')).toBe(origin);
    const code = callback.searchParams.get('code')!,
      params = f.exchange(code);
    for (const [name, value] of [
      ['redirect_uri', 'https://evil.test/cb'],
      ['client_secret', 'wrong'],
      ['code_verifier', 'x'.repeat(43)],
      ['resource', 'https://evil.test'],
    ]) {
      const p = new URLSearchParams(params);
      p.set(name, value);
      await expect(f.oauth.token(p)).rejects.toBeInstanceOf(Error);
    }
    const token = await f.oauth.token(params);
    expect(await f.oauth.access(token.access_token)).toMatchObject({
      account: 'alice',
    });
    await expect(f.oauth.token(params)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    const stored = JSON.stringify(
      f.repo.db.prepare('SELECT value FROM kv').all(),
    );
    for (const secret of [
      f.client.client_secret!,
      code,
      token.access_token,
      token.refresh_token,
    ])
      expect(stored).not.toContain(secret);
  });
  it('supports Basic client authentication and rejects a different registered client', async () => {
    const f = await fixture('client_secret_basic'),
      callback = await f.grant(),
      params = f.exchange(callback.searchParams.get('code')!);
    params.delete('client_secret');
    const auth = `Basic ${Buffer.from(`${f.client.client_id}:${f.client.client_secret}`).toString('base64')}`;
    const other = await f.oauth.register({
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
    });
    const bad = new URLSearchParams(params);
    bad.set('client_id', other.client_id);
    await expect(f.oauth.token(bad)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect((await f.oauth.token(params, auth)).access_token).toBeTruthy();
  });
  it('rotates refresh tokens, forbids expanded scopes and revokes the family on reuse', async () => {
    const f = await fixture(),
      token = await f.oauth.token(
        f.exchange((await f.grant()).searchParams.get('code')!),
      );
    const refresh = new URLSearchParams({
      client_id: f.client.client_id,
      grant_type: 'refresh_token',
      resource: f.oauth.resource,
      refresh_token: token.refresh_token,
    });
    const narrow = new URLSearchParams(refresh);
    narrow.set('scope', 'memo:read');
    const next = await f.oauth.token(narrow);
    expect(next.refresh_token).not.toBe(token.refresh_token);
    expect((await f.oauth.access(next.access_token))?.scopes).toEqual([
      'memo:read',
    ]);
    const expanded = new URLSearchParams(refresh);
    expanded.set('refresh_token', next.refresh_token);
    expanded.set('scope', 'memo:read memo:write');
    await expect(f.oauth.token(expanded)).rejects.toMatchObject({
      code: 'invalid_scope',
    });
    await expect(f.oauth.token(refresh)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect(await f.oauth.access(next.access_token)).toBeUndefined();
    expect(await f.oauth.access(token.access_token)).toBeUndefined();
  });
  it('revokes only the owner grant and prevents refresh afterward', async () => {
    const f = await fixture(),
      token = await f.oauth.token(
        f.exchange((await f.grant()).searchParams.get('code')!),
      );
    const [grant] = await f.oauth.grants('alice');
    await f.oauth.revokeGrant('bob', grant.id);
    expect(await f.oauth.access(token.access_token)).toBeDefined();
    await f.oauth.revoke(
      new URLSearchParams({
        client_id: f.client.client_id,
        token: token.refresh_token,
      }),
    );
    expect(await f.oauth.access(token.access_token)).toBeUndefined();
    expect(await f.oauth.grants('alice')).toEqual([]);
    await expect(
      f.oauth.token(
        new URLSearchParams({
          client_id: f.client.client_id,
          resource: f.oauth.resource,
          grant_type: 'refresh_token',
          refresh_token: token.refresh_token,
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
  it('denies requests without creating a grant and expires requests, codes, access and refresh tokens', async () => {
    const f = await fixture(),
      callback = await f.grant('alice', false);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('client-state');
    expect(await f.oauth.grants('alice')).toEqual([]);
    await expect(
      f.oauth.decide(f.request, 'alice', true),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    const g = await fixture(),
      granted = await g.grant();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (OAUTH.code + 1) * 1000);
    await expect(
      g.oauth.token(g.exchange(granted.searchParams.get('code')!)),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    vi.useRealTimers();
    const h = await fixture(),
      token = await h.oauth.token(
        h.exchange((await h.grant()).searchParams.get('code')!),
      );
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (OAUTH.access + 1) * 1000);
    expect(await h.oauth.access(token.access_token)).toBeUndefined();
    await expect(h.oauth.request(h.request)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    // Keep client registration valid to test grant/refresh expiry independently.
    const clientKey = {
      pk: `oauth-client#${hash(h.client.client_id)}`,
      sk: 'client',
    };
    const clientRow = (await h.repo.get(clientKey))!;
    await h.repo.commit([
      {
        key: clientKey,
        expected: clientRow.rev,
        value: {
          ...clientRow.value,
          expires: nowSeconds() + OAUTH.grant + 86400,
        },
      },
    ]);
    vi.setSystemTime(Date.now() + OAUTH.grant * 1000);
    await expect(
      h.oauth.token(
        new URLSearchParams({
          client_id: h.client.client_id,
          grant_type: 'refresh_token',
          resource: h.oauth.resource,
          refresh_token: token.refresh_token,
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

it('exposes discovery and CORS while keeping consent and connection management behind session/Origin checks', async () => {
  const f = await fixture();
  const app = createApp(f.repo, {
    origin,
    vaultKey: randomBytes(32).toString('base64'),
  });
  const unauth = await app.request('/mcp/account', { method: 'POST' });
  expect(unauth.status).toBe(401);
  expect(unauth.headers.get('WWW-Authenticate')).toContain(
    '/.well-known/oauth-protected-resource/mcp/account',
  );
  for (const path of [
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp/account',
  ]) {
    const result = await app.request(path, {
      headers: { Origin: 'https://client.test' },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  }
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  expect(
    (
      await post(
        '/api/oauth/register',
        { redirect_uris: [redirect], token_endpoint_auth_method: 'none' },
        { Origin: 'https://client.test' },
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await post(
        '/api/oauth/decision',
        { request: f.request, allow: true },
        { Origin: origin },
      )
    ).status,
  ).toBe(401);
  const session = randomBytes(32).toString('base64url');
  await f.repo.commit([
    {
      key: { pk: `session#${hash(session)}`, sk: 'session' },
      expected: null,
      value: { account: 'alice', expires: nowSeconds() + 1000 } as {
        account: string;
        expires: number;
      },
    },
  ]);
  expect(
    (
      await post(
        '/api/oauth/decision',
        { request: f.request, allow: true },
        { Origin: 'https://evil.test', Cookie: `__Host-memo=${session}` },
      )
    ).status,
  ).toBe(403);
  expect((await app.request('/api/oauth/connections')).status).toBe(401);
  const nav = await app.request(`/api/oauth/authorize?${f.params}`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  expect(nav.status).toBe(302);
  expect(nav.headers.get('location')).toContain('/connect?request=');
});
