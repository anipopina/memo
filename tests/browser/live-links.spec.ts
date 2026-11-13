import { expect, test } from '@playwright/test';
test.use({ baseURL: `http://127.0.0.1:${process.env.MEMO_TEST_PORT}` });

test('links follow text edits immediately, without needing a space or blur', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  const source = page.getByRole('textbox', {
    name: '入力するMarkdown',
    exact: true,
  });
  await source.fill('');
  await page.getByRole('button', { name: '本文へ読み込む' }).click();
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true }),
    output = page.getByRole('textbox', {
      name: '出力されたMarkdown',
      exact: true,
    });
  await editor.focus();
  await page.keyboard.insertText('https://example.com');
  await expect(editor.getByRole('link')).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await page.keyboard.insertText('/path');
  await expect(editor.getByRole('link')).toHaveAttribute(
    'href',
    'https://example.com/path',
  );
  await page.keyboard.press('Backspace');
  await expect(editor.getByRole('link')).toHaveAttribute(
    'href',
    'https://example.com/pat',
  );
  await editor.fill('https://one.example/a https://two.example/b');
  await expect(editor.getByRole('link')).toHaveCount(2);
  await expect(editor.getByRole('link').nth(0)).toHaveAttribute(
    'href',
    'https://one.example/a',
  );
  await expect(editor.getByRole('link').nth(1)).toHaveAttribute(
    'href',
    'https://two.example/b',
  );
  await editor.fill('https://example.com');
  await page.clock.runFor(600);
  await editor.evaluate((dom) => {
    const range = document.createRange();
    range.setStart(dom.querySelector('a')!.firstChild!, 0);
    range.setEnd(dom.querySelector('a')!.firstChild!, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Backspace');
  await expect(editor.getByRole('link')).toHaveCount(0);
  await expect(output).toHaveValue('example.com');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.getByRole('link')).toHaveAttribute(
    'href',
    'https://example.com',
  );
});
