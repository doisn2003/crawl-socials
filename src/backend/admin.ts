import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isManagedModel, MANAGED_MODELS, STARTER_OFFER, TRIAL_OFFER } from '../shared/managed.js';
import type { BackendConfig } from './config.js';
import { ApiError, audit, bad, email, hash, hex, integer, lockAccount, micros, policy, rateLimit, record, safeEqual, string, token, uuid } from './core.js';
import { transaction } from './database.js';
import { grantCredits } from './entitlements.js';
import { MODEL_PRICE_SOURCES, modelCredential } from './model-providers.js';

function decodeBase32(text: string) {
  let bits = 0, word = 0;
  const output: number[] = [];
  for (const char of text) {
    const code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    if (code < 0) throw Error('ADMIN_TOTP_INVALID');
    word = (word << 5) | code;
    bits += 5;
    if (bits >= 8) { bits -= 8; output.push((word >>> bits) & 255); }
  }
  return Buffer.from(output);
}

export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const bytes = createHmac('sha1', decodeBase32(secret)).update(counter).digest(), offset = bytes.at(-1)! & 15;
  return String((bytes.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function createAdmin(pool: Pool, config: BackendConfig) {
  async function login(value: unknown, ip: string) {
    await rateLimit(pool, 'admin:login:' + ip, 8, 900);
    if (!config.admin) throw new ApiError(404, 'ADMIN_DISABLED');
    const body = record(value), entered = hex(body.token), otp = string(body.otp, 6, 6);
    const step = Math.floor(Date.now() / 30000);
    const valid = [step, step - 1, step + 1].find(counter => safeEqual(totp(config.admin!.totp, counter), otp));
    if (!safeEqual(entered, config.admin.token) || valid === undefined) throw new ApiError(401, 'ADMIN_AUTH_FAILED');
    return transaction(pool, async db => {
      const inserted = await db.query('INSERT INTO findlink_control.admin_otp(step) VALUES($1) ON CONFLICT DO NOTHING', [valid]);
      if (!inserted.rowCount) throw new ApiError(401, 'ADMIN_OTP_REPLAY');
      const session = token();
      await db.query("INSERT INTO findlink_control.admin_sessions VALUES($1,now()+interval '15 minutes')", [hash(session)]);
      await audit(db, 'operator', 'ADMIN_LOGIN', 'operator');
      return { token: session };
    });
  }

  async function authorize(value: unknown) {
    if (!config.admin || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED');
    const r = await pool.query('SELECT 1 FROM findlink_control.admin_sessions WHERE hash=$1 AND expires_at>now()', [hash(value)]);
    if (!r.rowCount) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED');
  }

  async function invite(value: unknown) {
    const body = record(value), purpose = body.purpose;
    if (purpose !== 'ACCOUNT' && purpose !== 'TRIAL' && purpose !== 'RECOVERY') throw bad('INVITE_PURPOSE_INVALID');
    const accountId = body.accountId ? uuid(body.accountId) : null;
    if (purpose === 'RECOVERY' && !accountId) throw bad('INVITE_ACCOUNT_REQUIRED');
    const code = token(), expiresIn = integer(body.hours ?? 48, 1, 168);
    return transaction(pool, async db => {
      const account = accountId ? await lockAccount(db, accountId) : null;
      const address = email(body.email);
      if (account?.email && account.email !== address) throw bad('INVITE_EMAIL_MISMATCH');
      if (purpose === 'RECOVERY' && !account?.email_verified_at) throw bad('INVITE_EMAIL_REQUIRED');
      await db.query(`INSERT INTO findlink_control.invites(hash,email,purpose,account_id,expires_at)
        VALUES($1,$2,$3,$4,now()+make_interval(hours=>$5))`, [hash(code), address, purpose, accountId, expiresIn]);
      await audit(db, 'operator', 'INVITE_CREATED', accountId ?? hash(code), { purpose, expiresIn });
      return { code, expiresIn, email: address };
    });
  }

  async function savePolicy(value: unknown) {
    const body = record(value);
    const toggles = ['trial_enabled','pause_grants','pause_trial','pause_ai'] as const;
    const amounts = ['trial_grant_cap','trial_daily_cost','trial_total_cost','paid_daily_cost','paid_total_cost'] as const;
    const counts = ['max_trial_subjects','trial_subjects_per_day'] as const;
    const pairs = [
      ...toggles.filter(k => Object.hasOwn(body,k)).map(k => {
        if (typeof body[k] !== 'boolean') throw bad();
        return [k, body[k]] as const;
      }),
      ...amounts.filter(k => Object.hasOwn(body,k)).map(k => [k, micros(body[k]).toString()] as const),
      ...counts.filter(k => Object.hasOwn(body,k)).map(k => [k, integer(body[k],0,1_000_000)] as const),
    ];
    if (!pairs.length || pairs.length !== Object.keys(body).length) throw bad();
    return transaction(pool, async db => {
      const before = await policy(db, true);
      const proposed = { ...before, ...Object.fromEntries(pairs) };
      if (proposed.trial_enabled && !proposed.pause_grants &&
        (!proposed.max_trial_subjects || !proposed.trial_subjects_per_day || BigInt(proposed.trial_grant_cap) < 100_000_000n ||
          BigInt(proposed.trial_daily_cost) <= 0n || BigInt(proposed.trial_total_cost) <= 0n)) throw bad('TRIAL_CAP_REQUIRED');
      if (!proposed.pause_ai && (!modelCredential(config, before.route_model) || BigInt(proposed.paid_daily_cost) <= 0n || BigInt(proposed.paid_total_cost) <= 0n)) {
        throw bad('AI_CAP_REQUIRED');
      }
      // Column names are from the fixed lists above.
      const { rows } = await db.query('UPDATE findlink_control.policy SET ' + pairs.map(([key], i) => key + '=$' + (i + 1)).join(',') +
        ' WHERE id=true RETURNING *', pairs.map(([, value]) => value));
      await audit(db, 'operator', 'POLICY_CHANGED', 'policy', { before, after: rows[0] });
      return rows[0];
    });
  }

  async function saveTariff(value: unknown) {
    const body = record(value), price = record(body.price);
    for (const key of ['input_per_million','output_per_million','cached_input_per_million']) {
      if (typeof price[key] !== 'number' || !Number.isFinite(price[key]) || price[key] < 0 || price[key] > 1000) throw bad('TARIFF_INVALID');
    }
    if (Number(price.input_per_million) <= 0 || Number(price.output_per_million) <= 0 ||
        Number(price.cached_input_per_million) > Number(price.input_per_million)) throw bad('TARIFF_INVALID');
    const observed = string(price.observed_at, 10, 10), observedTime = Date.parse(observed);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observed) || !Number.isFinite(observedTime) || new Date(observedTime).toISOString().slice(0, 10) !== observed) throw bad('TARIFF_INVALID');
    return transaction(pool, async db => {
      const before = await policy(db, true);
      const model: unknown = body.model ?? before.route_model;
      if (!isManagedModel(model)) throw bad('MODEL_NOT_SUPPORTED');
      if (!modelCredential(config, model)) throw new ApiError(409, 'MODEL_KEY_REQUIRED');
      const snapshot = { input_per_million: price.input_per_million, output_per_million: price.output_per_million,
        cached_input_per_million: price.cached_input_per_million, observed_at: observed, source: MODEL_PRICE_SOURCES[model] };
      const id = (await db.query('SELECT max(id)+1 AS id FROM findlink_control.tariff_versions')).rows[0].id as number;
      await db.query('INSERT INTO findlink_control.tariff_versions(id,model,price) VALUES($1,$2,$3)', [id, model, JSON.stringify(snapshot)]);
      await db.query('UPDATE findlink_control.policy SET route_id=$1 WHERE id=true', [id]);
      await audit(db, 'operator', 'TARIFF_CHANGED', String(id), { previous: before.route_id, model, price: snapshot });
      return { id, model };
    });
  }

  async function review(id: string, value: unknown) {
    const body = record(value);
    if (typeof body.approved !== 'boolean') throw bad();
    const reason = string(body.reason, 1000, 4);
    return transaction(pool, async db => {
      const { rows } = await db.query('SELECT account_id FROM findlink_control.trial_reviews WHERE id=$1', [id]);
      if (!rows[0]) throw new ApiError(404, 'TRIAL_REVIEW_NOT_FOUND');
      await lockAccount(db, rows[0].account_id);
      await db.query('UPDATE findlink_control.trial_reviews SET approved=$2,resolved_at=now() WHERE id=$1', [id, body.approved]);
      await audit(db, 'operator', 'TRIAL_REVIEW_RESOLVED', id, { approved: body.approved, reason });
    });
  }

  async function accountAction(accountId: string, value: unknown) {
    const body = record(value), reason = string(body.reason, 1000, 4), action = body.action;
    return transaction(pool, async db => {
      await lockAccount(db, accountId);
      if (action === 'suspend' || action === 'restore') {
        await db.query('UPDATE findlink_control.accounts SET suspended=$2,epoch=epoch+1 WHERE id=$1', [accountId,action==='suspend']);
      } else if (action === 'revoke-device' || action === 'move-trial') {
        const id = uuid(body.deviceId);
        const d = (await db.query('SELECT key_hash FROM findlink_control.devices WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL',
          [id, accountId])).rows[0];
        if (!d) throw new ApiError(404, 'DEVICE_NOT_FOUND');
        if (action === 'revoke-device') {
          await db.query('UPDATE findlink_control.devices SET revoked_at=now() WHERE id=$1', [id]);
          await db.query('DELETE FROM findlink_control.sessions WHERE device_id=$1', [id]);
        } else {
          const result = await db.query('UPDATE findlink_control.trial_subjects SET device_tag=$2 WHERE account_id=$1', [accountId,d.key_hash]);
          if (!result.rowCount) throw new ApiError(404, 'TRIAL_NOT_FOUND');
        }
        await db.query('UPDATE findlink_control.accounts SET epoch=epoch+1 WHERE id=$1', [accountId]);
      } else if (action === 'revoke-trial') {
        await db.query('UPDATE findlink_control.trial_subjects SET revoked=true WHERE account_id=$1', [accountId]);
        await db.query("UPDATE findlink_control.grants SET revoked_at=now() WHERE kind='TRIAL' AND account_id=$1", [accountId]);
        // A paid run retains its permission when the customer's trial is revoked.
      } else throw bad('ADMIN_ACTION_INVALID');
      await audit(db, 'operator', 'ACCOUNT_ACTION', accountId, { action, reason, ...(body.deviceId ? { deviceId: body.deviceId } : {}) });
    });
  }

  async function creditAction(accountId: string, value: unknown) {
    const input = record(value), reason = string(input.reason, 1000, 4);
    return transaction(pool, async db => {
      await lockAccount(db, accountId);
      if (input.action === 'grant') {
        const amount = micros(input.amount), origin = 'manual:' + uuid(input.requestId);
        if (amount === 0n) throw bad();
        const existing = (await db.query('SELECT account_id,amount FROM findlink_control.grants WHERE origin=$1', [origin])).rows[0];
        if (existing) {
          if (existing.account_id !== accountId || BigInt(existing.amount) !== amount) throw new ApiError(409,'CREDIT_IDEMPOTENCY_MISMATCH');
          return;
        }
        const active = (await db.query(`SELECT ends_at,now() AS starts_at FROM findlink_control.subscriptions WHERE account_id=$1
          AND revoked_at IS NULL AND starts_at<=now() AND ends_at>now() ORDER BY ends_at DESC LIMIT 1`, [accountId])).rows[0];
        if (!active) throw new ApiError(403,'SUBSCRIPTION_REQUIRED');
        const id = await grantCredits(db, { accountId, kind: 'ADJUSTMENT', origin, from: active.starts_at, until: active.ends_at, amount });
        await audit(db, 'operator', 'CREDITS_GRANTED', accountId, { grantId: id, amount: amount.toString(), reason });
        return;
      }
      if (input.action !== 'refund') throw bad('ADMIN_ACTION_INVALID');
      const id = hex(input.operationId);
      const operation = (await db.query(`SELECT state,charge FROM findlink_control.ai_operations WHERE account_id=$1 AND id=$2 AND funding='PAID'`, [accountId,id])).rows[0];
      if (operation?.state !== 'DONE' || BigInt(operation.charge ?? 0) === 0n) throw new ApiError(409,'CREDIT_REFUND_INVALID');
      const prior = await db.query(`SELECT 1 FROM findlink_control.credit_ledger WHERE account_id=$1 AND operation_id=$2 AND action='REFUND' LIMIT 1`, [accountId,id]);
      if (prior.rowCount) return;
      const charges = await db.query(`SELECT grant_id,amount FROM findlink_control.credit_ledger WHERE account_id=$1 AND operation_id=$2
        AND action='CHARGE' AND amount>0`, [accountId,id]);
      for (const charge of charges.rows) {
        await db.query('UPDATE findlink_control.grants SET spent=spent-$2 WHERE id=$1', [charge.grant_id, charge.amount]);
        await db.query(`INSERT INTO findlink_control.credit_ledger(account_id,grant_id,operation_id,action,amount)
          VALUES($1,$2,$3,'REFUND',$4)`, [accountId,charge.grant_id,id,charge.amount]);
      }
      await audit(db, 'operator', 'CREDITS_REFUNDED', accountId, { operationId: id, reason });
    });
  }

  async function overview() {
    const queries = [
      ['policy','SELECT * FROM findlink_control.policy'],
      ['tariff',`SELECT t.id,t.model,t.price FROM findlink_control.policy p JOIN findlink_control.tariff_versions t ON t.id=p.route_id WHERE p.id=true`],
      ['tariffs',`SELECT DISTINCT ON (model) model,price FROM findlink_control.tariff_versions ORDER BY model,id DESC`],
      ['accounts',`SELECT u.username,a.id,
        CASE WHEN paid.active_until IS NOT NULL THEN 'STARTER' WHEN paid.had_paid OR t.id IS NULL THEN 'INACTIVE' ELSE 'TRIAL' END AS plan,
        CASE WHEN paid.had_paid AND paid.active_until IS NULL THEN '0' ELSE wallet.available END AS available,
        paid.active_until AS paid_until,t.expires_at AS trial_until,a.suspended,a.email_verified_at
        FROM findlink_control.accounts a JOIN csd_backup.users u ON u.id=a.id
        LEFT JOIN findlink_control.trial_subjects t ON t.account_id=a.id
        CROSS JOIN LATERAL (SELECT count(*)>0 AS had_paid,max(ends_at) FILTER(WHERE revoked_at IS NULL AND starts_at<=now() AND ends_at>now()) AS active_until
          FROM findlink_control.subscriptions WHERE account_id=a.id) paid
        CROSS JOIN LATERAL (SELECT coalesce(sum(amount-spent-held),0)::text AS available FROM findlink_control.grants WHERE account_id=a.id
          AND revoked_at IS NULL AND starts_at<=now() AND ends_at>now() AND (kind='TRIAL')=(paid.active_until IS NULL)) wallet
        ORDER BY a.created_at DESC LIMIT 100`],
      ['devices','SELECT id,account_id,seen_at,revoked_at FROM findlink_control.devices ORDER BY seen_at DESC LIMIT 100'],
      ['reviews','SELECT id,account_id,reason,created_at FROM findlink_control.trial_reviews WHERE resolved_at IS NULL ORDER BY created_at LIMIT 100'],
      ['payments',`SELECT provider_id,order_id,amount_vnd,state,reason,created_at FROM findlink_control.payments ORDER BY created_at DESC LIMIT 100`],
      ['orders',`SELECT u.username,o.code,o.kind,o.amount_vnd,o.credits,
        CASE WHEN EXISTS (SELECT 1 FROM findlink_control.payments p WHERE p.order_id=o.id AND p.state='REFUNDED') THEN 'REFUNDED'
          WHEN o.paid_at IS NOT NULL THEN 'APPLIED' WHEN o.expires_at<=now() THEN 'EXPIRED' ELSE 'PENDING' END AS state,
        s.starts_at,s.ends_at,o.id AS order_id FROM findlink_control.orders o JOIN csd_backup.users u ON u.id=o.account_id
        LEFT JOIN findlink_control.subscriptions s ON s.order_id=o.id ORDER BY o.created_at DESC LIMIT 100`],
      ['costs',`SELECT funding,count(*)::int AS attempts,coalesce(sum(cost),0)::text AS measured,
        coalesce(sum(bound) FILTER(WHERE cost IS NULL),0)::text AS held FROM findlink_control.ai_operations GROUP BY funding`],
      ['unknown',`SELECT account_id,id,run_id,bound,funding,error,started_at FROM findlink_control.ai_operations
        WHERE state='UNKNOWN' ORDER BY started_at LIMIT 100`],
      ['audit','SELECT actor,action,target,details,at FROM findlink_control.audit ORDER BY id DESC LIMIT 100'],
    ] as const;
    const result = await Promise.all(queries.map(async ([key, sql]) => [key, (await pool.query(sql)).rows] as const));
    return { ...Object.fromEntries(result), setup: { geminiConfigured: !!config.geminiKey, sepayConfigured: !!config.sepay,
      sepayMode: config.sepay ? config.sepay.test ? 'test' : 'live' : 'disabled',
      models: MANAGED_MODELS.map(model => ({ model, configured: !!modelCredential(config, model), source: MODEL_PRICE_SOURCES[model] })),
      starter: STARTER_OFFER, trial: TRIAL_OFFER } };
  }

  return { login, authorize, invite, savePolicy, saveTariff, review, accountAction, creditAction, overview,
    logout: (value: string) => pool.query('DELETE FROM findlink_control.admin_sessions WHERE hash=$1', [hash(value)]) };
}
