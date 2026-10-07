import { test, expect } from '@playwright/test';
import { addPurchase, start } from './helpers';

test('log purchases; merchant defaults make the second one two fields', async ({ page }) => {
  await start(page);
  await addPurchase(page, '4.75', 'Tim Hortons', /Coffee/);
  await expect(page.getByText('Saved $4.75 at Tim Hortons')).toBeVisible();

  // Second time: amount + pick the suggestion → category comes from the merchant.
  await page.getByRole('button', { name: /^New(?! budget)/ }).first().click();
  await page.getByLabel('Amount').fill('3.20');
  await page.getByLabel('Merchant').click();
  await page.keyboard.type('tim');
  await page.getByRole('option', { name: /Tim Hortons/ }).click();
  await expect(page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Coffee/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved $3.20 at Tim Hortons')).toBeVisible();

  await page.goto('/#/history');
  await expect(page.getByText('Today ·')).toBeVisible();
  await expect(page.locator('.day-total').first()).toHaveText('$7.95');
});

test('validation, split purchase and undo', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /^New(?! budget)/ }).first().click();
  await page.getByRole('button', { name: 'Add purchase' }).click();
  await expect(page.getByText('Enter an amount')).toBeVisible();
  await page.getByLabel('Amount').fill('20');
  await page.getByLabel('Merchant').fill('Corner Store');
  await page.getByRole('button', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Split across categories' }).click();
  await page.getByLabel('Split 1 amount').fill('15');
  await page.getByLabel('Split 1 category').selectOption({ label: '🛒 Groceries' });
  await page.getByLabel('Split 2 amount').fill('5');
  await page.getByLabel('Split 2 category').selectOption({ label: '🍩 Sweet treats' });
  await expect(page.getByText('Balanced ✓')).toBeVisible();
  await page.getByRole('button', { name: 'Add purchase' }).click();
  await expect(page.getByText('Saved $20.00 at Corner Store')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.goto('/#/history');
  await expect(page.getByText('No transactions here.')).toBeVisible();
});

test('budget feedback after saving', async ({ page }) => {
  await start(page);
  await page.goto('/#/budgets');
  await page.getByRole('button', { name: 'New budget' }).click();
  await page.getByRole('option', { name: /Sweet treats/ }).click();
  await page.getByLabel('Limit amount').fill('10');
  await page.getByRole('button', { name: 'Save' }).click();
  await addPurchase(page, '8.50', 'Bakery', /Sweet treats/);
  await expect(page.getByText(/Sweet treats: \$1\.50 left/)).toBeVisible();
  await page.goto('/#/budgets');
  await expect(page.getByText('Close to limit')).toBeVisible();
});

test('budget on a category that leaves out a tag', async ({ page }) => {
  await start(page);
  await page.goto('/#/budgets');
  await page.getByRole('button', { name: 'New budget' }).click();
  await page.getByRole('option', { name: /^Food/ }).click();
  await page.getByRole('group', { name: 'Filter sections' }).getByRole('button', { name: /^Tags/ }).click();
  await page.getByRole('button', { name: 'Exclude' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible(); // no tags yet
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Tag a work lunch (creating the tag), then build the budget.
  await page.getByRole('button', { name: /^New(?! budget)/ }).first().click();
  await page.getByLabel('Amount').fill('20');
  await page.getByLabel('Merchant').fill('Deli');
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Eating out/ }).click();
  await page.getByRole('button', { name: 'Details' }).click();
  await page.getByLabel('Add a tag').fill('work');
  await page.getByLabel('Add a tag').press('Enter');
  await page.getByRole('button', { name: 'Add purchase' }).click();
  await expect(page.getByText('Saved $20.00 at Deli')).toBeVisible();

  await page.goto('/#/budgets');
  await page.getByRole('button', { name: 'New budget' }).click();
  await page.getByRole('option', { name: /^Food/ }).click();
  await page.getByRole('group', { name: 'Filter sections' }).getByRole('button', { name: /^Tags/ }).click();
  await page.getByRole('button', { name: 'Exclude' }).click();
  await page.getByRole('option', { name: '#work' }).click();
  await expect(page.getByRole('button', { name: 'Exclude (1)' })).toBeVisible();
  await page.getByLabel('Limit amount').fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^\$50\.00 left/)).toBeVisible(); // the work lunch doesn't count

  await addPurchase(page, '8', 'Grocer', /Groceries/);
  await expect(page.getByText(/Food: \$42\.00 left/)).toBeVisible();

  // Merging #work into another tag keeps it excluded.
  await page.goto('/#/settings/tags');
  await page.getByPlaceholder(/New tag/).fill('office');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: /^#work/ }).click();
  await page.getByLabel('Merge into another tag').selectOption({ label: '#office' });
  await page.getByRole('button', { name: 'Merge' }).click();
  await page.goto('/#/budgets');
  await page.getByRole('button', { name: /^🍽️ Food/ }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('group', { name: 'Filter sections' }).getByRole('button', { name: /^Tags/ }).click();
  await expect(page.getByRole('button', { name: 'Exclude (1)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('option', { name: '#office' })).toHaveAttribute('aria-selected', 'true');
});
