import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });
const editorName = { name: 'メモ本文', exact: true };

test('search highlights list and editor matches when switching notes and clears both', async ({
  page,
}) => {
  const tokens = Array.from({ length: 3 }, () =>
    randomBytes(16).toString('base64url'),
  );
  const titles = ['日記', '旅行の予定', '来月の予定'];
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { signedIn: true, account: 'search-test' } }),
  );
  await page.route('**/api/list', (route) =>
    route.fulfill({
      json: tokens.map((token, i) => ({
        token,
        title: titles[i],
        addedAt: 3 - i,
      })),
    }),
  );
  await page.route('**/api/notes/*', (route) => {
    const token = new URL(route.request().url()).pathname.split('/').at(-1);
    const index = tokens.indexOf(token!);
    return route.fulfill({
      json: {
        content:
          index === 0 ? '日記\n週末は旅行に行く\n- 旅行の準備' : titles[index],
        version: 1,
      },
    });
  });
  await page.route('**/api/list/search', (route) => {
    expect(route.request().postDataJSON()).toEqual({ query: '旅行' });
    return route.fulfill({
      json: {
        results: [
          {
            token: tokens[0],
            title: titles[0],
            snippet: {
              text: '週末は旅行に行く',
              truncatedBefore: true,
              truncatedAfter: false,
            },
          },
          { token: tokens[1], title: titles[1] },
        ],
        truncatedAt: 50,
      },
    });
  });

  await page.goto('/' + tokens[2]);
  const toggle = page.getByRole('button', { name: 'メモリスト', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  const list = page.getByRole('complementary', { name: 'メモリスト' });
  const rows = list.getByRole('navigation', { name: '自分のメモ' });
  const input = list.getByRole('searchbox', { name: 'メモを検索' });
  const clear = list.getByRole('button', { name: '検索をクリア' });
  const editor = page.getByRole('textbox', editorName);
  const editorMatches = editor.locator('mark');
  await expect(rows.getByRole('button')).toHaveCount(3);
  await expect(list.getByText('URLでメモを追加')).toHaveCount(0);
  const emptyBox = await input.boundingBox();
  const emptyPadding = await input.evaluate(
    (element) => getComputedStyle(element).paddingInlineEnd,
  );
  await input.fill('旅行');
  await expect(clear).toBeVisible();
  await expect(input).toHaveCSS('padding-inline-end', emptyPadding);
  const filledBox = (await input.boundingBox())!;
  const clearBox = (await clear.boundingBox())!;
  expect(filledBox.width).toBe(emptyBox!.width);
  expect(clearBox.x).toBeGreaterThanOrEqual(filledBox.x);
  expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(
    filledBox.x + filledBox.width,
  );
  expect(clearBox.y).toBeGreaterThanOrEqual(filledBox.y);
  expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(
    filledBox.y + filledBox.height,
  );
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(rows.getByRole('button')).toHaveCount(3);
  await input.press('Enter');
  await expect(rows.getByRole('button')).toHaveCount(2);
  await expect(rows.locator('mark')).toHaveText(['旅行', '旅行']);
  await expect(rows.getByRole('button').first()).toContainText(
    '週末は旅行に行く',
  );
  await expect(list.getByRole('status')).toContainText('先頭50件');
  await expect(editor).toHaveText(titles[2]);
  await expect(editorMatches).toHaveCount(0);

  await rows.getByRole('button').first().click();
  await expect(editorMatches).toHaveText(['旅行', '旅行']);
  if ((await toggle.getAttribute('aria-expanded')) === 'true')
    await toggle.click();
  await expect(list).toBeHidden();
  await expect(editorMatches).toHaveCount(2);
  await editor.focus();
  await page.keyboard.insertText('と旅行の日程');
  await expect(editorMatches).toHaveCount(3);

  await toggle.click();
  await expect(rows.getByRole('button')).toHaveCount(2);
  await clear.click();
  await expect(input).toBeFocused();
  await expect(rows.getByRole('button')).toHaveCount(3);
  await expect(editorMatches).toHaveCount(0);
  await input.fill('旅行');
  await list.getByRole('button', { name: '検索', exact: true }).click();
  await rows.getByRole('button', { name: titles[1], exact: true }).click();
  await expect(editor).toHaveText(titles[1]);
  await expect(editorMatches).toHaveText(['旅行']);
});

test('writing persists, sharing works and direct unknown URLs do not create notes', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('書きかけのメモ');
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await page.reload();
  await expect(editor).toHaveText('書きかけのメモ');
  await page.getByRole('button', { name: '共有', exact: true }).click();
  const url = await page
    .getByRole('textbox', { name: 'メモのURL', exact: true })
    .inputValue();
  expect(url).toMatch(/\/[A-Za-z0-9_-]{22}$/);
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByRole('textbox', editorName)).toHaveText(
    '書きかけのメモ',
  );
  await other.close();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.goto('/' + randomBytes(16).toString('base64url'));
  await expect(
    page.getByText('メモが見つかりません', { exact: true }),
  ).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(
    page.getByRole('link', { name: 'anipopina.com', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'メモリスト', exact: true }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'メモリスト', exact: true })
      .getByRole('link', { name: 'anipopina.com', exact: true }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
});

test('unsaved offline input is recovered and synchronized on reconnection', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('before');
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await context.setOffline(true);
  await page.keyboard.insertText(' offline');
  await expect(page.getByRole('status').first()).toHaveText('通信待ち');
  await context.setOffline(false);
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await page.reload();
  await expect(editor).toHaveText('before offline');
});

test('remote edits merge with in-flight local input without resetting the caret', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('one\ntwo');
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await page.getByRole('button', { name: '共有', exact: true }).click();
  const url = await page
    .getByRole('textbox', { name: 'メモのURL', exact: true })
    .inputValue();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const other = await context.newPage();
  await other.goto(url);
  const remote = other.getByRole('textbox', editorName);
  await expect(remote).toHaveText(/one/);
  await remote.click();
  await other.keyboard.press('ControlOrMeta+End');
  await other.keyboard.insertText(' remote');
  await expect(other.getByRole('status').first()).toHaveText('保存済み');
  await page.bringToFront();
  await expect(editor).toContainText('remote', { timeout: 10000 });
  await other.close();
});

test('resident passkey login carries the note into an account and list removal preserves its URL', async ({
  page,
  browserName,
  context,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Virtual passkey authenticator requires Chromium CDP.',
  );
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('account memo');
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Passkeyの名前', exact: true })
    .fill('PC');
  await page
    .getByRole('button', { name: 'アカウントを作る', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
  const toggle = page.getByRole('button', { name: 'メモリスト', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(
    page.getByRole('button', { name: 'account memo', exact: true }),
  ).toBeVisible();
  const originalUrl = page.url();
  const remove = page.getByRole('button', {
    name: 'リストから削除',
    exact: true,
  });
  const memoList = page.getByRole('complementary', {
    name: 'メモリスト',
    exact: true,
  });
  await expect(
    memoList.getByRole('button', { name: 'リストから削除', exact: true }),
  ).toHaveCount(0);
  let attempts = 0;
  await page.route('**/api/list/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unavailable' }),
      });
    await route.continue();
  });
  await remove.click();
  const confirmation = page.getByRole('dialog', {
    name: 'リストから削除',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('account memo');
  await expect(confirmation).toContainText('再び開くにはこのメモのURLが必要');
  await expect(
    confirmation.getByRole('button', { name: 'キャンセル', exact: true }),
  ).toBeFocused();
  await confirmation
    .getByRole('button', { name: 'キャンセル', exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  expect(attempts).toBe(0);
  await expect(
    memoList.getByRole('button', { name: 'account memo', exact: true }),
  ).toBeVisible();
  await remove.click();
  await confirmation
    .getByRole('button', { name: '削除する', exact: true })
    .click();
  await expect(confirmation.getByRole('alert')).toHaveText(
    'リストから削除できませんでした。接続を確認してください。',
  );
  await expect(
    memoList.getByRole('button', { name: 'account memo', exact: true }),
  ).toHaveCount(1);
  await confirmation
    .getByRole('button', { name: '削除する', exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(
    memoList.getByRole('button', { name: 'account memo', exact: true }),
  ).toHaveCount(0);
  await expect(editor).toHaveText('account memo');
  expect(page.url()).toBe(originalUrl);
  const add = page.getByRole('button', { name: 'リストに追加', exact: true });
  await expect(add).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText('account memo');
  await expect(add).toBeVisible();
  await expect(
    memoList.getByRole('button', { name: 'account memo', exact: true }),
  ).toHaveCount(0);
  await add.click();
  await expect(remove).toBeVisible();
  await expect(
    memoList.getByRole('button', { name: 'account memo', exact: true }),
  ).toBeVisible();
  await remove.click();
  await confirmation
    .getByRole('button', { name: '削除する', exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(add).toBeVisible();
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'ログイン', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
  await expect(editor).toHaveText('');
  await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{22}$/);
});

test('typing during a delayed save survives its acknowledgement', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('base');
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let caught!: () => void;
  const waiting = new Promise<void>((resolve) => {
    caught = resolve;
  });
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'POST') {
      caught();
      await gate;
    }
    await route.continue();
  });
  await page.keyboard.insertText(' sent');
  await waiting;
  await page.keyboard.insertText(' later');
  release();
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await page.reload();
  await expect(editor).toHaveText('base sent later');
});

test('a closed tab draft is recovered once, without restoring it again after a later save', async ({
  page,
  context,
}) => {
  await page.goto('/');
  let editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('base');
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await page.route('**/api/**', (route) => route.abort());
  await page.keyboard.insertText(' unsaved');
  await expect(page.getByRole('status').first()).toHaveText('通信待ち');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  editor = reopened.getByRole('textbox', editorName);
  await expect(editor).toHaveText('base unsaved');
  await expect(reopened.getByRole('status').first()).toHaveText('保存済み');
  await editor.fill('replacement');
  await expect(editor).toHaveText('replacement');
  await expect(reopened.getByRole('status').first()).toHaveText('保存済み');
  await reopened.close();
  const again = await context.newPage();
  await again.goto('/');
  await expect(again.getByRole('textbox', editorName)).toHaveText(
    'replacement',
  );
});

test('list controls follow the caret and the link action sits beside the selected URL', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('- ');
  await page.keyboard.insertText('parent');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('child');
  const indent = page.getByRole('button', { name: '字下げ', exact: true });
  if (testInfo.project.use.hasTouch) {
    await expect(indent).toBeVisible();
    await expect(indent).toBeEnabled();
    await indent.tap();
  } else {
    await expect(indent).toBeHidden();
    await expect(
      page.getByRole('button', { name: '字上げ', exact: true }),
    ).toBeHidden();
    await page.keyboard.press('Tab');
  }
  await expect(editor).toBeFocused();
  await expect(editor.locator('.list-line').last()).toHaveAttribute(
    'data-list-depth',
    '1',
  );
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('https://example.com ');
  const url = editor.getByRole('link', {
    name: 'https://example.com',
    exact: true,
  });
  await expect(url).toBeVisible();
  await url.click();
  await expect(
    page.getByRole('link', { name: 'リンクを別タブで開く', exact: true }),
  ).toHaveAttribute('href', 'https://example.com');
});

test('known memo names survive delayed loading and empty memo confirmation uses the list title', async ({
  page,
}) => {
  const first = randomBytes(16).toString('base64url');
  const second = randomBytes(16).toString('base64url');
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { signedIn: true, account: 'title-test' } }),
  );
  await page.route('**/api/list', (route) =>
    route.fulfill({
      json: [
        { token: first, title: '最初のメモ', addedAt: 1 },
        { token: second, title: '既知のメモ名', addedAt: 2 },
      ],
    }),
  );
  await page.route(`**/api/notes/${first}`, (route) =>
    route.fulfill({ json: { content: '最初のメモ', version: 1 } }),
  );
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const requestedNote = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(`**/api/notes/${second}`, async (route) => {
    requested();
    await loaded;
    await route.fulfill({ json: { content: '', version: 1 } });
  });
  await page.goto(`/${first}`);
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toHaveText('最初のメモ');
  const toggle = page.getByRole('button', { name: 'メモリスト', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  const list = page.getByRole('complementary', {
    name: 'メモリスト',
    exact: true,
  });
  await list.getByRole('button', { name: '既知のメモ名', exact: true }).click();
  await requestedNote;
  try {
    await expect(
      list.getByRole('button', { name: '既知のメモ名', exact: true }),
    ).toBeVisible();
    await expect(
      list.getByRole('button', { name: '無題', exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText('');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(
    list.getByRole('button', { name: '無題', exact: true }),
  ).toBeVisible();
  if (
    (await page
      .getByRole('button', { name: 'リストを閉じる', exact: true })
      .count()) > 0 &&
    (await page.locator('.drawer-backdrop').isVisible())
  )
    await list
      .getByRole('button', { name: 'リストを閉じる', exact: true })
      .click();
  await page
    .getByRole('button', { name: 'リストから削除', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'リストから削除',
    exact: true,
  });
  await expect(confirmation.locator('.note-title')).toHaveText('無題');
});
