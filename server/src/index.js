#!/usr/bin/env node
/**
 * Tally sync server.
 *
 *   tally-server serve                 start the server (default)
 *   tally-server vaults                list vaults
 *   tally-server backup [vault]        write a snapshot now (all vaults if omitted)
 *   tally-server export <vault> [file] write the current documents as JSON (unencrypted vaults)
 *
 * Configuration is via environment variables — see docs/self-hosting.md.
 */
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Backups } from './backup.js';
import { createServer, VERSION } from './http.js';

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  error: (...a) => console.error(new Date().toISOString(), ...a),
};

export function start(config = loadConfig()) {
  const store = new Store(config.dataDir).loadAll();
  const backups = new Backups(config, store, log);
  const server = createServer({ config, store, backups, log });
  backups.start();
  const shutdown = () => {
    log.info('[server] shutting down');
    server.close();
    backups.stop();
    store.closeAll();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      log.info(`[server] Tally sync server ${VERSION} on http://${config.host}:${config.port}`);
      log.info(`[server] data: ${config.dataDir}`);
      log.info(`[server] web app: ${config.staticDir && fs.existsSync(config.staticDir) ? config.staticDir : '(not built — API only)'}`);
      log.info(`[server] vaults: ${store.vaults.size}; signup: ${!config.allowSignup ? 'closed' : config.signupSecret ? 'needs secret' : 'open'}`);
      resolve({ server, store, backups });
    });
  });
}

async function main(argv) {
  const [cmd = 'serve', ...args] = argv;
  const config = loadConfig();
  switch (cmd) {
    case 'serve':
      await start(config);
      break;
    case 'vaults': {
      const store = new Store(config.dataDir).loadAll();
      for (const v of store.vaults.values()) {
        const i = v.info();
        console.log(`${i.vault}\tdocs=${i.docs}\tseq=${i.seq}\tencrypted=${i.encrypted}\tcreated=${i.createdAt}`);
      }
      store.closeAll();
      break;
    }
    case 'backup': {
      const store = new Store(config.dataDir).loadAll();
      const backups = new Backups(config, store, log);
      const names = args[0] ? [args[0]] : [...store.vaults.keys()];
      for (const n of names) console.log(backups.snapshot(n, { manual: true }) ?? `no vault ${n}`);
      store.closeAll();
      break;
    }
    case 'export': {
      const store = new Store(config.dataDir).loadAll();
      const backups = new Backups({ ...config, plainExport: true }, store, log);
      const v = store.get(args[0] ?? '');
      if (!v) {
        console.error('Usage: tally-server export <vault> [file]');
        process.exitCode = 1;
      } else if (v.meta.encrypted) {
        console.error('This vault is end-to-end encrypted; export it from the app instead.');
        process.exitCode = 1;
      } else {
        const file = backups.writeExport(v.name);
        if (args[1]) fs.copyFileSync(file, args[1]);
        console.log(args[1] ?? file);
      }
      store.closeAll();
      break;
    }
    case '--version':
    case 'version':
      console.log(VERSION);
      break;
    default:
      console.log('Usage: tally-server [serve|vaults|backup [vault]|export <vault> [file]|version]');
      process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/tally-server')) {
  main(process.argv.slice(2)).catch((err) => {
    log.error(err);
    process.exit(1);
  });
}
