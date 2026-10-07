/**
 * Turning bank statement text into merchant names.
 *
 * CIBC chequing exports wrap the merchant in a channel, a transaction type and
 * a reference number:
 *   "Point of Sale - Interac RETAIL PURCHASE 531214272782 TIM HORTONS #53"
 *   "Point of Sale - Visa Debit VISA DEBIT PURCHASE 24lmvmsy0000 Lindt Canada"
 * Credit card exports are shorter but carry store numbers and the city:
 *   "TIM HORTONS #1234 TORONTO, ON"
 * All of these should become "Tim Hortons" / "Lindt Canada".
 */

const CHANNEL =
  /^(point of sale\s*-\s*(interac|visa debit|debit)|electronic funds transfer|internet banking|online banking|telephone banking|mobile banking|automated banking machine|branch transaction)\s+/i;

/** Transaction types that follow a CIBC channel. Longest phrases first. */
const TYPE =
  /^((intl\s+)?(visa\s+deb(it)?\s+)?(retail\s+)?(purchase|refund|return|correction)|pre-?authori[sz]ed\s+debit|internet\s+bill\s+pay(ment)?|bill\s+pay(ment)?|internet\s+transfer|(interac\s+)?e-?transfer|(send|receive|cancel)\s+e-?tfr|e-?tfr|payroll\s+deposit|deposit|atm\s+withdrawal|withdrawal|service\s+charge|network\s+transaction\s+fee|misc(ellaneous)?\s+payment|transfer|pay)(\s+|$)/i;

/** Types other banks put in front without a channel. */
const BARE_TYPE = /^(interac\s+)?(retail\s+purchase|e-?transfer|pre-?authori[sz]ed\s+debit)\s+/i;

/** A transaction reference: "531214272782", "24lmvmsy0000". */
function isReference(token: string): boolean {
  if (/^\d{4,}$/.test(token)) return true;
  return /^[a-z0-9]{8,}$/i.test(token) && (token.match(/\d/g)?.length ?? 0) >= 3;
}

export interface BankText {
  /** The transaction type, e.g. "RETAIL PURCHASE" ("" if none). */
  type: string;
  /** What's left: the merchant part, still with store numbers and city. */
  core: string;
}

/** Split off the channel, transaction type and reference numbers. */
export function parseBankText(raw: string): BankText {
  let s = raw.trim().replace(/\s+/g, (w) => (w.length > 1 ? '  ' : ' '));
  let type = '';
  const channel = s.match(CHANNEL);
  if (channel) s = s.slice(channel[0].length);
  const t = s.match(channel ? TYPE : BARE_TYPE);
  if (t) {
    type = t[0].trim();
    s = s.slice(t[0].length);
  }
  for (let m = s.match(/^(\S+)\s+(?=\S)/); m && isReference(m[1]); m = s.match(/^(\S+)\s+(?=\S)/)) s = s.slice(m[0].length);
  return { type, core: s.trim() };
}

/** "TIM HORTONS" → "Tim Hortons", "7-ELEVEN" → "7-Eleven"; text that already has lower case is left alone. */
function nameCase(s: string): string {
  if (/\p{Ll}/u.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-/(&]|(?<=(?:^|\s)\d+))(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Clean bank noise: "Point of Sale - Interac RETAIL PURCHASE 5312… TIM HORTONS #53" → "Tim Hortons". */
export function cleanDescriptor(raw: string): string {
  const { type, core } = parseBankText(raw);
  const steps: [RegExp, string][] = [
    [/\s{2,}.*$/, ''], // padded location column
    [/\s*[#*]\s*\w*\d\w*.*$/, ''], // store number / order reference and everything after it (the city)
    [/\s+(\d{3,}|(?=[a-z]*\d)[a-z\d]{6,})(\s.*)?$/i, ''], // "SPOTIFY P1234ABC", "PETRO-CANADA 12345 TORONTO"
    [/\b\d{6,}\b/g, ' '],
    [/\b(sq|tst|pp|sp|paypal)\s*\*\s*/gi, ' '], // payment processors
    [/\s*\*\s*/g, ' '], // "UBER* EATS"
    [/\s+/g, ' '],
    [/,?\s+(on|bc|ab|qc|mb|sk|ns|nb|nl|pe|yt|nt|nu)\s*$/i, ''], // province
    [/,\s*$/, ''],
    [/\s+\d+$/, ''],
  ];
  let s = core;
  for (const [re, by] of steps) {
    const next = s.replace(re, by).trim();
    if (next) s = next; // never clean a name away completely
  }
  // Drop a trailing city name when there are more than three words.
  const words = s.split(/\s+/);
  if (words.length > 3) s = words.slice(0, 3).join(' ');
  if (!s || isReference(s) || /^\d+$/.test(s)) s = type || raw.trim();
  return nameCase(s.trim());
}

/** Comparison key for merchant names: case, spaces and punctuation ignored. */
export function merchantKey(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Does this merchant name look like raw bank text rather than something a person typed? */
export function looksLikeBankText(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  const { type, core } = parseBankText(n);
  return !!type || core.replace(/\s+/g, ' ') !== n.replace(/\s+/g, ' ') || /[#*]\s*\w*\d/.test(n) || /\b\d{6,}\b/.test(n) || (!/\p{Ll}/u.test(n) && /\p{Lu}/u.test(n));
}

/** A whole bank line used as a name (channel, transaction type or reference number still in it). */
export function isRawBankLine(name: string): boolean {
  const { type, core } = parseBankText(name);
  return !!type || core.replace(/\s+/g, ' ') !== name.trim().replace(/\s+/g, ' ') || /\b\d{6,}\b/.test(name);
}

/** Key that puts "TIM HORTONS #53", "Point of Sale … TIM HORTONS #12" and "Tim Hortons" together. */
export function merchantGroupKey(name: string): string {
  return merchantKey(looksLikeBankText(name) ? cleanDescriptor(name) : name);
}

/** A useful bank alias: plain merchant text, not a channel/type phrase or a reference number. */
export function isUsefulAlias(alias: string): boolean {
  const a = alias.trim();
  if (a.length < 3) return false;
  const { type, core } = parseBankText(a);
  return !type && core.toLowerCase() === a.toLowerCase().replace(/\s+/g, ' ') && !isReference(a);
}
