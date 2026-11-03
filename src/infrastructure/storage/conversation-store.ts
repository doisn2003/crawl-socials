import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertEvaluationContext, contentHash, contextKey, evidenceSpans, stableJson, validateObservation, type ConversationCoverage, type ConversationEntity, type ConversationObservation, type ConversationSnapshot, type EvaluationContext, type SocialPlatform } from '../../domain/conversation.js';
import { isAssessmentTime, validateConversationDecision, type ConversationDecision, type ConversationDecisionInput, type ConversationClassification } from '../../domain/conversation-decision.js';
import type { SourceKind } from '../../domain/conversation.js';
import { sourcePriorityScores } from '../../domain/source-priority.js';
import { GOAL_FILTER_VERSION } from '../../domain/goal-filter.js';

export type ConversationJobType = 'DISCOVER' | 'ENRICH_CONVERSATION' | 'ROOT_RESOLVE' | 'CLASSIFY' | 'VERIFY' | 'REVISIT';
export type ConversationJobState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'RETRY' | 'PAUSED' | 'FAILED' | 'SUPERSEDED';
export interface ConversationJobInput {
  type: ConversationJobType;
  idempotency_key: string;
  payload: Record<string, unknown>;
  priority?: number;
  not_before?: string;
  max_attempts?: number;
}
export interface ConversationJob extends Required<ConversationJobInput> {
  id: string;
  state: ConversationJobState;
  attempts: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ModelInvocationReservation {
  id?: string;
  campaign_id: string;
  campaign_version: string;
  platform?: SocialPlatform | null;
  model: string;
  cache_key?: string | null;
  reserved_usd: number;
  budget_usd: number;
}
export interface ModelInvocationResult {
  status: 'SUCCEEDED' | 'FAILED' | 'USAGE_UNKNOWN';
  cost_usd: number | null;
  usage?: Record<string, unknown>;
  response?: unknown;
}
export interface ConversationStoreOptions {
  now?: () => Date;
  /** Test-only crash injection. A thrown callback leaves a durable event to replay on reopen. */
  afterJournalAppend?: (eventType: string) => void;
}
export interface ConversationStats {
  raw_unique_posts: number;
  observed_comments: number;
  suitable: number;
  not_yet: number;
  unrelated: number;
  pending: number;
  failed: number;
  stale_decisions: number;
  cost_usd: number;
  reserved_usd: number;
  usage_unknown: number;
}
export interface ConversationExportSnapshot {
  context: EvaluationContext;
  conversations: Array<{ snapshot: ConversationSnapshot; decision: ConversationDecision; stale: boolean }>;
  snapshots: ConversationSnapshot[];
  decisions: ConversationDecision[];
  decision_snapshots: ConversationSnapshot[];
  stats: ConversationStats;
  by_platform: Record<SocialPlatform, ConversationStats>;
  watch: { pending: number; next_at: string | null };
  watermark: { journal_sequence: number; journal_event_id: string | null; captured_at: string };
}
export interface ConversationAssessmentDue {
  snapshot: ConversationSnapshot;
  evaluated_at: string;
  valid_until: string;
}
export interface ImportedObservationLineage {
  import_id: string;
  source_run_id: string;
  source_prefix_sha256: string;
  source_event_id: string;
  source_sequence: number;
}
type JournalEvent = { id: string; seq: number; type: 'OBSERVATION' | 'DECISION' | 'JOB_ENQUEUED' | 'INVOCATION_RESERVED' | 'INVOCATION_FINISHED'; at: string; payload: unknown };
type Row = Record<string, string | number | bigint | Uint8Array | null>;
const decode = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const asNumber = (value: unknown): number => Number(value ?? 0);
// Old queues predate payload.query; derive their bucket from durable first-discovery evidence.
const ENRICHMENT_QUERY_SQL = `COALESCE(NULLIF(TRIM(json_extract(jobs.payload,'$.query')),''),
  (SELECT TRIM(json_extract(o.payload,'$.provenance.query')) FROM observations o
   WHERE o.platform=json_extract(jobs.payload,'$.platform') AND o.root_post_id=json_extract(jobs.payload,'$.root_post_id')
     AND o.entity_type='POST' AND json_type(o.payload,'$.provenance.query')='text' AND TRIM(json_extract(o.payload,'$.provenance.query'))<>''
   ORDER BY o.rowid LIMIT 1),'')`;

/** Single-writer synchronous core. Use from the utility/worker process, or CLI; renderer never owns it. */
export class ConversationStore {
  readonly directory: string;
  readonly journalPath: string;
  private readonly db!: DatabaseSync;
  private readonly lockPath: string;
  private readonly lockNonce = randomUUID();
  private readonly now: () => Date;
  private readonly afterAppend: ConversationStoreOptions['afterJournalAppend'];
  private nextSequence = 1;
  private closed = false;
  private readonly unappliedImports = new Map<string, JournalEvent>();

  constructor(directory: string, options: ConversationStoreOptions = {}) {
    this.directory = directory; this.now = options.now ?? (() => new Date()); this.afterAppend = options.afterJournalAppend;
    mkdirSync(directory, { recursive: true });
    this.journalPath = join(directory, 'conversation-events.jsonl');
    this.lockPath = join(directory, 'conversation-writer.lock');
    this.acquireLock();
    try {
      this.db = new DatabaseSync(join(directory, 'conversations.sqlite'));
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
      this.schema();
      this.replay();
      // Startup never resumes browser/model work. Interrupted leases require explicit resume().
      this.db.prepare("UPDATE jobs SET state='PAUSED', lease_owner=NULL, lease_token=NULL, lease_until=NULL, error='PROCESS_RESTARTED', updated_at=? WHERE state='RUNNING'").run(this.iso());
      this.db.prepare("UPDATE invocations SET status='USAGE_UNKNOWN',updated_at=? WHERE status='RESERVED'").run(this.iso());
    } catch (error) { try { this.db!.close(); } catch { /* Constructor may fail before opening. */ } this.releaseLock(); throw error; }
  }
  private iso(): string { return this.now().toISOString(); }
  private assertOpen(): void { if (this.closed) throw Error('CONVERSATION_STORE_CLOSED'); }
  private acquireLock(): void {
    const take = () => { const fd = openSync(this.lockPath, 'wx'); try { writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce: this.lockNonce })); fsyncSync(fd); } finally { closeSync(fd); } };
    try { take(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: { pid: number; nonce: string };
      try { owner = JSON.parse(readFileSync(this.lockPath, 'utf8')); } catch { throw Error('CONVERSATION_WRITER_LOCK_INVALID'); }
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (probeError) { if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw Error('CONVERSATION_WRITER_ALREADY_OPEN');
      unlinkSync(this.lockPath); take();
    }
  }
  private releaseLock(): void {
    if (!existsSync(this.lockPath)) return;
    try { if (JSON.parse(readFileSync(this.lockPath, 'utf8')).nonce === this.lockNonce) unlinkSync(this.lockPath); } catch { /* Never delete a lock belonging to someone else. */ }
  }
  private schema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS applied_events(event_id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS observations(event_id TEXT PRIMARY KEY, platform TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, root_post_id TEXT, observed_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS observations_root_type ON observations(platform,root_post_id,entity_type);
      CREATE TABLE IF NOT EXISTS entities(platform TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, root_post_id TEXT NOT NULL, observed_at TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(platform,entity_type,entity_id));
      CREATE INDEX IF NOT EXISTS entities_root ON entities(platform,root_post_id,entity_type);
      CREATE TABLE IF NOT EXISTS conversations(platform TEXT NOT NULL, root_post_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(platform,root_post_id));
      CREATE TABLE IF NOT EXISTS campaign_roots(context_key TEXT NOT NULL, platform TEXT NOT NULL, root_post_id TEXT NOT NULL, PRIMARY KEY(context_key,platform,root_post_id));
      CREATE TABLE IF NOT EXISTS result_admissions(context_key TEXT NOT NULL, platform TEXT NOT NULL, root_post_id TEXT NOT NULL, accepted_sequence INTEGER NOT NULL,
        PRIMARY KEY(context_key,platform,root_post_id), UNIQUE(context_key,accepted_sequence));
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, platform TEXT NOT NULL, root_post_id TEXT NOT NULL, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, observed_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(platform,root_post_id,revision));
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, context_key TEXT NOT NULL, platform TEXT NOT NULL, root_post_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, snapshot_revision INTEGER NOT NULL, classification TEXT, assessment_status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS current_decisions(context_key TEXT NOT NULL, platform TEXT NOT NULL, root_post_id TEXT NOT NULL, decision_id TEXT NOT NULL, snapshot_revision INTEGER NOT NULL, PRIMARY KEY(context_key,platform,root_post_id));
      CREATE TABLE IF NOT EXISTS assessment_requests(context_key TEXT NOT NULL, snapshot_id TEXT NOT NULL, evaluated_at TEXT NOT NULL, PRIMARY KEY(context_key,snapshot_id));
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, priority INTEGER NOT NULL, not_before TEXT NOT NULL, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, lease_owner TEXT, lease_token TEXT, lease_until TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(state,not_before,priority);
      CREATE TABLE IF NOT EXISTS invocations(id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, campaign_version TEXT NOT NULL, platform TEXT, model TEXT NOT NULL, cache_key TEXT, reserved_usd REAL NOT NULL, status TEXT NOT NULL, cost_usd REAL, usage TEXT, response TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS invocations_budget ON invocations(campaign_id,campaign_version);
      CREATE TABLE IF NOT EXISTS model_cache(cache_key TEXT PRIMARY KEY, response TEXT NOT NULL, invocation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT OR IGNORE INTO campaign_roots(context_key,platform,root_post_id) SELECT context_key,platform,root_post_id FROM decisions;
      INSERT OR IGNORE INTO campaign_roots(context_key,platform,root_post_id)
        SELECT json_array(json_extract(payload,'$.campaign_id'),json_extract(payload,'$.campaign_version'),json_extract(payload,'$.filter_version')),json_extract(payload,'$.platform'),json_extract(payload,'$.root_post_id') FROM jobs
        WHERE type='CLASSIFY' AND json_type(payload,'$.campaign_id')='text' AND json_type(payload,'$.campaign_version')='text' AND json_type(payload,'$.filter_version')='text' AND json_type(payload,'$.platform')='text' AND json_type(payload,'$.root_post_id')='text';
      PRAGMA user_version=1;
    `);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private append(type: JournalEvent['type'], payload: unknown, eventId?: string): JournalEvent {
    this.assertOpen();
    const event: JournalEvent = { id: eventId ?? randomUUID(), seq: this.nextSequence++, type, at: this.iso(), payload };
    appendFileSync(this.journalPath, JSON.stringify(event) + '\n', { flush: true });
    if (eventId) this.unappliedImports.set(eventId, event);
    this.afterAppend?.(type);
    this.apply(event);
    if (eventId) this.unappliedImports.delete(eventId);
    return event;
  }
  private replay(): void {
    if (!existsSync(this.journalPath)) return;
    const bytes = readFileSync(this.journalPath), source = bytes.toString('utf8'), lines = source.split('\n');
    let byteOffset = 0, previousSequence = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (!line.trim()) { byteOffset += Buffer.byteLength(line) + (index < lines.length - 1 ? 1 : 0); continue; }
      let event: JournalEvent;
      try { event = JSON.parse(line) as JournalEvent; }
      catch {
        if (index !== lines.length - 1 || source.endsWith('\n')) throw Error('CONVERSATION_JOURNAL_CORRUPT');
        copyFileSync(this.journalPath, this.journalPath + '.torn-' + randomUUID());
        truncateSync(this.journalPath, byteOffset);
        const fd = openSync(this.journalPath, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
        break;
      }
      if (!event.id || !Number.isInteger(event.seq) || event.seq <= previousSequence || !['OBSERVATION', 'DECISION', 'JOB_ENQUEUED', 'INVOCATION_RESERVED', 'INVOCATION_FINISHED'].includes(event.type)) throw Error('CONVERSATION_JOURNAL_INVALID_EVENT');
      previousSequence = event.seq; this.nextSequence = Math.max(this.nextSequence, event.seq + 1);
      this.apply(event);
      byteOffset += Buffer.byteLength(line) + (index < lines.length - 1 ? 1 : 0);
    }
    if (existsSync(this.journalPath)) {
      const current = readFileSync(this.journalPath, 'utf8');
      if (current && !current.endsWith('\n')) appendFileSync(this.journalPath, '\n', { flush: true });
    }
  }
  private apply(event: JournalEvent): void {
    if (this.db.prepare('SELECT 1 FROM applied_events WHERE event_id=?').get(event.id)) return;
    this.transaction(() => {
      switch (event.type) {
        case 'OBSERVATION': this.applyObservation(event); break;
        case 'DECISION': this.applyDecision(event.payload as ConversationDecision); break;
        case 'JOB_ENQUEUED': this.insertJob(event.payload as ConversationJob); break;
        case 'INVOCATION_RESERVED': {
          const invocation = event.payload as ModelInvocationReservation & { id: string };
          this.db.prepare("INSERT OR IGNORE INTO invocations(id,campaign_id,campaign_version,platform,model,cache_key,reserved_usd,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'RESERVED',?,?)").run(invocation.id, invocation.campaign_id, invocation.campaign_version, invocation.platform ?? null, invocation.model, invocation.cache_key ?? null, invocation.reserved_usd, event.at, event.at);
          break;
        }
        case 'INVOCATION_FINISHED': this.applyInvocationFinished(event); break;
      }
      this.db.prepare('INSERT INTO applied_events(event_id,sequence) VALUES(?,?)').run(event.id, event.seq);
    });
  }
  ingest(observation: ConversationObservation, context?: EvaluationContext): { observation_id: string; snapshot: ConversationSnapshot | null; changed: boolean; job: ConversationJob | null } {
    validateObservation(observation); if (context) assertEvaluationContext(context);
    // Defensive copy: callers cannot mutate an already durable observation or its snapshot.
    const raw = structuredClone(observation);
    const root = raw.root_post_id ?? (raw.entity_type === 'POST' ? raw.entity_id : null);
    raw.root_post_id = root;
    const previous = root ? this.snapshot(raw.platform, root) : null;
    const event = this.append('OBSERVATION', { observation: raw, context: context ?? null });
    const snapshot = root ? this.snapshot(raw.platform, root) : null;
    const jobKey = snapshot && context ? this.classifyJobKey(context, snapshot) : null;
    return { observation_id: event.id, snapshot, changed: snapshot?.id !== previous?.id, job: jobKey ? this.getJobByKey(jobKey) : null };
  }
  /** Stable source-event identity closes the durable-ingest / import-checkpoint crash window. */
  ingestImported(observation: ConversationObservation, context: EvaluationContext, lineage: ImportedObservationLineage): ReturnType<ConversationStore['ingest']> & { duplicate: boolean } {
    validateObservation(observation); assertEvaluationContext(context);
    if (!lineage || !/^[a-f0-9]{64}$/.test(lineage.import_id) || !/^[a-f0-9]{64}$/.test(lineage.source_prefix_sha256)
      || !lineage.source_run_id?.trim() || !lineage.source_event_id?.trim() || !Number.isSafeInteger(lineage.source_sequence) || lineage.source_sequence < 1) throw Error('IMPORT_LINEAGE_INVALID');
    const raw = structuredClone(observation), root = raw.root_post_id ?? (raw.entity_type === 'POST' ? raw.entity_id : null); raw.root_post_id = root;
    const id = 'import:' + contentHash([contextKey(context), lineage]), previous = root ? this.snapshot(raw.platform, root) : null;
    const unapplied = this.unappliedImports.get(id);
    if (unapplied) { this.apply(unapplied); this.unappliedImports.delete(id); }
    const existing = this.db.prepare('SELECT payload FROM observations WHERE event_id=?').get(id) as Row | undefined;
    if (existing && contentHash(decode<ConversationObservation>(existing.payload)) !== contentHash(raw)) throw Error('IMPORT_SOURCE_EVENT_CHANGED');
    if (!existing) this.append('OBSERVATION', { observation: raw, context, import_lineage: structuredClone(lineage) }, id);
    const snapshot = root ? this.snapshot(raw.platform, root) : null, jobKey = snapshot ? this.classifyJobKey(context, snapshot) : null;
    return { observation_id: id, snapshot, changed: snapshot?.id !== previous?.id, job: jobKey ? this.getJobByKey(jobKey) : null, duplicate: Boolean(existing) };
  }
  private applyObservation(event: JournalEvent): void {
    const { observation, context } = event.payload as { observation: ConversationObservation; context: EvaluationContext | null };
    validateObservation(observation);
    this.db.prepare('INSERT INTO observations(event_id,platform,entity_type,entity_id,root_post_id,observed_at,payload) VALUES(?,?,?,?,?,?,?)').run(event.id, observation.platform, observation.entity_type, observation.entity_id, observation.root_post_id, observation.observed_at, JSON.stringify(observation));
    if (!observation.root_post_id) return;
    let previousRoot: string | null = null;
    if ((observation.entity_type === 'POST' || observation.entity_type === 'COMMENT') && observation.entity_id) {
      const oldRow = this.db.prepare('SELECT payload,observed_at FROM entities WHERE platform=? AND entity_type=? AND entity_id=?').get(observation.platform, observation.entity_type, observation.entity_id) as Row | undefined;
      const priorEntity = oldRow ? decode<ConversationEntity>(oldRow.payload) : null;
      const entity: ConversationEntity = {
        entity_id: observation.entity_id, entity_type: observation.entity_type, root_post_id: observation.root_post_id,
        parent_id: observation.parent_id, text: observation.text, observed_at: observation.observed_at,
        published_at: observation.published_at === undefined ? priorEntity?.published_at ?? null : observation.published_at,
        permalink: observation.permalink === undefined ? priorEntity?.permalink ?? null : observation.permalink,
        author: observation.author === undefined ? priorEntity?.author ?? { role: 'UNKNOWN' } : { ...priorEntity?.author, ...observation.author },
        source: observation.source === undefined || (observation.source.kind === 'UNKNOWN' && !observation.source.id && !observation.source.name && !observation.source.url)
          ? priorEntity?.source ?? observation.source ?? { kind: 'UNKNOWN' } : { ...priorEntity?.source, ...observation.source },
        media: observation.media === undefined ? priorEntity?.media ?? [] : observation.media, content_hash: '',
      };
      entity.content_hash = contentHash(this.entityContent(entity));
      if (!oldRow || Date.parse(observation.observed_at) >= Date.parse(String(oldRow.observed_at))) {
        if (priorEntity && priorEntity.root_post_id !== observation.root_post_id) previousRoot = priorEntity.root_post_id;
        this.db.prepare('INSERT INTO entities(platform,entity_type,entity_id,root_post_id,observed_at,content_hash,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(platform,entity_type,entity_id) DO UPDATE SET root_post_id=excluded.root_post_id,observed_at=excluded.observed_at,content_hash=excluded.content_hash,payload=excluded.payload').run(observation.platform, observation.entity_type, observation.entity_id, observation.root_post_id, observation.observed_at, entity.content_hash, JSON.stringify(entity));
      }
    }
    this.projectObservation(observation, context, event.at);
    if (previousRoot) {
      const oldContext = context && this.db.prepare('SELECT 1 FROM campaign_roots WHERE context_key=? AND platform=? AND root_post_id=?').get(contextKey(context), observation.platform, previousRoot) ? context : null;
      const { coverage: _coverage, ...prior } = observation;
      this.projectObservation({ ...prior, entity_type: 'CAPTURE', root_post_id: previousRoot }, oldContext, event.at);
    }
  }
  private projectObservation(observation: ConversationObservation, context: EvaluationContext | null, eventAt: string): void {
    if (!observation.root_post_id) return;
    const previous = this.snapshot(observation.platform, observation.root_post_id);
    const entities = (this.db.prepare('SELECT payload FROM entities WHERE platform=? AND root_post_id=? ORDER BY entity_type,entity_id').all(observation.platform, observation.root_post_id) as Row[]).map(row => decode<ConversationEntity>(row.payload));
    const post = entities.find(entity => entity.entity_type === 'POST' && entity.entity_id === observation.root_post_id) ?? null;
    const comments = entities.filter(entity => entity.entity_type === 'COMMENT');
    let coverage: ConversationCoverage = previous?.coverage ?? { status: 'NOT_ATTEMPTED' };
    if (observation.coverage && (!coverage.observed_at || Date.parse(observation.observed_at) >= Date.parse(coverage.observed_at))) coverage = { ...observation.coverage, observed_at: observation.observed_at };
    const { observed_at: _coverageTime, ...coverageContent } = coverage;
    const hash = contentHash({ platform: observation.platform, root_post_id: observation.root_post_id, post: post ? this.entityContent(post) : null, comments: comments.map(entity => this.entityContent(entity)), coverage: coverageContent });
    let snapshot = previous;
    if (!previous || previous.content_hash !== hash) {
      const revision = (previous?.revision ?? 0) + 1;
      snapshot = { id: `${observation.platform}:${observation.root_post_id}:${revision}:${hash.slice(0, 20)}`, platform: observation.platform, root_post_id: observation.root_post_id, revision, content_hash: hash, observed_at: observation.observed_at, post, comments, coverage, spans: [...(post ? evidenceSpans(post) : []), ...comments.flatMap(entity => evidenceSpans(entity))] };
      this.db.prepare('INSERT INTO snapshots(id,platform,root_post_id,revision,content_hash,observed_at,payload) VALUES(?,?,?,?,?,?,?)').run(snapshot.id, snapshot.platform, snapshot.root_post_id, revision, hash, snapshot.observed_at, JSON.stringify(snapshot));
      this.db.prepare('INSERT INTO conversations(platform,root_post_id,snapshot_id,revision) VALUES(?,?,?,?) ON CONFLICT(platform,root_post_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,revision=excluded.revision').run(snapshot.platform, snapshot.root_post_id, snapshot.id, revision);
    }
    if (context && snapshot) {
      assertEvaluationContext(context);
      this.db.prepare('INSERT OR IGNORE INTO campaign_roots(context_key,platform,root_post_id) VALUES(?,?,?)').run(contextKey(context), snapshot.platform, snapshot.root_post_id);
      // A burst of comment captures needs one latest-snapshot inference, not one request per comment.
      this.db.prepare("UPDATE jobs SET state='SUPERSEDED',error='NEWER_SNAPSHOT',updated_at=? WHERE type='CLASSIFY' AND state IN ('PENDING','RETRY','PAUSED') AND json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=? AND json_extract(payload,'$.platform')=? AND json_extract(payload,'$.root_post_id')=? AND json_extract(payload,'$.snapshot_id')<>?").run(eventAt, context.campaign_id, context.campaign_version, context.filter_version, snapshot.platform, snapshot.root_post_id, snapshot.id);
      this.insertJob(this.makeJob({ type: 'CLASSIFY', idempotency_key: this.classifyJobKey(context, snapshot), payload: { ...context, platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_id: snapshot.id }, priority: 50 }, eventAt, `classify:${contentHash([contextKey(context), snapshot.id])}`));
    }
  }
  private entityContent(entity: ConversationEntity): unknown {
    const { observed_at: _time, content_hash: _hash, ...content } = entity; return content;
  }
  private classifyJobKey(context: EvaluationContext, snapshot: ConversationSnapshot): string { return stableJson(['CLASSIFY', contextKey(context), snapshot.id]); }
  /** The caller requests a new as-of evaluation when due; a content revision is not invented. */
  requestAssessment(context: EvaluationContext, snapshotId: string, options: { evaluated_at: string }): ConversationJob {
    this.assertOpen(); assertEvaluationContext(context);
    if (!isAssessmentTime(options.evaluated_at)) throw Error('INVALID_ASSESSMENT_TIME');
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) throw Error('ASSESSMENT_SNAPSHOT_NOT_FOUND');
    if (this.snapshot(snapshot.platform, snapshot.root_post_id)?.id !== snapshotId) throw Error('ASSESSMENT_SNAPSHOT_STALE');
    const evaluatedAt = new Date(options.evaluated_at).toISOString();
    if (Date.parse(evaluatedAt) < Date.parse(snapshot.observed_at)) throw Error('ASSESSMENT_BEFORE_OBSERVATION');
    if (Date.parse(evaluatedAt) > Date.parse(this.iso())) throw Error('ASSESSMENT_TIME_IN_FUTURE');
    return this.enqueue({ type: 'CLASSIFY', idempotency_key: stableJson(['CLASSIFY', contextKey(context), snapshot.id, evaluatedAt]),
      payload: { ...context, platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_id: snapshot.id, evaluated_at: evaluatedAt }, priority: 50 });
  }
  /** Once a newer request exists, its retry/paused/failed state owns recovery instead of a polling loop. */
  assessmentsDue(context: EvaluationContext, options: { now?: string } = {}): ConversationAssessmentDue[] {
    this.assertOpen(); assertEvaluationContext(context);
    const now = options.now ?? this.iso(); if (!isAssessmentTime(now)) throw Error('INVALID_ASSESSMENT_TIME');
    return (this.db.prepare(`SELECT s.payload AS snapshot,d.payload AS decision FROM current_decisions cd
      JOIN decisions d ON d.id=cd.decision_id JOIN snapshots s ON s.id=d.snapshot_id
      JOIN conversations r ON r.platform=cd.platform AND r.root_post_id=cd.root_post_id
      LEFT JOIN assessment_requests ar ON ar.context_key=cd.context_key AND ar.snapshot_id=d.snapshot_id
      WHERE cd.context_key=? AND cd.snapshot_revision=r.revision
      AND julianday(json_extract(d.payload,'$.valid_until'))<=julianday(?)
      AND (ar.evaluated_at IS NULL OR julianday(ar.evaluated_at)<=julianday(COALESCE(json_extract(d.payload,'$.evaluated_at'),s.observed_at)))
      ORDER BY julianday(json_extract(d.payload,'$.valid_until')),cd.platform,cd.root_post_id`).all(contextKey(context), now) as Row[]).map(row => {
      const snapshot = decode<ConversationSnapshot>(row.snapshot), decision = decode<ConversationDecision>(row.decision);
      return { snapshot, evaluated_at: decision.evaluated_at ?? snapshot.observed_at, valid_until: decision.valid_until! };
    });
  }
  /** Deadline counters without loading conversation text; paused models still need expiry visibility. */
  assessmentSummary(context: EvaluationContext, options: { now?: string } = {}): { pending: number; due: number; next_at: string | null; next_future_at: string | null } {
    this.assertOpen(); assertEvaluationContext(context);
    const now = options.now ?? this.iso(); if (!isAssessmentTime(now)) throw Error('INVALID_ASSESSMENT_TIME');
    const rows = this.db.prepare(`SELECT json_extract(d.payload,'$.valid_until') AS deadline FROM current_decisions cd
      JOIN decisions d ON d.id=cd.decision_id JOIN snapshots s ON s.id=d.snapshot_id
      JOIN conversations r ON r.platform=cd.platform AND r.root_post_id=cd.root_post_id
      LEFT JOIN assessment_requests ar ON ar.context_key=cd.context_key AND ar.snapshot_id=d.snapshot_id
      WHERE cd.context_key=? AND cd.snapshot_revision=r.revision AND json_type(d.payload,'$.valid_until')='text'
      AND (ar.evaluated_at IS NULL OR julianday(ar.evaluated_at)<=julianday(COALESCE(json_extract(d.payload,'$.evaluated_at'),s.observed_at)))
      ORDER BY julianday(json_extract(d.payload,'$.valid_until'))`).all(contextKey(context)) as Row[];
    const future = rows.find(row => Date.parse(String(row.deadline)) > Date.parse(now));
    return { pending: rows.length, due: rows.filter(row => Date.parse(String(row.deadline)) <= Date.parse(now)).length,
      next_at: rows[0]?.deadline ? String(rows[0].deadline) : null, next_future_at: future ? String(future.deadline) : null };
  }
  snapshot(platform: SocialPlatform, rootPostId: string): ConversationSnapshot | null {
    this.assertOpen();
    const row = this.db.prepare('SELECT s.payload FROM snapshots s JOIN conversations c ON c.snapshot_id=s.id WHERE c.platform=? AND c.root_post_id=?').get(platform, rootPostId) as Row | undefined;
    return row ? decode<ConversationSnapshot>(row.payload) : null;
  }
  getSnapshot(id: string): ConversationSnapshot | null {
    this.assertOpen(); const row = this.db.prepare('SELECT payload FROM snapshots WHERE id=?').get(id) as Row | undefined; return row ? decode<ConversationSnapshot>(row.payload) : null;
  }
  snapshots(platform?: SocialPlatform): ConversationSnapshot[] {
    this.assertOpen();
    const rows = platform ? this.db.prepare('SELECT s.payload FROM snapshots s JOIN conversations c ON c.snapshot_id=s.id WHERE c.platform=? ORDER BY s.observed_at').all(platform) : this.db.prepare('SELECT s.payload FROM snapshots s JOIN conversations c ON c.snapshot_id=s.id ORDER BY s.observed_at').all();
    return (rows as Row[]).map(row => decode<ConversationSnapshot>(row.payload));
  }
  observations(): ConversationObservation[] { this.assertOpen(); return (this.db.prepare('SELECT payload FROM observations ORDER BY rowid').all() as Row[]).map(row => decode<ConversationObservation>(row.payload)); }
  /** Raw reply locators survive before a root can be projected. Never invent a root from the reply ID. */
  rootCandidates(): ConversationObservation[] {
    this.assertOpen();
    const candidates = (this.db.prepare(`SELECT o.payload FROM observations o WHERE o.platform='threads' AND o.entity_id IS NOT NULL
      AND o.entity_type IN ('CANDIDATE','COMMENT')
      AND NOT EXISTS (SELECT 1 FROM entities comment JOIN entities root
        ON root.platform=comment.platform AND root.entity_type='POST' AND root.entity_id=comment.root_post_id
        WHERE comment.platform=o.platform AND comment.entity_type='COMMENT' AND comment.entity_id=o.entity_id)
      AND o.rowid=(SELECT n.rowid FROM observations n WHERE n.platform=o.platform AND n.entity_id=o.entity_id AND n.entity_type IN ('CANDIDATE','COMMENT')
        ORDER BY CASE WHEN n.entity_type='COMMENT' AND n.root_post_id IS NOT NULL THEN 0 ELSE 1 END,n.rowid DESC LIMIT 1)
      ORDER BY o.rowid`).all() as Row[]).map(row => decode<ConversationObservation>(row.payload));
    const usableLocator = (value: unknown): value is string => {
      if (typeof value !== 'string') return false;
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(url.hostname) &&
          !url.username && !url.password && !url.port && /^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
      } catch { return false; }
    };
    const priorLocators = this.db.prepare("SELECT payload FROM observations WHERE platform='threads' AND entity_id=? AND entity_type IN ('CANDIDATE','COMMENT') ORDER BY rowid DESC");
    return candidates.map(candidate => {
      if (usableLocator(candidate.permalink)) return candidate;
      // A later ancestry fragment can establish the root while omitting the already-observed permalink.
      const prior = (priorLocators.all(candidate.entity_id) as Row[]).map(row => decode<ConversationObservation>(row.payload)).find(observation => usableLocator(observation.permalink));
      return prior && usableLocator(prior.permalink) ? { ...candidate, permalink: prior.permalink } : candidate;
    });
  }
  recordDecision(input: ConversationDecisionInput): { decision: ConversationDecision; current: boolean } {
    assertEvaluationContext(input); const snapshot = this.getSnapshot(input.snapshot_id); if (!snapshot) throw Error('DECISION_SNAPSHOT_NOT_FOUND');
    validateConversationDecision(input, snapshot);
    const decision: ConversationDecision = { ...structuredClone(input), id: randomUUID(), platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_revision: snapshot.revision, created_at: input.created_at ?? this.iso() };
    this.append('DECISION', decision);
    const current = this.db.prepare('SELECT decision_id FROM current_decisions WHERE context_key=? AND platform=? AND root_post_id=?').get(contextKey(input), snapshot.platform, snapshot.root_post_id) as Row | undefined;
    return { decision, current: current?.decision_id === decision.id };
  }
  private applyDecision(decision: ConversationDecision): void {
    const snapshot = this.getSnapshot(decision.snapshot_id); if (!snapshot) throw Error('JOURNAL_DECISION_SNAPSHOT_NOT_FOUND');
    validateConversationDecision(decision, snapshot);
    const key = contextKey(decision);
    this.db.prepare('INSERT OR IGNORE INTO campaign_roots(context_key,platform,root_post_id) VALUES(?,?,?)').run(key, decision.platform, decision.root_post_id);
    this.db.prepare('INSERT INTO decisions(id,context_key,platform,root_post_id,snapshot_id,snapshot_revision,classification,assessment_status,payload) VALUES(?,?,?,?,?,?,?,?,?)').run(decision.id, key, decision.platform, decision.root_post_id, decision.snapshot_id, decision.snapshot_revision, decision.classification, decision.assessment_status, JSON.stringify(decision));
    const latest = this.db.prepare('SELECT revision FROM conversations WHERE platform=? AND root_post_id=?').get(decision.platform, decision.root_post_id) as Row | undefined;
    const current = this.db.prepare('SELECT c.snapshot_revision,d.assessment_status,d.payload FROM current_decisions c JOIN decisions d ON d.id=c.decision_id WHERE c.context_key=? AND c.platform=? AND c.root_post_id=?').get(key, decision.platform, decision.root_post_id) as Row | undefined;
    // Store all historical output, but a late old snapshot must never become the current result.
    if (asNumber(latest?.revision) !== decision.snapshot_revision || (current && asNumber(current.snapshot_revision) > decision.snapshot_revision)) return;
    const requested = this.db.prepare('SELECT evaluated_at FROM assessment_requests WHERE context_key=? AND snapshot_id=?').get(key, snapshot.id) as Row | undefined;
    const evaluatedAt = Date.parse(decision.evaluated_at ?? snapshot.observed_at);
    if (requested && evaluatedAt < Date.parse(String(requested.evaluated_at))) return;
    if (current && asNumber(current.snapshot_revision) === decision.snapshot_revision) {
      const prior = decode<ConversationDecision>(current.payload), priorTime = Date.parse(prior.evaluated_at ?? snapshot.observed_at);
      if (evaluatedAt < priorTime) return;
      if (evaluatedAt === priorTime && current.assessment_status === 'ASSESSED' && decision.assessment_status !== 'ASSESSED') return;
    }
    this.db.prepare('INSERT INTO current_decisions(context_key,platform,root_post_id,decision_id,snapshot_revision) VALUES(?,?,?,?,?) ON CONFLICT(context_key,platform,root_post_id) DO UPDATE SET decision_id=excluded.decision_id,snapshot_revision=excluded.snapshot_revision').run(key, decision.platform, decision.root_post_id, decision.id, decision.snapshot_revision);
  }
  results(context: EvaluationContext, options: { platform?: SocialPlatform; classification?: ConversationClassification; include_stale?: boolean; ranked?: boolean; source_priority?: readonly SourceKind[]; limit?: number; offset?: number } = {}, asOf = this.iso()): Array<{ snapshot: ConversationSnapshot; decision: ConversationDecision; stale: boolean }> {
    this.assertOpen(); assertEvaluationContext(context);
    const params: Array<string | number> = [contextKey(context)];
    let where = ' WHERE c.context_key=?';
    if (options.platform) { where += ' AND c.platform=?'; params.push(options.platform); }
    if (options.classification === 'NOT_SUITABLE') where += " AND d.classification IN ('NOT_SUITABLE','NOT_YET','UNRELATED')";
    else if (options.classification) { where += ' AND d.classification=?'; params.push(options.classification); }
    if (!options.include_stale) {
      where += " AND c.snapshot_revision=roots.revision AND (json_extract(d.payload,'$.valid_until') IS NULL OR julianday(json_extract(d.payload,'$.valid_until'))>julianday(?)) AND (ar.evaluated_at IS NULL OR julianday(COALESCE(json_extract(d.payload,'$.evaluated_at'),s.observed_at))>=julianday(ar.evaluated_at))";
      params.push(asOf);
    }
    const sources = options.ranked ? sourcePriorityScores(options.source_priority) : null;
    const rank = options.ranked && context.filter_version === GOAL_FILTER_VERSION ? `CASE d.classification WHEN 'SUITABLE' THEN 3 WHEN 'NOT_SUITABLE' THEN 1 ELSE 0 END DESC,
      COALESCE(json_extract(d.payload,'$.attributes.goal_preferred'),0) DESC,
      COALESCE(json_extract(d.payload,'$.attributes.goal_actionability'),0) DESC,
      COALESCE(json_extract(d.payload,'$.attributes.goal_freshness'),0) DESC,
      COALESCE(json_extract(d.payload,'$.attributes.goal_published_at'),0) DESC,
      CASE json_extract(s.payload,'$.post.source.kind') WHEN 'PROFILE' THEN ${sources!.PROFILE} WHEN 'GROUP' THEN ${sources!.GROUP} WHEN 'PAGE' THEN ${sources!.PAGE} ELSE ${sources!.UNKNOWN} END DESC,`
      : options.ranked ? `CASE d.classification WHEN 'SUITABLE' THEN 3 WHEN 'NOT_YET' THEN 2 WHEN 'UNRELATED' THEN 1 ELSE 0 END DESC,
      CASE json_extract(d.payload,'$.attributes.observed_need') WHEN 'REQUEST' THEN 3 WHEN 'DISCUSSION' THEN 2 WHEN 'EXPERIENCE' THEN 1 ELSE 0 END DESC,
      CASE json_extract(d.payload,'$.attributes.brand_fit') WHEN 'ALIGNED' THEN 2 WHEN 'TOPIC_ONLY' THEN 1 ELSE 0 END DESC,
      CASE json_extract(d.payload,'$.attributes.participation_context') WHEN 'OPEN' THEN 2 WHEN 'UNKNOWN' THEN 1 ELSE 0 END DESC,
      CASE json_extract(d.payload,'$.attributes.freshness') WHEN 'CURRENT' THEN 2 WHEN 'UNKNOWN' THEN 1 ELSE 0 END DESC,
      CASE json_extract(s.payload,'$.post.source.kind') WHEN 'PROFILE' THEN ${sources!.PROFILE} WHEN 'GROUP' THEN ${sources!.GROUP} WHEN 'PAGE' THEN ${sources!.PAGE} ELSE ${sources!.UNKNOWN} END DESC,` : '';
    const sql = `SELECT d.payload AS decision,s.payload AS snapshot,roots.revision AS latest_revision,ar.evaluated_at AS requested_at FROM current_decisions c JOIN decisions d ON d.id=c.decision_id JOIN snapshots s ON s.id=d.snapshot_id JOIN conversations roots ON roots.platform=c.platform AND roots.root_post_id=c.root_post_id LEFT JOIN assessment_requests ar ON ar.context_key=c.context_key AND ar.snapshot_id=d.snapshot_id${where} ORDER BY ${rank} d.rowid DESC LIMIT ? OFFSET ?`;
    const limit = options.limit ?? 100000, offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(offset) || offset < 0) throw Error('INVALID_PAGINATION');
    return (this.db.prepare(sql).all(...params, limit, offset) as Row[]).map(row => {
      const snapshot = decode<ConversationSnapshot>(row.snapshot), decision = decode<ConversationDecision>(row.decision);
      return { snapshot, decision, stale: snapshot.revision !== asNumber(row.latest_revision)
        || Boolean(decision.valid_until && Date.parse(decision.valid_until) <= Date.parse(asOf))
        || Boolean(row.requested_at && Date.parse(decision.evaluated_at ?? snapshot.observed_at) < Date.parse(String(row.requested_at))) };
    });
  }
  decisionHistory(context: EvaluationContext): ConversationDecision[] { this.assertOpen(); return (this.db.prepare('SELECT payload FROM decisions WHERE context_key=? ORDER BY rowid').all(contextKey(context)) as Row[]).map(row => decode<ConversationDecision>(row.payload)); }
  /** Freeze all result/evidence tables under one transaction; later watcher updates cannot mix into this export. */
  exportSnapshot(context: EvaluationContext, options: { source_priority?: readonly SourceKind[] } = {}): ConversationExportSnapshot {
    this.assertOpen(); assertEvaluationContext(context);
    return this.transaction(() => {
      const key = contextKey(context), capturedAt = this.iso();
      const snapshots = (this.db.prepare('SELECT s.payload FROM campaign_roots cr JOIN conversations c ON c.platform=cr.platform AND c.root_post_id=cr.root_post_id JOIN snapshots s ON s.id=c.snapshot_id WHERE cr.context_key=? ORDER BY c.platform,c.root_post_id').all(key) as Row[]).map(row => decode<ConversationSnapshot>(row.payload));
      const decisionSnapshots = (this.db.prepare('SELECT DISTINCT s.id,s.payload FROM decisions d JOIN snapshots s ON s.id=d.snapshot_id WHERE d.context_key=? ORDER BY s.platform,s.root_post_id,s.revision').all(key) as Row[]).map(row => decode<ConversationSnapshot>(row.payload));
      const watermark = this.db.prepare('SELECT event_id,sequence FROM applied_events ORDER BY sequence DESC LIMIT 1').get() as Row | undefined;
      return { context: structuredClone(context), conversations: this.results(context, { ranked: true, ...options }, capturedAt), snapshots, decisions: this.decisionHistory(context), decision_snapshots: decisionSnapshots,
        stats: this.stats(context, undefined, capturedAt), by_platform: { facebook: this.stats(context, 'facebook', capturedAt), threads: this.stats(context, 'threads', capturedAt) }, watch: this.watchSummary(undefined, context),
        watermark: { journal_sequence: asNumber(watermark?.sequence), journal_event_id: watermark?.event_id ? String(watermark.event_id) : null, captured_at: capturedAt } };
    });
  }
  selectTarget(context: EvaluationContext, target: number, unassessed = false) {
    if (!Number.isSafeInteger(target) || target < 1) throw Error('CAMPAIGN_TARGET_INVALID');
    return this.transaction(() => {
      const key = contextKey(context);
      const candidates = unassessed ? this.snapshots().filter(s => s.post).map(snapshot => ({ snapshot, strength: 0, at: snapshot.observed_at }))
        : this.results(context, { classification: 'SUITABLE' }).filter(r => !r.stale).map(r => ({ snapshot: r.snapshot,
          strength: Number(r.decision.attributes?.signal_strength ?? 0), at: r.decision.created_at }));
      candidates.sort((a, b) => b.strength - a.strength || a.at.localeCompare(b.at) || a.snapshot.id.localeCompare(b.snapshot.id));
      let sequence = Number((this.db.prepare('SELECT COALESCE(MAX(accepted_sequence),0) AS n FROM result_admissions WHERE context_key=?').get(key) as Row).n);
      const insert = this.db.prepare('INSERT OR IGNORE INTO result_admissions VALUES(?,?,?,?)');
      for (const { snapshot: s } of candidates) { if (insert.run(key, s.platform, s.root_post_id, sequence + 1).changes) sequence++; }
      const eligible = new Set(candidates.map(c => c.snapshot.platform + ':' + c.snapshot.root_post_id));
      const all = (this.db.prepare('SELECT platform,root_post_id,accepted_sequence FROM result_admissions WHERE context_key=? ORDER BY accepted_sequence').all(key) as Row[])
        .filter(r => eligible.has(r.platform + ':' + r.root_post_id)).map(r => ({ platform: String(r.platform), rootId: String(r.root_post_id), acceptedSequence: Number(r.accepted_sequence) }));
      return { target: all.slice(0, target), extra: all.slice(target) };
    });
  }
  stats(context: EvaluationContext, platform?: SocialPlatform, asOf = this.iso()): ConversationStats {
    this.assertOpen(); assertEvaluationContext(context);
    const params: string[] = [asOf, contextKey(context)]; let where = 'cr.context_key=?'; if (platform) { where += ' AND cr.platform=?'; params.push(platform); }
    const valid = "cd.snapshot_revision=r.revision AND (json_extract(d.payload,'$.valid_until') IS NULL OR julianday(json_extract(d.payload,'$.valid_until'))>julianday(clock.as_of)) AND (ar.evaluated_at IS NULL OR julianday(COALESCE(json_extract(d.payload,'$.evaluated_at'),s.observed_at))>=julianday(ar.evaluated_at))";
    const row = this.db.prepare(`WITH clock(as_of) AS (VALUES (?)) SELECT COUNT(*) AS raw,
      COALESCE(SUM(json_array_length(s.payload,'$.comments')),0) AS comments,
      COALESCE(SUM(CASE WHEN d.assessment_status='ASSESSED' AND ${valid} THEN 1 ELSE 0 END),0) AS assessed,
      COALESCE(SUM(CASE WHEN d.classification='SUITABLE' AND d.assessment_status='ASSESSED' AND ${valid} THEN 1 ELSE 0 END),0) AS suitable,
      COALESCE(SUM(CASE WHEN d.classification='NOT_YET' AND d.assessment_status='ASSESSED' AND ${valid} THEN 1 ELSE 0 END),0) AS not_yet,
      COALESCE(SUM(CASE WHEN d.classification IN ('UNRELATED','NOT_SUITABLE') AND d.assessment_status='ASSESSED' AND ${valid} THEN 1 ELSE 0 END),0) AS unrelated,
      COALESCE(SUM(CASE WHEN d.assessment_status='FAILED' AND ${valid} THEN 1 ELSE 0 END),0) AS failed,
      COALESCE(SUM(CASE WHEN cd.snapshot_revision<>r.revision OR julianday(json_extract(d.payload,'$.valid_until'))<=julianday(clock.as_of)
        OR julianday(COALESCE(json_extract(d.payload,'$.evaluated_at'),s.observed_at))<julianday(ar.evaluated_at) THEN 1 ELSE 0 END),0) AS stale
      FROM campaign_roots cr JOIN conversations r ON r.platform=cr.platform AND r.root_post_id=cr.root_post_id
      JOIN snapshots s ON s.id=r.snapshot_id LEFT JOIN current_decisions cd ON cd.context_key=cr.context_key AND cd.platform=cr.platform AND cd.root_post_id=cr.root_post_id
      LEFT JOIN decisions d ON d.id=cd.decision_id LEFT JOIN assessment_requests ar ON ar.context_key=cd.context_key AND ar.snapshot_id=d.snapshot_id CROSS JOIN clock WHERE ${where}`).get(...params) as Row;
    const money = this.costSummary(context.campaign_id, context.campaign_version, platform);
    return { raw_unique_posts: asNumber(row.raw), observed_comments: asNumber(row.comments), suitable: asNumber(row.suitable), not_yet: asNumber(row.not_yet), unrelated: asNumber(row.unrelated), pending: asNumber(row.raw) - asNumber(row.assessed), failed: asNumber(row.failed), stale_decisions: asNumber(row.stale), ...money };
  }
  private makeJob(input: ConversationJobInput, now = this.iso(), id: string = randomUUID()): ConversationJob {
    if (!['DISCOVER', 'ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'CLASSIFY', 'VERIFY', 'REVISIT'].includes(input.type) || !input.idempotency_key?.trim()) throw Error('INVALID_JOB');
    const maxAttempts = input.max_attempts ?? 3, priority = input.priority ?? 0;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isInteger(priority)) throw Error('INVALID_JOB_LIMIT');
    if (input.type === 'CLASSIFY' && input.payload.evaluated_at !== undefined) {
      assertEvaluationContext(input.payload as unknown as EvaluationContext);
      if (!isAssessmentTime(input.payload.evaluated_at) || typeof input.payload.snapshot_id !== 'string' || !this.getSnapshot(input.payload.snapshot_id)) throw Error('INVALID_ASSESSMENT_JOB');
    }
    const notBefore = input.not_before ?? now; if (!Number.isFinite(Date.parse(notBefore))) throw Error('INVALID_JOB_TIME');
    return { ...input, id, payload: structuredClone(input.payload), max_attempts: maxAttempts, priority, not_before: new Date(notBefore).toISOString(), state: 'PENDING', attempts: 0, lease_owner: null, lease_token: null, lease_until: null, error: null, created_at: now, updated_at: now };
  }
  private insertJob(job: ConversationJob): void {
    this.db.prepare('INSERT OR IGNORE INTO jobs(id,idempotency_key,type,state,payload,priority,not_before,attempts,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.id, job.idempotency_key, job.type, job.state, JSON.stringify(job.payload), job.priority, job.not_before, job.attempts, job.max_attempts, job.created_at, job.updated_at);
    if (job.type === 'CLASSIFY' && job.payload.evaluated_at !== undefined) {
      const context = job.payload as unknown as EvaluationContext;
      assertEvaluationContext(context);
      if (!isAssessmentTime(job.payload.evaluated_at) || typeof job.payload.snapshot_id !== 'string') throw Error('INVALID_ASSESSMENT_JOB');
      const snapshot = this.getSnapshot(job.payload.snapshot_id); if (!snapshot) throw Error('ASSESSMENT_SNAPSHOT_NOT_FOUND');
      this.db.prepare('INSERT OR IGNORE INTO campaign_roots(context_key,platform,root_post_id) VALUES(?,?,?)').run(contextKey(context), snapshot.platform, snapshot.root_post_id);
      this.db.prepare(`INSERT INTO assessment_requests(context_key,snapshot_id,evaluated_at) VALUES(?,?,?)
        ON CONFLICT(context_key,snapshot_id) DO UPDATE SET evaluated_at=excluded.evaluated_at
        WHERE julianday(excluded.evaluated_at)>julianday(assessment_requests.evaluated_at)`).run(contextKey(context), snapshot.id, new Date(job.payload.evaluated_at).toISOString());
      this.db.prepare(`UPDATE jobs SET state='SUPERSEDED',error='NEWER_ASSESSMENT',updated_at=?
        WHERE type='CLASSIFY' AND state IN ('PENDING','RETRY','PAUSED') AND json_extract(payload,'$.campaign_id')=?
          AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=? AND json_extract(payload,'$.snapshot_id')=?
          AND julianday(COALESCE(json_extract(payload,'$.evaluated_at'),?))<julianday((SELECT evaluated_at FROM assessment_requests WHERE context_key=? AND snapshot_id=?))`)
        .run(job.created_at, context.campaign_id, context.campaign_version, context.filter_version, snapshot.id, snapshot.observed_at, contextKey(context), snapshot.id);
    }
  }
  enqueue(input: ConversationJobInput): ConversationJob {
    const existing = this.getJobByKey(input.idempotency_key); if (existing) return existing;
    const job = this.makeJob(input); this.append('JOB_ENQUEUED', job); return this.getJob(job.id)!;
  }
  private readJob(row: Row | undefined): ConversationJob | null {
    if (!row) return null;
    return { id: String(row.id), idempotency_key: String(row.idempotency_key), type: String(row.type) as ConversationJobType, state: String(row.state) as ConversationJobState, payload: decode<Record<string, unknown>>(row.payload), priority: asNumber(row.priority), not_before: String(row.not_before), attempts: asNumber(row.attempts), max_attempts: asNumber(row.max_attempts), lease_owner: row.lease_owner as string | null, lease_token: row.lease_token as string | null, lease_until: row.lease_until as string | null, error: row.error as string | null, created_at: String(row.created_at), updated_at: String(row.updated_at) };
  }
  getJob(id: string): ConversationJob | null { this.assertOpen(); return this.readJob(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Row | undefined); }
  getJobByKey(key: string): ConversationJob | null { this.assertOpen(); return this.readJob(this.db.prepare('SELECT * FROM jobs WHERE idempotency_key=?').get(key) as Row | undefined); }
  jobs(states?: ConversationJobState[], context?: EvaluationContext): ConversationJob[] {
    this.assertOpen();
    const params: string[] = [], clauses: string[] = [];
    if (states?.length) { clauses.push(`state IN (${states.map(() => '?').join(',')})`); params.push(...states); }
    if (context) { assertEvaluationContext(context); clauses.push("json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=?"); params.push(context.campaign_id, context.campaign_version, context.filter_version); }
    const rows = this.db.prepare(`SELECT * FROM jobs${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY priority DESC,created_at`).all(...params);
    return (rows as Row[]).map(row => this.readJob(row)!);
  }
  /** UTF-8 bytes of active inference job payloads and distinct referenced snapshots, without loading them into main memory. */
  backlogBytes(context: EvaluationContext, options: { includeVerification?: boolean } = {}): { jobs: number; payload_bytes: number; snapshot_bytes: number; total_bytes: number; missing_snapshots: number } {
    this.assertOpen(); assertEvaluationContext(context);
    const row = this.db.prepare(`WITH pending AS (
      SELECT payload FROM jobs WHERE state IN ('PENDING','RETRY','RUNNING')
      AND type IN (${options.includeVerification === false ? "'CLASSIFY'" : "'CLASSIFY','VERIFY'"})
      AND json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=?
    ), referenced AS (SELECT DISTINCT json_extract(payload,'$.snapshot_id') AS id FROM pending WHERE json_type(payload,'$.snapshot_id')='text')
    SELECT (SELECT COUNT(*) FROM pending) AS jobs,
      (SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM pending) AS payload_bytes,
      (SELECT COALESCE(SUM(length(CAST(s.payload AS BLOB))),0) FROM snapshots s JOIN referenced r ON r.id=s.id) AS snapshot_bytes,
      ((SELECT COUNT(*) FROM referenced r LEFT JOIN snapshots s ON s.id=r.id WHERE s.id IS NULL)
        + (SELECT COUNT(*) FROM pending WHERE json_type(payload,'$.snapshot_id') IS NOT 'text')) AS missing_snapshots
    `).get(context.campaign_id, context.campaign_version, context.filter_version) as Row;
    const result = { jobs: asNumber(row.jobs), payload_bytes: asNumber(row.payload_bytes), snapshot_bytes: asNumber(row.snapshot_bytes),
      total_bytes: asNumber(row.payload_bytes) + asNumber(row.snapshot_bytes), missing_snapshots: asNumber(row.missing_snapshots) };
    if (!Object.values(result).every(value => Number.isSafeInteger(value) && value >= 0)) throw Error('STORAGE_BACKLOG_SIZE_INVALID');
    return result;
  }
  watchSummary(platforms?: SocialPlatform[], context?: EvaluationContext): { pending: number; next_at: string | null } {
    this.assertOpen(); const params: string[] = [];
    let where = "type='REVISIT' AND state IN ('PENDING','RETRY','RUNNING')";
    if (platforms) { if (!platforms.length) return { pending: 0, next_at: null }; where += ` AND json_extract(payload,'$.platform') IN (${platforms.map(() => '?').join(',')})`; params.push(...platforms); }
    if (context) { assertEvaluationContext(context); where += " AND json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=?"; params.push(context.campaign_id, context.campaign_version, context.filter_version); }
    const row = this.db.prepare(`SELECT COUNT(*) AS pending,MIN(CASE WHEN state IN ('PENDING','RETRY') THEN not_before ELSE NULL END) AS next_at FROM jobs WHERE ${where}`).get(...params) as Row;
    return { pending: asNumber(row.pending), next_at: row.next_at === null ? null : String(row.next_at) };
  }
  /** A missed set of scheduled observations becomes one fresh capture, not a burst of identical crawls. */
  coalesceRevisits(options: { now?: string; platforms?: SocialPlatform[] } = {}): { expired: number; superseded: number } {
    this.assertOpen(); const now = options.now ? new Date(options.now).toISOString() : this.iso();
    return this.transaction(() => {
      const jobs = this.jobs(['PENDING', 'RETRY']).filter(job => job.type === 'REVISIT' && (!options.platforms || options.platforms.includes(job.payload.platform as SocialPlatform)));
      let expired = 0, superseded = 0;
      const due = new Map<string, ConversationJob[]>();
      for (const job of jobs) {
        if (typeof job.payload.expires_at === 'string' && Date.parse(job.payload.expires_at) <= Date.parse(now)) {
          this.db.prepare("UPDATE jobs SET state='SUPERSEDED',error='WATCH_TTL_EXPIRED',updated_at=? WHERE id=?").run(now, job.id); expired++; continue;
        }
        if (Date.parse(job.not_before) > Date.parse(now)) continue;
        const key = stableJson([job.payload.campaign_id ?? null, job.payload.campaign_version ?? null, job.payload.filter_version ?? null, job.payload.platform, job.payload.root_post_id]);
        const group = due.get(key) ?? []; group.push(job); due.set(key, group);
      }
      for (const group of due.values()) {
        group.sort((a, b) => b.not_before.localeCompare(a.not_before) || b.id.localeCompare(a.id));
        for (const job of group.slice(1)) { this.db.prepare("UPDATE jobs SET state='SUPERSEDED',error='MISSED_REVISIT_COALESCED',updated_at=? WHERE id=?").run(now, job.id); superseded++; }
      }
      return { expired, superseded };
    });
  }
  enrichmentQueries(platform: SocialPlatform): string[] {
    this.assertOpen();
    return (this.db.prepare(`SELECT ${ENRICHMENT_QUERY_SQL} AS query FROM jobs
      WHERE type='ENRICH_CONVERSATION' AND state IN ('PENDING','RETRY') AND not_before<=? AND attempts<max_attempts
        AND json_extract(payload,'$.platform')=? GROUP BY query ORDER BY MIN(created_at),query`).all(this.iso(), platform) as Row[]).map(row => String(row.query));
  }
  claim(worker: string, options: { types?: ConversationJobType[]; lease_ms?: number; platform?: SocialPlatform; query?: string; context?: EvaluationContext } = {}): ConversationJob | null {
    this.assertOpen(); if (!worker.trim()) throw Error('INVALID_WORKER'); const leaseMs = options.lease_ms ?? 60000;
    if (!Number.isFinite(leaseMs) || leaseMs < 1) throw Error('INVALID_LEASE');
    if (options.query !== undefined && (typeof options.query !== 'string' || options.types?.length !== 1 || !['ENRICH_CONVERSATION', 'ROOT_RESOLVE'].includes(options.types[0]!))) throw Error('QUERY_FILTER_REQUIRES_ENRICHMENT');
    return this.transaction(() => {
      const now = this.iso();
      this.db.prepare("UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'FAILED' ELSE 'RETRY' END,lease_owner=NULL,lease_token=NULL,lease_until=NULL,error='LEASE_EXPIRED',updated_at=? WHERE state='RUNNING' AND lease_until<=?").run(now, now);
      const params: Array<string | number> = [now]; let where = "state IN ('PENDING','RETRY') AND not_before<=? AND attempts<max_attempts";
      if (options.types?.length) { where += ` AND type IN (${options.types.map(() => '?').join(',')})`; params.push(...options.types); }
      if (options.platform) { where += " AND json_extract(payload,'$.platform')=?"; params.push(options.platform); }
      if (options.context) { assertEvaluationContext(options.context); where += " AND json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=?"; params.push(options.context.campaign_id, options.context.campaign_version, options.context.filter_version); }
      if (options.query !== undefined) { where += ` AND ${ENRICHMENT_QUERY_SQL}=?`; params.push(options.query.trim()); }
      const row = this.db.prepare(`SELECT * FROM jobs WHERE ${where} ORDER BY priority DESC,created_at,id LIMIT 1`).get(...params) as Row | undefined;
      if (!row) return null;
      const token = randomUUID(), until = new Date(Date.parse(now) + leaseMs).toISOString();
      this.db.prepare("UPDATE jobs SET state='RUNNING',attempts=attempts+1,lease_owner=?,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(worker, token, until, now, String(row.id));
      return this.getJob(String(row.id));
    });
  }
  complete(id: string, leaseToken: string): boolean {
    this.assertOpen(); const result = this.db.prepare("UPDATE jobs SET state='SUCCEEDED',lease_owner=NULL,lease_token=NULL,lease_until=NULL,error=NULL,updated_at=? WHERE id=? AND state='RUNNING' AND lease_token=? AND lease_until>?").run(this.iso(), id, leaseToken, this.iso()); return asNumber(result.changes) === 1;
  }
  heartbeat(id: string, leaseToken: string, leaseMs = 60000): boolean {
    this.assertOpen(); if (!Number.isFinite(leaseMs) || leaseMs < 1) throw Error('INVALID_LEASE'); const now = this.iso();
    return asNumber(this.db.prepare("UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND state='RUNNING' AND lease_token=? AND lease_until>?").run(new Date(Date.parse(now) + leaseMs).toISOString(), now, id, leaseToken, now).changes) === 1;
  }
  retry(id: string, leaseToken: string, error: string, delayMs = 1000): boolean {
    this.assertOpen(); if (!Number.isFinite(delayMs) || delayMs < 0) throw Error('INVALID_RETRY_DELAY'); const now = this.iso();
    return asNumber(this.db.prepare("UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'FAILED' ELSE 'RETRY' END,not_before=?,error=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='RUNNING' AND lease_token=? AND lease_until>?").run(new Date(Date.parse(now) + delayMs).toISOString(), error.slice(0, 1000), now, id, leaseToken, now).changes) === 1;
  }
  pause(options: { types?: ConversationJobType[]; platform?: SocialPlatform; context?: EvaluationContext } = {}): number {
    this.assertOpen(); const params: string[] = [this.iso()]; let where = "state IN ('PENDING','RETRY','RUNNING')";
    if (options.types) { if (!options.types.length) return 0; where += ` AND type IN (${options.types.map(() => '?').join(',')})`; params.push(...options.types); }
    if (options.platform) { where += " AND json_extract(payload,'$.platform')=?"; params.push(options.platform); }
    if (options.context) { assertEvaluationContext(options.context); where += " AND json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=?"; params.push(options.context.campaign_id, options.context.campaign_version, options.context.filter_version); }
    return asNumber(this.db.prepare(`UPDATE jobs SET state='PAUSED',lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE ${where}`).run(...params).changes);
  }
  resume(options: { types?: ConversationJobType[]; context?: EvaluationContext } = {}): number {
    this.assertOpen(); const params = [this.iso()]; let where = "state='PAUSED'";
    if (options.types) { if (!options.types.length) return 0; where += ` AND type IN (${options.types.map(() => '?').join(',')})`; params.push(...options.types); }
    if (options.context) { assertEvaluationContext(options.context); where += " AND json_extract(payload,'$.campaign_id')=? AND json_extract(payload,'$.campaign_version')=? AND json_extract(payload,'$.filter_version')=?"; params.push(options.context.campaign_id, options.context.campaign_version, options.context.filter_version); }
    return asNumber(this.db.prepare(`UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'FAILED' ELSE 'PENDING' END,updated_at=? WHERE ${where}`).run(...params).changes);
  }
  reserveInvocation(input: ModelInvocationReservation): string {
    this.assertOpen();
    if (!input.campaign_id?.trim() || !input.campaign_version?.trim() || !input.model?.trim() || !Number.isFinite(input.reserved_usd) || input.reserved_usd < 0 || !Number.isFinite(input.budget_usd) || input.budget_usd < 0) throw Error('INVALID_INVOCATION_RESERVATION');
    const id = input.id ?? randomUUID();
    const old = this.db.prepare('SELECT * FROM invocations WHERE id=?').get(id) as Row | undefined;
    if (old) {
      if (old.campaign_id !== input.campaign_id || old.campaign_version !== input.campaign_version || old.model !== input.model || asNumber(old.reserved_usd) !== input.reserved_usd) throw Error('INVOCATION_ID_CONFLICT');
      return id;
    }
    const summary = this.costSummary(input.campaign_id, input.campaign_version);
    if (summary.cost_usd + summary.reserved_usd + input.reserved_usd > input.budget_usd + 1e-9) throw Error('MODEL_BUDGET_EXHAUSTED');
    this.append('INVOCATION_RESERVED', { ...input, id }); return id;
  }
  finishInvocation(id: string, result: ModelInvocationResult): void {
    this.assertOpen(); const invocation = this.db.prepare('SELECT status FROM invocations WHERE id=?').get(id) as Row | undefined; if (!invocation) throw Error('INVOCATION_NOT_FOUND');
    if (!['SUCCEEDED', 'FAILED', 'USAGE_UNKNOWN'].includes(result.status) || (result.cost_usd !== null && (!Number.isFinite(result.cost_usd) || result.cost_usd < 0))) throw Error('INVALID_INVOCATION_RESULT');
    if (result.status === 'SUCCEEDED' && result.cost_usd === null) throw Error('SUCCEEDED_USAGE_REQUIRED');
    if (invocation.status !== 'RESERVED' && invocation.status !== 'USAGE_UNKNOWN') throw Error('INVOCATION_ALREADY_FINISHED');
    this.append('INVOCATION_FINISHED', { id, result });
  }
  private applyInvocationFinished(event: JournalEvent): void {
    const { id, result } = event.payload as { id: string; result: ModelInvocationResult };
    const old = this.db.prepare('SELECT cache_key FROM invocations WHERE id=?').get(id) as Row | undefined; if (!old) throw Error('JOURNAL_INVOCATION_NOT_FOUND');
    this.db.prepare('UPDATE invocations SET status=?,cost_usd=?,usage=?,response=?,updated_at=? WHERE id=?').run(result.status, result.cost_usd, result.usage ? JSON.stringify(result.usage) : null, result.response === undefined ? null : JSON.stringify(result.response), event.at, id);
    if (result.status === 'SUCCEEDED' && old.cache_key && result.response !== undefined) this.db.prepare('INSERT INTO model_cache(cache_key,response,invocation_id,created_at) VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET response=excluded.response,invocation_id=excluded.invocation_id,created_at=excluded.created_at').run(String(old.cache_key), JSON.stringify(result.response), id, event.at);
  }
  cached<T = unknown>(key: string): { response: T; invocation_id: string; created_at: string } | null {
    this.assertOpen(); const row = this.db.prepare('SELECT response,invocation_id,created_at FROM model_cache WHERE cache_key=?').get(key) as Row | undefined;
    return row ? { response: decode<T>(row.response), invocation_id: String(row.invocation_id), created_at: String(row.created_at) } : null;
  }
  costSummary(campaignId: string, campaignVersion: string, platform?: SocialPlatform): Pick<ConversationStats, 'cost_usd' | 'reserved_usd' | 'usage_unknown'> {
    this.assertOpen(); const params: string[] = [campaignId, campaignVersion]; let where = 'campaign_id=? AND campaign_version=?'; if (platform) { where += ' AND platform=?'; params.push(platform); }
    const row = this.db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS cost,COALESCE(SUM(CASE WHEN status IN ('RESERVED','USAGE_UNKNOWN') OR cost_usd IS NULL THEN MAX(reserved_usd-COALESCE(cost_usd,0),0) ELSE 0 END),0) AS reserved,COALESCE(SUM(CASE WHEN status='USAGE_UNKNOWN' THEN 1 ELSE 0 END),0) AS unknown FROM invocations WHERE ${where}`).get(...params) as Row;
    return { cost_usd: asNumber(row.cost), reserved_usd: asNumber(row.reserved), usage_unknown: asNumber(row.unknown) };
  }
  invocationHistory(): Array<Record<string, unknown>> {
    this.assertOpen(); return (this.db.prepare('SELECT * FROM invocations ORDER BY rowid').all() as Row[]).map(row => ({ ...row, usage: row.usage ? decode(row.usage) : null, response: row.response ? decode(row.response) : null }));
  }
  close(): void {
    if (this.closed) return;
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); } finally { this.closed = true; this.releaseLock(); }
  }
}
export function createConversationStore(directory: string, options?: ConversationStoreOptions): ConversationStore { return new ConversationStore(directory, options); }
