import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DiscoverySubscription } from '../../shared/discovery-watch.js';

export function deliveryMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(date);
}
export const exportDigest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const validRun = (v: string) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const validId = (v: string) => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const validError = (v: unknown) => v === null || (typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(v));
export function createDiscoveryStore(file: string, now: () => Date = () => new Date()) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, source_run TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
      enabled INTEGER NOT NULL, interval_hours INTEGER NOT NULL, monthly_target INTEGER NOT NULL, next_at TEXT NOT NULL,
      last_run TEXT, active_run TEXT, awaiting_export INTEGER NOT NULL DEFAULT 0, expected_count INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS discovery_runs(run_id TEXT PRIMARY KEY, scope TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(scope TEXT NOT NULL, root_key TEXT NOT NULL, first_at TEXT NOT NULL, month TEXT NOT NULL,
      export_id TEXT NOT NULL, PRIMARY KEY(scope,root_key));
    CREATE TABLE IF NOT EXISTS delivery_exports(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, scope TEXT NOT NULL,
      roots TEXT NOT NULL, destination TEXT NOT NULL, digest TEXT NOT NULL, at TEXT NOT NULL, month TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0, error TEXT);`);
  // Additive migration: preserve receipts and first-delivery history from earlier versions.
  if (!db.prepare('PRAGMA table_info(subscriptions)').all().some(row => row.name === 'expected_count'))
    db.exec('ALTER TABLE subscriptions ADD COLUMN expected_count INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(delivery_exports)').all().some(row => row.name === 'error'))
    db.exec('ALTER TABLE delivery_exports ADD COLUMN error TEXT');
  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function scope(runId: string): string {
    if (!validRun(runId)) throw Error('DISCOVERY_RUN_INVALID');
    const value = String(db.prepare('SELECT scope FROM discovery_runs WHERE run_id=?').get(runId)?.scope ?? runId);
    if (!validRun(value)) throw Error('DISCOVERY_SCOPE_INVALID');
    return value;
  }
  function exportedCount(runId: string): number {
    if (!validRun(runId)) throw Error('DISCOVERY_RUN_INVALID');
    return Number(db.prepare(`SELECT COUNT(DISTINCT j.value) AS n FROM delivery_exports e, json_each(e.roots) j
      WHERE e.run_id=? AND e.complete=1`).get(runId)!.n);
  }
  function receiptRoots(value: unknown): string[] {
    let roots: unknown;
    try { roots = JSON.parse(String(value)); } catch { throw Error('DELIVERY_RECEIPT_INVALID'); }
    if (!Array.isArray(roots) || roots.length > 50000 || roots.some(k => typeof k !== 'string' || !/^(facebook|threads):[^\s:]{1,200}$/u.test(k))) throw Error('DELIVERY_RECEIPT_INVALID');
    return [...new Set(roots as string[])];
  }
  function fileMatches(destination: string, digest: string): void {
    if (!isAbsolute(destination) || destination.includes('\0') || !/^[a-f0-9]{64}$/.test(digest)) throw Error('DELIVERY_RECEIPT_INVALID');
    if (!existsSync(destination)) throw Error('DELIVERY_FILE_MISSING');
    let actual: string;
    try { actual = exportDigest(destination); } catch { throw Error('DELIVERY_FILE_UNREADABLE'); }
    if (actual !== digest) throw Error('DELIVERY_FILE_MISMATCH');
  }
  function completeExport(id: string) {
    if (!validId(id)) throw Error('DELIVERY_INPUT_INVALID');
    transaction(() => {
      const row = db.prepare('SELECT * FROM delivery_exports WHERE id=?').get(id);
      if (!row) throw Error('DELIVERY_RECEIPT_MISSING');
      if (row.complete) return;
      if (!validRun(String(row.scope)) || !validRun(String(row.run_id))) throw Error('DELIVERY_RECEIPT_INVALID');
      fileMatches(String(row.destination), String(row.digest));
      for (const key of receiptRoots(row.roots)) {
        db.prepare('INSERT OR IGNORE INTO deliveries(scope,root_key,first_at,month,export_id) VALUES(?,?,?,?,?)')
          .run(String(row.scope), key, String(row.at), String(row.month), id);
      }
      db.prepare('UPDATE delivery_exports SET complete=1,error=NULL WHERE id=?').run(id);
      // A partial/live export cannot release a later, larger completed batch.
      db.prepare('UPDATE subscriptions SET awaiting_export=0 WHERE last_run=? AND expected_count>0 AND expected_count<=?')
        .run(String(row.run_id), exportedCount(String(row.run_id)));
    });
  }
  // Recover the rename/SQLite boundary only when the exact durable file was saved.
  for (const row of db.prepare('SELECT id FROM delivery_exports WHERE complete=0').all()) {
    try { completeExport(String(row.id)); }
    catch (error) {
      const code = error instanceof Error && validError(error.message) ? error.message : 'DELIVERY_RECOVERY_FAILED';
      db.prepare('UPDATE delivery_exports SET error=? WHERE id=?').run(code, String(row.id));
    }
  }
  function list(): DiscoverySubscription[] {
    return db.prepare('SELECT * FROM subscriptions ORDER BY rowid').all().map(row => ({ id: String(row.id), sourceRunId: String(row.source_run), label: String(row.label),
      enabled: !!row.enabled, intervalHours: Number(row.interval_hours), monthlyTarget: Number(row.monthly_target), nextRunAt: String(row.next_at),
      lastRunId: row.last_run === null ? null : String(row.last_run), activeRunId: row.active_run === null ? null : String(row.active_run),
      awaitingExport: !!row.awaiting_export,
      lastError: row.error === null ? (db.prepare('SELECT error FROM delivery_exports WHERE scope=? AND complete=0 AND error IS NOT NULL ORDER BY rowid DESC LIMIT 1')
        .get(String(row.source_run))?.error as string | undefined) ?? null : String(row.error),
      deliveredTotal: Number(db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE scope=?').get(String(row.source_run))!.n),
      deliveredThisMonth: Number(db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE scope=? AND month=? AND export_id IN (SELECT id FROM delivery_exports WHERE run_id<>scope)').get(String(row.source_run), deliveryMonth(now()))!.n),
    }));
  }
  return {
    list, scopeForRun: scope,
    create(input: { sourceRunId: string; label: string; intervalHours?: number; monthlyTarget?: number }) {
      const hours = input.intervalHours ?? 24, target = input.monthlyTarget ?? 100;
      if (!validRun(input.sourceRunId) || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 200
        || !Number.isInteger(hours) || hours < 6 || hours > 168 || !Number.isInteger(target) || target < 1 || target > 5000) throw Error('DISCOVERY_INPUT_INVALID');
      const source = scope(input.sourceRunId);
      if (db.prepare('SELECT id FROM subscriptions WHERE source_run=?').get(source)) throw Error('DISCOVERY_ALREADY_EXISTS');
      db.prepare('INSERT INTO subscriptions(id,source_run,label,enabled,interval_hours,monthly_target,next_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), source, input.label.trim(), 1, hours, target, new Date(now().getTime() + hours * 3600000).toISOString());
      return list();
    },
    setEnabled(id: string, enabled: boolean) {
      if (!validId(id) || typeof enabled !== 'boolean' || !db.prepare('SELECT id FROM subscriptions WHERE id=?').get(id)) throw Error('DISCOVERY_INPUT_INVALID');
      db.prepare('UPDATE subscriptions SET enabled=?,error=NULL WHERE id=?').run(Number(enabled), id); return list();
    },
    deliveredKeys(runId: string): string[] { return db.prepare('SELECT root_key FROM deliveries WHERE scope=?').all(scope(runId)).map(row => String(row.root_key)); },
    exportedCount,
    hasExport(runId: string, minimumCount = 1): boolean {
      if (!Number.isSafeInteger(minimumCount) || minimumCount < 1) throw Error('DELIVERY_COUNT_INVALID');
      return exportedCount(runId) >= minimumCount;
    },
    beginRun(id: string, runId: string) {
      if (!validId(id) || !validRun(runId)) throw Error('DISCOVERY_RUN_INVALID');
      transaction(() => {
        const row = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id);
        if (!row || (row.active_run && row.active_run !== runId) || row.awaiting_export || runId === row.source_run) throw Error('DISCOVERY_BUSY');
        const mapped = db.prepare('SELECT scope FROM discovery_runs WHERE run_id=?').get(runId);
        if (mapped && mapped.scope !== row.source_run) throw Error('DISCOVERY_SCOPE_CONFLICT');
        db.prepare('INSERT OR IGNORE INTO discovery_runs(run_id,scope) VALUES(?,?)').run(runId, String(row.source_run));
        // A crash after service.start can leave a completed export under the run's temporary own scope.
        // Recover that receipt atomically before applying the original lifetime deduplication scope.
        const orphanReceipts = db.prepare('SELECT id FROM delivery_exports WHERE run_id=? AND scope=?').all(runId, runId);
        for (const receipt of orphanReceipts) {
          db.prepare(`INSERT INTO deliveries(scope,root_key,first_at,month,export_id)
            SELECT ?,root_key,first_at,month,export_id FROM deliveries WHERE scope=? AND export_id=?
            ON CONFLICT(scope,root_key) DO UPDATE SET first_at=excluded.first_at,month=excluded.month,export_id=excluded.export_id
              WHERE excluded.first_at<deliveries.first_at`)
            .run(String(row.source_run), runId, String(receipt.id));
          db.prepare('DELETE FROM deliveries WHERE scope=? AND export_id=?').run(runId, String(receipt.id));
        }
        db.prepare('UPDATE delivery_exports SET scope=? WHERE run_id=? AND scope=?').run(String(row.source_run), runId, runId);
        db.prepare('UPDATE subscriptions SET active_run=?,last_run=?,expected_count=0,error=NULL WHERE id=?').run(runId, runId, id);
      });
    },
    finishRun(id: string, expectedCount: number, error: string | null = null) {
      if (!validId(id) || !Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 100000 || !validError(error)) throw Error('DISCOVERY_INPUT_INVALID');
      transaction(() => {
        const row = db.prepare('SELECT interval_hours,active_run,last_run,next_at FROM subscriptions WHERE id=?').get(id);
        if (!row || !row.last_run) throw Error('DISCOVERY_INPUT_INVALID');
        db.prepare('UPDATE subscriptions SET active_run=NULL,expected_count=?,awaiting_export=?,error=?,next_at=? WHERE id=?')
          .run(expectedCount, Number(exportedCount(String(row.last_run)) < expectedCount), error,
            row.active_run ? new Date(now().getTime() + Number(row.interval_hours) * 3600000).toISOString() : String(row.next_at), id);
      });
    },
    defer(id: string, error: string) {
      const row = validId(id) ? db.prepare('SELECT interval_hours FROM subscriptions WHERE id=?').get(id) : null;
      if (!row || !validError(error)) throw Error('DISCOVERY_INPUT_INVALID');
      db.prepare('UPDATE subscriptions SET error=?,next_at=? WHERE id=?')
        .run(error, new Date(now().getTime() + Math.max(6, Number(row.interval_hours)) * 3600000).toISOString(), id);
    },
    prepareExport(runId: string, roots: string[], destination: string, digest: string): string {
      if (!validRun(runId) || !Array.isArray(roots) || roots.length > 50000 || roots.some(k => typeof k !== 'string' || !/^(facebook|threads):[^\s:]{1,200}$/u.test(k))
        || typeof destination !== 'string' || !isAbsolute(destination) || destination.includes('\0')
        || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw Error('DELIVERY_INPUT_INVALID');
      const id = randomUUID(), date = now();
      db.prepare('INSERT INTO delivery_exports(id,run_id,scope,roots,destination,digest,at,month) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, runId, scope(runId), JSON.stringify([...new Set(roots)]), destination, digest, date.toISOString(), deliveryMonth(date));
      return id;
    }, completeExport,
    close() { db.close(); },
  };
}
export type DiscoveryStore = ReturnType<typeof createDiscoveryStore>;
