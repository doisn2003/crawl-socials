import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { STARTER_OFFER, TOPUP_CREDITS, type StarterOrder } from '../shared/managed.js';
import type { Principal } from './auth.js';
import type { BackendConfig } from './config.js';
import { ApiError, audit, bad, hash, integer, lockAccount, record, STARTER_CREDITS, string, uuid } from './core.js';
import { transaction, type Transaction } from './database.js';
import { grantCredits } from './entitlements.js';

export const STARTER_PRICE_VND = STARTER_OFFER.priceVnd;
const codePattern = /(?<![A-Z0-9])FL[A-F0-9]{12}(?![A-Z0-9])/g;
const starterVersion = 1;
const topupCredits = BigInt(TOPUP_CREDITS) * 1_000_000n;

export function yearAfter(date: Date) {
  const until = new Date(date);
  const day = until.getUTCDate(), month = until.getUTCMonth();
  until.setUTCDate(1);
  until.setUTCFullYear(until.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(until.getUTCFullYear(), month + 1, 0)).getUTCDate();
  until.setUTCDate(Math.min(day, lastDay));
  return until;
}

export function verifySePay(raw: Buffer, timestamp: unknown, signature: unknown, secret: string, now = Date.now()) {
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300 ||
      typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

function transactionDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(value.replace(' ', 'T') + '+07:00');
  if (!Number.isFinite(+parsed)) return null;
  if (new Date(+parsed + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') !== value) return null;
  return parsed;
}

async function fulfill(db: Transaction, order: Record<string, any>, payment: string) {
  if (order.paid_at) return;
  const { rows: [clock] } = await db.query('SELECT clock_timestamp() AS now');
  const prior = order.kind === 'STARTER' ? (await db.query(`SELECT max(ends_at) AS until FROM findlink_control.subscriptions
    WHERE account_id=$1 AND revoked_at IS NULL`, [order.account_id])).rows[0]?.until : null;
  const from = new Date(Math.max(+clock.now, prior ? +prior : 0)), until = yearAfter(from);
  await db.query('UPDATE findlink_control.orders SET paid_at=$2 WHERE id=$1', [order.id, clock.now]);
  await db.query('UPDATE findlink_control.payments SET state=\'APPLIED\',order_id=$2,reason=NULL WHERE provider_id=$1',
    [payment, order.id]);
  if (order.kind === 'STARTER') await db.query(`INSERT INTO findlink_control.subscriptions(id,account_id,order_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)`,
    [randomUUID(), order.account_id, order.id, from, until]);
  await grantCredits(db, { accountId: order.account_id, kind: order.kind, origin: 'order:' + order.id, from, until, amount: BigInt(order.credits) });
  await db.query(`INSERT INTO findlink_control.outbox(account_id,kind,payload) VALUES($1,'ENTITLEMENT_CHANGED',$2)`,
    [order.account_id, JSON.stringify({ orderId: order.id, startsAt: from, endsAt: until })]);
  await audit(db, 'sepay', order.kind + '_APPLIED', order.id, { payment });
}

export function createBilling(pool: Pool, config: BackendConfig) {
  const settings = () => {
    if (!config.sepay) throw new ApiError(503, 'CHECKOUT_UNAVAILABLE');
    return config.sepay;
  };
  const present = (row: Record<string, any>): StarterOrder => {
    const bank = settings();
    return { id: row.id, code: row.code, kind: row.kind, amountVnd: Number(row.amount_vnd), bank: bank.bank,
      accountNumber: bank.account, accountName: bank.name, expiresAt: row.expires_at.toISOString(), paid: !!row.paid_at,
      ...(bank.test ? { test: true as const } : {}),
      ...(row.period ? { startsAt: row.period.startsAt, endsAt: row.period.endsAt } : {}) };
  };

  async function createOrder(actor: Principal, value: unknown) {
    settings();
    const input = record(value), requestId = uuid(input.requestId), kind = input.kind ?? 'STARTER';
    if (kind !== 'STARTER' && kind !== 'TOPUP') throw bad('ORDER_KIND_INVALID');
    if (kind === 'TOPUP' && !config.topupPriceVnd) throw new ApiError(503, 'CHECKOUT_UNAVAILABLE');
    return transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId);
      if (account.suspended) throw new ApiError(403, 'ENTITLEMENT_REVOKED');
      if (!account.email_verified_at) throw new ApiError(403, 'INVITE_REQUIRED');
      if (kind === 'TOPUP') {
        const active = await db.query(`SELECT 1 FROM findlink_control.subscriptions WHERE account_id=$1 AND revoked_at IS NULL
          AND starts_at<=now() AND ends_at>now() LIMIT 1`, [actor.accountId]);
        if (!active.rowCount) throw new ApiError(403, 'SUBSCRIPTION_REQUIRED');
      }
      const prior = (await db.query(`SELECT * FROM findlink_control.orders WHERE account_id=$1
        AND (request_id=$2 OR (kind=$3 AND paid_at IS NULL AND expires_at>now())) ORDER BY (request_id=$2) DESC,created_at DESC LIMIT 1`,
        [actor.accountId, requestId, kind])).rows[0];
      if (prior && prior.kind !== kind) throw new ApiError(409, 'ORDER_IDEMPOTENCY_MISMATCH');
      if (prior) return present(prior);
      const id = randomUUID(), code = 'FL' + randomBytes(6).toString('hex').toUpperCase();
      const { rows } = await db.query(`INSERT INTO findlink_control.orders(id,account_id,code,kind,plan_version,amount_vnd,credits,expires_at,request_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours',$8) RETURNING *`,
        [id, actor.accountId, code, kind, starterVersion, kind === 'STARTER' ? STARTER_PRICE_VND : config.topupPriceVnd,
          (kind === 'STARTER' ? STARTER_CREDITS : topupCredits).toString(), requestId]);
      return present(rows[0]);
    });
  }

  async function order(actor: Principal, id: string) {
    const { rows } = await pool.query(`SELECT o.*,(SELECT e.payload FROM findlink_control.outbox e WHERE e.account_id=o.account_id
      AND e.kind='ENTITLEMENT_CHANGED' AND e.payload->>'orderId'=o.id::text ORDER BY e.id DESC LIMIT 1) AS period
      FROM findlink_control.orders o WHERE o.account_id=$1 AND o.id=$2`, [actor.accountId, id]);
    if (!rows[0]) throw new ApiError(404, 'ORDER_NOT_FOUND');
    return present(rows[0]);
  }

  async function webhook(raw: Buffer, timestamp: unknown, signature: unknown) {
    const bank = settings();
    if (!verifySePay(raw, timestamp, signature, bank.secret)) throw new ApiError(401, 'SEPAY_SIGNATURE_INVALID');
    let value: unknown;
    try { value = JSON.parse(raw.toString('utf8')); } catch { throw bad('SEPAY_PAYLOAD_INVALID'); }
    const body = record(value);
    if (body.transferType === 'out') return;
    if (body.transferType !== 'in') throw bad('SEPAY_DIRECTION_INVALID');
    if (body.accountNumber !== bank.account || typeof body.gateway !== 'string' || body.gateway.toLowerCase() !== bank.bank.toLowerCase()) {
      throw new ApiError(403, 'SEPAY_RECEIVER_MISMATCH');
    }
    const providerId = String(integer(body.id, 1, Number.MAX_SAFE_INTEGER));
    const amount = integer(body.transferAmount, 1, Number.MAX_SAFE_INTEGER);
    const received = transactionDate(body.transactionDate);
    const reference = body.referenceCode ? string(body.referenceCode, 150) : null;
    const memo = string(body.content, 3000, 0).toUpperCase();
    const explicitCode = typeof body.code === 'string' && /^FL[A-F0-9]{12}$/.test(body.code.toUpperCase()) ? body.code.toUpperCase() : null;
    const codes = [...new Set([...(explicitCode ? [explicitCode] : []), ...memo.matchAll(codePattern)].map(match => typeof match === 'string' ? match : match[0]!))];

    await transaction(pool, async db => {
      const candidate = codes.length === 1 ? (await db.query('SELECT id,account_id FROM findlink_control.orders WHERE code=$1', [codes[0]])).rows[0] : null;
      let matched;
      if (candidate) {
        await lockAccount(db, candidate.account_id);
        matched = (await db.query('SELECT * FROM findlink_control.orders WHERE id=$1 FOR UPDATE', [candidate.id])).rows[0];
      }
      const reason = body.currency !== undefined && body.currency !== 'VND' ? 'CURRENCY_MISMATCH'
        : !matched ? 'ORDER_CODE_UNMATCHED' : matched.paid_at ? 'ORDER_ALREADY_PAID'
        : Number(matched.amount_vnd) !== amount ? 'AMOUNT_MISMATCH'
        : !received || +received < +matched.created_at - 1000 || +received >= +matched.expires_at || +received > Date.now() + 300_000
          ? 'PAYMENT_TIME_OUTSIDE_ORDER' : null;
      const inserted = await db.query(`INSERT INTO findlink_control.payments(provider_id,order_id,amount_vnd,reference,state,reason,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider_id) DO NOTHING RETURNING provider_id`,
        [providerId, matched?.id ?? null, amount, reference, reason ? 'REVIEW' : 'RECEIVED', reason, hash(raw)]);
      if (inserted.rowCount && !reason) await fulfill(db, matched, providerId);
    });
  }

  async function reviewPayment(providerId: string, orderId: string, reason: string) {
    return transaction(pool, async db => {
      const order = (await db.query('SELECT account_id FROM findlink_control.orders WHERE id=$1', [orderId])).rows[0];
      if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND');
      await lockAccount(db, order.account_id);
      const target = (await db.query('SELECT * FROM findlink_control.orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
      const paid = (await db.query('SELECT * FROM findlink_control.payments WHERE provider_id=$1 FOR UPDATE', [providerId])).rows[0];
      if (!paid || paid.state !== 'REVIEW' || target.paid_at || Number(paid.amount_vnd) !== Number(target.amount_vnd)
        || paid.reason === 'CURRENCY_MISMATCH') throw new ApiError(409, 'PAYMENT_NOT_RECONCILABLE');
      await fulfill(db, target, providerId);
      await audit(db, 'operator', 'PAYMENT_RECONCILED', providerId, { orderId, reason });
    });
  }

  async function refund(providerId: string, reason: string) {
    return transaction(pool, async db => {
      const payment = (await db.query(`SELECT p.order_id,o.account_id FROM findlink_control.payments p
        JOIN findlink_control.orders o ON o.id=p.order_id WHERE p.provider_id=$1`, [providerId])).rows[0];
      if (!payment) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
      await lockAccount(db, payment.account_id);
      const current = await db.query(`UPDATE findlink_control.payments SET state='REFUNDED',reason=$2
        WHERE provider_id=$1 AND state='APPLIED' RETURNING provider_id`, [providerId, reason]);
      if (!current.rowCount) throw new ApiError(409, 'PAYMENT_NOT_REFUNDABLE');
      await db.query('UPDATE findlink_control.subscriptions SET revoked_at=now() WHERE order_id=$1', [payment.order_id]);
      const grant = (await db.query(`UPDATE findlink_control.grants SET revoked_at=now() WHERE origin=$1
        RETURNING id,(amount-spent-held)::text AS unused`, ['order:' + payment.order_id])).rows[0];
      if (grant) await db.query(`INSERT INTO findlink_control.credit_ledger(account_id,grant_id,operation_id,action,amount)
        VALUES($1,$2,$3,'REVOKE',$4)`, [payment.account_id, grant.id, 'refund:' + providerId, grant.unused]);
      await db.query('UPDATE findlink_control.accounts SET epoch=epoch+1 WHERE id=$1', [payment.account_id]);
      await audit(db, 'operator', 'PAYMENT_REFUND_RECORDED', providerId, { reason });
    });
  }

  return { createOrder, order, webhook, reviewPayment, refund };
}
