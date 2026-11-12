import type { Pool } from 'pg';
import type { JsonModelResult, ModelPrice } from '../application/ports/model-gateway.js';
import { modelHash, pricedUsage } from '../infrastructure/llm/gemini-gateway.js';
import { managedModelBody, managedModelBound } from '../infrastructure/llm/managed-model-wire.js';
import { isManagedModel } from '../shared/managed.js';
import type { Principal } from './auth.js';
import type { BackendConfig } from './config.js';
import { ApiError, audit, hex, lockAccount, microsForUsd, policy, record, uuid } from './core.js';
import { transaction, type Transaction } from './database.js';
import { requireAction } from './entitlements.js';
import { validateModelRequest } from './ai-contract.js';
import { modelCredential, modelEndpoint, parseModelResponse } from './model-providers.js';

type Row = Record<string, any>;
const deadline = 45_000;
const maxResponse = 2 * 1024 * 1024;

function receipt(row: Row) {
  return { id: row.id, state: row.state as 'QUEUED' | 'DISPATCHING' | 'DONE' | 'FAILED' | 'UNKNOWN',
    result: row.result as JsonModelResult | null, error: row.error as string | null,
    cost: row.cost as string | null, charge: row.charge as string | null, bound: String(row.bound), dispatched: !!row.started_at };
}

async function metered(db: Transaction, row: Row, day: string, rules: Row, reservedId: string | null = null) {
  const usage = (await db.query(`SELECT
    coalesce(sum(coalesce(cost,bound)) FILTER (WHERE funding=$1),0)::text AS total,
    coalesce(sum(coalesce(cost,bound)) FILTER (WHERE funding=$1 AND budget_day=$2),0)::text AS daily,
    coalesce(sum(coalesce(cost,bound)) FILTER (WHERE account_id=$3 AND run_id=$4),0)::text AS run
    FROM findlink_control.ai_operations WHERE (funding=$1 OR (account_id=$3 AND run_id=$4))
    AND ($5::text IS NULL OR account_id<>$3 OR id<>$5)`,
    [row.funding, day, row.account_id, row.run_id, reservedId])).rows[0];
  const amount = BigInt(row.bound), trial = row.funding === 'TRIAL';
  if (BigInt(usage.total) + amount > BigInt(trial ? rules.trial_total_cost : rules.paid_total_cost)
    || BigInt(usage.daily) + amount > BigInt(trial ? rules.trial_daily_cost : rules.paid_daily_cost)) {
    throw new ApiError(402, trial ? 'TRIAL_FUNDING_PAUSED' : 'MODEL_GLOBAL_BUDGET_EXHAUSTED');
  }
  if (BigInt(usage.run) + amount > BigInt(row.budget)) throw new ApiError(402, 'MODEL_BUDGET_EXHAUSTED');
}

async function finalize(db: Transaction, row: Row, result: JsonModelResult | null, cost: bigint | null, code: string | null, raw?: string) {
  const bound = BigInt(row.bound);
  const amount = result && cost !== null ? (cost > bound ? bound : cost) : 0n;
  if (cost !== null) {
    const allocations = await db.query(`SELECT a.*,g.ends_at FROM findlink_control.ai_allocations a
      JOIN findlink_control.grants g ON g.id=a.grant_id WHERE a.account_id=$1 AND a.operation_id=$2 ORDER BY g.ends_at,g.id`,
      [row.account_id, row.id]);
    let left = amount;
    for (const allocation of allocations.rows) {
      const held = BigInt(allocation.amount);
      const used = left < held ? left : held;
      left -= used;
      await db.query('UPDATE findlink_control.grants SET held=held-$2,spent=spent+$3 WHERE id=$1', [allocation.grant_id, held.toString(), used.toString()]);
      await db.query(`INSERT INTO findlink_control.credit_ledger(account_id,grant_id,operation_id,action,amount)
        VALUES($1,$2,$3,'RELEASE',$4),($1,$2,$3,'CHARGE',$5)`,
        [row.account_id, allocation.grant_id, row.id, (held - used).toString(), used.toString()]);
    }
    if (cost > bound) {
      await db.query(row.funding === 'TRIAL' ? 'UPDATE findlink_control.policy SET pause_trial=true WHERE id=true'
        : 'UPDATE findlink_control.policy SET pause_ai=true WHERE id=true');
      await audit(db, 'ai', 'PROVIDER_COST_ABOVE_RESERVATION', row.id, { cost: cost.toString(), bound: bound.toString() });
    }
  }
  await db.query(`UPDATE findlink_control.ai_operations SET state=$3,cost=$4,charge=$5,result=$6,error=$7,
    raw_response=coalesce($8,raw_response),wire=NULL,finished_at=now() WHERE account_id=$1 AND id=$2`,
    [row.account_id, row.id, cost === null ? 'UNKNOWN' : result ? 'DONE' : 'FAILED', cost?.toString() ?? null,
      cost === null ? null : amount.toString(), result ? JSON.stringify(result) : null, code, raw ?? null]);
}

function utcDay(date: Date) { return date.toISOString().slice(0, 10); }

async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts).toString('utf8');
      length += value.length;
      if (length > maxResponse) throw Error('MODEL_RESPONSE_TOO_LARGE');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export function createModelQueue(pool: Pool, config: BackendConfig, transport: typeof fetch = fetch) {
  async function get(actor: Principal, id: string) {
    const { rows } = await pool.query('SELECT * FROM findlink_control.ai_operations WHERE account_id=$1 AND id=$2', [actor.accountId, id]);
    if (!rows[0]) throw new ApiError(404, 'MODEL_OPERATION_NOT_FOUND');
    return receipt(rows[0]);
  }

  async function enqueue(actor: Principal, value: unknown) {
    const body = record(value), leaseId = uuid(body.leaseId), id = hex(body.id);
    return transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId);
      const { rows } = await db.query(`SELECT l.*,r.route_id,r.budget,t.model,t.price FROM findlink_control.leases l
        JOIN findlink_control.runs r ON r.account_id=l.account_id AND r.id=l.run_id
        JOIN findlink_control.tariff_versions t ON t.id=r.route_id
        WHERE l.id=$1 AND l.account_id=$2 AND l.device_id=$3`, [leaseId, actor.accountId, actor.deviceId]);
      const lease = rows[0];
      if (!lease) throw new ApiError(403, 'RUN_LEASE_INVALID');
      const request = validateModelRequest(body.request, lease.scope);
      const hash = modelHash({ route: lease.route_id, run: lease.run_id, request });
      const old = (await db.query('SELECT * FROM findlink_control.ai_operations WHERE account_id=$1 AND id=$2', [actor.accountId,id])).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new ApiError(409, 'MODEL_IDEMPOTENCY_MISMATCH');
        return receipt(old);
      }
      const unknown = await db.query(`SELECT 1 FROM findlink_control.ai_operations WHERE account_id=$1 AND run_id=$2 AND state='UNKNOWN' LIMIT 1`,
        [actor.accountId, lease.run_id]);
      if (unknown.rowCount) throw new ApiError(409, 'MODEL_USAGE_UNKNOWN');
      const rules = await policy(db, true);
      const current = await requireAction(db, actor, rules, lease.scope, { lockedAccount: account });
      if (rules.pause_ai || !isManagedModel(lease.model) || !modelCredential(config, lease.model)) throw new ApiError(503, 'MODEL_NOT_AUTHORIZED');
      if (lease.ended_at || +lease.expires_at <= +current.now || lease.epoch !== account.epoch) throw new ApiError(403, 'RUN_LEASE_EXPIRED');
      const bound = BigInt(managedModelBound(lease.model, request, lease.price as ModelPrice));
      const day = utcDay(current.now), row = { account_id: actor.accountId, run_id: lease.run_id, funding: current.funding, bound, budget: lease.budget };
      await metered(db, row, day, rules);
      const grants = (await db.query(`SELECT * FROM findlink_control.grants WHERE account_id=$1 AND starts_at<=$2 AND ends_at>$2
        AND revoked_at IS NULL AND (kind='TRIAL')=$3 AND amount>spent+held ORDER BY ends_at,id FOR UPDATE`,
        [actor.accountId, current.now, current.funding === 'TRIAL'])).rows;
      const total = grants.reduce((sum, grant) => sum + BigInt(grant.amount) - BigInt(grant.spent) - BigInt(grant.held), 0n);
      if (total < bound) throw new ApiError(402, BigInt(current.status.held) ? 'MODEL_BUDGET_BUSY' : 'MODEL_BUDGET_EXHAUSTED');
      const operation = await db.query(`INSERT INTO findlink_control.ai_operations(account_id,id,run_id,lease_id,route_id,purpose,request_hash,wire,bound,funding,state,budget_day)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11) RETURNING *`,
        [actor.accountId, id, lease.run_id, leaseId, lease.route_id, request.purpose, hash, JSON.stringify(managedModelBody(lease.model, request)), bound.toString(), current.funding, day]);
      let left = bound;
      for (const grant of grants) {
        if (left === 0n) break;
        const balance = BigInt(grant.amount) - BigInt(grant.spent) - BigInt(grant.held);
        const hold = balance < left ? balance : left;
        left -= hold;
        await db.query('UPDATE findlink_control.grants SET held=held+$2 WHERE id=$1', [grant.id, hold.toString()]);
        await db.query('INSERT INTO findlink_control.ai_allocations VALUES($1,$2,$3,$4)', [actor.accountId, id, grant.id, hold.toString()]);
        await db.query(`INSERT INTO findlink_control.credit_ledger(account_id,grant_id,operation_id,action,amount) VALUES($1,$2,$3,'HOLD',$4)`,
          [actor.accountId, grant.id, id, hold.toString()]);
      }
      return receipt(operation.rows[0]);
    });
  }

  async function claim() {
    const candidate = (await pool.query(`SELECT account_id,id FROM findlink_control.ai_operations
      WHERE state='QUEUED' ORDER BY created_at LIMIT 1`)).rows[0];
    if (!candidate) return null;
    return transaction(pool, async db => {
      const account = await lockAccount(db, candidate.account_id);
      const rules = await policy(db, true);
      const { rows } = await db.query(`SELECT o.*,l.scope,l.epoch,l.ended_at,l.expires_at,d.key_hash,d.revoked_at,
        EXISTS(SELECT 1 FROM findlink_control.sessions s WHERE s.device_id=d.id AND s.refresh_until>now()) AS session_active,
        t.model,t.price,r.budget
        FROM findlink_control.ai_operations o JOIN findlink_control.leases l ON l.id=o.lease_id
        JOIN findlink_control.devices d ON d.id=l.device_id JOIN findlink_control.tariff_versions t ON t.id=o.route_id
        JOIN findlink_control.runs r ON r.account_id=o.account_id AND r.id=o.run_id
        WHERE o.account_id=$1 AND o.id=$2 AND o.state='QUEUED' FOR UPDATE OF o`, [candidate.account_id, candidate.id]);
      const row = rows[0];
      if (!row) return null;
      try {
        const current = await requireAction(db, { accountId: row.account_id, deviceTag: row.key_hash }, rules, row.scope, { ownHold: true, lockedAccount: account });
        if (!isManagedModel(row.model) || !modelCredential(config, row.model)) throw new ApiError(503, 'MODEL_NOT_AUTHORIZED');
        if (row.ended_at || row.revoked_at || !row.session_active || +row.expires_at <= +current.now || row.epoch !== account.epoch ||
          current.funding !== row.funding) throw new ApiError(403, 'RUN_LEASE_EXPIRED');
        const today = utcDay(current.now);
        await metered(db, row, today, rules, row.id);
        // The durable dispatch marker precedes the only outbound attempt.
        await db.query(`UPDATE findlink_control.ai_operations SET state='DISPATCHING',started_at=clock_timestamp(),budget_day=$3
          WHERE account_id=$1 AND id=$2`, [row.account_id, row.id, today]);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await finalize(db, row, null, 0n, error.code);
        return null;
      }
      return row;
    });
  }

  async function workOnce() {
    const row = await claim();
    if (!row) return false;
    const start = Date.now();
    let raw: string | undefined;
    let result: JsonModelResult | null = null;
    let cost: bigint | null = null;
    let error: string | null = null;
    try {
      const model = row.model, credential = modelCredential(config, model);
      if (!isManagedModel(model) || !credential) throw Error('MODEL_NOT_AUTHORIZED');
      const { url, headers } = modelEndpoint(model, credential);
      const response = await transport(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(deadline),
        headers, body: JSON.stringify(row.wire),
      });
      raw = await boundedResponse(response);
      let payload: Row | null = null;
      try { payload = JSON.parse(raw) as Row; } catch { error = 'MODEL_RESPONSE_NOT_JSON'; }
      const { usage, complete, generated, version } = parseModelResponse(model, payload);
      if (usage) cost = microsForUsd(pricedUsage(usage, row.price));
      if (!response.ok) error = 'MODEL_HTTP_' + response.status;
      else if (!error) {
        if (!complete) error = 'MODEL_INCOMPLETE_RESPONSE';
        else {
          try {
            let value: unknown = JSON.parse(generated);
            if (model === 'deepseek-flash') {
              const wrapper = record(value);
              if (!Object.hasOwn(wrapper, 'result') || Object.keys(wrapper).length !== 1) throw Error('MODEL_OUTPUT_NOT_JSON');
              value = wrapper.result;
            }
            result = { value, invocation_id: row.id, request_hash: row.request_hash, model,
              model_version: version,
              usage, cost_usd: cost === null ? null : Number(cost) / 1e9,
              unmetered_cost_upper_usd: cost === null ? Number(row.bound) / 1e9 : 0, cache_hit: false,
              elapsed_ms: Date.now() - start, price: row.price };
          } catch { error = 'MODEL_OUTPUT_NOT_JSON'; }
        }
      }
    } catch { error = 'MODEL_NETWORK_USAGE_UNKNOWN'; }
    await transaction(pool, async db => {
      await lockAccount(db, row.account_id);
      await policy(db, true);
      const locked = (await db.query('SELECT * FROM findlink_control.ai_operations WHERE account_id=$1 AND id=$2 FOR UPDATE',
        [row.account_id, row.id])).rows[0];
      if (locked?.state === 'DISPATCHING') await finalize(db, locked, result, cost, error ?? (cost === null ? 'MODEL_USAGE_UNKNOWN' : null), raw);
    });
    return true;
  }

  return {
    get, enqueue, workOnce,
    async recover() {
      // A crash cannot distinguish a submitted provider request from a dispatch intent.
      await pool.query(`UPDATE findlink_control.ai_operations SET state='UNKNOWN',error='MODEL_NETWORK_USAGE_UNKNOWN',wire=NULL,finished_at=now()
        WHERE state='DISPATCHING' AND started_at<now()-interval '2 minutes'`);
    },
    async reconcile(accountId: string, id: string, cost: bigint, evidence: string) {
      return transaction(pool, async db => {
        await lockAccount(db, accountId);
        await policy(db, true);
        const row = (await db.query('SELECT * FROM findlink_control.ai_operations WHERE account_id=$1 AND id=$2 FOR UPDATE', [accountId, id])).rows[0];
        if (row?.state !== 'UNKNOWN' || row.cost !== null) throw new ApiError(409, 'MODEL_RECONCILIATION_INVALID');
        const result = row.result ? { ...row.result, cost_usd: Number(cost) / 1e9, unmetered_cost_upper_usd: 0 } as JsonModelResult : null;
        await finalize(db, row, result, cost, result ? null : row.error);
        await audit(db, 'operator', 'AI_COST_RECONCILED', id, { cost: cost.toString(), evidence });
      });
    },
  };
}
