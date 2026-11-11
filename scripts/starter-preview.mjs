import { spawn } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { createAdmin } from '../dist/backend/admin.js';
import { database, migrate } from '../dist/backend/database.js';
import { createBackend } from '../dist/backend/server.js';
import { starterGeminiFixture } from './fixtures/starter-gemini.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const verify = process.argv.includes('--verify');
const envPath = process.argv.find(arg => arg.startsWith('--env='))?.slice(6) ?? join(root, '.env');
const dbName = 'findlink_preview_' + randomUUID().replaceAll('-', '');
const password = () => randomBytes(32).toString('hex');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const admin = { token: password(), totp: [...randomBytes(32)].map(byte => alphabet[byte & 31]).join('') };
const sepay = { secret: password(), bank: 'SePay mô phỏng', account: '000000000000', name: 'BẢN THỬ — KHÔNG CHUYỂN TIỀN' };
const local = '127.0.0.1';
let creator, pool, backend, directory, child, poll, outstandingPayment, verificationDeadline;
let created = false, stopping = false;
const stop = () => { stopping = true; child?.kill(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function deliverPayment(origin, order, id) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ id, gateway: sepay.bank, accountNumber: sepay.account, transferType: 'in', code: null,
    transactionDate: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0,19).replace('T',' '),
    content: 'Giao dịch mô phỏng ' + order.code, transferAmount: Number(order.amount_vnd), referenceCode: 'PREVIEW-' + id });
  const signature = createHmac('sha256', sepay.secret).update(timestamp + '.').update(body).digest('hex');
  const response = await fetch(origin + '/v1/billing/webhooks/sepay', { method: 'POST', body, signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', 'X-SePay-Timestamp': timestamp, 'X-SePay-Signature': 'sha256=' + signature } });
  if (response.status !== 201) throw Error('PREVIEW_SEPAY_FAILED');
}

try {
  const { DATABASE_URL } = parseEnv(await readFile(envPath, 'utf8'));
  if (!DATABASE_URL) throw Error('PREVIEW_DATABASE_URL_REQUIRED');
  const isolated = new URL(DATABASE_URL);
  isolated.pathname = '/' + dbName;
  creator = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 8000 });
  await creator.connect();
  await creator.query('CREATE DATABASE "' + dbName + '"');
  created = true;
  directory = await mkdtemp(join(tmpdir(), 'findlink-starter-preview-'));
  pool = database(isolated.href);
  await migrate(pool);
  const config = { databaseUrl: isolated.href, production: false, origin: 'http://' + local, host: local, port: 0,
    leaseKey: generateKeyPairSync('ed25519').privateKey, identityKey: password(), geminiKey: 'preview-fixture',
    admin, sepay, topupPriceVnd: 325_000, trustLocalProxy: false };
  backend = createBackend(pool, config, { transport: starterGeminiFixture });
  await new Promise((done, fail) => { backend.server.once('error', fail); backend.server.listen(verify ? 0 : 9070, local, done); });
  const origin = 'http://' + local + ':' + backend.server.address().port;
  const operator = createAdmin(pool, config);
  await operator.savePolicy({ trial_enabled: true, pause_grants: false, pause_trial: false, pause_ai: false,
    max_trial_subjects: 4, trial_subjects_per_day: 4, trial_grant_cap: '400000000', trial_daily_cost: '100000000',
    trial_total_cost: '100000000', paid_daily_cost: '1000000000', paid_total_cost: '1000000000' });
  const account = await operator.invite({ email: 'starter-preview@example.test', purpose: 'TRIAL' });
  let paymentId = 10_000;
  poll = setInterval(() => {
    if (outstandingPayment || stopping) return;
    outstandingPayment = (async () => {
      const { rows } = await pool.query(`SELECT code,amount_vnd FROM findlink_control.orders
        WHERE paid_at IS NULL AND expires_at>now() AND created_at<now()-interval '2 seconds' ORDER BY created_at LIMIT 5`);
      for (const order of rows) await deliverPayment(origin, order, ++paymentId);
    })().catch(() => console.error('PREVIEW_SEPAY_PENDING')).finally(() => { outstandingPayment = undefined; });
  }, 1000);
  if (stopping) throw Error('PREVIEW_CANCELLED');
  const env = { ...process.env, FINDLINK_DEV_BACKEND_URL: origin, FINDLINK_LOCAL_PREVIEW: '1' };
  for (const key of Object.keys(env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'DATABASE_URL' || /(?:GEMINI|SEPAY|FINDLINK_ADMIN)/.test(key)) delete env[key];
  }
  // All values passed here belong to this disposable preview.
  env.FINDLINK_PREVIEW_BOOTSTRAP = JSON.stringify({ directory, origin, admin, verify,
    signup: { username: account.email, password: password(), invite: account.code } });
  child = spawn(createRequire(import.meta.url)('electron'), [join(root, 'scripts', 'starter-preview-desktop.mjs')],
    { cwd: root, env, windowsHide: verify, stdio: ['ignore','inherit','inherit'] });
  if (verify) verificationDeadline = setTimeout(stop, 110_000);
  const result = new Promise((done, fail) => { child.once('exit', code => done(code ?? 1)); child.once('error', fail); });
  console.log('FINDLINK_PREVIEW_BACKEND_READY ' + origin);
  process.exitCode = await result;
} catch (error) {
  const code = error?.code ?? error?.message;
  console.error('FINDLINK_PREVIEW_FAILED', /^[A-Z0-9_]{3,90}$/.test(code ?? '') ? code : 'STARTUP_FAILED');
  process.exitCode = 1;
} finally {
  clearInterval(poll);
  clearTimeout(verificationDeadline);
  await outstandingPayment;
  await backend?.close().catch(() => {});
  await pool?.end().catch(() => {});
  if (created && /^findlink_preview_[0-9a-f]{32}$/.test(dbName)) {
    await creator.query('DROP DATABASE "' + dbName + '" WITH (FORCE)').catch(() => console.error('PREVIEW_DATABASE_CLEANUP_FAILED'));
  }
  await creator?.end().catch(() => {});
  if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('findlink-starter-preview-')) {
    await rm(directory, { recursive: true, force: true, maxRetries: 4 }).catch(() => console.error('PREVIEW_PROFILE_CLEANUP_FAILED'));
  }
}
