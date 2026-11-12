import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isManagedModel, MANAGED_MODELS, STARTER_OFFER, TRIAL_OFFER, type ManagedModel } from '../shared/managed.js';
import type { BackendConfig } from './config.js';
import { ApiError, audit, bad, email, hash, hex, integer, lockAccount, micros, policy, rateLimit, record, safeEqual, string, token, uuid } from './core.js';
import { transaction, type Transaction } from './database.js';
import { grantCredits } from './entitlements.js';
import { credentialTag, encryptCredential, trialCredential, trialCredentialTags } from './model-credentials.js';
import { MODEL_PRICE_SOURCES, MODEL_PROVIDERS, type ModelProvider } from './model-providers.js';

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
  async function paidKeyConfigured(db: Transaction, model: unknown) {
    if (!isManagedModel(model)) return false;
    const result = await db.query(`SELECT 1 FROM findlink_control.model_credentials
      WHERE provider=$1 AND NOT (key_tag=ANY($2::text[])) LIMIT 1`, [MODEL_PROVIDERS[model], trialCredentialTags(config)]);
    return !!result.rowCount;
  }

  async function paidAccountsMissingKey(db: Pool | Transaction, activeModel: unknown, nextModel: ManagedModel) {
    if (!isManagedModel(activeModel) || MODEL_PROVIDERS[activeModel] === MODEL_PROVIDERS[nextModel]) return 0;
    const { rows: [row] } = await db.query<{ count: number }>(`SELECT count(*)::int AS count
      FROM findlink_control.model_credentials current_key JOIN findlink_control.accounts a ON a.id=current_key.account_id
      WHERE current_key.provider=$1 AND NOT (current_key.key_tag=ANY($3::text[])) AND NOT a.suspended
        AND EXISTS (SELECT 1 FROM findlink_control.subscriptions s WHERE s.account_id=a.id AND s.revoked_at IS NULL
          AND s.starts_at<=now() AND s.ends_at>now())
        AND NOT EXISTS (SELECT 1 FROM findlink_control.model_credentials next_key WHERE next_key.account_id=a.id
          AND next_key.provider=$2 AND NOT (next_key.key_tag=ANY($3::text[])))`,
    [MODEL_PROVIDERS[activeModel], MODEL_PROVIDERS[nextModel], trialCredentialTags(config)]);
    return row!.count;
  }

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
      if (!proposed.pause_ai && before.pause_ai) {
        if (BigInt(proposed.paid_daily_cost) <= 0n || BigInt(proposed.paid_total_cost) <= 0n) throw bad('AI_CAP_REQUIRED');
        const trialConfigured = proposed.trial_enabled && !proposed.pause_trial && !!trialCredential(config, before.trial_route_model);
        if (!trialConfigured && !await paidKeyConfigured(db, before.route_model)) throw new ApiError(409, 'MODEL_KEY_REQUIRED');
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
    const funding = body.funding ?? 'PAID';
    if (funding !== 'TRIAL' && funding !== 'PAID') throw bad('MODEL_FUNDING_INVALID');
    for (const key of ['input_per_million','output_per_million','cached_input_per_million']) {
      if (typeof price[key] !== 'number' || !Number.isFinite(price[key]) || price[key] < 0 || price[key] > 1000) throw bad('TARIFF_INVALID');
    }
    if (Number(price.input_per_million) <= 0 || Number(price.output_per_million) <= 0 ||
        Number(price.cached_input_per_million) > Number(price.input_per_million)) throw bad('TARIFF_INVALID');
    const observed = string(price.observed_at, 10, 10), observedTime = Date.parse(observed);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observed) || !Number.isFinite(observedTime) || new Date(observedTime).toISOString().slice(0, 10) !== observed) throw bad('TARIFF_INVALID');
    return transaction(pool, async db => {
      const before = await policy(db, true);
      const trial = funding === 'TRIAL';
      const model: unknown = body.model ?? (trial ? before.trial_route_model : before.route_model);
      if (!isManagedModel(model)) throw bad('MODEL_NOT_SUPPORTED');
      if (trial ? !trialCredential(config, model) : !await paidKeyConfigured(db, model)) throw new ApiError(409, 'MODEL_KEY_REQUIRED');
      if (!trial && await paidAccountsMissingKey(db, before.route_model, model)) throw new ApiError(409, 'MODEL_ROUTE_KEYS_MISSING');
      const snapshot = { input_per_million: price.input_per_million, output_per_million: price.output_per_million,
        cached_input_per_million: price.cached_input_per_million, observed_at: observed, source: MODEL_PRICE_SOURCES[model] };
      const id = (await db.query('SELECT max(id)+1 AS id FROM findlink_control.tariff_versions')).rows[0].id as number;
      await db.query('INSERT INTO findlink_control.tariff_versions(id,model,price) VALUES($1,$2,$3)', [id, model, JSON.stringify(snapshot)]);
      await db.query(trial ? 'UPDATE findlink_control.policy SET trial_route_id=$1 WHERE id=true'
        : 'UPDATE findlink_control.policy SET route_id=$1 WHERE id=true', [id]);
      await audit(db, 'operator', 'TARIFF_CHANGED', String(id), { previous: trial ? before.trial_route_id : before.route_id, funding, model, price: snapshot });
      return { id, model, funding };
    });
  }

  async function modelCredentialAction(accountId: string, value: unknown) {
    const body = record(value), provider: unknown = body.provider, action = body.action;
    if ((provider !== 'gemini' && provider !== 'deepseek') || (action !== 'set' && action !== 'revoke')) throw bad();
    const reason = string(body.reason, 1000, 4).trim();
    if (reason.length < 4) throw bad();
    const key = action === 'set' ? string(body.key, 4096, 12).trim() : null;
    if (key !== null && (!/^[a-zA-Z0-9._~+/=-]{12,4096}$/.test(key) || reason.includes(key))) throw bad('MODEL_KEY_INVALID');
    const fingerprint = key === null ? null : credentialTag(config, key);
    if (fingerprint && trialCredentialTags(config).includes(fingerprint)) throw new ApiError(409, 'MODEL_KEY_RESERVED_FOR_TRIAL');
    await transaction(pool, async db => {
      await lockAccount(db, accountId);
      // Serialize key changes with a provider switch's account coverage check.
      await policy(db, true);
      if (key === null) {
        const result = await db.query('DELETE FROM findlink_control.model_credentials WHERE account_id=$1 AND provider=$2', [accountId, provider]);
        if (!result.rowCount) return;
      } else {
        try {
          await db.query(`INSERT INTO findlink_control.model_credentials(account_id,provider,key_tag,encrypted_key)
            VALUES($1,$2,$3,$4) ON CONFLICT(account_id,provider) DO UPDATE
            SET key_tag=excluded.key_tag,encrypted_key=excluded.encrypted_key,updated_at=now()`,
          [accountId, provider, fingerprint, encryptCredential(config, accountId, provider, key)]);
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'MODEL_KEY_IN_USE');
          throw error;
        }
      }
      await audit(db, 'operator', action === 'set' ? 'MODEL_KEY_SET' : 'MODEL_KEY_REVOKED', accountId, { provider, reason });
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
      ['trialTariff',`SELECT t.id,t.model,t.price FROM findlink_control.policy p JOIN findlink_control.tariff_versions t ON t.id=p.trial_route_id WHERE p.id=true`],
      ['tariffs',`SELECT DISTINCT ON (model) model,price FROM findlink_control.tariff_versions ORDER BY model,id DESC`],
      ['accounts',`SELECT u.username,a.id,
        CASE WHEN paid.active_until IS NOT NULL THEN 'STARTER' WHEN paid.had_paid OR t.id IS NULL THEN 'INACTIVE' ELSE 'TRIAL' END AS plan,
        CASE WHEN paid.had_paid AND paid.active_until IS NULL THEN '0' ELSE wallet.available END AS available,
        paid.active_until AS paid_until,t.expires_at AS trial_until,a.suspended,a.email_verified_at,
        ARRAY(SELECT provider FROM findlink_control.model_credentials WHERE account_id=a.id ORDER BY provider) AS model_providers
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
    const [result, paidKeys] = await Promise.all([
      Promise.all(queries.map(async ([key, sql]) => [key, (await pool.query(sql)).rows] as const)),
      pool.query<{ provider: ModelProvider; count: number }>(`SELECT provider,count(*)::int AS count FROM findlink_control.model_credentials
        WHERE NOT (key_tag=ANY($1::text[])) GROUP BY provider`, [trialCredentialTags(config)]),
    ]);
    const data = Object.fromEntries(result);
    const models = await Promise.all(MANAGED_MODELS.map(async model => ({
      model, trialConfigured: !!trialCredential(config, model),
      paidKeys: paidKeys.rows.find(row => row.provider === MODEL_PROVIDERS[model])?.count ?? 0,
      paidMissingOnSwitch: await paidAccountsMissingKey(pool, data.tariff?.[0]?.model, model),
      source: MODEL_PRICE_SOURCES[model],
    })));
    return { ...data, setup: { sepayConfigured: !!config.sepay,
      sepayMode: config.sepay ? config.sepay.test ? 'test' : 'live' : 'disabled',
      models, starter: STARTER_OFFER, trial: TRIAL_OFFER } };
  }

  return { login, authorize, invite, savePolicy, saveTariff, review, accountAction, creditAction, modelCredentialAction, overview,
    logout: (value: string) => pool.query('DELETE FROM findlink_control.admin_sessions WHERE hash=$1', [hash(value)]) };
}
