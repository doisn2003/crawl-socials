import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { starterReleaseAsset } from '../infrastructure/managed/starter-release.js';
import { createAdmin } from './admin.js';
import { createAuth } from './auth.js';
import { backupPath, createBackup, MAX_BACKUP_FILE } from './backup.js';
import { createBilling } from './billing.js';
import { loopback, publicLeaseKey, type BackendConfig } from './config.js';
import { ApiError, bad, hex, integer, rateLimit, record, micros, string, tag, uuid } from './core.js';
import { CONTROL_SCHEMA_VERSION } from './database.js';
import { createEntitlements } from './entitlements.js';
import { createModelQueue } from './model.js';

const jsonMax = 192 * 1024;
const windowsDownloads = '/downloads/windows';
const routes = {
  '/admin': ['admin.html','text/html; charset=utf-8'],
  '/admin/console.js': ['admin-console.js','text/javascript; charset=utf-8'],
  '/admin/console.css': ['admin-console.css','text/css; charset=utf-8'],
} as const;

function send(res: ServerResponse, status: number, data: unknown) {
  const content = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(content) });
  res.end(content);
}

async function bytes(req: IncomingMessage, max: number) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'CONTENT_ENCODING_UNSUPPORTED');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > max) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function json(req: IncomingMessage, max = jsonMax) {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new ApiError(415, 'CONTENT_TYPE_INVALID');
  const raw = await bytes(req, max);
  try { return JSON.parse(raw.toString('utf8')) as unknown; } catch { throw bad('JSON_INVALID'); }
}

const bearer = (req: IncomingMessage) => /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1] ?? '';

export function createBackend(pool: Pool, config: BackendConfig, options: { transport?: typeof fetch; workers?: boolean } = {}) {
  const auth = createAuth(pool, config), entitlements = createEntitlements(pool, config);
  const backups = createBackup(pool), billing = createBilling(pool, config), admin = createAdmin(pool, config);
  const models = createModelQueue(pool, config, options.transport);
  const leasePublicKey = publicLeaseKey(config.leaseKey);
  let heavy = 0;

  async function withBackupIO<T>(work: () => Promise<T>) {
    if (heavy >= 2) throw new ApiError(429, 'PROJECT_BACKUP_BUSY');
    heavy++;
    try { return await work(); } finally { heavy--; }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 4096) throw bad('PATH_INVALID');
    const url = new URL(req.url, config.origin), path = url.pathname, method = req.method;
    const reply = (value: unknown, status = 200) => send(res, status, value);
    const body = (max?: number) => json(req, max);
    if ((method === 'GET' || method === 'HEAD') && (path === windowsDownloads || path.startsWith(windowsDownloads + '/'))) {
      const release = config.starterRelease;
      const filename = path.slice(windowsDownloads.length + 1);
      const asset = release && starterReleaseAsset(release.version, filename);
      if (!release || !asset) throw new ApiError(404, 'STARTER_RELEASE_UNAVAILABLE');
      const location = `https://github.com/${release.repository}/releases/download/findlink-starter-v${asset.version}/${asset.filename}`;
      res.writeHead(307, { Location: location });
      res.end();
      return;
    }
    if (method === 'GET' && path === '/healthz') {
      const ready = await pool.query('SELECT version FROM findlink_control.migrations WHERE version=$1', [CONTROL_SCHEMA_VERSION]);
      if (!ready.rowCount) throw new ApiError(503,'BACKEND_MIGRATION_REQUIRED');
      return reply({ ok: true });
    }
    if (method === 'GET' && path === '/v1/config') return reply({ protocol: 1, leasePublicKey });
    const asset = method === 'GET' ? routes[path as keyof typeof routes] : undefined;
    if (asset && config.admin) {
      const content = await readFile(new URL('./' + asset[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': content.length });
      res.end(content);
      return;
    }

    const peer = req.socket.remoteAddress || 'unknown';
    const forwarded = req.headers['x-real-ip'];
    const trustedProxy = config.trustRailwayProxy || (config.trustLocalProxy && loopback(peer));
    const ip = trustedProxy && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
    const ipTag = tag(config.identityKey, 'ip', ip);
    if (path === '/v1/billing/webhooks/sepay' && method === 'POST') {
      await rateLimit(pool, 'sepay:ip:' + ipTag, 120, 60);
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new ApiError(415, 'CONTENT_TYPE_INVALID');
      await billing.webhook(await bytes(req, 32_768), req.headers['x-sepay-timestamp'], req.headers['x-sepay-signature']);
      return reply({ success: true }, 201);
    }

    if (path.startsWith('/v1/admin/')) {
      if (method === 'POST' && path === '/v1/admin/session') return reply(await admin.login(await body(), ipTag));
      await admin.authorize(bearer(req));
      await rateLimit(pool, 'admin:api:' + ipTag, 120, 60);
      if (method === 'POST' && path === '/v1/admin/logout') { await admin.logout(bearer(req)); return reply({ ok: true }); }
      if (method === 'GET' && path === '/v1/admin/overview') return reply(await admin.overview());
      if (method === 'POST' && path === '/v1/admin/invites') return reply(await admin.invite(await body()), 201);
      if (method === 'PUT' && path === '/v1/admin/policy') return reply(await admin.savePolicy(await body()));
      if (method === 'POST' && path === '/v1/admin/tariffs') return reply(await admin.saveTariff(await body()), 201);
      const review = /^\/v1\/admin\/reviews\/([^/]+)$/.exec(path);
      if (method === 'POST' && review) { await admin.review(uuid(review[1]), await body()); return reply({ ok: true }); }
      const account = /^\/v1\/admin\/accounts\/([^/]+)$/.exec(path);
      if (method === 'POST' && account) { await admin.accountAction(uuid(account[1]), await body()); return reply({ ok: true }); }
      const adjustment = /^\/v1\/admin\/accounts\/([^/]+)\/credits$/.exec(path);
      if (method === 'POST' && adjustment) { await admin.creditAction(uuid(adjustment[1]), await body()); return reply({ ok: true }); }
      const credential = /^\/v1\/admin\/accounts\/([^/]+)\/model-credential$/.exec(path);
      if (method === 'PUT' && credential) { await admin.modelCredentialAction(uuid(credential[1]), await body()); return reply({ ok: true }); }
      const payment = /^\/v1\/admin\/payments\/([0-9]{1,16})\/(reconcile|refund)$/.exec(path);
      if (method === 'POST' && payment) {
        const value = record(await body()), reason = string(value.reason, 1000, 4);
        if (payment[2] === 'refund') await billing.refund(payment[1]!, reason);
        else await billing.reviewPayment(payment[1]!, uuid(value.orderId), reason);
        return reply({ ok: true });
      }
      if (method === 'POST' && path === '/v1/admin/ai/reconcile') {
        const value = record(await body());
        await models.reconcile(uuid(value.accountId), hex(value.id), micros(value.cost), string(value.evidence, 1000, 4));
        return reply({ ok: true });
      }
      throw new ApiError(404, 'NOT_FOUND');
    }

    if (!path.startsWith('/v1/')) throw new ApiError(404, 'NOT_FOUND');
    await rateLimit(pool, 'api:ip:' + ipTag, 1800, 60);
    if (method === 'POST' && path === '/v1/auth/recover') {
      await auth.recover(await body(), ipTag);
      return reply({ ok: true });
    }
    const device = req.headers['x-findlink-device'];
    if (method === 'POST' && (path === '/v1/auth/login' || path === '/v1/auth/register')) {
      return reply(await auth.login(await body(), hex(device), ipTag, path.endsWith('register')));
    }
    if (method === 'POST' && path === '/v1/auth/refresh') return reply(await auth.refresh(await body(), hex(device)));
    const actor = await auth.principal(bearer(req), device);
    await rateLimit(pool, 'api:account:' + actor.accountId, 1200, 60);
    if (method === 'POST' && path === '/v1/auth/logout') { await auth.logout(actor); return reply({ ok: true }); }
    if (method === 'GET' && path === '/v1/auth/session') return reply({ id: actor.accountId, username: actor.username });
    if (method === 'GET' && path === '/v1/me/entitlements') return reply(await entitlements.status(actor));
    if (method === 'GET' && path === '/v1/wallet') {
      const status = await entitlements.status(actor);
      const ledger = await pool.query(`SELECT id,action,amount,operation_id,at FROM findlink_control.credit_ledger
        WHERE account_id=$1 ORDER BY id DESC LIMIT 100`, [actor.accountId]);
      return reply({ ...status, ledger: ledger.rows });
    }
    if (method === 'POST' && path === '/v1/trial/activate') {
      await rateLimit(pool, 'trial:' + actor.deviceTag, 10, 900);
      const hasBody = Number(req.headers['content-length']) > 0 || !!req.headers['transfer-encoding'];
      const value = hasBody ? record(await body(1024)) : {};
      const installationTag = value.installationTag === undefined ? undefined : hex(value.installationTag);
      return reply(await entitlements.activate(actor, installationTag));
    }
    if (method === 'POST' && path === '/v1/runs/authorize') {
      await rateLimit(pool, 'lease:' + actor.accountId, 30, 60);
      return reply(await entitlements.issue(actor, await body()));
    }
    const lease = /^\/v1\/runs\/leases\/([^/]+)\/(renew|release|raw)$/.exec(path);
    if (method === 'POST' && lease) {
      const id = uuid(lease[1]);
      if (lease[2] === 'renew') return reply(await entitlements.renew(actor, id));
      if (lease[2] === 'raw') return reply(await entitlements.reportRaw(actor, id, await body()));
      await entitlements.release(actor, id);
      return reply({ ok: true });
    }
    if (method === 'POST' && path === '/v1/ai/operations') {
      await rateLimit(pool, 'ai:' + actor.accountId, 60, 60);
      return reply(await models.enqueue(actor, await body()), 202);
    }
    const operation = /^\/v1\/ai\/operations\/([a-f0-9]{64})$/.exec(path);
    if (method === 'GET' && operation) return reply(await models.get(actor, operation[1]!));
    if (method === 'POST' && path === '/v1/billing/orders') {
      await rateLimit(pool, 'order:' + actor.accountId, 15, 900);
      return reply(await billing.createOrder(actor, await body()), 201);
    }
    const order = /^\/v1\/billing\/orders\/([^/]+)$/.exec(path);
    if (method === 'GET' && order) return reply(await billing.order(actor, uuid(order[1])));
    if (method === 'GET' && path === '/v1/projects') return reply(await backups.list(actor));
    if (method === 'POST' && path === '/v1/projects/claim') {
      await rateLimit(pool, 'claim:' + actor.accountId, 15, 900);
      await backups.claim(actor, await body());
      return reply({ ok: true });
    }
    if (method === 'POST' && path === '/v1/projects/backups') {
      await rateLimit(pool, 'backup:' + actor.accountId, 30, 60);
      return reply(await backups.start(actor, await body(10 * 1024 * 1024)));
    }
    const stage = /^\/v1\/projects\/backups\/([^/]+)\/(file|commit)$/.exec(path);
    if (stage && method === 'PUT' && stage[2] === 'file') {
      const id = uuid(stage[1]), name = backupPath(url.searchParams.get('path'));
      await withBackupIO(async () => backups.write(actor, id, name, await bytes(req, MAX_BACKUP_FILE)));
      return reply({ ok: true });
    }
    if (stage && method === 'POST' && stage[2] === 'commit') return reply(await withBackupIO(() => backups.commit(actor, uuid(stage[1]))));
    const project = /^\/v1\/projects\/([^/]+)\/(manifest|file)$/.exec(path);
    if (method === 'GET' && project) {
      const id = uuid(project[1]), revision = integer(Number(url.searchParams.get('revision')), 1, Number.MAX_SAFE_INTEGER);
      if (project[2] === 'manifest') return reply(await backups.manifest(actor, id, revision));
      return withBackupIO(async () => {
        const file = await backups.file(actor, id, revision, backupPath(url.searchParams.get('path')));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.length });
        await new Promise<void>(resolve => {
          res.once('close', resolve);
          res.end(file, resolve);
        });
      });
    }
    throw new ApiError(404, 'NOT_FOUND');
  }

  const server = createServer({ requestTimeout: 120_000, headersTimeout: 10_000, keepAliveTimeout: 5_000, maxHeaderSize: 16_384 },
    (req, res) => void handle(req, res).catch(error => {
      if (res.headersSent || res.destroyed) return res.destroy();
      req.resume();
      if (error instanceof ApiError) return send(res, error.status, { code: error.code });
      const code = error instanceof Error ? error.message : '';
      if (/^PROJECT_(?:ACCESS_DENIED|BACKUP_CONFLICT|BACKUP_CORRUPT|BACKUP_PATH_INVALID)$/.test(code)) {
        return send(res, code === 'PROJECT_ACCESS_DENIED' ? 403 : 409, { code });
      }
      const pgCode = (error as { code?: string })?.code ?? '';
      process.stderr.write('FINDLINK_HTTP_FAILED' + (/^[0-9A-Z]{5}$/.test(pgCode) ? ' ' + pgCode : '') + '\n');
      return send(res, 500, { code: 'BACKEND_UNAVAILABLE' });
    }));
  server.maxConnections = 128;
  server.setTimeout(125_000, socket => socket.destroy());

  let closing = false, timer: ReturnType<typeof setInterval> | undefined;
  const active = new Set<Promise<unknown>>();
  let lastMaintenance = 0;
  function workerTick() {
    if (closing) return;
    while (active.size < 2) {
      const job = models.workOnce().catch(() => process.stderr.write('FINDLINK_AI_WORKER_FAILED\n')).finally(() => active.delete(job));
      active.add(job);
    }
    if (Date.now() - lastMaintenance > 60_000) {
      lastMaintenance = Date.now();
      void models.recover().catch(() => process.stderr.write('FINDLINK_RECONCILIATION_FAILED\n'));
      void entitlements.pruneInstallationTags().catch(() => process.stderr.write('FINDLINK_MAINTENANCE_FAILED\n'));
      void pool.query(`DELETE FROM findlink_control.rate_buckets WHERE expires_at<now()-interval '1 day';
        DELETE FROM findlink_control.admin_sessions WHERE expires_at<now();
        DELETE FROM findlink_control.admin_otp WHERE used_at<now()-interval '1 day';
        DELETE FROM findlink_control.refresh_replays WHERE until_at<now();
        DELETE FROM findlink_control.sessions WHERE refresh_until<now();
        DELETE FROM findlink_control.backup_stages WHERE expires_at<now();`).catch(() => process.stderr.write('FINDLINK_MAINTENANCE_FAILED\n'));
    }
  }
  if (options.workers !== false) {
    server.once('listening', () => { timer = setInterval(workerTick, 350); timer.unref(); workerTick(); });
  }
  return { server, models,
    async close() {
      closing = true;
      if (timer) clearInterval(timer);
      await new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.allSettled(active);
    },
  };
}
