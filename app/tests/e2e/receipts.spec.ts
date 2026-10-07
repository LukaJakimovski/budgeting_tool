import { test, expect, type Page } from '@playwright/test';
import { start } from './helpers';

async function addWithReceipt(page: Page, png: Buffer) {
  await page.getByRole('button', { name: /^New(?! budget)/ }).first().click();
  await page.getByLabel('Amount').fill('23.40');
  await page.getByLabel('Merchant').fill('Corner Store');
  await page.getByText('Category', { exact: true }).click();
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Groceries/ }).click();
  // The footer camera button opens this input (capture="environment" → camera on phones).
  await page.locator('input[type=file][capture]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Open receipt.jpg' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open receipt.jpg' }).locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Add purchase' }).click();
  await expect(page.getByText(/Saved \$23\.40/)).toBeVisible();
}

test('attach a receipt photo, see it again later', async ({ page }) => {
  await start(page);
  const png = await page.screenshot(); // any real image will do
  await addWithReceipt(page, png);

  await page.goto('/#/history');
  await expect(page.getByRole('img', { name: 'has receipt' })).toBeVisible();
  await page.getByRole('button', { name: /Corner Store/ }).first().click();
  await page.getByRole('button', { name: 'Open receipt.jpg' }).click();
  const viewer = page.getByRole('dialog', { name: 'receipt.jpg' });
  await expect(viewer.locator('img')).toBeVisible();
  await expect(viewer.getByText(/KB · \d+×\d+/)).toBeVisible();
  await viewer.getByRole('button', { name: 'Done' }).click();

  // Removing it and saving deletes it
  await page.getByRole('button', { name: 'Remove receipt.jpg' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('img', { name: 'has receipt' })).toHaveCount(0);
});
