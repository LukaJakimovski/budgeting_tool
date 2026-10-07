import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { repo } from '$lib/db/repo.svelte';
import { sync } from '$lib/sync/sync.svelte';
import { lock } from '$lib/lock.svelte';
import { applyAppearance } from '$lib/theme/apply';
import { runRecurring } from '$lib/actions';
import { emit } from '$lib/modules/events';
import { syncModules } from '$lib/modules/registry';
import { ui } from '$lib/ui/ui.svelte';
import { platform } from '$lib/platform';
import './widgets/index';

function fatal(message: string) {
  const el = document.getElementById('app')!;
  el.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:520px;margin:15vh auto;padding:24px;font-family:system-ui;line-height:1.5';
  const h = document.createElement('h1');
  h.textContent = 'Tally could not start';
  const p = document.createElement('p');
  p.textContent = message;
  box.append(h, p);
  el.appendChild(box);
}

async function registerServiceWorker() {
  if (platform() !== 'web' || !('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const watch = (w: ServiceWorker | null) =>
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) ui.updateReady = true;
      });
    if (reg.waiting && navigator.serviceWorker.controller) ui.updateReady = true;
    reg.addEventListener('updatefound', () => watch(reg.installing));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) {
        reloading = true;
        location.reload();
      }
    });
    setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
  } catch (err) {
    console.warn('[tally] service worker registration failed', err);
  }
}

async function start() {
  try {
    await repo.init();
  } catch (err) {
    fatal(
      `This browser won't let Tally store data (${(err as Error).message}). ` +
        'Private/incognito windows and some strict privacy settings block local storage. Open Tally in a normal window or use the app.',
    );
    return;
  }
  applyAppearance(repo.setting('appearance'));
  await Promise.all([sync.init(), lock.init()]);
  syncModules(repo.setting('modules'));
  runRecurring().catch((err) => console.error(err));
  setInterval(() => runRecurring().catch(() => undefined), 60 * 60 * 1000);
  document.documentElement.dataset.platform = platform();
  mount(App, { target: document.getElementById('app')! });
  registerServiceWorker();
  emit('app:ready', {});
}

start();
