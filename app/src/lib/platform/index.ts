/**
 * Platform differences in one place. The same web build runs in a browser
 * (or installed PWA), inside Tauri on Linux, and inside Capacitor on Android.
 */
declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    __TAURI_INTERNALS__?: unknown;
  }
}

export type Platform = 'web' | 'tauri' | 'android';

export function platform(): Platform {
  if (typeof window === 'undefined') return 'web';
  if (window.__TAURI_INTERNALS__) return 'tauri';
  if (window.Capacitor?.isNativePlatform?.()) return 'android';
  return 'web';
}

export const isNative = () => platform() !== 'web';

/** Save a file the user can keep: download (web), save dialog (Linux), share sheet (Android). */
export async function saveFile(name: string, data: string | Uint8Array, mime: string): Promise<'saved' | 'cancelled'> {
  const p = platform();
  if (p === 'tauri') {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name });
    if (!path) return 'cancelled';
    if (typeof data === 'string') await writeTextFile(path, data);
    else await writeFile(path, data);
    return 'saved';
  }
  if (p === 'android') {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const res =
      typeof data === 'string'
        ? await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 })
        : await Filesystem.writeFile({ path: name, data: toBase64(data), directory: Directory.Cache });
    // Also keep a copy in Documents so there is always a local backup on the phone.
    try {
      if (typeof data === 'string') await Filesystem.writeFile({ path: `Tally/${name}`, data, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
      else await Filesystem.writeFile({ path: `Tally/${name}`, data: toBase64(data), directory: Directory.Documents, recursive: true });
    } catch {
      /* Documents may be unavailable on some Android versions */
    }
    await Share.share({ title: name, url: res.uri, dialogTitle: 'Save or send' });
    return 'saved';
  }
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Read a user-picked file as text. */
export function readFileText(file: File): Promise<string> {
  return file.text();
}
