import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';
test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });

test('arrow navigation shows the URL action at both endpoints and hides it outside', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill('x https://a.co y https://b.co z');
  // Seed only the starting position through the public command. All URL entry/exit
  // assertions below use real arrow events, without relying on mobile Home/End support.
  const moveToEdge = async (edge: 'start' | 'end') => {
    await editor.evaluate((dom, edge) => {
      const value = (dom as HTMLElement & { editor: Editor }).editor;
      value.commands.setTextSelection(
        edge === 'start' ? 1 : value.state.doc.content.size - 1,
      );
    }, edge);
  };

  const action = page.getByRole('link', {
    name: 'リンクを別タブで開く',
    exact: true,
  });
  await moveToEdge('start');
  await page.keyboard.press('ArrowRight');
  await expect(action).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(action).toHaveAttribute('href', 'https://a.co');
  await page.keyboard.press('ArrowRight');
  await expect(action).toHaveAttribute('href', 'https://a.co');
  await moveToEdge('end');
  await expect(action).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(action).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await page.keyboard.press('ArrowLeft');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await page.keyboard.press('ArrowRight');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await page.keyboard.press('ArrowRight');
  await expect(action).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await editor.fill('https://b.co');
  await moveToEdge('end');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await page.keyboard.press('Enter');
  await expect(action).toBeHidden();
  await page.keyboard.press('ArrowUp');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await page.keyboard.press('ArrowDown');
  await expect(action).toBeHidden();
  await page.keyboard.press('ArrowUp');
  await expect(action).toHaveAttribute('href', 'https://b.co');
  await context.route('https://b.co', (route) =>
    route.fulfill({ body: 'opened', contentType: 'text/html' }),
  );
  const opened = page.waitForEvent('popup');
  await action.click();
  const popup = await opened;
  await expect(popup).toHaveURL('https://b.co');
  await popup.close();
});
