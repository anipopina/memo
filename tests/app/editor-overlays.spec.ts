import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';
import { randomBytes } from 'node:crypto';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });

for (const kind of ['list', 'link'] as const) {
  test(`${kind} action scrolls with its line before scroll events are delivered`, async ({
    page,
  }, testInfo) => {
    test.skip(kind === 'list' && !testInfo.project.use.hasTouch);
    const lines = Array.from({ length: 60 }, (_, index) =>
      kind === 'list' ? `- item ${index}` : `https://example.com/${index}`,
    );
    const token = randomBytes(16).toString('base64url');
    await page.route(`**/api/notes/${token}`, (route) =>
      route.fulfill({ json: { content: lines.join('\n'), version: 1 } }),
    );
    await page.goto('/' + token);
    const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
    await expect(editor.locator('.memo-line')).toHaveCount(lines.length);
    await editor.focus();
    await editor.evaluate((dom) => {
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      let position = 1;
      for (let index = 0; index < 10; index++)
        position += editor.state.doc.child(index).nodeSize;
      editor.commands.setTextSelection(position + 3);
      dom.closest('.document-scroll')!.scrollTop = 100;
    });
    const action =
      kind === 'list'
        ? page.getByRole('group', { name: 'リストの階層', exact: true })
        : page.getByRole('link', {
            name: 'リンクを別タブで開く',
            exact: true,
          });
    await expect(action).toBeVisible();
    const line = editor.locator('.memo-line').nth(10);
    const initialLine = (await line.boundingBox())!;
    const initialAction = (await action.boundingBox())!;
    const gap = initialAction.y - initialLine.y;
    const immediate = await action.evaluate((element) => {
      const scroller = document.querySelector('.document-scroll')!;
      const line = scroller.querySelectorAll('.memo-line')[10]!;
      const before = element.getBoundingClientRect().top;
      scroller.scrollTop += 80;
      // Read in the same task: native scrolling must keep them aligned even
      // before JavaScript receives the asynchronous scroll notification.
      return {
        movement: element.getBoundingClientRect().top - before,
        gap:
          element.getBoundingClientRect().top -
          line.getBoundingClientRect().top,
      };
    });
    expect(immediate.movement).toBeCloseTo(-80, 0);
    expect(immediate.gap).toBeCloseTo(gap, 0);
    await expect
      .poll(async () => {
        const actionBox = (await action.boundingBox())!;
        const lineBox = (await line.boundingBox())!;
        return Math.abs(actionBox.y - lineBox.y - gap);
      })
      .toBeLessThan(1);
    await expect(editor).toBeFocused();
    await page.locator('.document-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(action).toBeHidden();
  });
}
