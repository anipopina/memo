import { expect, test } from '@playwright/test';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });

for (const side of ['top', 'bottom', 'left', 'right'] as const) {
  test(`${side} padding places the caret at the corresponding line boundary`, async ({
    page,
  }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
    await expect(editor).toBeVisible();
    await editor.fill('first\nmiddle\nlast');
    const point = await editor.evaluate((element, side) => {
      const wrapper = element.parentElement!.getBoundingClientRect();
      const lines = Array.from(element.children).map((line) =>
        line.getBoundingClientRect(),
      );
      const middle = lines[1]!;
      switch (side) {
        case 'top':
          return { x: wrapper.left + wrapper.width / 2, y: wrapper.top + 2 };
        case 'bottom':
          return {
            x: wrapper.left + wrapper.width / 2,
            y: lines[2]!.bottom + 8,
          };
        case 'left':
          return { x: wrapper.left + 2, y: middle.top + middle.height / 2 };
        case 'right':
          return { x: wrapper.right - 2, y: middle.top + middle.height / 2 };
      }
    }, side);
    await page.mouse.click(point.x, point.y);
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('X');
    const expected = {
      top: ['Xfirst', 'middle', 'last'],
      bottom: ['first', 'middle', 'lastX'],
      left: ['first', 'Xmiddle', 'last'],
      right: ['first', 'middleX', 'last'],
    };
    await expect(editor.locator('.memo-line')).toHaveText(expected[side]);
  });
}
