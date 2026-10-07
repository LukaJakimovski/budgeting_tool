import { test, expect } from '@playwright/test';
import { start } from './helpers';

test('keyboard-first entry on desktop', async ({ page }) => {
  await start(page);
  await page.keyboard.press('n');
  await expect(page.getByLabel('Amount')).toBeFocused();
  await page.keyboard.type('9.99');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Steam');
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'All' }).click();
  await page.getByPlaceholder('Search categories').fill('enter');
  await page.getByRole('option', { name: /Entertainment/ }).click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Saved $9.99 at Steam')).toBeVisible();
});

test('dashboard can be customised', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Customise' }).click();
  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('button', { name: /Calendar heatmap/ }).click();
  await page.getByRole('button', { name: 'Remove widget' }).first().click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByText('Daily spending · 26 weeks')).toBeVisible();
  await expect(page.getByText('Spent · Today')).toHaveCount(0);
});
