/**
 * Vault keys and end-to-end encryption.
 *
 * From the vault passphrase we derive 64 bytes with PBKDF2-SHA256
 * (salt "tally-vault-v1:<vault>", 210 000 iterations):
 *   bytes  0–31  AES-256-GCM key  — never leaves the device
 *   bytes 32–63  access token     — sent to the server, which stores only its SHA-256
 * Knowing the token does not reveal the key, so the server can authenticate
 * devices without being able to read an encrypted vault.
 *
 * Encrypted payload: "v1:" + base64(nonce[12] || ciphertext+tag), with the
 * document id as associated data so ciphertexts can't be swapped between ids.
 * WebCrypto is used when available (fast); otherwise the audited pure-JS
 * @noble libraries (works on plain-http pages and old WebViews).
 */
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';
import { randomBytes } from '../core/ids';

export const KDF_ITERATIONS = 210_000;

export interface VaultKeys {
  /** Hex AES key, or null for an unencrypted vault. */
  key: string | null;
  /** Hex access token. */
  token: string;
}

export async function deriveVaultKeys(passphrase: string, vault: string, iterations = KDF_ITERATIONS): Promise<{ key: string; token: string }> {
  const salt = utf8ToBytes(`tally-vault-v1:${vault.toLowerCase()}`);
  const pass = utf8ToBytes(passphrase.normalize('NFC'));
  let bits: Uint8Array;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const base = await subtle.importKey('raw', pass as BufferSource, 'PBKDF2', false, ['deriveBits']);
    bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 512));
  } else {
    bits = await pbkdf2Async(sha256, pass, salt, { c: iterations, dkLen: 64, asyncTick: 20 });
  }
  return { key: bytesToHex(bits.slice(0, 32)), token: bytesToHex(bits.slice(32, 64)) };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encryptJSON(keyHex: string, id: string, value: unknown): string {
  const nonce = randomBytes(12);
  const ct = gcm(hexToBytes(keyHex), nonce, utf8ToBytes(id)).encrypt(utf8ToBytes(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce);
  out.set(ct, 12);
  return 'v1:' + toBase64(out);
}

export function decryptJSON<T = unknown>(keyHex: string, id: string, payload: string): T {
  if (!payload.startsWith('v1:')) throw new Error('Unknown encryption format');
  const raw = fromBase64(payload.slice(3));
  const pt = gcm(hexToBytes(keyHex), raw.subarray(0, 12), utf8ToBytes(id)).decrypt(raw.subarray(12));
  return JSON.parse(bytesToUtf8(pt)) as T;
}

/** Encrypt raw bytes (attachments): nonce[12] ‖ ciphertext+tag, with `blob:<id>` as associated data. */
export function encryptBytes(keyHex: string, id: string, data: Uint8Array): Uint8Array {
  const nonce = randomBytes(12);
  const ct = gcm(hexToBytes(keyHex), nonce, utf8ToBytes(`blob:${id}`)).encrypt(data);
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce);
  out.set(ct, 12);
  return out;
}

export function decryptBytes(keyHex: string, id: string, data: Uint8Array): Uint8Array {
  return gcm(hexToBytes(keyHex), data.subarray(0, 12), utf8ToBytes(`blob:${id}`)).decrypt(data.subarray(12));
}

/** Hash for PIN checks etc. (fast; PINs are a UI lock, see docs/security.md). */
export async function slowHash(secret: string, saltHex: string, iterations = 100_000): Promise<string> {
  const salt = hexToBytes(saltHex);
  const pass = utf8ToBytes(secret);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const base = await subtle.importKey('raw', pass as BufferSource, 'PBKDF2', false, ['deriveBits']);
    return bytesToHex(new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256)));
  }
  return bytesToHex(await pbkdf2Async(sha256, pass, salt, { c: iterations, dkLen: 32, asyncTick: 20 }));
}
