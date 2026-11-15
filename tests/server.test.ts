import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRepository } from '../apps/server/sqlite';
import { createApp } from '../apps/server/app';
import { Notes, AppError } from '../apps/server/notes';
import { hash, TokenVault } from '../apps/server/crypto';
import { nowSeconds } from '../apps/server/repository';
const origin = 'https://memo.test';
const repositories: SqliteRepository[] = [];
function fixture() {
  const repo = new SqliteRepository(':memory:');
  repositories.push(repo);
  const key = randomBytes(32).toString('base64'),
    vault = new TokenVault(key);
  return {
    repo,
    vault,
    notes: new Notes(repo, vault),
    app: createApp(repo, { origin, vaultKey: key }),
  };
}
const token = () => randomBytes(16).toString('base64url');
afterEach(() => {
  for (const repo of repositories.splice(0)) repo.db.close();
});

describe('persistent note transactions', () => {
  it('saves account order, prepends additions, and keeps concurrent moves and removal consistent', async () => {
    const { app, notes, repo } = fixture();
    const first = token(),
      second = token(),
      third = token(),
      foreign = token();
    let timestamp = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => timestamp++);
    try {
      for (const id of [first, second, third])
        await notes.create(id, 'body', 'alice');
    } finally {
      clock.mockRestore();
    }
    await notes.create(foreign, 'body', 'bob');
    const session = randomBytes(32).toString('base64url');
    const value = { account: 'alice', expires: nowSeconds() + 3600 };
    await repo.commit([
      {
        key: { pk: `session#${hash(session)}`, sk: 'session' },
        expected: null,
        value,
      },
    ]);
    const move = (token: string, before: string | null, cookie?: string) =>
      app.request('/api/list/order', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ token, before }),
      });
    const order = async () =>
      (await notes.list('alice')).map((item) => item.token);
    await expect(
      notes.moveInList('alice', first, foreign),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      notes.moveInList('alice', foreign, first),
    ).rejects.toMatchObject({ code: 'not_found' });
    await notes.moveInList('alice', first, null);
    expect((await move(second, third)).status).toBe(401);
    expect((await move(second, third, `__Host-memo=${session}`)).status).toBe(
      200,
    );
    expect(await order()).toEqual([second, third, first]);
    const added = token();
    await notes.create(added, 'body', 'alice');
    expect(await order()).toEqual([added, second, third, first]);
    await Promise.all([
      notes.moveInList('alice', first, second),
      notes.remove('alice', third),
    ]);
    expect(await order()).toEqual([added, first, second]);
    await notes.add('alice', third);
    expect(await order()).toEqual([third, added, first, second]);
    expect(
      (await notes.searchList('alice', 'body')).results.map(
        (item) => item.token,
      ),
    ).toEqual(await order());
  });

  it('rejects stale versions and deduplicates an atomic concurrent append without copying full content into operation records', async () => {
    const { notes, repo } = fixture(),
      id = token(),
      operation = randomUUID();
    await notes.create(id, 'a');
    const results = await Promise.all([
      notes.mutate(id, operation, 'append', 'b'),
      notes.mutate(id, operation, 'append', 'b'),
    ]);
    expect(results).toEqual([{ version: 2 }, { version: 2 }]);
    expect((await notes.read(id)).content).toBe('ab');
    await expect(
      notes.mutate(id, randomUUID(), 'write', 'x', 1),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      notes.mutate(id, operation, 'append', 'c'),
    ).rejects.toMatchObject({ code: 'operation_id_reused' });
    expect(await notes.version(id)).toEqual({ version: 2 });
    const rows = await repo.query(`note#${hash(id)}`, 'operation#');
    expect(JSON.stringify(rows)).not.toContain('content');
  });
  it('encrypts references and removing an account reference leaves the note accessible', async () => {
    const { notes, repo } = fixture(),
      id = token();
    await notes.create(id, 'first\nbody', 'account');
    await notes.add('account', id);
    expect(await notes.list('account')).toEqual([
      { token: id, title: 'first', addedAt: expect.any(Number) },
    ]);
    expect(
      JSON.stringify(await repo.query('account#account', 'note#')),
    ).not.toContain(id);
    await notes.remove('account', id);
    expect(await notes.list('account')).toEqual([]);
    expect((await notes.read(id)).content).toBe('first\nbody');
  });
  it('allows expired records to be replaced atomically and authenticates vault records by account and note', async () => {
    const { repo, vault } = fixture(),
      key = { pk: 'expired', sk: 'x' };
    await repo.commit([
      { key, expected: null, value: { expires: nowSeconds() - 1 } },
    ]);
    expect(await repo.get(key)).toBeUndefined();
    await repo.commit([
      { key, expected: null, value: { expires: nowSeconds() + 10 } },
    ]);
    expect(await repo.get(key)).toBeDefined();
    const encrypted = vault.encrypt('secret', 'one');
    expect(vault.decrypt(encrypted, 'one')).toBe('secret');
    expect(() => vault.decrypt(encrypted, 'two')).toThrow();
  });
});

describe('HTTP boundaries', () => {
  it('searches only the signed-in list and caps saved body reads in list order', async () => {
    const { app, notes, repo } = fixture();
    const session = randomBytes(32).toString('base64url');
    const sessionValue = { account: 'alice', expires: nowSeconds() + 3600 };
    await repo.commit([
      {
        key: { pk: `session#${hash(session)}`, sk: 'session' },
        expected: null,
        value: sessionValue,
      },
    ]);
    const titleHit = token(),
      bodyHit = token();
    await notes.create(titleHit, '題名 A+B', 'alice');
    await notes.create(
      bodyHit,
      `会議\n${'前'.repeat(30)}a+b${'後'.repeat(30)}`,
      'alice',
    );
    await notes.create(token(), '正規表現なら一致する aaab', 'alice');
    await notes.create(token(), '別アカウントの A+B', 'bob');
    const search = (query: string, authenticated = true) =>
      app.request('/api/list/search', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(authenticated ? { Cookie: `__Host-memo=${session}` } : {}),
        },
        body: JSON.stringify({ query }),
      });
    expect((await search('a+b', false)).status).toBe(401);
    expect((await search('　')).status).toBe(400);
    const response = await search(' a+b ');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const matches = await response.json();
    expect(matches.truncatedAt).toBeNull();
    expect(matches.results).toHaveLength(2);
    expect(matches.results).toEqual(
      expect.arrayContaining([
        { token: titleHit, title: '題名 A+B' },
        {
          token: bodyHit,
          title: '会議',
          snippet: {
            text: `${'前'.repeat(24)}a+b${'後'.repeat(24)}`,
            truncatedBefore: true,
            truncatedAfter: true,
          },
        },
      ]),
    );
    const many = '共通する本文';
    for (let i = 0; i < 51; i++) {
      await notes.create(token(), many, 'alice');
    }
    const listed = await notes.list('alice');
    const read = vi.spyOn(repo, 'get');
    const capped = await (await search(many)).json();
    expect(read.mock.calls.filter(([key]) => key.sk === 'note')).toHaveLength(
      50,
    );
    expect(capped.truncatedAt).toBe(50);
    expect(capped.results).toEqual(
      listed
        .slice(0, 50)
        .filter(({ title }) => title === many)
        .map(({ token, title }) => ({ token, title })),
    );
  });

  it('does not create a note on reads, rejects foreign origins and enforces note size', async () => {
    const { app } = fixture(),
      id = token();
    expect((await app.request(`/api/notes/${id}`)).status).toBe(404);
    expect(
      (
        await app.request(`/api/notes/${id}`, {
          method: 'PUT',
          headers: {
            Origin: 'https://other.test',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'x' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/notes/${id}`, {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x'.repeat(256 * 1024 + 1) }),
        })
      ).status,
    ).toBe(413);
    const result = await app.request(`/api/notes/${id}`, {
      method: 'PUT',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'saved' }),
    });
    expect(result.status).toBe(201);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(
      await (await app.request(`/api/notes/${id}/version`)).json(),
    ).toEqual({ version: 1 });
    expect((await app.request('/api/list')).status).toBe(401);
    expect(
      (
        await app.request(`/api/notes/${id}`, {
          method: 'DELETE',
          headers: { Origin: origin },
        })
      ).status,
    ).toBe(404);
  });
  it('consumes a challenge once even after an invalid credential response', async () => {
    const { app } = fixture();
    const response = await app.request('/api/auth/begin', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'register', name: 'PC' }),
    });
    const { challengeId } = await response.json();
    for (const expected of ['verification_failed', 'invalid_challenge']) {
      const result = await app.request('/api/auth/finish', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: { id: 'invalid' } }),
      });
      expect(result.status).toBe(401);
      expect(await result.json()).toEqual({ error: expected });
    }
  });
  it('bounds anonymous creation and does not expose arbitrary server errors', async () => {
    const { app } = fixture();
    for (let index = 0; index < 30; index++)
      expect(
        (
          await app.request(`/api/notes/${token()}`, {
            method: 'PUT',
            headers: { Origin: origin, 'Content-Type': 'application/json' },
            body: '{"content":""}',
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await app.request(`/api/notes/${token()}`, {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{"content":""}',
        })
      ).status,
    ).toBe(429);
    expect(new AppError('not_found', 404).status).toBe(404);
  });
});

it('keeps notes and encrypted account references across a local server restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'memo-restart-')),
    filename = join(directory, 'memo.sqlite');
  const key = randomBytes(32).toString('base64'),
    id = token();
  let repo = new SqliteRepository(filename);
  try {
    await new Notes(repo, new TokenVault(key)).create(
      id,
      'persisted',
      'account',
    );
    repo.db.close();
    repo = new SqliteRepository(filename);
    const notes = new Notes(repo, new TokenVault(key));
    expect((await notes.read(id)).content).toBe('persisted');
    expect((await notes.list('account'))[0].token).toBe(id);
  } finally {
    repo.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('lists passkey names/dates and keeps one active credential under concurrent revocations', async () => {
  const { repo } = fixture();
  const { Auth } = await import('../apps/server/auth');
  const auth = new Auth(repo, origin);
  const ids = ['first', 'second'];
  for (const [index, id] of ids.entries())
    await repo.commit([
      {
        key: { pk: `credential#${hash(id)}`, sk: 'credential' },
        expected: null,
        value: {
          account: 'a',
          id,
          publicKey: 'AA',
          counter: 0,
        } as import('../apps/server/repository').RecordValue,
      },
      {
        key: { pk: 'account#a', sk: `credential#${hash(id)}` },
        expected: null,
        value: {
          id,
          name: `key ${index}`,
          createdAt: 1000 + index,
        } as import('../apps/server/repository').RecordValue,
      },
    ]);
  expect(await auth.credentials('a')).toEqual([
    { id: 'first', name: 'key 0', createdAt: 1000 },
    { id: 'second', name: 'key 1', createdAt: 1001 },
  ]);
  await expect(auth.revoke('other', 'first')).rejects.toMatchObject({
    code: 'not_found',
  });
  const results = await Promise.allSettled(
    ids.map((id) => auth.revoke('a', id)),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const remaining = await auth.credentials('a');
  expect(remaining).toHaveLength(1);
  await expect(auth.revoke('a', remaining[0].id)).rejects.toMatchObject({
    code: 'last_passkey',
  });
  expect((await fixture().app.request('/api/auth/credentials')).status).toBe(
    401,
  );
});
