import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });
const editorName = { name: 'メモ本文', exact: true };

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
    page.getByRole('link', { name: 'anipopina.com' }),
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
  const toggle = page.getByRole('button', { name: 'メモ一覧', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(
    page.getByRole('button', { name: 'account memo', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '一覧から外す', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'account memo', exact: true }),
  ).toHaveCount(0);
  await expect(editor).toHaveText('account memo');
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
  await expect(indent).toBeEnabled();
  if (testInfo.project.use.hasTouch) await indent.tap();
  else await indent.click();
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
