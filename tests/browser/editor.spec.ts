import { expect, test, type Locator } from '@playwright/test';
import type { Editor } from '@tiptap/core';

// The webServer captures its ephemeral port before the test worker starts.
test.use({ baseURL: `http://127.0.0.1:${process.env.MEMO_TEST_PORT}` });

async function load(page: import('@playwright/test').Page, source: string) {
  await page
    .getByRole('textbox', { name: '入力するMarkdown', exact: true })
    .fill(source);
  await page.getByRole('button', { name: '本文へ読み込む' }).click();
}

// Browsers may deliver selectionchange after the click/keyboard event has completed.
async function settleSelection(element: Locator) {
  await expect
    .poll(() =>
      element.evaluate((dom) => {
        const editor = (dom as HTMLElement & { editor: Editor }).editor;
        const selection = window.getSelection();
        if (
          !selection?.anchorNode ||
          !selection.focusNode ||
          !dom.contains(selection.anchorNode) ||
          !dom.contains(selection.focusNode)
        )
          return false;
        return (
          editor.state.selection.anchor ===
            editor.view.posAtDOM(
              selection.anchorNode,
              selection.anchorOffset,
            ) &&
          editor.state.selection.head ===
            editor.view.posAtDOM(selection.focusNode, selection.focusOffset)
        );
      }),
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('source survives the real editor schema, including mixed newlines and unknown syntax', async ({
  page,
}) => {
  for (const source of [
    '',
    '\n\n',
    '- a\n- \n',
    '# title\r\n\r\n**bold**  \n<!-- keep -->\n',
    '<script>alert(1)</script>\nhttps://example.com\n',
  ]) {
    await load(page, source);
    await expect(page.getByTestId('roundtrip')).toHaveText('原文と一致');
  }
  await expect(
    page
      .getByRole('textbox', { name: 'メモ本文', exact: true })
      .locator('script'),
  ).toHaveCount(0);
});

test('bullet conversion, continuation, exit, backspace, and undo', async ({
  page,
}) => {
  await load(page, '');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.click();
  await page.keyboard.type('- item');
  await expect(editor.locator('.bullet')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  await expect(output).toHaveValue('- item\n- next');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue('- item\n- next\n');
  await load(page, '- item');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Home');
  await settleSelection(editor);
  await page.keyboard.press('Backspace');
  await expect(output).toHaveValue('item');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue('- item');
});

test('plain-text paste preserves Markdown instead of interpreting HTML', async ({
  page,
}) => {
  await load(page, '');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.click();
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', '# hello\n\n- item\n<script>bad()</script>');
    data.setData('text/html', '<b>wrong</b>');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('# hello\n\n- item\n<script>bad()</script>');
});

test('URL links preserve source and require an explicit open action', async ({
  page,
}) => {
  await load(page, 'https://example.com/path?q=1');
  await page
    .getByRole('textbox', { name: 'メモ本文', exact: true })
    .getByRole('link')
    .click();
  await expect(
    page.getByRole('link', { name: 'リンクを別タブで開く' }),
  ).toHaveAttribute('href', 'https://example.com/path?q=1');
  await expect(page.getByTestId('roundtrip')).toHaveText('原文と一致');
});

test('composition delays output; synthetic events do not replace real IME validation', async ({
  page,
}) => {
  await load(page, '');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.click();
  await editor.dispatchEvent('compositionstart');
  await page.keyboard.insertText('日本語');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('');
  await editor.dispatchEvent('compositionend');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('日本語');
});

test('remote change maps the caret and keeps local undo separate', async ({
  page,
}) => {
  await load(page, 'hello\nworld');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await page
    .getByText('他端末の変更とカーソル維持を確認', { exact: true })
    .click();
  await page
    .getByRole('textbox', { name: '他端末の本文', exact: true })
    .fill('hello\nWORLD');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ArrowRight');
  // Programmatic activation retains the editor selection just like background sync.
  await page
    .getByRole('button', { name: '他端末の変更を反映', exact: true })
    .evaluate((element: HTMLButtonElement) => element.click());
  await page.keyboard.insertText('X');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('hXello\nWORLD');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('hello\nWORLD');
});

test('bullet and link input works without physical keydown events', async ({
  page,
}) => {
  await load(page, '');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.click();
  await page.keyboard.insertText('- ');
  await expect(editor.locator('.bullet')).toHaveCount(1);
  await page.keyboard.insertText('https://example.com ');
  await expect(editor.getByRole('link')).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('- https://example.com ');
});

test('Tab and Shift+Tab move list items and their descendants together', async ({
  page,
}) => {
  await load(page, '- parent\n- child\n    - grandchild\n- next');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.locator('.memo-line').nth(1).click();
  await settleSelection(editor);
  await page.keyboard.press('Tab');
  await expect(output).toHaveValue(
    '- parent\n    - child\n        - grandchild\n- next',
  );
  await expect(editor.locator('.memo-line').nth(1)).toHaveCSS(
    'padding-left',
    /\d+(\.\d+)?px/,
  );
  await page.keyboard.press('Shift+Tab');
  await expect(output).toHaveValue(
    '- parent\n- child\n    - grandchild\n- next',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue(
    '- parent\n    - child\n        - grandchild\n- next',
  );
});

test('numbered list input, nested continuation, lift, exit, undo and redo', async ({
  page,
}) => {
  await load(page, '');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.click();
  await page.keyboard.insertText('1. ');
  await expect(editor.locator('.ordered')).toHaveAttribute('data-marker', '1.');
  await page.keyboard.insertText('parent');
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue('1. parent\n2. ');
  await settleSelection(editor);
  await page.keyboard.insertText('child');
  await expect(output).toHaveValue('1. parent\n2. child');
  await page.keyboard.press('Tab');
  await expect(output).toHaveValue('1. parent\n    1. child');
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue('1. parent\n    1. child\n    2. ');
  await settleSelection(editor);
  await page.keyboard.insertText('next child');
  await expect(output).toHaveValue(
    '1. parent\n    1. child\n    2. next child',
  );
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue(
    '1. parent\n    1. child\n    2. next child\n    3. ',
  );
  await settleSelection(editor);
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue(
    '1. parent\n    1. child\n    2. next child\n2. ',
  );
  await settleSelection(editor);
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue(
    '1. parent\n    1. child\n    2. next child\n',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue(
    '1. parent\n    1. child\n    2. next child\n2. ',
  );
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(output).toHaveValue(
    '1. parent\n    1. child\n    2. next child\n',
  );
});

test('Backspace lifts nested lists before removing the marker', async ({
  page,
}) => {
  await load(page, '1. parent\n    - child');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.locator('.memo-line').nth(1).click();
  await settleSelection(editor);
  await page.keyboard.press('ControlOrMeta+End');
  await settleSelection(editor);
  await page.keyboard.press('Home');
  await settleSelection(editor);
  await page.keyboard.press('Backspace');
  await expect(output).toHaveValue('1. parent\n- child');
  await page.keyboard.press('Backspace');
  await expect(output).toHaveValue('1. parent\nchild');
});

test('ordinary Tab navigates focus and an orphan item is not indented', async ({
  page,
}) => {
  await load(page, '- first');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.click();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('- first');
  await expect(editor).toBeFocused();
  await load(page, 'ordinary paragraph');
  await editor.click();
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
});

test('selected sibling lists are renumbered under their new parent', async ({
  page,
}) => {
  await load(page, '7. parent\n9. one\n12. two');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('ControlOrMeta+Shift+End');
  await settleSelection(editor);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('7. parent\n    1. one\n    2. two');
});

test('nested lists display independent numbering and depth-specific bullet markers', async ({
  page,
}) => {
  const source =
    '1. あいうえお\n    1. あいうえお\n    2. かきくけこ\n2. かきくけこ\n    1. あいうえお\n\n- あいうえお\n    - かきくけこ\n        - さしすせそ\n            - たちつてと\n                - なにぬねの';
  await load(page, source);
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await expect(editor.locator('.ordered').first()).toHaveAttribute(
    'data-marker',
    '1.',
  );
  const numbers = await editor
    .locator('.ordered')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-marker')),
    );
  expect(numbers).toEqual(['1.', '1.', '2.', '2.', '1.']);
  const bullets = await editor
    .locator('.bullet')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-marker')),
    );
  expect(bullets).toEqual(['•', '◦', '▪', '▪', '▪']);
  // Verify the marker's actual CSS, not just its diagnostic data attribute.
  const styles = await editor
    .locator('.list-line')
    .evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).listStyleType),
    );
  expect(styles).toEqual(
    [...numbers, ...bullets].map((marker) => JSON.stringify(`${marker} `)),
  );
  await expect(page.getByTestId('roundtrip')).toHaveText('原文と一致');
});

test('inserting an ordered item updates later sibling numbers and Undo restores them', async ({
  page,
}) => {
  await load(page, '1. first\n2. second');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.locator('.memo-line').first().click();
  await settleSelection(editor);
  await page.keyboard.press('End');
  await settleSelection(editor);
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue('1. first\n2. \n3. second');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue('1. first\n2. second');
});

test('renumbering a moved item preserves unrelated Markdown and can be undone', async ({
  page,
}) => {
  const source = '007.  untouched\n\n9. parent\n10. child';
  await load(page, source);
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.locator('.memo-line').last().click();
  await settleSelection(editor);
  await page.keyboard.press('Tab');
  await expect(output).toHaveValue(
    '007.  untouched\n\n9. parent\n    1. child',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(output).toHaveValue('007.  untouched\n\n9. parent\n10. child');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue(
    '007.  untouched\n\n9. parent\n    1. child',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue(source);
});

test('adding a normal paragraph beside a list does not rewrite its source numbering', async ({
  page,
}) => {
  await load(page, 'intro\n009.  untouched');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.locator('.memo-line').first().click();
  await settleSelection(editor);
  await page.keyboard.press('End');
  await settleSelection(editor);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue('intro\n\n009.  untouched');
});

test('a typed root start number survives continuation, nesting, lifting and undo', async ({
  page,
}) => {
  await load(page, '');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  const output = page.getByRole('textbox', {
    name: '出力されたMarkdown',
    exact: true,
  });
  await editor.click();
  await page.keyboard.insertText('2. ');
  await expect(output).toHaveValue('2. ');
  await expect(editor.locator('.ordered')).toHaveCSS(
    'list-style-type',
    '"2. "',
  );
  await page.keyboard.insertText('parent');
  await page.keyboard.press('Enter');
  await expect(output).toHaveValue('2. parent\n3. ');
  await settleSelection(editor);
  await page.keyboard.insertText('child');
  await page.keyboard.press('Tab');
  await expect(output).toHaveValue('2. parent\n    1. child');
  await page.keyboard.press('Shift+Tab');
  await expect(output).toHaveValue('2. parent\n3. child');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(output).toHaveValue('2. parent\n    1. child');
});
