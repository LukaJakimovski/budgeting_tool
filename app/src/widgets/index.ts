/** Built-in widgets. Modules can add more with registerWidget(). */
import { registerWidget } from './registry';
import SpendStat from './SpendStat.svelte';
import BudgetsWidget from './BudgetsWidget.svelte';
import Recent from './Recent.svelte';
import Breakdown from './Breakdown.svelte';
import Trend from './Trend.svelte';
import HeatmapWidget from './HeatmapWidget.svelte';
import Pace from './Pace.svelte';
import QuickAdd from './QuickAdd.svelte';
import type { WidgetProps } from './registry';
import type { Component } from 'svelte';

const RANGES = ['today', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'last30', 'last90', 'thisYear'];
const c = (x: unknown) => x as Component<WidgetProps>;

registerWidget({
  type: 'spendStat',
  name: 'Total',
  description: 'Spent, income or net for a period, compared with last time.',
  icon: 'wallet',
  defaultSize: 'half',
  defaultConfig: { range: 'thisWeek', measure: 'spent' },
  fields: [
    { key: 'range', label: 'Period', kind: 'range', presets: RANGES },
    { key: 'measure', label: 'Show', kind: 'select', options: [['spent', 'Spent'], ['income', 'Income'], ['net', 'Net (income − spent)']] },
    { key: 'filter', label: 'Only count', kind: 'filter' },
    { key: 'label', label: 'Title', kind: 'text', placeholder: 'Automatic' },
  ],
  component: c(SpendStat),
});

registerWidget({
  type: 'budgets',
  name: 'Budgets',
  description: 'Progress bars for all or chosen budgets.',
  icon: 'target',
  defaultSize: 'full',
  defaultConfig: { budgetIds: [] },
  fields: [
    { key: 'budgetIds', label: 'Budgets (none selected = all)', kind: 'budgets' },
    { key: 'label', label: 'Title', kind: 'text', placeholder: 'Budgets' },
  ],
  component: c(BudgetsWidget),
});

registerWidget({
  type: 'recent',
  name: 'Recent transactions',
  description: 'The latest entries.',
  icon: 'list',
  defaultSize: 'full',
  defaultConfig: { count: 5 },
  fields: [{ key: 'count', label: 'How many', kind: 'number', min: 1, max: 30 }],
  component: c(Recent),
});

registerWidget({
  type: 'quickAdd',
  name: 'Quick add',
  description: 'One-tap buttons for your favourite merchants.',
  icon: 'plus',
  defaultSize: 'full',
  defaultConfig: { merchantIds: [], count: 6 },
  fields: [
    { key: 'merchantIds', label: 'Merchants (none = most used)', kind: 'merchants' },
    { key: 'count', label: 'How many (automatic mode)', kind: 'number', min: 1, max: 20 },
  ],
  component: c(QuickAdd),
});

registerWidget({
  type: 'breakdown',
  name: 'Breakdown',
  description: 'Top categories, merchants, tags… for a period.',
  icon: 'chart',
  defaultSize: 'half',
  defaultConfig: { range: 'thisMonth', dimension: 'category', limit: 6 },
  fields: [
    { key: 'range', label: 'Period', kind: 'range', presets: RANGES },
    {
      key: 'dimension',
      label: 'By',
      kind: 'select',
      options: [['category', 'Category'], ['subcategory', 'Subcategory'], ['merchant', 'Merchant'], ['tag', 'Tag'], ['payment', 'Payment method'], ['channel', 'Online / in person'], ['weekday', 'Weekday']],
    },
    { key: 'limit', label: 'Rows', kind: 'number', min: 3, max: 20 },
    { key: 'filter', label: 'Only count', kind: 'filter' },
  ],
  component: c(Breakdown),
});

registerWidget({
  type: 'trend',
  name: 'Spending chart',
  description: 'Spending per day, week or month.',
  icon: 'chart',
  defaultSize: 'full',
  defaultConfig: { range: 'last30' },
  fields: [{ key: 'range', label: 'Period', kind: 'range', presets: ['thisWeek', 'thisMonth', 'last30', 'last90', 'thisYear'] }],
  component: c(Trend),
});

registerWidget({
  type: 'pace',
  name: 'Pace',
  description: 'Cumulative spending this period vs the last one.',
  icon: 'sliders',
  defaultSize: 'full',
  defaultConfig: { range: 'thisMonth' },
  fields: [{ key: 'range', label: 'Period', kind: 'range', presets: ['thisWeek', 'thisMonth', 'thisYear'] }],
  component: c(Pace),
});

registerWidget({
  type: 'heatmap',
  name: 'Calendar heatmap',
  description: 'Which days you spend the most.',
  icon: 'calendar',
  defaultSize: 'full',
  defaultConfig: { weeks: 26 },
  fields: [{ key: 'weeks', label: 'Weeks', kind: 'number', min: 4, max: 53 }],
  component: c(HeatmapWidget),
});
