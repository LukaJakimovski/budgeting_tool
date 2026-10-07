import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { addPurchase, start } from './helpers';

const here = fileURLToPath(new URL('.', import.meta.url));

test('History: select several, delete, undo, recategorise', async ({ page }) => {
  await start(page);
  await addPurchase(page, '1', 'Kiosk A', /Groceries/);
  await addPurchase(page, '2', 'Kiosk B', /Groceries/);
  await addPurchase(page, '3', 'Kiosk C', /Groceries/);
  await page.goto('/#/history');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /Kiosk A/ }).click();
  await page.getByRole('checkbox', { name: /Kiosk B/ }).click();
  await expect(page.getByText('2 selected')).toBeVisible();

  // Delete asks once more, then can be undone
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete 2?' }).click();
  await expect(page.getByText('Deleted 2 transactions')).toBeVisible();
  await expect(page.locator('.day-total').first()).toHaveText('$3.00');
  await page.getByRole('status').filter({ hasText: 'Deleted 2 transactions' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.day-total').first()).toHaveText('$6.00');

  await page.getByRole('button', { name: 'Select all 3' }).click();
  await page.getByRole('button', { name: 'Category' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('[aria-expanded]').first().click();
  await sheet.getByRole('option', { name: /Household/ }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Changed the category of 3 transactions')).toBeVisible();
  await expect(page.getByText(/Household/)).toHaveCount(3);
});

test('Merchants: tidy up duplicates made from bank text, then select and merge', async ({ page }) => {
  await start(page);
  await addPurchase(page, '2', 'TIM HORTONS #53', /Coffee/);
  await addPurchase(page, '3', 'TIM HORTONS #1207', /Coffee/);
  await addPurchase(page, '4', 'Starbucks', /Coffee/);
  await addPurchase(page, '5', 'Second Cup', /Coffee/);
  // In History, "same merchant" finds both Tim Hortons lines although they're separate merchants
  await page.goto('/#/history');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /TIM HORTONS #53/ }).click();
  await page.getByRole('button', { name: '+ Same merchant' }).click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /TIM HORTONS #1207/ })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/#/settings/merchants');
  await expect(page.getByText('1 merchant could be tidied')).toBeVisible();
  await page.getByRole('button', { name: 'Tidy up' }).click();
  await expect(page.getByLabel('Name after tidying')).toHaveValue('Tim Hortons');
  await page.getByRole('button', { name: 'Tidy 1' }).click();
  await expect(page.getByText(/Tidied 1 merchant/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Tim Hortons/ })).toContainText('2');

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /Starbucks/ }).click();
  await page.getByRole('checkbox', { name: /Second Cup/ }).click();
  await page.getByRole('button', { name: 'Merge…' }).click();
  await page.getByLabel('Merged merchant name').fill('Coffee shops');
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText(/Merged 2 merchants into Coffee shops/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Coffee shops/ })).toContainText('2');
});

test('Import: CIBC chequing names, then re-import to update', async ({ page }) => {
  await start(page);
  const file = join(here, '../fixtures/cibc-chequing.csv');
  await page.goto('/#/import');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: /Review rows/ }).click();
  // One name for the three Tim Hortons lines, edited once
  await expect(page.getByText('×3')).toHaveCount(3);
  await page.getByLabel('New merchant name').first().fill('Tims');
  await expect(page.getByLabel('New merchant name').nth(2)).toHaveValue('Tims');
  await page.getByRole('button', { name: /^Import 7/ }).click();
  await expect(page.getByText(/Imported 7 transactions/)).toBeVisible();

  await page.goto('/#/import');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: /Review rows/ }).click();
  await expect(page.getByText(/7 rows were imported before/)).toBeVisible();
  await page.getByRole('button', { name: 'Update all 7' }).click();
  await expect(page.getByText('Already imported · will update it').first()).toBeVisible();
  await page.getByRole('button', { name: 'Select none' }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: /^Update 7/ }).click();
  await expect(page.getByText('Updated 7 imported before')).toBeVisible();
  await page.goto('/#/settings/merchants');
  await expect(page.getByRole('button', { name: /^Tims/ })).toContainText('3');
});
