export type WidgetSize = 'full' | 'half';

export interface WidgetInstance {
  /** Unique within the dashboard. */
  id: string;
  /** Widget type id from the registry. */
  type: string;
  size: WidgetSize;
  config: Record<string, unknown>;
}

export interface DashboardLayout {
  widgets: WidgetInstance[];
}

export const DEFAULT_DASHBOARD: DashboardLayout = {
  widgets: [
    { id: 'w-today', type: 'spendStat', size: 'half', config: { range: 'today' } },
    { id: 'w-week', type: 'spendStat', size: 'half', config: { range: 'thisWeek' } },
    { id: 'w-budgets', type: 'budgets', size: 'full', config: { budgetIds: [] } },
    { id: 'w-recent', type: 'recent', size: 'full', config: { count: 5 } },
  ],
};
