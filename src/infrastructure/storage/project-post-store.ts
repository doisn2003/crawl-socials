import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ConversationSnapshot, EvaluationContext, SocialPlatform } from '../../domain/conversation.js';
import type { ConversationDecision, ConversationDecisionInput } from '../../domain/conversation-decision.js';
import { validateConversationDecision } from '../../domain/conversation-decision.js';
import { postOnlyEvidenceView } from '../../domain/post-only-evidence.js';

type StoredAssessment = { decision: ConversationDecision; mode: string } & ({ snapshot: ConversationSnapshot } | { evidenceHash: string });
const evidenceHash = (value: StoredAssessment) => 'evidenceHash' in value ? value.evidenceHash : postOnlyEvidenceView(value.snapshot).content_hash;

export function compactProjectPostIndex(file: string): void {
  const db = new DatabaseSync(file);
  try {
    db.function('compact_assessment', value => {
      if (typeof value !== 'string') return null;
      const saved = JSON.parse(value) as StoredAssessment;
      return JSON.stringify({ decision: saved.decision, mode: saved.mode, evidenceHash: evidenceHash(saved) });
    });
    db.exec("PRAGMA journal_mode=DELETE; UPDATE posts SET payload='{}', assessment=compact_assessment(assessment); VACUUM;");
  } finally { db.close(); }
}

/** One canonical post per project, with separate membership in each collection run. */
export class ProjectPostStore {
  private readonly db: DatabaseSync;

  constructor(directory: string, private readonly compact = false) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'project-posts.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS posts (
        platform TEXT NOT NULL, root_id TEXT NOT NULL, first_run_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, payload TEXT NOT NULL,
        assessment TEXT, PRIMARY KEY(platform, root_id));
      CREATE TABLE IF NOT EXISTS run_posts (
        run_id TEXT NOT NULL, platform TEXT NOT NULL, root_id TEXT NOT NULL,
        previously_collected INTEGER NOT NULL CHECK(previously_collected IN (0,1)),
        PRIMARY KEY(run_id, platform, root_id),
        FOREIGN KEY(platform, root_id) REFERENCES posts(platform, root_id));
      CREATE TABLE IF NOT EXISTS imported_runs (run_id TEXT PRIMARY KEY);`);
    try { this.importHistory(directory); } catch (error) { this.db.close(); throw error; }
  }

  observe(runId: string, platform: SocialPlatform, rootId: string, payload: unknown, observedAt: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT first_run_id FROM posts WHERE platform=? AND root_id=?').get(platform, rootId);
      this.db.prepare(`INSERT INTO posts(platform,root_id,first_run_id,first_seen_at,last_seen_at,payload)
        VALUES(?,?,?,?,?,?) ON CONFLICT(platform,root_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,payload=excluded.payload
        WHERE julianday(excluded.last_seen_at) >= julianday(posts.last_seen_at)`)
        .run(platform, rootId, runId, observedAt, observedAt, this.compact ? '{}' : JSON.stringify(payload));
      this.db.prepare('INSERT OR IGNORE INTO run_posts(run_id,platform,root_id,previously_collected) VALUES(?,?,?,?)')
        .run(runId, platform, rootId, prior && prior.first_run_id !== runId ? 1 : 0);
      const previous = this.previouslyCollected(runId, platform, rootId);
      this.db.exec('COMMIT');
      return previous;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  previouslyCollected(runId: string, platform: SocialPlatform, rootId: string): boolean {
    return this.db.prepare('SELECT previously_collected FROM run_posts WHERE run_id=? AND platform=? AND root_id=?')
      .get(runId, platform, rootId)?.previously_collected === 1;
  }

  saveAssessment(snapshot: ConversationSnapshot, decision: ConversationDecision, mode: string): void {
    if (!snapshot.post || decision.assessment_status !== 'ASSESSED' || !decision.classification
      || !decision.filter_version.startsWith('opportunity-posts-') || decision.attributes?.project_assessment_reused === true) return;
    const assessment: StoredAssessment = this.compact ? { evidenceHash: postOnlyEvidenceView(snapshot).content_hash, decision, mode } : { snapshot, decision, mode };
    this.db.prepare(`UPDATE posts SET assessment=? WHERE platform=? AND root_id=?
      AND (assessment IS NULL OR julianday(json_extract(assessment,'$.decision.created_at')) <= julianday(?))`)
      .run(JSON.stringify(assessment), snapshot.platform, snapshot.root_post_id, decision.created_at);
  }

  reuse(snapshot: ConversationSnapshot, context: EvaluationContext, now: string): ConversationDecisionInput | null {
    const row = this.db.prepare('SELECT assessment FROM posts WHERE platform=? AND root_id=?').get(snapshot.platform, snapshot.root_post_id);
    if (!row?.assessment) return null;
    const saved = JSON.parse(String(row.assessment)) as StoredAssessment;
    if (saved.decision.campaign_id === context.campaign_id || saved.decision.assessment_status !== 'ASSESSED'
      || !saved.decision.classification || evidenceHash(saved) !== postOnlyEvidenceView(snapshot).content_hash
      || (saved.decision.valid_until && Date.parse(saved.decision.valid_until) <= Date.parse(now))) return null;
    const decision: ConversationDecisionInput = { ...saved.decision, ...context, snapshot_id: snapshot.id,
      attributes: { ...saved.decision.attributes, project_assessment_reused: true,
        project_source_run_id: saved.decision.campaign_id, project_source_decision_id: saved.decision.id,
        project_source_filter_mode: saved.mode, project_source_filter_version: saved.decision.filter_version,
        project_source_evaluated_at: saved.decision.evaluated_at ?? saved.decision.created_at } };
    // Citation identities include metadata. A changed citation must be assessed again.
    try { validateConversationDecision(decision, snapshot); } catch { return null; }
    return decision;
  }

  count(): number { return Number(this.db.prepare('SELECT COUNT(*) AS count FROM posts').get()!.count); }
  close(): void { this.db.close(); }

  private importHistory(directory: string): void {
    const collections = join(directory, 'collections');
    if (!existsSync(collections)) return;
    const runs = readdirSync(collections, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .filter(entry => !this.db.prepare('SELECT 1 FROM imported_runs WHERE run_id=?').get(entry.name))
      .map(entry => {
        const state = join(collections, entry.name, 'run-state.json');
        const startedAt = existsSync(state) ? (JSON.parse(readFileSync(state, 'utf8')) as { startedAt?: string }).startedAt ?? '' : '';
        return { id: entry.name, startedAt };
      }).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
    for (const run of runs) {
      const file = join(collections, run.id, 'opportunity-results.json');
      const rawFile = join(collections, run.id, 'results.json');
      if (!existsSync(file) && !existsSync(rawFile)) continue;
      if (existsSync(rawFile)) {
        const raw = JSON.parse(readFileSync(rawFile, 'utf8')) as Partial<Record<SocialPlatform, Record<string, unknown>[]>>;
        for (const platform of ['facebook', 'threads'] as const) for (const row of raw[platform] ?? []) {
          if (typeof row.post_id === 'string' && row.post_id && row.entity_type !== 'COMMENT' && row.is_reply !== true)
            this.observe(run.id, platform, row.post_id, row, String(row.collected_at ?? run.startedAt));
        }
      }
      if (!existsSync(file)) {
        this.db.prepare('INSERT OR IGNORE INTO imported_runs(run_id) VALUES(?)').run(run.id);
        continue;
      }
      const data = JSON.parse(readFileSync(file, 'utf8')) as {
        campaign?: { filter_mode?: string }; snapshots?: ConversationSnapshot[];
        conversations?: Array<{ snapshot: ConversationSnapshot; decision: ConversationDecision; stale: boolean }>;
      };
      for (const snapshot of data.snapshots ?? []) {
        if (!snapshot.post) continue;
        this.observe(run.id, snapshot.platform, snapshot.root_post_id, snapshot, snapshot.observed_at);
      }
      for (const row of data.conversations ?? []) if (!row.stale && row.decision.snapshot_id === row.snapshot.id) {
        this.saveAssessment(row.snapshot, row.decision, data.campaign?.filter_mode ?? 'UNKNOWN');
      }
      this.db.prepare('INSERT OR IGNORE INTO imported_runs(run_id) VALUES(?)').run(run.id);
    }
  }
}
