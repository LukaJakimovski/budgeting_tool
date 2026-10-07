// Renders public/icon.svg to the PNG sizes needed by the PWA manifest, Tauri
// and Android. Run with: npm run icons  (needs Playwright's Chromium).
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8');
const out = (p) => {
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

const targets = [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  // Maskable: the platform crops to a circle/squircle, so keep the art inside the safe zone.
  { file: 'public/icon-maskable-512.png', size: 512, pad: 0.12, bg: '#3b72cc' },
  { file: '../desktop/src-tauri/icons/icon.png', size: 1024 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const t of targets) {
  const pad = (t.pad ?? 0) * t.size;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg ?? 'transparent'}">` +
      `<div style="width:${t.size}px;height:${t.size}px;display:grid;place-items:center">` +
      `<div style="width:${t.size - 2 * pad}px;height:${t.size - 2 * pad}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>` +
      `</div></body></html>`,
  );
  const png = await page.screenshot({ omitBackground: !t.bg, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  writeFileSync(out(join(root, t.file)), png);
  console.log('wrote', t.file);
}
await browser.close();
