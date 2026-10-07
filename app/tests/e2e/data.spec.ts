import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { start } from './helpers';

const here = fileURLToPath(new URL('.', import.meta.url));

const dir = mkdtempSync(join(tmpdir(), 'tally-fixture-'));
const demo = join(dir, 'demo.json');
writeFileSync(demo, execFileSync('python3', [join(here, '../fixtures/make-demo.py')]));

test('restore a backup, see stats, export every format', async ({ page }) => {
  await start(page);
  await page.goto('/#/settings/data');
  await page.locator('input[type=file]').setInputFiles(demo);
  await page.getByRole('button', { name: 'Merge (keep newer of each)' }).click();
  await expect(page.getByText('Backup merged')).toBeVisible();

  await page.goto('/#/stats');
  await expect(page.getByText('Spending over time')).toBeVisible();
  await page.getByRole('button', { name: /Housing/ }).click();
  await expect(page).toHaveURL(/#\/history/);
  await expect(page.getByText('Rent').first()).toBeVisible();

  await page.goto('/#/settings/data');
  for (const [label, ext] of [['JSON', '.json'], ['CSV', '.csv'], ['SQLite', '.sqlite']] as const) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
  }
});

test('import a CIBC statement', async ({ page }) => {
  await start(page);
  await page.goto('/#/import');
  await page.locator('input[type=file]').setInputFiles(join(here, '../fixtures/cibc-credit.csv'));
  await expect(page.getByText('CIBC format detected')).toBeVisible();
  await page.getByRole('button', { name: 'Review rows' }).click();
  await expect(page.getByText('Card payment / transfer')).toBeVisible();
  await page.getByRole('button', { name: /^Import \d+/ }).click();
  await expect(page.getByText(/Imported 5 transactions/)).toBeVisible();
});

test('appearance: pick a style and colour, persists after reload', async ({ page }) => {
  await start(page);
  await page.goto('/#/settings/appearance');
  await page.getByRole('button', { name: /Forest/ }).click();
  await page.getByRole('button', { name: 'Use #d9468a' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'forest');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(accent).not.toBe('');
});
