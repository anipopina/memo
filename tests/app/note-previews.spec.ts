import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });
const newToken = () => randomBytes(16).toString('base64url');

function cachedTokens(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('memo-previews', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction('notes')
            .objectStore('notes')
            .getAllKeys();
          request.onsuccess = () => resolve(request.result.map(String));
          request.onerror = () => reject(request.error);
          db.close();
        };
      }),
  );
}

test('shows the cached note read-only, preserves an unchanged preview, and handles refresh failures', async ({
  page,
}) => {
  const token = newToken();
  const path = '/' + token;
  const url = `**/api/notes/${token}`;
  const body = { content: '前回読んだメモ', version: 1 };
  await page.route(url, (route) => route.fulfill({ json: body }));
  await page.goto(path);
  const editor = page.getByRole('textbox', { name: 'メモ本文' });
  await expect(editor).toBeEditable();
  await expect.poll(() => cachedTokens(page)).toContain(token);
  await page.unroute(url);

  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    await delayed;
    await route.fulfill({ json: body });
  });
  await page.reload();
  try {
    await expect(editor).toHaveText(body.content);
    await expect(editor).not.toBeEditable();
    await expect(page.getByText(/最新版を確認しています/)).toBeVisible();
    await editor.locator('.memo-line').evaluate((line) => {
      Reflect.set(line, 'previewLine', true);
    });
  } finally {
    release();
  }
  await expect(editor).toBeEditable();
  expect(
    await editor
      .locator('.memo-line')
      .evaluate((line) => Reflect.get(line, 'previewLine')),
  ).toBe(true);
  await expect(page.getByText(/最新版を確認しています/)).toHaveCount(0);

  const latest = { content: '最新版のメモ', version: 2 };
  await page.unroute(url);
  await page.route(url, (route) => route.fulfill({ json: latest }));
  await page.reload();
  await expect(editor).toBeEditable();
  await expect(editor).toHaveText(latest.content);

  await page.unroute(url);
  await page.route(url, (route) =>
    route.fulfill({ status: 503, json: { error: 'request_failed' } }),
  );
  await page.reload();
  await expect(editor).toHaveText(latest.content);
  await expect(editor).not.toBeEditable();
  await expect(page.getByText(/最新版を取得できません/)).toBeVisible();
  await page.unroute(url);
  await page.route(url, (route) =>
    route.fulfill({ status: 404, json: { error: 'not_found' } }),
  );
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByRole('alert')).toHaveText('メモが見つかりません');
  await expect(editor).toBeHidden();
  await expect.poll(() => cachedTokens(page)).not.toContain(token);
});

test('excludes expired previews and keeps at most the ten most recent notes', async ({
  page,
}) => {
  const token = newToken();
  await page.route(`**/api/notes/${token}`, (route) =>
    route.fulfill({ json: { content: '初回取得', version: 1 } }),
  );
  await page.goto('/' + token);
  const editor = page.getByRole('textbox', { name: 'メモ本文' });
  await expect(editor).toBeEditable();
  await expect.poll(() => cachedTokens(page)).toContain(token);
  const additional = Array.from({ length: 10 }, newToken);
  const expired = newToken();
  await page.evaluate(
    ({ tokens, expiredToken }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('memo-previews', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('notes', 'readwrite');
          const store = tx.objectStore('notes');
          const now = Date.now();
          tokens.forEach((token, index) =>
            store.put({
              token,
              epoch: '',
              content: 'キャッシュ',
              version: 1,
              cachedAt: now - (index + 1) * 1000,
            }),
          );
          store.put({
            token: expiredToken,
            epoch: '',
            content: '期限切れ',
            version: 1,
            cachedAt: now - 7 * 86400000,
          });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
          db.close();
        };
      }),
    { tokens: additional, expiredToken: expired },
  );
  await page.route(`**/api/notes/${expired}`, (route) =>
    route.fulfill({ status: 503, json: { error: 'request_failed' } }),
  );
  await page.goto('/' + expired);
  await expect(page.getByRole('alert')).toHaveText('メモを読み込めません');
  await expect(editor).toBeHidden();
  await expect.poll(() => cachedTokens(page)).not.toContain(expired);
  await page.goto('/' + token);
  await expect(editor).toBeEditable();
  await expect
    .poll(() => cachedTokens(page))
    .toEqual([token, ...additional.slice(0, 9)].sort());
});

test('sign-out clears previews and prevents an in-flight response in another tab from restoring them', async ({
  page,
  context,
}) => {
  const token = newToken();
  const path = '/' + token;
  const url = `**/api/notes/${token}`;
  const body = { content: 'ログアウト前のメモ', version: 1 };
  await context.route('**/api/session', (route) =>
    route.fulfill({ json: { signedIn: true, account: 'preview-test' } }),
  );
  await page.route('**/api/list', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/credentials', (route) =>
    route.fulfill({ json: [{ id: 'pc', name: 'PC', createdAt: 1 }] }),
  );
  await page.route('**/api/oauth/connections', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route(url, (route) => route.fulfill({ json: body }));
  await page.goto(path);
  await expect.poll(() => cachedTokens(page)).toContain(token);

  const other = await context.newPage();
  await other.route('**/api/list', (route) => route.fulfill({ json: [] }));
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await other.route(url, async (route) => {
    await delayed;
    await route.fulfill({ json: body });
  });
  await other.goto(path);
  try {
    await expect(other.getByText(/最新版を確認しています/)).toBeVisible();
    await page.getByRole('button', { name: 'アカウント', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await expect.poll(() => cachedTokens(page)).toEqual([]);
    await expect(other.getByText(/最新版を確認しています/)).toHaveCount(0);
  } finally {
    release();
  }
  await expect(other.getByRole('textbox', { name: 'メモ本文' })).toBeEditable();
  await expect.poll(() => cachedTokens(other)).toEqual([]);
});
