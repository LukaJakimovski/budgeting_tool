/**
 * Synced settings and first-run seed data.
 *
 * Seed documents use fixed ids and the lowest possible revision (SEED_REV), so
 * every device creates identical seeds and any real edit on any device wins.
 */
import { SEED_REV } from './hlc';
import type { DateFormat } from './dates';
import type { Category, PaymentMethod } from './types';
import { DEFAULT_APPEARANCE, type Appearance } from '../theme/types';
import { DEFAULT_DASHBOARD, type DashboardLayout } from '../modules/dashboard-types';

export interface SettingsMap {
  baseCurrency: string;
  /** Currencies offered in the entry form. */
  currencies: string[];
  /** Units of base currency per 1 unit of each other currency. */
  rates: Record<string, number>;
  weekStart: number;
  monthStartDay: number;
  dateFormat: DateFormat;
  appearance: Appearance;
  dashboard: DashboardLayout;
  /** Remind to back up after this many days (0 = never). */
  backupReminderDays: number;
  /** Enabled optional modules by id. */
  modules: Record<string, boolean>;
  onboarded: boolean;
}

export type SettingKey = keyof SettingsMap;

export const DEFAULT_SETTINGS: SettingsMap = {
  baseCurrency: 'CAD',
  currencies: ['CAD', 'EUR'],
  rates: { EUR: 1.5, USD: 1.37 },
  weekStart: 1,
  monthStartDay: 1,
  dateFormat: 'dmy',
  appearance: DEFAULT_APPEARANCE,
  dashboard: DEFAULT_DASHBOARD,
  backupReminderDays: 14,
  modules: {},
  onboarded: false,
};

const EPOCH = '2024-01-01T00:00:00.000Z';

type SeedCat = [id: string, name: string, icon: string, parent: string | null, kind?: 'expense' | 'income'];

const CATS: SeedCat[] = [
  ['cat_food', 'Food', '🍽️', null],
  ['cat_groceries', 'Groceries', '🛒', 'cat_food'],
  ['cat_eating_out', 'Eating out', '🍔', 'cat_food'],
  ['cat_coffee', 'Coffee', '☕', 'cat_food'],
  ['cat_treats', 'Sweet treats', '🍩', 'cat_food'],
  ['cat_transport', 'Transport', '🚌', null],
  ['cat_transit', 'Transit', '🚇', 'cat_transport'],
  ['cat_fuel', 'Fuel', '⛽', 'cat_transport'],
  ['cat_rides', 'Taxi & rideshare', '🚕', 'cat_transport'],
  ['cat_housing', 'Housing', '🏠', null],
  ['cat_rent', 'Rent', '🔑', 'cat_housing'],
  ['cat_utilities', 'Utilities', '💡', 'cat_housing'],
  ['cat_phone', 'Phone & internet', '📶', 'cat_housing'],
  ['cat_shopping', 'Shopping', '🛍️', null],
  ['cat_clothing', 'Clothing', '👕', 'cat_shopping'],
  ['cat_electronics', 'Electronics', '💻', 'cat_shopping'],
  ['cat_household', 'Household', '🧽', 'cat_shopping'],
  ['cat_fun', 'Entertainment', '🎮', null],
  ['cat_subscriptions', 'Subscriptions', '🔁', 'cat_fun'],
  ['cat_events', 'Events & outings', '🎟️', 'cat_fun'],
  ['cat_health', 'Health', '💊', null],
  ['cat_education', 'Education', '📚', null],
  ['cat_gifts', 'Gifts', '🎁', null],
  ['cat_travel', 'Travel', '✈️', null],
  ['cat_fees', 'Fees & charges', '🏦', null],
  ['cat_other', 'Other', '📦', null],
  ['cat_salary', 'Salary', '💼', null, 'income'],
  ['cat_other_income', 'Other income', '💰', null, 'income'],
];

export function seedCategories(): Category[] {
  let slot = 0;
  return CATS.map(([id, name, icon, parentId, kind], order) => ({
    id,
    type: 'category',
    rev: SEED_REV,
    createdAt: EPOCH,
    name,
    icon,
    parentId,
    color: parentId ? '' : `slot:${slot++ % 8}`,
    kind: kind ?? 'expense',
    order,
    archived: false,
  }));
}

export function seedPaymentMethods(): PaymentMethod[] {
  const rows: [string, string][] = [
    ['pm_credit', 'Credit card'],
    ['pm_debit', 'Debit card'],
    ['pm_cash', 'Cash'],
  ];
  return rows.map(([id, name], order) => ({
    id,
    type: 'paymentMethod',
    rev: SEED_REV,
    createdAt: EPOCH,
    name,
    defaultChannel: id === 'pm_cash' ? 'in_person' : null,
    order,
    archived: false,
  }));
}
