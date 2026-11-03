import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ModelGatewayError } from '../../application/ports/model-gateway.js';

export const REBUILD_MODEL = 'gemini-2.5-flash-lite';
export const SPEND_DIRECTORY = join(homedir(), '.csd', 'spending');
export interface SpendEnvelope { scope: 'USER' | 'DEVELOPMENT'; model: string; totalUsd: number; dailyUsd: number; maxCalls: number; }
export interface SpendStatus { measuredUsd: number; heldUsd: number; remainingUsd: number; dailyRemainingUsd: number; calls: number; }
const units = (usd: number) => Math.ceil(usd * 1e9);
const dayOf = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** One account per user/development, deliberately independent of campaign, worktree and key.
 * Unsettled reservations remain charged after a crash; time never releases unknown usage. */
export function createDurableSpend(options: { envelope: () => SpendEnvelope; file?: string; now?: () => Date }) {
  const file = options.file ?? join(SPEND_DIRECTORY, 'ledger.sqlite');
  const now = options.now ?? (() => new Date());
  function transact<T>(work: (db: DatabaseSync, envelope: SpendEnvelope) => T): T {
    const e = options.envelope();
    if (!e || !['USER', 'DEVELOPMENT'].includes(e.scope) || e.model !== REBUILD_MODEL
      || ![e.totalUsd, e.dailyUsd].every(v => Number.isFinite(v) && v >= 0 && v <= 10000)
      || !Number.isSafeInteger(e.maxCalls) || e.maxCalls < 0) throw new ModelGatewayError('MODEL_SPEND_POLICY_INVALID');
    mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      db.exec(`CREATE TABLE IF NOT EXISTS spending (id TEXT PRIMARY KEY, scope TEXT NOT NULL, model TEXT NOT NULL,
        day TEXT NOT NULL, at INTEGER NOT NULL, pid INTEGER NOT NULL, held INTEGER NOT NULL, measured INTEGER, settled INTEGER NOT NULL DEFAULT 0)`);
      db.exec('BEGIN IMMEDIATE');
      try { const result = work(db, e); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  }
  function totals(db: DatabaseSync, e: SpendEnvelope) {
    return db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(COALESCE(measured,held)),0) AS used,
      COALESCE(SUM(measured),0) AS measured, COALESCE(SUM(CASE WHEN measured IS NULL THEN held ELSE 0 END),0) AS held,
      COALESCE(SUM(CASE WHEN day=? THEN COALESCE(measured,held) ELSE 0 END),0) AS daily
      FROM spending WHERE scope=?`).get(dayOf(now()), e.scope) as { calls: number; used: number; measured: number; held: number; daily: number };
  }
  return {
    reserve(model: string, upperUsd: number): string {
      if (!Number.isFinite(upperUsd) || upperUsd < 0) throw new ModelGatewayError('MODEL_SPEND_AMOUNT_INVALID');
      return transact((db, e) => {
        if (model !== e.model) throw new ModelGatewayError('MODEL_NOT_AUTHORIZED');
        const t = totals(db, e), upper = units(upperUsd);
        if (t.calls >= e.maxCalls) throw new ModelGatewayError('MODEL_CALL_LIMIT_REACHED');
        if (t.used + upper > units(e.totalUsd) || t.daily + upper > units(e.dailyUsd)) {
          const active = db.prepare('SELECT pid FROM spending WHERE scope=? AND settled=0 AND at>?').all(e.scope, now().getTime() - 120000);
          const alive = active.some(row => { try { process.kill(Number(row.pid), 0); return true; } catch { return false; } });
          throw new ModelGatewayError(alive ? 'MODEL_BUDGET_BUSY' : 'MODEL_GLOBAL_BUDGET_EXHAUSTED');
        }
        const id = randomUUID();
        db.prepare('INSERT INTO spending(id,scope,model,day,at,pid,held) VALUES(?,?,?,?,?,?,?)').run(id, e.scope, model, dayOf(now()), now().getTime(), process.pid, upper);
        return id;
      });
    },
    settle(id: string, costUsd: number | null) {
      if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd < 0)) throw new ModelGatewayError('MODEL_SPEND_AMOUNT_INVALID');
      transact(db => { db.prepare('UPDATE spending SET measured=?,settled=1 WHERE id=? AND settled=0').run(costUsd === null ? null : units(costUsd), id); });
    },
    status(): SpendStatus {
      return transact((db, e) => { const t = totals(db, e); return { measuredUsd: t.measured / 1e9, heldUsd: t.held / 1e9,
        remainingUsd: Math.max(0, units(e.totalUsd) - t.used) / 1e9, dailyRemainingUsd: Math.max(0, units(e.dailyUsd) - t.daily) / 1e9, calls: t.calls }; });
    },
  };
}
export type DurableSpend = ReturnType<typeof createDurableSpend>;

/** Created only after an explicit spending authorization; no environment/key implies consent. */
export function developmentSpend(): DurableSpend {
  return createDurableSpend({ envelope: () => {
    let e: SpendEnvelope;
    try { e = JSON.parse(readFileSync(join(SPEND_DIRECTORY, 'development-authorization.json'), 'utf8')) as SpendEnvelope; }
    catch { throw new ModelGatewayError('MODEL_SPEND_AUTH_REQUIRED'); }
    if (e.scope !== 'DEVELOPMENT') throw new ModelGatewayError('MODEL_SPEND_POLICY_INVALID');
    return e;
  } });
}
