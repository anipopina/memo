import { expect, test } from '@playwright/test';

test.use({ baseURL: `http://127.0.0.1:${process.env.MEMO_TEST_PORT}` });

test('indent buttons move descendants without blurring or moving the caret', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const source = '2. parent\n3. child\n    1. grandchild\nplain';
  await page
    .getByRole('textbox', { name: '入力するMarkdown', exact: true })
    .fill(source);
  await page.getByRole('button', { name: '本文へ読み込む' }).click();
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  const indent = page.getByRole('button', { name: '字下げ', exact: true });
  const outdent = page.getByRole('button', { name: '字上げ', exact: true });
  await editor.focus();
  await editor.evaluate((dom) => {
    window.getSelection()!.collapse(dom.children[1].firstChild!, 2);
    (dom as HTMLElement).dataset.blurCount = '0';
    dom.addEventListener('blur', () => {
      const element = dom as HTMLElement;
      element.dataset.blurCount = String(Number(element.dataset.blurCount) + 1);
    });
  });
  await expect(indent).toBeEnabled();
  await expect(outdent).toBeDisabled();
  if (testInfo.project.use.hasTouch) await indent.tap();
  else await indent.click();
  await expect(output).toHaveValue(
    '2. parent\n    1. child\n        1. grandchild\nplain',
  );
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute('data-blur-count', '0');
  expect(await editor.evaluate(() => window.getSelection()!.anchorOffset)).toBe(
    2,
  );
  await expect(outdent).toBeEnabled();
  if (testInfo.project.use.hasTouch) await outdent.tap();
  else await outdent.click();
  await expect(output).toHaveValue(source);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute('data-blur-count', '0');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue(
    '2. parent\n    1. child\n        1. grandchild\nplain',
  );
});

test('indent buttons follow selection and disable during composition', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: '入力するMarkdown', exact: true })
    .fill('plain\n- first\n- second');
  await page.getByRole('button', { name: '本文へ読み込む' }).click();
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const indent = page.getByRole('button', { name: '字下げ', exact: true });
  const outdent = page.getByRole('button', { name: '字上げ', exact: true });
  await editor.focus();
  await expect(indent).toBeDisabled();
  await expect(outdent).toBeDisabled();
  await editor.locator('.bullet').first().click();
  await expect(indent).toBeDisabled();
  await expect(outdent).toBeDisabled();
  await editor.locator('.bullet').last().click();
  await expect(indent).toBeEnabled();
  await editor.dispatchEvent('compositionstart');
  await expect(indent).toBeDisabled();
  await expect(outdent).toBeDisabled();
  await editor.dispatchEvent('compositionend');
  await expect(indent).toBeEnabled();
});
