/**
 * Tiny Vite plugin: after the build, inject the list of emitted files and a
 * build hash into dist/sw.js so the service worker can precache the app for
 * offline use and detect new versions.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  const files: string[] = [];
  return {
    name: 'tally-sw-manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    generateBundle(_opts, bundle) {
      for (const f of Object.keys(bundle)) {
        // Large on-demand chunks (SQLite export) are fetched when used, not precached.
        if (f.endsWith('.wasm') || f.includes('sql-wasm') || f.endsWith('.map')) continue;
        files.push(f);
      }
    },
    closeBundle() {
      const sw = join(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      const list = ['./', ...files.map((f) => `./${f}`), './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
      const hash = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync(sw, 'utf8')
        .replace('self.__PRECACHE__', JSON.stringify(list))
        .replace('self.__BUILD__', JSON.stringify(hash));
      writeFileSync(sw, src);
    },
  };
}
