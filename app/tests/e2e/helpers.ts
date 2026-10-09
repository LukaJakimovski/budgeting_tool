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

/** Wait until a document is stored in IndexedDB (the UI updates before the write lands; a reload in between loses it). */
export async function waitForStored(page: Page, id: string, check: (doc: any) => boolean) {
  await expect
    .poll(async () =>
      check(
        await page.evaluate(
          (id) =>
          new Promise((resolve) => {
            const open = indexedDB.open('tally');
            open.onsuccess = () => {
              const get = open.result.transaction('docs').objectStore('docs').get(id);
              get.onsuccess = () => (open.result.close(), resolve(get.result ?? null));
              get.onerror = () => resolve(null);
            };
            open.onerror = () => resolve(null);
          }),
          id,
        ),
      ),
    )
    .toBe(true);
}
