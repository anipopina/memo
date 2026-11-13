import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });

test('Tailscale host supports reads without Origin while mutations retain Origin checks', async ({
  request,
}) => {
  const host = 'gtune2023.tail4432be.ts.net';
  const origin = `https://${host}`;
  const headers = { Host: host };
  const session = await request.get('/api/session', { headers });
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ signedIn: false });
  const path = `/api/notes/${randomBytes(16).toString('base64url')}`;
  const missing = await request.get(path, { headers });
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not_found' });
  const withoutOrigin = await request.put(path, {
    headers,
    data: { content: 'origin test' },
  });
  expect(withoutOrigin.status()).toBe(403);
  const invalidOrigin = await request.put(path, {
    headers: { ...headers, Origin: 'https://example.com' },
    data: { content: 'origin test' },
  });
  expect(invalidOrigin.status()).toBe(403);
  const created = await request.put(path, {
    headers: { ...headers, Origin: origin },
    data: { content: 'origin test' },
  });
  expect(created.status()).toBe(201);
  const read = await request.get(path, { headers });
  expect(read.status()).toBe(200);
  expect((await read.json()).content).toBe('origin test');
  const crossSite = await request.get(path, {
    headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
  });
  expect(crossSite.status()).toBe(403);
});
