/**
 * HTTP layer: the sync API under /api/v1 and static hosting of the web app.
 * Protocol reference: docs/sync-protocol.md
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
export const VERSION = pkg.version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.wasm']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; object-src 'self' blob:; font-src 'self' data:; connect-src 'self' https: http:; worker-src 'self'; " +
  "manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Tiny per-IP limiter for failed logins. */
class AuthLimiter {
  constructor(max = 20, windowMs = 10 * 60 * 1000) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  blocked(ip) {
    const h = this.hits.get(ip);
    if (!h) return false;
    if (Date.now() - h.start > this.windowMs) {
      this.hits.delete(ip);
      return false;
    }
    return h.count >= this.max;
  }
  fail(ip) {
    const h = this.hits.get(ip);
    if (!h || Date.now() - h.start > this.windowMs) this.hits.set(ip, { start: Date.now(), count: 1 });
    else h.count++;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const stream = /gzip/i.test(req.headers['content-encoding'] ?? '') ? req.pipe(zlib.createGunzip()) : req;
    stream.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    stream.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    stream.on('error', () => reject(new HttpError(400, 'Bad request body')));
  });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `File too large (max ${Math.round(limit / 1024 / 1024)} MB)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'Bad request body')));
  });
}

function sendJSON(req, res, status, body, extra = {}) {
  let data = Buffer.from(JSON.stringify(body));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra };
  if (data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    data = zlib.gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  headers['Content-Length'] = data.length;
  res.writeHead(status, headers);
  res.end(data);
}

export function createServer({ config, store, backups, log = console }) {
  const limiter = new AuthLimiter();
  const staticCache = new Map();

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = config.corsOrigins.includes('*') || config.corsOrigins.includes(origin);
    if (!allowed) return;
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigins.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Encoding');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (!config.corsOrigins.includes('*')) res.setHeader('Vary', 'Origin');
  }

  function ipOf(req) {
    return req.socket.remoteAddress ?? 'unknown';
  }

  function authVault(req, name) {
    const ip = ipOf(req);
    if (limiter.blocked(ip)) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
    const vault = store.get(name);
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!vault || !vault.checkToken(token)) {
      limiter.fail(ip);
      // Same answer for "no such vault" and "wrong passphrase".
      throw new HttpError(401, 'Unknown vault or wrong passphrase.');
    }
    return vault;
  }

  async function api(req, res, url) {
    let parts;
    try {
      parts = url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    const method = req.method;

    if (parts[0] === 'health' && method === 'GET') {
      return sendJSON(req, res, 200, {
        ok: true,
        name: 'tally',
        version: VERSION,
        signup: !config.allowSignup ? 'closed' : config.signupSecret ? 'secret' : 'open',
        backups: config.backup.enabled,
      });
    }

    if (parts[0] !== 'vaults') throw new HttpError(404, 'Not found');

    // POST /vaults — create
    if (parts.length === 1 && method === 'POST') {
      if (!config.allowSignup) throw new HttpError(403, 'This server does not allow new vaults.');
      const body = await readBody(req, 64 * 1024);
      if (config.signupSecret && body.signupSecret !== config.signupSecret) {
        limiter.fail(ipOf(req));
        throw new HttpError(403, 'Wrong server signup secret.');
      }
      const v = store.create(String(body.vault ?? ''), body.token, body.encrypted);
      log.info?.(`[vault] created ${v.name} (encrypted: ${v.meta.encrypted})`);
      return sendJSON(req, res, 201, v.info());
    }

    const name = parts[1];
    if (!name) throw new HttpError(404, 'Not found');
    const vault = authVault(req, name);

    if (parts.length === 2 && method === 'GET') return sendJSON(req, res, 200, vault.info());

    if (parts.length === 2 && method === 'DELETE') {
      backups.snapshot(name, { manual: true });
      store.remove(name);
      log.info?.(`[vault] deleted ${name} (moved to trash, final snapshot kept)`);
      return sendJSON(req, res, 200, { ok: true });
    }

    if (parts[2] === 'sync' && method === 'POST') {
      const body = await readBody(req, config.maxBodyBytes);
      const since = Number.isFinite(body.since) ? body.since : 0;
      const push = Array.isArray(body.push) ? body.push : [];
      const result = vault.sync({ since, push, limit: body.limit ?? 1000 });
      if (result.accepted) backups.scheduleExport(name);
      return sendJSON(req, res, 200, result);
    }

    if (parts[2] === 'blobs') {
      if (parts.length === 3 && method === 'GET') return sendJSON(req, res, 200, { blobs: vault.listBlobs() });
      const id = parts[3];
      if (parts.length !== 4 || !id) throw new HttpError(404, 'Not found');
      if (method === 'PUT') {
        vault.blobPath(id); // validate before reading the body
        const data = await readRaw(req, config.maxBlobBytes);
        vault.putBlob(id, data);
        return sendJSON(req, res, 201, { id, size: data.length });
      }
      if (method === 'GET' || method === 'HEAD') {
        const file = vault.blobFile(id) ?? backups.backedUpBlob(name, id);
        if (!file) throw new HttpError(404, 'No such file');
        const st = fs.statSync(file);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
        if (method === 'HEAD') return res.end();
        return fs.createReadStream(file).pipe(res);
      }
      if (method === 'DELETE') {
        vault.deleteBlob(id);
        return sendJSON(req, res, 200, { ok: true });
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (parts[2] === 'backups') {
      if (parts.length === 3 && method === 'GET') return sendJSON(req, res, 200, { backups: backups.list(name) });
      if (parts.length === 3 && method === 'POST') {
        const file = backups.snapshot(name, { manual: true });
        return sendJSON(req, res, 201, { name: file });
      }
      if (parts.length === 4 && method === 'GET') {
        const snap = backups.read(name, parts[3]);
        if (!snap) throw new HttpError(404, 'No such backup');
        return sendJSON(req, res, 200, snap);
      }
    }

    throw new HttpError(404, 'Not found');
  }

  function serveStatic(req, res, url) {
    if (!config.staticDir || !fs.existsSync(config.staticDir)) {
      return sendJSON(req, res, 404, { error: 'The web app is not installed on this server (build app/ first).' });
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const root = path.resolve(config.staticDir);
    let file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Single-page app: unknown paths get the app shell.
      file = path.join(config.staticDir, 'index.html');
      if (!fs.existsSync(file)) throw new HttpError(404, 'Not found');
    }
    const ext = path.extname(file);
    const st = fs.statSync(file);
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const key = `${file}|${st.mtimeMs}|${gzip}`;
    let body = staticCache.get(key);
    if (!body) {
      body = fs.readFileSync(file);
      if (gzip) body = zlib.gzipSync(body, { level: 9 });
      staticCache.set(key, body);
    }
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}${gzip ? '-gz' : ''}"`;
    const immutable = /\/assets\//.test(file);
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: etag,
      Vary: 'Accept-Encoding',
    };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    if (gzip) headers['Content-Encoding'] = 'gzip';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        cors(req, res);
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) log.error?.(err);
      if (!res.headersSent) sendJSON(req, res, status, { error: status >= 500 ? 'Internal server error' : err.message });
      else res.end();
    }
  });
  server.keepAliveTimeout = 65_000;
  return server;
}
