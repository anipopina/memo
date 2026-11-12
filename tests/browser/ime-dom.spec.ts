import { expect, test } from '@playwright/test';

test.use({ baseURL: `http://127.0.0.1:${process.env.MEMO_TEST_PORT}` });

for (const fixture of [
  {
    name: 'original marker and spacing',
    source: '003.  \nnext',
    row: 0,
    expected: '003.  あいうえお\nnext',
  },
  {
    name: 'rebuilt blank lines',
    source: '\n\nnext',
    row: 0,
    expected: 'あいうえお\n\nnext',
    rebuildAll: true,
  },
  {
    name: 'rebuilt adjacent lines',
    source: '\nnext',
    row: 0,
    expected: 'あいうえお\nnext',
    rebuildAll: true,
  },
  {
    name: 'empty first line',
    source: '\nnext',
    row: 0,
    expected: 'あいうえお\nnext',
  },
  {
    name: 'empty middle line',
    source: 'before\n\nnext',
    row: 1,
    expected: 'before\nあいうえお\nnext',
  },
  {
    name: 'bullet item',
    source: '- \nnext',
    row: 0,
    expected: '- あいうえお\nnext',
  },
  {
    name: 'ordered item',
    source: '1. \nnext',
    row: 0,
    expected: '1. あいうえお\nnext',
  },
  {
    name: 'nested item',
    source: '- parent\n    - \nnext',
    row: 1,
    expected: '- parent\n    - あいうえお\nnext',
  },
]) {
  test(`DOM reconstruction on composition commit preserves ${fixture.name}`, async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('textbox', { name: '入力するMarkdown', exact: true })
      .fill(fixture.source);
    await page.getByRole('button', { name: '本文へ読み込む' }).click();
    const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
    await editor.focus();
    // Replace the native DOM node to exercise ProseMirror's DOM parser, not insertText commands.
    // This models a browser reconstruction; it does not emulate an actual iPhone IME.
    await editor.evaluate(
      (element, { rowIndex, rebuildAll }) => {
        element.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true }),
        );
        if (rebuildAll) {
          const copy = element.cloneNode(true);
          element.replaceChildren(...copy.childNodes);
        }
        const line = element.children[rowIndex];
        const replacement = line.cloneNode(true) as HTMLElement;
        const text = document.createTextNode('あいうえお');
        replacement.replaceChildren(text);
        line.replaceWith(replacement);
        const range = document.createRange();
        range.setStart(text, text.length);
        range.collapse(true);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        element.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertCompositionText',
            data: 'あいうえお',
            isComposing: true,
          }),
        );
        element.dispatchEvent(
          new CompositionEvent('compositionend', {
            bubbles: true,
            data: 'あいうえお',
          }),
        );
      },
      {
        rowIndex: fixture.row,
        rebuildAll: 'rebuildAll' in fixture && fixture.rebuildAll,
      },
    );
    await expect(
      page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
    ).toHaveValue(fixture.expected);
    await expect(editor.locator('.memo-line')).toHaveCount(
      fixture.source.split('\n').length,
    );
  });
}

test('empty IME target blocks use normal flow', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: '入力するMarkdown', exact: true })
    .fill('\n- \n1. \nnext');
  await page.getByRole('button', { name: '本文へ読み込む' }).click();
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  // WebKit bug 321674 expands composition replacement to positioned empty blocks.
  // Check the trigger itself: synthetic composition events cannot invoke native WebKit IME replacement.
  for (const line of await editor.locator('.memo-line').all()) {
    await expect(line).toHaveCSS('position', 'static');
  }
});
