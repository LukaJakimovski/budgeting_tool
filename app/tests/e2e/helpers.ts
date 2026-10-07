import { expect, type Page } from '@playwright/test';

export async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('button', { name: 'Customise' })).toBeVisible();
}

export async function addPurchase(page: Page, amount: string, merchant: string, category?: RegExp) {
  await page.getByRole('button', { name: /^New(?! budget)/ }).first().click();
  await page.getByLabel('Amount').fill(amount);
  const m = page.getByLabel(/Merchant|From/);
  await m.click();
  await m.fill(merchant);
  if (category) {
    await page.getByRole('heading', { name: /Category/ }).or(page.getByText('Category', { exact: true })).first().click();
    await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: category }).first().click();
  }
  await page.getByRole('button', { name: /Add purchase|Add refund|Add income/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
