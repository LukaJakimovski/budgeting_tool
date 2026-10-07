import type { CurrencyCode, Minor } from './types';

/** Common currencies offered in pickers. Any ISO 4217 code works. */
export const COMMON_CURRENCIES: CurrencyCode[] = [
  'CAD', 'EUR', 'USD', 'GBP', 'AUD', 'CHF', 'JPY', 'MKD', 'MXN', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'INR', 'CNY', 'KRW',
];

const digitCache = new Map<string, number>();

/** Number of minor-unit digits (2 for CAD, 0 for JPY). */
export function currencyDigits(code: CurrencyCode): number {
  let d = digitCache.get(code);
  if (d === undefined) {
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    } catch {
      d = 2;
    }
    digitCache.set(code, d);
  }
  return d;
}

/**
 * Parse a user-typed amount ("12", "12.5", "12,50", "$1,234.56") into minor
 * units. Returns null when nothing sensible can be read.
 */
export function parseAmount(input: string, currency: CurrencyCode): Minor | null {
  let s = input.trim().replace(/[^\d.,\-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (!/\d/.test(s)) return null;
  const digits = currencyDigits(currency);
  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  let intPart = s;
  let fracPart = '';
  if (dots && commas) {
    // Both present: whichever comes last is the decimal separator.
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const at = s.lastIndexOf(dec);
    intPart = s.slice(0, at).replace(/[.,]/g, '');
    fracPart = s.slice(at + 1);
  } else if (dots + commas === 1) {
    const at = s.search(/[.,]/);
    const tail = s.slice(at + 1);
    if (tail.length === 3 && digits < 3 && at > 0 && s[0] !== '0') {
      intPart = s.replace(/[.,]/g, ''); // "1,234" → thousands separator
    } else {
      intPart = s.slice(0, at);
      fracPart = tail;
    }
  } else if (dots + commas > 1) {
    intPart = s.replace(/[.,]/g, ''); // "1,234,567"
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  const frac = (fracPart + '0'.repeat(digits)).slice(0, digits);
  const dropped = fracPart.length > digits ? Number(fracPart[digits]) : 0;
  let value = Number(intPart || '0') * 10 ** digits + Number(frac || '0');
  if (dropped >= 5) value += 1;
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** Minor units → decimal number (for display maths and exports only). */
export function toMajor(amount: Minor, currency: CurrencyCode): number {
  return amount / 10 ** currencyDigits(currency);
}

/** Decimal string without currency symbol, e.g. "12.50". */
export function toDecimalString(amount: Minor, currency: CurrencyCode): string {
  const digits = currencyDigits(currency);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (digits === 0) return sign + String(abs);
  const s = String(abs).padStart(digits + 1, '0');
  return `${sign}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

const fmtCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: Minor, currency: CurrencyCode, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const key = `${currency}|${opts.compact ? 1 : 0}|${opts.sign ? 1 : 0}`;
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        notation: opts.compact ? 'compact' : 'standard',
        maximumFractionDigits: opts.compact ? 1 : undefined,
        signDisplay: opts.sign ? 'exceptZero' : 'auto',
      });
    } catch {
      f = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    fmtCache.set(key, f);
  }
  return f.format(toMajor(amount, currency));
}

/**
 * Convert between currencies using `rate` = units of `to` per one unit of `from`.
 */
export function convert(amount: Minor, from: CurrencyCode, to: CurrencyCode, rate: number): Minor {
  if (from === to) return amount;
  const major = toMajor(amount, from) * rate;
  return Math.round(major * 10 ** currencyDigits(to));
}

/** Split `total` proportionally to `parts` so the results sum exactly to `total`. */
export function allocateProportional(total: Minor, parts: Minor[]): Minor[] {
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum === 0) return parts.map((_, i) => (i === 0 ? total : 0));
  const out = parts.map((p) => Math.floor((total * p) / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  // Hand out the remainder to the largest parts first.
  const order = parts.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}
