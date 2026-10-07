/**
 * Identifiers: time-sortable, 128-bit, URL-safe (ULID-style, Crockford base32).
 * Uses crypto.getRandomValues, which (unlike crypto.randomUUID) also works on
 * plain-http pages.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function newId(prefix = ''): string {
  let ms = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[ms % 32] + time;
    ms = Math.floor(ms / 32);
  }
  const bytes = randomBytes(10);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b & 31];
  for (let i = 0; i < 6; i++) rand += ALPHABET[bytes[i] >> 5];
  return prefix + time + rand;
}

export function randomHex(bytes: number): string {
  return Array.from(randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
