import { randomUUID, sign } from 'node:crypto';
import type { Pool } from 'pg';
import { TRIAL_INSTALLATION_REVIEW_DAYS, TRIAL_OFFER, type ManagedLease, type ManagedScope, type ManagedStatus, type SignedLease } from '../shared/managed.js';
import type { Principal } from './auth.js';
import type { BackendConfig } from './config.js';
import { requireModelCredential, trialCredential } from './model-credentials.js';
import { ApiError, audit, bad, hex, lockAccount, micros, policy, record, runId, tag, TRIAL_CREDITS, TRIAL_RAW_LIMIT, uuid } from './core.js';
import { transaction, type Transaction } from './database.js';

export const LEASE_SECONDS = 120;
const scopes = new Set<ManagedScope>(['PLAN', 'COLLECT', 'COLLECT_AI', 'ASSESS']);
const hasAI = (scope: ManagedScope) => scope !== 'COLLECT';

export async function grantCredits(db: Transaction, input: { accountId: string; kind: 'TRIAL' | 'STARTER' | 'TOPUP' | 'ADJUSTMENT'; origin: string; from: Date; until: Date; amount: bigint }) {
  const id = randomUUID();
  await db.query(`INSERT INTO findlink_control.grants(id,account_id,kind,origin,starts_at,ends_at,amount)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, input.accountId, input.kind, input.origin, input.from, input.until, input.amount.toString()]);
  await db.query(`INSERT INTO findlink_control.credit_ledger(account_id,grant_id,operation_id,action,amount)
    VALUES($1,$2,$3,'GRANT',$4)`, [input.accountId, id, input.origin, input.amount.toString()]);
  return id;
}

export async function entitlement(db: Transaction, accountId: string, controls: Record<string, unknown>, lockedAccount?: Record<string, unknown>) {
  const account = lockedAccount ?? await lockAccount(db, accountId);
  const { rows: [clock] } = await db.query('SELECT clock_timestamp() AS now');
  const now = clock.now as Date;
  const paid = (await db.query(`SELECT ends_at FROM findlink_control.subscriptions WHERE account_id=$1
    AND revoked_at IS NULL AND starts_at<=$2 AND ends_at>$2 ORDER BY ends_at DESC LIMIT 1`, [accountId, now])).rows[0];
  const hadPaid = !!paid || !!(await db.query('SELECT 1 FROM findlink_control.subscriptions WHERE account_id=$1 LIMIT 1', [accountId])).rowCount;
  const trial = (await db.query('SELECT * FROM findlink_control.trial_subjects WHERE account_id=$1', [accountId])).rows[0];
  const funding = paid ? 'PAID' as const : 'TRIAL' as const;
  const balances = (await db.query(`SELECT coalesce(sum(amount-spent-held),0)::text AS available,
    coalesce(sum(spent),0)::text AS spent,coalesce(sum(held),0)::text AS held
    FROM findlink_control.grants WHERE account_id=$1 AND revoked_at IS NULL AND starts_at<=$2 AND ends_at>$2
    AND (kind='TRIAL')=$3`, [accountId, now, !paid])).rows[0];
  let reason: string | null = null;
  if (account.suspended) reason = 'ENTITLEMENT_REVOKED';
  else if (hadPaid && !paid) reason = 'SUBSCRIPTION_REQUIRED';
  else if (!paid) {
    if (!trial) reason = 'SUBSCRIPTION_REQUIRED';
    else if (trial.revoked) reason = 'TRIAL_REVOKED';
    else if (+trial.expires_at <= +now) reason = 'TRIAL_EXPIRED';
    else if (trial.raw_count >= TRIAL_RAW_LIMIT) reason = 'TRIAL_EXHAUSTED';
    else if (!controls.trial_enabled || controls.pause_trial) reason = 'TRIAL_FUNDING_PAUSED';
    else if (BigInt(balances.available) === 0n) reason = BigInt(balances.held) > 0n ? 'TRIAL_CREDITS_HELD' : 'TRIAL_EXHAUSTED';
  }
  const until: Date | null = paid?.ends_at ?? trial?.expires_at ?? null;
  const status: ManagedStatus = { state: paid ? 'STARTER' : trial && !hadPaid ? 'TRIAL' : 'INACTIVE', reason,
    available: hadPaid && !paid ? '0' : balances.available, held: balances.held, spent: balances.spent, verified: !!account.email_verified_at,
    until: hadPaid && !paid ? null : until?.toISOString() ?? null, rawRemaining: !hadPaid && trial ? Math.max(0, TRIAL_RAW_LIMIT - trial.raw_count) : null };
  return { account, status, trial, funding, now, until, hadPaid };
}

export async function requireAction(db: Transaction, actor: Pick<Principal,'accountId'|'deviceTag'>, controls: Record<string, unknown>,
  scope: ManagedScope, options: { ownHold?: boolean; lockedAccount?: Record<string, unknown> } = {}) {
  const current = await entitlement(db, actor.accountId, controls, options.lockedAccount);
  const reason = current.status.reason;
  if (reason && !(options.ownHold && reason === 'TRIAL_CREDITS_HELD')) throw new ApiError(403, reason);
  if (current.funding === 'TRIAL' && current.trial.device_tag !== actor.deviceTag) throw new ApiError(403, 'TRIAL_DEVICE_MISMATCH');
  if ((scope === 'PLAN' || scope === 'ASSESS' || options.ownHold) && controls.pause_ai) throw new ApiError(503, 'MODEL_NOT_AUTHORIZED');
  if (hasAI(scope) && scope !== 'COLLECT_AI' && !options.ownHold && BigInt(current.status.available) === 0n) {
    throw new ApiError(402, 'MODEL_BUDGET_EXHAUSTED');
  }
  return current;
}

export function createEntitlements(pool: Pool, config: BackendConfig) {
  const signed = (lease: ManagedLease): SignedLease => ({
    lease, signature: sign(null, Buffer.from(JSON.stringify(lease)), config.leaseKey).toString('base64'),
  });

  async function latestReview(db: Transaction, accountId: string) {
    const { rows } = await db.query<{ approved: boolean; resolved_at: Date | null; device_tag: string }>(
      `SELECT approved,resolved_at,device_tag FROM findlink_control.trial_reviews
        WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [accountId]);
    return rows[0];
  }

  async function status(actor: Principal) {
    return transaction(pool, async db => {
      const rules = await policy(db);
      const value = await entitlement(db, actor.accountId, rules);
      if (value.funding === 'TRIAL' && value.trial && !value.status.reason && value.trial.device_tag !== actor.deviceTag) {
        value.status.reason = 'TRIAL_DEVICE_MISMATCH';
      }
      if (value.status.state === 'INACTIVE' && !value.hadPaid && value.status.reason === 'SUBSCRIPTION_REQUIRED') {
        const review = await latestReview(db, actor.accountId);
        if (review && (!review.resolved_at || !review.approved)) value.status.reason = 'TRIAL_REVIEW_REQUIRED';
      }
      value.status.checkoutAvailable = config.sepay !== null;
      if (config.sepay && value.status.state === 'STARTER' && config.topupPriceVnd !== undefined) value.status.topupPriceVnd = config.topupPriceVnd;
      if (value.funding === 'PAID' && !value.status.reason) {
        try {
          await requireModelCredential(db, config, actor.accountId, 'PAID', rules.route_model);
          if (rules.pause_ai) value.status.aiReason = 'MODEL_NOT_AUTHORIZED';
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          value.status.aiReason = error.code;
        }
      }
      return value.status;
    });
  }

  async function activate(actor: Principal, installationTag?: string) {
    const installation = installationTag ? tag(config.identityKey, 'trial-windows-installation', installationTag) : null;
    const reason = await transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId);
      const rules = await policy(db, true);
      const current = await entitlement(db, actor.accountId, rules, account);
      if (account.suspended) throw new ApiError(403, 'ENTITLEMENT_REVOKED');
      if (current.trial || current.hadPaid) return null;
      if (!account.email_verified_at || !account.email) throw new ApiError(403, 'INVITE_REQUIRED');
      const invite = await db.query(`SELECT 1 FROM findlink_control.invites WHERE account_id=$1 AND email=$2
        AND purpose='TRIAL' AND redeemed_at IS NOT NULL LIMIT 1`, [actor.accountId, account.email]);
      if (!invite.rowCount) throw new ApiError(403, 'INVITE_REQUIRED');
      if (!rules.trial_enabled || rules.pause_grants || rules.pause_trial || rules.pause_ai || !trialCredential(config, rules.trial_route_model)
        || BigInt(rules.trial_daily_cost) <= 0n || BigInt(rules.trial_total_cost) <= 0n) throw new ApiError(503, 'TRIAL_FUNDING_PAUSED');
      const emailTag = tag(config.identityKey, 'trial-email', account.email);
      const used = await db.query('SELECT 1 FROM findlink_control.trial_subjects WHERE email_tag=$1', [emailTag]);
      if (used.rowCount) throw new ApiError(409, 'TRIAL_ALREADY_CLAIMED');
      const review = await latestReview(db, actor.accountId);
      if (review && (!review.resolved_at || !review.approved)) return 'TRIAL_REVIEW_REQUIRED';
      const approved = review?.device_tag === actor.deviceTag;
      let risk: string | null = null;
      if (review && !approved) risk = 'REVIEW_DEVICE_CHANGED';
      if (!review) {
        const { rows: [reuse] } = await db.query(`SELECT
          EXISTS (SELECT 1 FROM findlink_control.trial_subjects WHERE device_tag=$1) AS device,
          EXISTS (SELECT 1 FROM findlink_control.trial_subjects WHERE installation_tag=$2
            AND started_at > $3::timestamptz - $4::int * interval '1 day') AS installation`,
          [actor.deviceTag, installation, current.now, TRIAL_INSTALLATION_REVIEW_DAYS]);
        if (reuse.device) risk = 'DEVICE_REUSE';
        else if (reuse.installation) risk = 'WINDOWS_INSTALLATION_REUSE';
      }
      if (risk) {
        await db.query(`INSERT INTO findlink_control.trial_reviews(id,account_id,device_tag,reason)
          VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [randomUUID(), actor.accountId, actor.deviceTag, risk]);
        return 'TRIAL_REVIEW_REQUIRED';
      }
      const limits = (await db.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE (started_at AT TIME ZONE 'UTC')::date=($1::timestamptz AT TIME ZONE 'UTC')::date)::int AS today
        FROM findlink_control.trial_subjects`, [current.now])).rows[0];
      const obligations = (await db.query(`SELECT coalesce(sum(CASE WHEN ends_at>$1 AND revoked_at IS NULL
        THEN amount ELSE spent+held END),0)::text AS amount FROM findlink_control.grants WHERE kind='TRIAL'`, [current.now])).rows[0];
      if (limits.total >= rules.max_trial_subjects || limits.today >= rules.trial_subjects_per_day ||
        BigInt(obligations.amount) + TRIAL_CREDITS > BigInt(rules.trial_grant_cap)) throw new ApiError(503, 'TRIAL_FUNDING_PAUSED');
      const subject = randomUUID(), until = new Date(+current.now + TRIAL_OFFER.days * 86_400_000);
      await db.query(`INSERT INTO findlink_control.trial_subjects(id,account_id,email_tag,device_tag,started_at,expires_at,reviewed,installation_tag)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [subject, actor.accountId, emailTag, actor.deviceTag, current.now, until, approved, installation]);
      await grantCredits(db, { accountId: actor.accountId, kind: 'TRIAL', origin: 'trial:' + subject, from: current.now, until, amount: TRIAL_CREDITS });
      await audit(db, actor.accountId, 'TRIAL_ACTIVATED', subject);
      return null;
    });
    if (reason) throw new ApiError(403, reason);
    return status(actor);
  }

  async function getLease(db: Transaction, actor: Principal, id: string) {
    const { rows } = await db.query(`SELECT l.*,r.project_id,r.route_id,t.model,t.price FROM findlink_control.leases l
      JOIN findlink_control.runs r ON r.account_id=l.account_id AND r.id=l.run_id
      JOIN findlink_control.tariff_versions t ON t.id=r.route_id
      WHERE l.id=$1 AND l.account_id=$2 AND l.device_id=$3 FOR UPDATE OF l`, [id, actor.accountId, actor.deviceId]);
    if (!rows[0]) throw new ApiError(403, 'RUN_LEASE_INVALID');
    return rows[0];
  }

  async function issue(actor: Principal, value: unknown) {
    const body = record(value);
    const id = runId(body.runId), projectId = uuid(body.projectId), scope = body.scope as ManagedScope;
    if (!scopes.has(scope)) throw bad('RUN_SCOPE_INVALID');
    const budget = micros(body.budget, 30_000_000_000n).toString();
    return transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId);
      const rules = await policy(db);
      const current = await requireAction(db, actor, rules, scope, { lockedAccount: account });
      const existing = (await db.query(`SELECT * FROM findlink_control.leases WHERE account_id=$1 AND ended_at IS NULL
        AND expires_at>$2 AND epoch=$3 LIMIT 1`, [actor.accountId, current.now, account.epoch])).rows[0];
      if (existing && (existing.run_id !== id || existing.device_id !== actor.deviceId || existing.scope !== scope)) {
        throw new ApiError(409, 'RUN_LEASE_BUSY');
      }
      const project = (await db.query('SELECT owner_id,deleted_at FROM csd_backup.projects WHERE id=$1', [projectId])).rows[0];
      if (project && (project.owner_id !== actor.accountId || project.deleted_at)) throw new ApiError(403, 'PROJECT_ACCESS_DENIED');
      if (current.funding === 'TRIAL') {
        const first = (await db.query('SELECT project_id FROM findlink_control.runs WHERE account_id=$1 ORDER BY created_at LIMIT 1', [actor.accountId])).rows[0];
        if (first && first.project_id !== projectId) throw new ApiError(403, 'TRIAL_PROJECT_LIMIT');
      } else {
        const { rows } = await db.query(`SELECT id FROM csd_backup.projects WHERE owner_id=$1 AND deleted_at IS NULL
          UNION SELECT r.project_id AS id FROM findlink_control.runs r
          LEFT JOIN csd_backup.projects p ON p.id=r.project_id
          WHERE r.account_id=$1 AND (p.id IS NULL OR (p.owner_id=$1 AND p.deleted_at IS NULL))`, [actor.accountId]);
        if (rows.length >= 5 && !rows.some(row => row.id === projectId)) throw new ApiError(403, 'PROJECT_LIMIT_REACHED');
      }
      const defaultRoute = current.funding === 'TRIAL' ? rules.trial_route_id : rules.route_id;
      await db.query(`INSERT INTO findlink_control.runs(account_id,id,project_id,route_id,budget) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(account_id,id) DO UPDATE SET budget=least(runs.budget,excluded.budget)`, [actor.accountId, id, projectId, defaultRoute, budget]);
      const route = (await db.query(`SELECT r.project_id,r.route_id,t.model,t.price FROM findlink_control.runs r
        JOIN findlink_control.tariff_versions t ON t.id=r.route_id WHERE r.account_id=$1 AND r.id=$2`, [actor.accountId, id])).rows[0];
      if (route.project_id !== projectId) throw new ApiError(409, 'RUN_PROJECT_MISMATCH');
      if (scope === 'PLAN' || scope === 'ASSESS') await requireModelCredential(db, config, actor.accountId, current.funding, route.model);
      const expiresAt = Math.min(+current.now + LEASE_SECONDS * 1000, +current.until!);
      const leaseId = existing?.id ?? randomUUID();
      if (existing) await db.query('UPDATE findlink_control.leases SET expires_at=$2 WHERE id=$1', [leaseId, new Date(expiresAt)]);
      else await db.query(`INSERT INTO findlink_control.leases(id,account_id,run_id,device_id,scope,epoch,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [leaseId, actor.accountId, id, actor.deviceId, scope, account.epoch, new Date(expiresAt)]);
      return signed({ id: leaseId, accountId: actor.accountId, deviceId: actor.deviceId, epoch: Number(account.epoch), runId: id, projectId, scope, issuedAt: +current.now, expiresAt,
        model: route.model, route: route.route_id, price: route.price, rawRemaining: current.status.rawRemaining });
    });
  }

  async function renew(actor: Principal, id: string) {
    return transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId), lease = await getLease(db, actor, id);
      const current = await requireAction(db, actor, await policy(db), lease.scope, { lockedAccount: account });
      if (lease.ended_at || +lease.expires_at <= +current.now || lease.epoch !== account.epoch) throw new ApiError(403, 'RUN_LEASE_EXPIRED');
      if (lease.scope === 'PLAN' || lease.scope === 'ASSESS') await requireModelCredential(db, config, actor.accountId, current.funding, lease.model);
      const expiresAt = Math.min(+current.now + LEASE_SECONDS * 1000, +current.until!);
      await db.query('UPDATE findlink_control.leases SET expires_at=$2 WHERE id=$1', [id, new Date(expiresAt)]);
      return signed({ id, accountId: actor.accountId, deviceId: actor.deviceId, epoch: Number(account.epoch), runId: lease.run_id, projectId: lease.project_id, scope: lease.scope, issuedAt: +current.now,
        expiresAt, model: lease.model, route: lease.route_id, price: lease.price, rawRemaining: current.status.rawRemaining });
    });
  }

  async function reportRaw(actor: Principal, id: string, value: unknown) {
    const roots = record(value).roots;
    if (!Array.isArray(roots) || roots.length > 1000) throw bad('TRIAL_ROOTS_INVALID');
    const hashes = [...new Set(roots.map(hex))];
    return transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId);
      const lease = await getLease(db, actor, id);
      if (!['COLLECT','COLLECT_AI'].includes(lease.scope)) throw new ApiError(403, 'RUN_LEASE_INVALID');
      const access = await requireAction(db, actor, await policy(db), lease.scope, { lockedAccount: account });
      if (lease.ended_at || +lease.expires_at <= +access.now || lease.epoch !== account.epoch) throw new ApiError(403, 'RUN_LEASE_EXPIRED');
      if (access.funding === 'PAID') return { rawRemaining: null, accepted: hashes };
      const trial = access.trial;
      const remaining = Math.max(0, TRIAL_RAW_LIMIT - trial.raw_count);
      const inserted = await db.query(`INSERT INTO findlink_control.trial_roots(subject_id,root_hash)
        SELECT $1,x FROM unnest($2::text[]) AS t(x)
        WHERE NOT EXISTS(SELECT 1 FROM findlink_control.trial_roots WHERE subject_id=$1 AND root_hash=x)
        LIMIT $3 ON CONFLICT DO NOTHING`, [trial.id, hashes, remaining]);
      const count = inserted.rowCount ?? 0;
      if (count) await db.query('UPDATE findlink_control.trial_subjects SET raw_count=raw_count+$2 WHERE id=$1', [trial.id, count]);
      const accepted = (await db.query('SELECT root_hash FROM findlink_control.trial_roots WHERE subject_id=$1 AND root_hash=ANY($2::text[])',
        [trial.id, hashes])).rows.map(row => String(row.root_hash));
      return { rawRemaining: remaining - count, accepted };
    });
  }

  return {
    status, activate, issue, renew, reportRaw,
    async pruneInstallationTags() {
      await pool.query(`UPDATE findlink_control.trial_subjects SET installation_tag=NULL
        WHERE installation_tag IS NOT NULL AND started_at<=now()-$1::int * interval '1 day'`, [TRIAL_INSTALLATION_REVIEW_DAYS]);
    },
    async release(actor: Principal, id: string) {
      await pool.query('UPDATE findlink_control.leases SET ended_at=now() WHERE id=$1 AND account_id=$2 AND device_id=$3 AND ended_at IS NULL',
        [id, actor.accountId, actor.deviceId]);
    },
  };
}
