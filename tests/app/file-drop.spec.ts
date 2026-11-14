import { expect, test, type Page } from '@playwright/test';
import { MAX_NOTE_BYTES } from '../../packages/core/src/note';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });
const editorName = { name: 'メモ本文', exact: true };
async function drop(page: Page, files: { name: string; bytes: number[] }[]) {
  // File-backed DataTransfer is supported by both target browser engines.
  await page.evaluate((files) => {
    const transfer = new DataTransfer();
    for (const file of files)
      transfer.items.add(new File([new Uint8Array(file.bytes)], file.name));
    const target = document.querySelector('[role="textbox"]')!;
    target.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }),
    );
    target.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, files);
}
const file = (name: string, text: string) => ({
  name,
  bytes: Array.from(new TextEncoder().encode(text)),
});

test('file drop creates a separate persistent note and preserves the current input', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  const original = page.url();
  await editor.fill('元のメモ');
  await drop(page, [file('filename.md', '新しいメモ\n- 項目')]);
  await expect(page).not.toHaveURL(original);
  await expect(editor).toContainText('新しいメモ');
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await page.reload();
  await expect(editor).toContainText('新しいメモ');
  await expect(editor).not.toContainText('filename');
  await page.goto(original);
  await expect(editor).toHaveText('元のメモ');
});

test('invalid files do not switch or modify the note and dialogs block import', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await editor.fill('保持する本文');
  const original = page.url();
  const cases = [
    {
      files: [file('a.txt', 'a'), file('b.txt', 'b')],
      message: 'ファイルは1つずつ',
    },
    { files: [file('a.png', 'a')], message: '.txt または .md' },
    { files: [{ name: 'a.txt', bytes: [0xff, 0xfe, 0x82] }], message: 'UTF-8' },
    {
      files: [file('a.txt', 'a'.repeat(MAX_NOTE_BYTES + 1))],
      message: '大きすぎます',
    },
  ];
  for (const item of cases) {
    await drop(page, item.files);
    await expect(page.locator('.notice')).toContainText(item.message);
    await expect(page).toHaveURL(original);
    await expect(editor).toHaveText('保持する本文');
  }
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await drop(page, [file('a.txt', '取り込まない')]);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(original);
  await expect(editor).toHaveText('保持する本文');
});

test('failed upload retains an imported draft across reload and retries', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', editorName);
  await expect(editor).toBeVisible();
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'PUT') await route.abort();
    else await route.continue();
  });
  await drop(page, [file('a.txt', '通信失敗でも残る本文')]);
  await expect(page.locator('.notice')).toContainText('本文はこの端末に保持');
  await page.reload();
  await expect(editor).toHaveText('通信失敗でも残る本文');
  await page.unroute('**/api/notes/*');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
});

test('signed-in file import appears in the memo list', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Virtual authenticators require Chromium CDP.',
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
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
  await expect(page.getByRole('textbox', editorName)).toBeVisible();
  await page.getByRole('button', { name: 'アカウント', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Passkeyの名前', exact: true })
    .fill('PC');
  await page
    .getByRole('button', { name: 'アカウントを作る', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('status').first()).toHaveText('保存済み');
  await drop(page, [file('import.txt', 'リストに並ぶメモ')]);
  await expect(page.getByRole('textbox', editorName)).toHaveText(
    'リストに並ぶメモ',
  );
  const toggle = page.getByRole('button', { name: 'メモリスト', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await expect(
    page.getByRole('button', { name: 'リストに並ぶメモ', exact: true }),
  ).toBeVisible();
});

test('file drag shows the drop target and leaving clears it', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', editorName)).toBeVisible();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['preview'], 'preview.txt'));
    window.dispatchEvent(
      new DragEvent('dragenter', { dataTransfer: transfer }),
    );
  });
  await expect(page.locator('.file-drop-overlay')).toHaveText(
    'ドロップして新しいメモを作成',
  );
  await page.screenshot({ path: testInfo.outputPath('file-drop.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.file-drop-overlay')).toBeHidden();
});
