import { expect, test } from '@playwright/test';

test.use({ baseURL: `http://127.0.0.1:${process.env.MEMO_TEST_PORT}` });

test('opt-in IME tracing records event timing without text and freezes after stop', async ({
  page,
}) => {
  await page.goto('/');
  const secret = '診断に含めない文章';
  await page
    .getByRole('textbox', { name: '入力するMarkdown', exact: true })
    .fill(secret);
  await page.getByRole('button', { name: '本文へ読み込む' }).click();
  await page.getByText('IME入力の診断', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'IME診断結果' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'IME記録を開始' }).click();
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await editor.focus();
  await editor.dispatchEvent('compositionstart', { data: secret });
  await editor.dispatchEvent('compositionend', { data: secret });
  await page.getByRole('button', { name: 'IME記録を終了' }).click();
  const result = page.getByRole('textbox', { name: 'IME診断結果' });
  const report = await result.inputValue();
  expect(report).not.toContain(secret);
  const parsed = JSON.parse(report);
  expect(parsed.format).toBe(2);
  expect(report.split('\n')).toHaveLength(parsed.records.length + 2);
  expect(
    parsed.records.some(
      (item: { event: string }) => item.event === 'compositionend',
    ),
  ).toBe(true);
  for (const [event, composing] of [
    ['compositionstart', true],
    ['compositionend', false],
  ] as const) {
    expect(
      parsed.records.find(
        (item: { event: string; phase?: string }) =>
          item.event === event && item.phase === 'after',
      ),
    ).toMatchObject({ composing, domSelection: { focused: true } });
  }
  expect(
    parsed.records.some(
      (item: { event: string }) => item.event === 'compositionstart',
    ),
  ).toBe(true);
  await editor.dispatchEvent('input', { data: '記録終了後' });
  await expect(result).toHaveValue(report);
  await expect(
    page.getByRole('textbox', { name: '出力されたMarkdown', exact: true }),
  ).toHaveValue(secret);
});
