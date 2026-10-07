/**
 * Receipts and other attachments.
 *
 * Bytes live in the local `blobs` store (and on the sync server), metadata in
 * the transaction's `attachments` array. Photos are shrunk before storing —
 * a 4 MB phone photo becomes ~300–600 KB, still sharp enough to read a
 * receipt — so they sync quickly on slow connections. Other devices download
 * a receipt the first time it's opened.
 */
import { repo } from './db/repo.svelte';
import { sync } from './sync/sync.svelte';
import { newId } from './core/ids';
import type { Attachment, ID, Transaction } from './core/types';

export const MAX_STORED_BYTES = 15 * 1024 * 1024;
const MAX_LONG_SIDE = 2400;
const MAX_PIXELS = 4_500_000;
const JPEG_QUALITY = 0.82;

export const ACCEPT = 'image/*,application/pdf';

export interface PreparedFile {
  name: string;
  mime: string;
  data: Uint8Array;
  width?: number;
  height?: number;
}

async function decode(file: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { draw: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> (older WebViews) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** Shrink a photo to a sensible size as JPEG. */
export async function compressImage(file: Blob): Promise<{ data: Uint8Array; mime: string; width: number; height: number }> {
  const img = await decode(file);
  try {
    let scale = Math.min(1, MAX_LONG_SIDE / Math.max(img.width, img.height));
    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (img.width * img.height)));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.draw, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Could not process the image');
    // Keep the original when it's already a small JPEG (avoids recompressing twice).
    if (file.type === 'image/jpeg' && file.size <= blob.size && scale === 1) {
      return { data: new Uint8Array(await file.arrayBuffer()), mime: 'image/jpeg', width: w, height: h };
    }
    return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: w, height: h };
  } finally {
    img.close();
  }
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const name = file.name || 'receipt';
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    const img = await compressImage(file);
    return { name: name.replace(/\.(png|heic|heif|webp|gif|bmp|tiff?)$/i, '.jpg'), ...img };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    if (file.size > MAX_STORED_BYTES) throw new Error(`PDFs up to ${MAX_STORED_BYTES / 1024 / 1024} MB, please`);
    return { name, mime: 'application/pdf', data: new Uint8Array(await file.arrayBuffer()) };
  }
  throw new Error('Attach a photo or a PDF');
}

/** Store a picked file and return its metadata (not yet linked to a transaction). */
export async function addAttachment(file: File): Promise<Attachment> {
  const p = await prepareFile(file);
  const id = newId('att_');
  await repo.db.putBlob({ id, mime: p.mime, data: p.data }, true);
  void sync.refreshBlobPending();
  return { id, name: p.name, mime: p.mime, size: p.data.byteLength, width: p.width, height: p.height, addedAt: new Date().toISOString() };
}

/** The attachment's bytes as a Blob, downloading them from the sync server if needed. */
export async function loadAttachment(att: Attachment): Promise<Blob | null> {
  const local = await repo.db.getBlob(att.id);
  if (local) return new Blob([local.data as BlobPart], { type: local.mime || att.mime });
  if (!sync.config) return null;
  const data = await sync.downloadBlob(att.id);
  if (!data) return null;
  await repo.db.putBlob({ id: att.id, mime: att.mime, data }, false);
  return new Blob([data as BlobPart], { type: att.mime });
}

/** Forget attachments that were added in the editor but never saved. */
export async function discardAttachments(ids: ID[]): Promise<void> {
  for (const id of ids) await repo.db.deleteBlob(id, false);
  void sync.refreshBlobPending();
}

/** Delete attachments removed from a saved transaction (here and on the server). */
export async function removeAttachments(ids: ID[]): Promise<void> {
  for (const id of ids) await repo.db.deleteBlob(id, true);
  void sync.refreshBlobPending();
  sync.schedule(1000);
}

function referencedIds(): Set<ID> {
  const out = new Set<ID>();
  for (const t of repo.list('transaction') as Transaction[]) for (const a of t.attachments ?? []) out.add(a.id);
  return out;
}

/**
 * Delete receipt files no live transaction refers to (e.g. from deleted
 * transactions), on this device and on the server.
 */
export async function cleanupUnusedAttachments(): Promise<{ local: number; server: number }> {
  const used = referencedIds();
  let local = 0;
  for (const id of await repo.db.blobIds()) {
    if (!used.has(id)) {
      await repo.db.deleteBlob(id, false);
      local++;
    }
  }
  let server = 0;
  if (sync.config) {
    for (const id of await sync.listServerBlobs()) {
      if (!used.has(id)) {
        await repo.db.deleteBlob(id, true);
        server++;
      }
    }
    await sync.syncNow().catch(() => undefined);
  }
  return { local, server };
}

/** Download every receipt so they're available offline on this device. */
export async function downloadAllAttachments(onProgress?: (done: number, total: number) => void): Promise<number> {
  const all = (repo.list('transaction') as Transaction[]).flatMap((t) => t.attachments ?? []);
  const have = new Set(await repo.db.blobIds());
  const missing = all.filter((a) => !have.has(a.id));
  let n = 0;
  for (const a of missing) {
    if (await loadAttachment(a).catch(() => null)) n++;
    onProgress?.(n, missing.length);
  }
  return n;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function extensionFor(mime: string): string {
  return mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}
