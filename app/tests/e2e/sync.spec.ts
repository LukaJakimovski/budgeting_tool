import { test, expect } from '@playwright/test';
import { addPurchase, start } from './helpers';

test('two devices stay in sync through the server (encrypted vault)', async ({ browser }) => {
  const phone = await (await browser.newContext()).newPage();
  const laptop = await (await browser.newContext()).newPage();

  await start(phone);
  await addPurchase(phone, '12.00', 'Sushi Place', /Eating out/);
  await phone.goto('/#/settings/sync');
  await phone.getByRole('button', { name: 'Create new vault' }).click();
  await phone.getByLabel('Vault name').fill('e2e');
  await phone.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
  await phone.getByLabel('Repeat passphrase').fill('correct horse battery');
  await phone.getByRole('button', { name: 'Create vault & sync' }).click();
  await expect(phone.getByText('Connected to “e2e”')).toBeVisible();

  await start(laptop);
  await laptop.goto('/#/settings/sync');
  await laptop.getByLabel('Vault name').fill('e2e');
  await laptop.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
  await laptop.getByRole('button', { name: 'Connect & sync' }).click();
  await expect(laptop.getByText('end-to-end encrypted')).toBeVisible();
  await laptop.goto('/#/history');
  await expect(laptop.getByText('Sushi Place')).toBeVisible();

  // Laptop adds one; phone sees it after syncing.
  await addPurchase(laptop, '3.00', 'TTC', /Transit/);
  await expect(laptop.getByRole('link', { name: /Synced/ })).toBeVisible({ timeout: 10_000 });
  await phone.goto('/#/settings/sync');
  await phone.getByRole('button', { name: 'Sync now' }).click();
  await phone.goto('/#/history');
  await expect(phone.getByText('TTC')).toBeVisible();
});

test('a receipt added on the phone opens on the laptop', async ({ browser }) => {
  const phone = await (await browser.newContext()).newPage();
  const laptop = await (await browser.newContext()).newPage();
  for (const [p, create] of [[phone, true], [laptop, false]] as const) {
    await start(p);
    await p.goto('/#/settings/sync');
    if (create) await p.getByRole('button', { name: 'Create new vault' }).click();
    await p.getByLabel('Vault name').fill('receipts');
    await p.getByLabel('Passphrase', { exact: true }).fill('receipt passphrase');
    if (create) await p.getByLabel('Repeat passphrase').fill('receipt passphrase');
    await p.getByRole('button', { name: create ? 'Create vault & sync' : 'Connect & sync' }).click();
    await expect(p.getByText('Connected to “receipts”')).toBeVisible();
  }
  const png = await phone.screenshot();
  await phone.getByRole('button', { name: /^New(?! budget)/ }).first().click();
  await phone.getByLabel('Amount').fill('9.99');
  await phone.getByLabel('Merchant').fill('Pharmacy');
  await phone.getByText('Category', { exact: true }).click();
  await phone.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'All' }).click();
  await phone.getByRole('option', { name: /Health/ }).click();
  await phone.locator('input[type=file][capture]').setInputFiles({ name: 'rx.png', mimeType: 'image/png', buffer: png });
  await expect(phone.getByRole('button', { name: 'Open rx.jpg' })).toBeVisible();
  await phone.getByRole('button', { name: 'Add purchase' }).click();
  await expect(phone.getByRole('link', { name: /Synced/ })).toBeVisible({ timeout: 15_000 });

  await laptop.goto('/#/settings/sync');
  await laptop.getByRole('button', { name: 'Sync now' }).click();
  await laptop.goto('/#/history');
  await laptop.getByText('Pharmacy').click();
  await laptop.getByRole('button', { name: 'Open rx.jpg' }).click();
  await expect(laptop.getByRole('dialog', { name: 'rx.jpg' }).locator('img')).toBeVisible();
});
