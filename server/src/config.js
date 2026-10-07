import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

/** All settings come from environment variables (see docs/self-hosting.md). */
export function loadConfig(env = process.env, overrides = {}) {
  return {
    host: env.TALLY_HOST || '0.0.0.0',
    port: int(env.TALLY_PORT, 8787),
    dataDir: resolve(env.TALLY_DATA_DIR || resolve(here, '../data')),
    staticDir: env.TALLY_STATIC_DIR === '' ? null : resolve(env.TALLY_STATIC_DIR || resolve(here, '../../app/dist')),
    /** If set, creating a vault requires this secret. */
    signupSecret: env.TALLY_SIGNUP_SECRET || '',
    /** Set to false to stop new vaults being created at all. */
    allowSignup: bool(env.TALLY_ALLOW_SIGNUP, true),
    corsOrigins: (env.TALLY_CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
    backup: {
      enabled: bool(env.TALLY_BACKUPS, true),
      keepDaily: int(env.TALLY_BACKUP_KEEP_DAILY, 14),
      keepWeekly: int(env.TALLY_BACKUP_KEEP_WEEKLY, 8),
      keepMonthly: int(env.TALLY_BACKUP_KEEP_MONTHLY, 24),
      /** Directory for snapshots; point Syncthing/Nextcloud at it for off-device copies. */
      dir: resolve(env.TALLY_BACKUP_DIR || resolve(env.TALLY_DATA_DIR || resolve(here, '../data'), 'backups')),
    },
    /** Keep data/exports/<vault>.json up to date for unencrypted vaults. */
    plainExport: bool(env.TALLY_PLAIN_EXPORT, true),
    maxBodyBytes: int(env.TALLY_MAX_BODY_MB, 25) * 1024 * 1024,
    /** Largest receipt file accepted. */
    maxBlobBytes: int(env.TALLY_MAX_FILE_MB, 20) * 1024 * 1024,
    ...overrides,
  };
}
