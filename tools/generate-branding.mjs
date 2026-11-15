import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const asset = (path) => new URL(path, root);
const publicAsset = (name) => asset(`apps/web/public/${name}`);
const favicon = await readFile(publicAsset('favicon.svg'), 'utf8');
const icon = await readFile(asset('assets/branding/icon.svg'), 'utf8');
const ogp = await readFile(asset('assets/branding/ogp.svg'), 'utf8');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svg, width, height, transparent = false) => {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
    );
    return page.screenshot({ omitBackground: transparent });
  };

  await writeFile(
    publicAsset('apple-touch-icon.png'),
    await render(icon, 180, 180),
  );
  for (const [size, name] of [
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
  ]) {
    await writeFile(publicAsset(name), await render(favicon, size, size, true));
  }
  await writeFile(publicAsset('ogp.png'), await render(ogp, 1200, 630));

  const sizes = [16, 32, 48];
  const images = [];
  for (const size of sizes) {
    images.push(await render(favicon, size, size, true));
  }

  // ICO directories point to embedded PNGs; preserve transparency around the folded paper.
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index];
    header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(
    publicAsset('favicon.ico'),
    Buffer.concat([header, ...images]),
  );
} finally {
  await browser.close();
}
