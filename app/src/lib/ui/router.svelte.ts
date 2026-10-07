/**
 * Minimal hash router (#/path?query). Hash routing works identically in the
 * browser, the installed PWA, Tauri and Capacitor, with no server rewrites.
 */
import { untrack } from 'svelte';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const clean = '/' + path.split('/').filter(Boolean).join('/');
  return { path: clean, segments: clean.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

class Router {
  route = $state<Route>(parse());

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.route = parse();
        window.scrollTo({ top: 0 });
      });
    }
  }

  go(path: string, query?: Record<string, string | undefined> | URLSearchParams): void {
    let qs = '';
    if (query) {
      const p = query instanceof URLSearchParams ? query : new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '') as [string, string][]);
      qs = p.toString();
    }
    const target = '#' + path + (qs ? '?' + qs : '');
    if (location.hash !== target) location.hash = target;
  }

  /** Update query parameters without adding history entries. */
  replaceQuery(query: Record<string, string | undefined>): void {
    // Untracked: callers run this inside effects, and must not depend on the route they rewrite.
    const cur = untrack(() => this.route);
    const p = new URLSearchParams(cur.query);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === '') p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    if (qs === cur.query.toString()) return;
    history.replaceState(null, '', '#' + cur.path + (qs ? '?' + qs : ''));
    this.route = parse();
  }

  back(fallback = '/'): void {
    if (history.length > 1) history.back();
    else this.go(fallback);
  }
}

export const router = new Router();

export function href(path: string, query?: Record<string, string | undefined>): string {
  const p = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString() : '';
  return '#' + path + (p ? '?' + p : '');
}
