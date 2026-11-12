import { Pool, type PoolClient } from 'pg';
import { PROJECT_SCHEMA_SQL } from '../infrastructure/projects/schema.js';

export type Transaction = PoolClient;
export const CONTROL_SCHEMA_VERSION = 2;

export function database(url: string) {
  const pool = new Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 15_000, statement_timeout: 30_000, idle_in_transaction_session_timeout: 15_000 });
  pool.on('error', () => process.stderr.write('FINDLINK_POSTGRES_IDLE_ERROR\n'));
  return pool;
}

export async function transaction<T>(pool: Pool, work: (db: Transaction) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const value = await work(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

export async function migrate(pool: Pool) {
  await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('csd_backup_schema', 0))");
    const prior = await db.query("SELECT to_regclass('csd_backup.schema_migrations') IS NOT NULL AS installed");
    const baseline = prior.rows[0]?.installed ? await db.query('SELECT version FROM csd_backup.schema_migrations WHERE version=1') : null;
    if (!baseline?.rowCount) await db.query(PROJECT_SCHEMA_SQL);
    await db.query(CONTROL_SCHEMA);
    const installed = await db.query('SELECT version FROM findlink_control.migrations WHERE version=2');
    if (!installed.rowCount) {
      await db.query(`ALTER TABLE findlink_control.trial_subjects ADD COLUMN installation_tag text;
        CREATE INDEX trial_installation ON findlink_control.trial_subjects(installation_tag,started_at)
          WHERE installation_tag IS NOT NULL;`);
      await db.query('INSERT INTO findlink_control.migrations(version) VALUES(2)');
    }
  });
}

const CONTROL_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS findlink_control;
SET LOCAL search_path = findlink_control, pg_catalog;
CREATE TABLE IF NOT EXISTS migrations (
  version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY REFERENCES csd_backup.users(id), email text UNIQUE,
  email_verified_at timestamptz, suspended boolean NOT NULL DEFAULT false,
  epoch integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
  key_hash text NOT NULL, revoked_at timestamptz, seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, key_hash), UNIQUE(id, account_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, device_id uuid NOT NULL,
  access_hash text UNIQUE NOT NULL, refresh_hash text UNIQUE NOT NULL,
  access_until timestamptz NOT NULL, refresh_until timestamptz NOT NULL,
  FOREIGN KEY(device_id, account_id) REFERENCES devices(id, account_id)
);
CREATE INDEX IF NOT EXISTS sessions_device ON sessions(device_id);
CREATE TABLE IF NOT EXISTS refresh_replays (
  refresh_hash text PRIMARY KEY, session_id uuid NOT NULL, until_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  hash text PRIMARY KEY, email text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('TRIAL','ACCOUNT','RECOVERY')),
  account_id uuid REFERENCES accounts(id), expires_at timestamptz NOT NULL,
  redeemed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trial_subjects (
  id uuid PRIMARY KEY, account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
  email_tag text NOT NULL UNIQUE, device_tag text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  raw_count integer NOT NULL DEFAULT 0 CHECK (raw_count BETWEEN 0 AND 1000),
  reviewed boolean NOT NULL DEFAULT false, revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS trial_device ON trial_subjects(device_tag);
CREATE TABLE IF NOT EXISTS trial_roots (
  subject_id uuid NOT NULL REFERENCES trial_subjects(id), root_hash text NOT NULL,
  PRIMARY KEY(subject_id,root_hash)
);
CREATE TABLE IF NOT EXISTS trial_reviews (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
  device_tag text NOT NULL, reason text NOT NULL,
  resolved_at timestamptz, approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS open_trial_review ON trial_reviews(account_id) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS tariff_versions (
  id integer PRIMARY KEY, model text NOT NULL, price jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS policy (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  trial_enabled boolean NOT NULL DEFAULT false, pause_grants boolean NOT NULL DEFAULT true,
  pause_trial boolean NOT NULL DEFAULT true, pause_ai boolean NOT NULL DEFAULT true,
  max_trial_subjects integer NOT NULL DEFAULT 0 CHECK(max_trial_subjects >= 0),
  trial_subjects_per_day integer NOT NULL DEFAULT 0 CHECK(trial_subjects_per_day >= 0),
  trial_grant_cap bigint NOT NULL DEFAULT 0 CHECK(trial_grant_cap >= 0),
  trial_daily_cost bigint NOT NULL DEFAULT 0 CHECK(trial_daily_cost >= 0),
  trial_total_cost bigint NOT NULL DEFAULT 0 CHECK(trial_total_cost >= 0),
  paid_daily_cost bigint NOT NULL DEFAULT 0 CHECK(paid_daily_cost >= 0),
  paid_total_cost bigint NOT NULL DEFAULT 0 CHECK(paid_total_cost >= 0),
  route_id integer NOT NULL REFERENCES tariff_versions(id)
);
CREATE TABLE IF NOT EXISTS runs (
  account_id uuid NOT NULL REFERENCES accounts(id), id text NOT NULL, project_id uuid NOT NULL,
  route_id integer NOT NULL REFERENCES tariff_versions(id), created_at timestamptz NOT NULL DEFAULT now(),
  budget bigint NOT NULL DEFAULT 3000000000 CHECK(budget BETWEEN 0 AND 30000000000),
  PRIMARY KEY(account_id, id)
);
CREATE TABLE IF NOT EXISTS leases (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, run_id text NOT NULL, device_id uuid NOT NULL,
  scope text NOT NULL CHECK(scope IN ('PLAN','COLLECT','COLLECT_AI','ASSESS')),
  epoch integer NOT NULL, expires_at timestamptz NOT NULL, ended_at timestamptz,
  FOREIGN KEY(account_id,run_id) REFERENCES runs(account_id,id),
  FOREIGN KEY(device_id,account_id) REFERENCES devices(id,account_id)
);
CREATE INDEX IF NOT EXISTS leases_active ON leases(account_id,expires_at) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), code text UNIQUE NOT NULL,
  kind text NOT NULL CHECK(kind IN ('STARTER','TOPUP')), plan_version integer NOT NULL,
  amount_vnd bigint NOT NULL CHECK(amount_vnd > 0), credits bigint NOT NULL CHECK(credits > 0),
  currency text NOT NULL DEFAULT 'VND' CHECK(currency='VND'),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, paid_at timestamptz,
  request_id uuid NOT NULL, UNIQUE(account_id,request_id)
);
CREATE TABLE IF NOT EXISTS payments (
  provider_id text PRIMARY KEY, order_id uuid REFERENCES orders(id), amount_vnd bigint NOT NULL,
  reference text, state text NOT NULL CHECK(state IN ('RECEIVED','REVIEW','APPLIED','REFUNDED')),
  reason text, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS applied_payment ON payments(order_id) WHERE state IN ('APPLIED','REFUNDED');
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), order_id uuid UNIQUE NOT NULL REFERENCES orders(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS subscription_window ON subscriptions(account_id, starts_at, ends_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS grants (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK(kind IN ('TRIAL','STARTER','TOPUP','ADJUSTMENT')),
  origin text UNIQUE NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, revoked_at timestamptz,
  amount bigint NOT NULL CHECK(amount > 0), spent bigint NOT NULL DEFAULT 0 CHECK(spent >= 0),
  held bigint NOT NULL DEFAULT 0 CHECK(held >= 0), CHECK(spent + held <= amount)
);
CREATE INDEX IF NOT EXISTS wallet_window ON grants(account_id,ends_at);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
  grant_id uuid NOT NULL REFERENCES grants(id), operation_id text NOT NULL,
  action text NOT NULL CHECK(action IN ('GRANT','HOLD','CHARGE','RELEASE','REFUND','REVOKE')),
  amount bigint NOT NULL CHECK(amount >= 0), at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(grant_id,operation_id,action)
);
CREATE INDEX IF NOT EXISTS credit_history ON credit_ledger(account_id,id DESC);
CREATE TABLE IF NOT EXISTS ai_operations (
  account_id uuid NOT NULL, id text NOT NULL, run_id text NOT NULL, lease_id uuid NOT NULL REFERENCES leases(id),
  route_id integer NOT NULL REFERENCES tariff_versions(id), purpose text NOT NULL, request_hash text NOT NULL,
  wire jsonb, bound bigint NOT NULL CHECK(bound > 0), cost bigint, charge bigint,
  funding text NOT NULL CHECK(funding IN ('TRIAL','PAID')),
  state text NOT NULL CHECK(state IN ('QUEUED','DISPATCHING','DONE','FAILED','UNKNOWN')),
  budget_day date NOT NULL, started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  result jsonb, raw_response text, error text,
  PRIMARY KEY(account_id,id), FOREIGN KEY(account_id,run_id) REFERENCES runs(account_id,id)
);
CREATE INDEX IF NOT EXISTS ai_queue ON ai_operations(created_at) WHERE state='QUEUED';
CREATE INDEX IF NOT EXISTS ai_dispatch ON ai_operations(started_at) WHERE state='DISPATCHING';
CREATE INDEX IF NOT EXISTS ai_budget ON ai_operations(funding,budget_day);
CREATE TABLE IF NOT EXISTS ai_allocations (
  account_id uuid NOT NULL, operation_id text NOT NULL, grant_id uuid NOT NULL REFERENCES grants(id),
  amount bigint NOT NULL CHECK(amount > 0), PRIMARY KEY(account_id,operation_id,grant_id),
  FOREIGN KEY(account_id,operation_id) REFERENCES ai_operations(account_id,id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL, payload jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_account ON outbox(account_id,id);
CREATE TABLE IF NOT EXISTS audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL,
  action text NOT NULL, target text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_otp (
  step bigint PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS backup_stages (
  id uuid PRIMARY KEY, account_id uuid NOT NULL UNIQUE REFERENCES accounts(id), project_id uuid NOT NULL,
  fingerprint text NOT NULL, metadata jsonb NOT NULL, manifest jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours'
);
CREATE TABLE IF NOT EXISTS backup_stage_files (
  stage_id uuid NOT NULL REFERENCES backup_stages(id) ON DELETE CASCADE, path text NOT NULL,
  content bytea NOT NULL, PRIMARY KEY(stage_id,path)
);
INSERT INTO tariff_versions(id,model,price) VALUES(1,'gemini-3.1-flash-lite',
  '{"input_per_million":0.25,"output_per_million":1.50,"cached_input_per_million":0.025,"observed_at":"2026-10-30","source":"https://ai.google.dev/gemini-api/docs/pricing"}')
ON CONFLICT DO NOTHING;
INSERT INTO policy(route_id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
