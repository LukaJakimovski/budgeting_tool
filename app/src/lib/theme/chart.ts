/**
 * Chart colours. Categorical slots are a colour-vision-deficiency-checked
 * palette (validated for adjacent-pair separation in both modes); the order
 * matters, so assign slots in sequence and never cycle past eight — fold the
 * rest into "Other". Status colours are reserved for budget states and always
 * appear with an icon + label.
 */
import type { Mode } from './types';

export const CATEGORICAL: Record<Mode, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export const STATUS = {
  good: '#0ca30c',
  warn: '#fab219',
  serious: '#ec835a',
  bad: '#d03b3b',
};

export function slotColor(color: string | undefined, index: number, mode: Mode): string {
  if (color?.startsWith('slot:')) return CATEGORICAL[mode][Number(color.slice(5)) % 8];
  if (color && /^#[0-9a-f]{3,8}$/i.test(color)) return color;
  return CATEGORICAL[mode][index % 8];
}
