/**
 * Dashboard widget registry.
 *
 * A widget = a Svelte component receiving `{ config, size }` + a definition
 * describing its defaults and which settings it exposes. Settings are declared
 * as simple fields, so the dashboard can render a config form for any widget
 * (including widgets added by optional modules via `registerWidget`).
 */
import type { Component } from 'svelte';
import type { IconName } from '$lib/ui/Icon.svelte';
import type { WidgetSize } from '$lib/modules/dashboard-types';

export type WidgetConfig = Record<string, unknown>;

export type ConfigField =
  | { key: string; label: string; kind: 'range'; presets?: string[] }
  | { key: string; label: string; kind: 'number'; min: number; max: number }
  | { key: string; label: string; kind: 'select'; options: [string, string][] }
  | { key: string; label: string; kind: 'budgets' }
  | { key: string; label: string; kind: 'merchants' }
  | { key: string; label: string; kind: 'filter' }
  | { key: string; label: string; kind: 'text'; placeholder?: string };

export interface WidgetProps {
  config: WidgetConfig;
  size: WidgetSize;
}

export interface WidgetDef {
  type: string;
  name: string;
  description: string;
  icon: IconName;
  defaultSize: WidgetSize;
  defaultConfig: WidgetConfig;
  fields: ConfigField[];
  component: Component<WidgetProps>;
  /** Optional module that provides it (shown in the picker). */
  module?: string;
}

const widgets = new Map<string, WidgetDef>();

export function registerWidget(def: WidgetDef): void {
  widgets.set(def.type, def);
}

export function getWidget(type: string): WidgetDef | undefined {
  return widgets.get(type);
}

export function allWidgets(): WidgetDef[] {
  return [...widgets.values()];
}
