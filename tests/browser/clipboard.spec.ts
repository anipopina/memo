import { expect, test, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';
test.use({ baseURL: `http://127.0.0.1:${process.env.MEMO_TEST_PORT}` });
const name = { name: 'メモ本文', exact: true };
const output = { name: '出力されたMarkdown', exact: true };
async function load(page: Page, source: string, from: number, to = from) {
  await page
    .getByRole('textbox', { name: '入力するMarkdown', exact: true })
    .fill(source);
  await page
    .getByRole('button', { name: '本文へ読み込む', exact: true })
    .click();
  await page.getByRole('textbox', name).evaluate(
    (dom, { from, to }) => {
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      editor.view.focus();
      editor.commands.setTextSelection({ from, to });
    },
    { from, to },
  );
}
async function paste(page: Page, text: string) {
  await page.getByRole('textbox', name).evaluate((dom, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    data.setData('text/html', '<p>ignore this rich text</p>');
    dom.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}
test('paste joins the caret edges, replaces selections and remains one undo step', async ({
  page,
}) => {
  await page.goto('/');
  await load(page, 'abcd', 3);
  await paste(page, 'X');
  await expect(page.getByRole('textbox', output)).toHaveValue('abXcd');
  await page.keyboard.insertText('!');
  await expect(page.getByRole('textbox', output)).toHaveValue('abX!cd');
  await load(page, 'abcd', 2, 4);
  await paste(page, 'X\n\nY\n');
  await expect(page.getByRole('textbox', output)).toHaveValue('aX\n\nY\nd');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('textbox', output)).toHaveValue('abcd');
  await page.getByRole('textbox', name).evaluate((dom) => {
    (dom as HTMLElement & { editor: Editor }).editor.commands.selectAll();
  });
  await paste(page, 'new\ntext');
  await expect(page.getByRole('textbox', output)).toHaveValue('new\ntext');
  await load(page, '', 1);
  await paste(page, '- one\n    - two\n2. three');
  await expect(page.getByRole('textbox', output)).toHaveValue(
    '- one\n    - two\n2. three',
  );
});
test('copy and cut preserve single newlines, blank lines and list markers', async ({
  page,
}) => {
  await page.goto('/');
  for (const source of ['a\nb', 'a\n\nb\n', '\n\n', '- a\n    - b\n2. c']) {
    await load(page, source, 1);
    const copied = await page.getByRole('textbox', name).evaluate((dom) => {
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      editor.commands.selectAll();
      const data = new DataTransfer();
      dom.dispatchEvent(
        new ClipboardEvent('copy', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      return data.getData('text/plain');
    });
    expect(copied).toBe(source);
    await load(page, 'beforeafter', 7);
    await paste(page, copied);
    await expect(page.getByRole('textbox', output)).toHaveValue(
      'before' + source + 'after',
    );
  }
  await load(page, 'a\nb', 1, 5);
  const cut = await page.getByRole('textbox', name).evaluate((dom) => {
    const data = new DataTransfer();
    dom.dispatchEvent(
      new ClipboardEvent('cut', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return data.getData('text/plain');
  });
  expect(cut).toBe('a\nb');
  await expect(page.getByRole('textbox', output)).toHaveValue('');
});
