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
