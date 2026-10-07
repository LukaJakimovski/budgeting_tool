// Renders public/icon.svg into every PNG the platforms need:
//   PWA (public/), Tauri (../desktop/src-tauri/icons/icon.png → run `tauri icon` after),
//   Android launcher icons, adaptive icon foregrounds and splash screens.
// Run with: npm run icons   (uses Playwright's Chromium)
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8');
// Adaptive-icon foreground: just the tally marks; Android supplies the shape and background.
const marks = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g stroke="#fff" stroke-width="34" stroke-linecap="round"><path d="M158 140v232M222 140v232M286 140v232M350 140v232"/><path d="M112 330L398 182" stroke-width="30" opacity=".92"/></g></svg>`;
const BRAND_BG = '#3b72cc';
const SPLASH_BG = '#f5f6f8';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

async function render(file, { w, h = w, art = svg, artSize = Math.min(w, h), bg = 'transparent', round = false }) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<html><body style="margin:0;background:${bg}"><div style="width:${w}px;height:${h}px;display:grid;place-items:center">` +
      `<div style="width:${artSize}px;height:${artSize}px;${round ? 'border-radius:50%;overflow:hidden;' : ''}">${art.replace('<svg ', '<svg width="100%" height="100%" ')}</div>` +
      `</div></body></html>`,
  );
  const png = await page.screenshot({ omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: w, height: h } });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
}

await render(join(root, 'public/icon-192.png'), { w: 192 });
await render(join(root, 'public/icon-512.png'), { w: 512 });
await render(join(root, 'public/icon-maskable-512.png'), { w: 512, bg: BRAND_BG, art: marks, artSize: 400 });
await render(join(root, '../desktop/src-tauri/icons/icon.png'), { w: 1024 });

const res = join(root, 'android/app/src/main/res');
if (existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    await render(join(res, `mipmap-${d}/ic_launcher.png`), { w: 48 * k });
    await render(join(res, `mipmap-${d}/ic_launcher_round.png`), { w: 48 * k, art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="${BRAND_BG}"/>${marks.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>` });
    // 108dp canvas; keep the marks inside the 66dp safe zone.
    await render(join(res, `mipmap-${d}/ic_launcher_foreground.png`), { w: 108 * k, art: marks, artSize: 72 * k });
  }
  writeFileSync(join(res, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BRAND_BG}</color>\n</resources>\n`);
  const splash = {
    drawable: [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800],
    'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
  };
  for (const [dir, [w, h]] of Object.entries(splash)) {
    await render(join(res, `${dir}/splash.png`), { w, h, bg: SPLASH_BG, artSize: Math.round(Math.min(w, h) * 0.28) });
  }
}
await browser.close();
console.log('icons written');
