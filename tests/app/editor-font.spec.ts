import { expect, test } from '@playwright/test';

test.use({ baseURL: `http://localhost:${process.env.MEMO_APP_PORT}` });

test('bundled editor font loads and keeps Japanese and ASCII at a 2:1 width ratio', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'メモ本文', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill(
    'あいうえお\n0123456789\n漢字とABC123\n"引用符" 0O 1Il [] {}',
  );
  const metrics = await editor.evaluate(async (element) => {
    const fontSize = getComputedStyle(element).fontSize;
    const fonts = await document.fonts.load(
      `${fontSize} "UDEV Gothic HS"`,
      'あA"',
    );
    await document.fonts.ready;
    const style = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.cssText = `position: fixed; visibility: hidden; white-space: pre; font-family: ${style.fontFamily}; font-size: ${style.fontSize}; font-weight: ${style.fontWeight}; font-variant-ligatures: ${style.fontVariantLigatures}; text-rendering: ${style.textRendering}`;
    document.body.append(probe);
    const width = (text: string) => {
      probe.textContent = text;
      return probe.getBoundingClientRect().width;
    };
    const japanese = width('あいうえお');
    const ascii = width('0123456789');
    const quote = width('"');
    const letter = width('A');
    probe.remove();
    return {
      loaded:
        fonts.length > 0 && fonts.every((font) => font.status === 'loaded'),
      family: style.fontFamily,
      size: style.fontSize,
      japanese,
      ascii,
      quote,
      letter,
    };
  });
  expect(metrics.loaded).toBe(true);
  expect(metrics.size).toBe(testInfo.project.use.hasTouch ? '16px' : '15px');
  expect(metrics.family).toContain('UDEV Gothic HS');
  expect(metrics.japanese).toBeCloseTo(metrics.ascii, 2);
  expect(metrics.quote).toBeCloseTo(metrics.letter, 2);
  await page.screenshot({ path: testInfo.outputPath('editor-font.png') });
});
