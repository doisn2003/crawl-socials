import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConversationSnapshot } from '../../domain/conversation.js';
import type { ConversationClassification, ConversationDecision } from '../../domain/conversation-decision.js';

export interface OpportunityExportData {
  campaign: unknown; progress: unknown; cost: unknown;
  snapshots: ConversationSnapshot[]; decisions: ConversationDecision[];
  decision_snapshots?: ConversationSnapshot[]; watermark?: unknown; cost_captured_at?: string;
  runtime_limits?: unknown; root_resolution?: unknown; retained_input?: unknown; ranking?: unknown; storage?: unknown;
  conversations: { snapshot: ConversationSnapshot; decision: ConversationDecision; stale: boolean }[];
}
export function selectOpportunityExport(value: unknown, classification?: ConversationClassification): OpportunityExportData {
  if (!value || typeof value !== 'object') throw Error('OPPORTUNITY_EXPORT_INVALID');
  const input = value as OpportunityExportData;
  if (!Array.isArray(input.snapshots) || !Array.isArray(input.decisions) || !Array.isArray(input.conversations)) throw Error('OPPORTUNITY_EXPORT_INVALID');
  if (!classification) return input;
  const conversations = input.conversations.filter(item => !item.stale && item.decision.snapshot_id === item.snapshot.id
    && item.decision.assessment_status === 'ASSESSED' && item.decision.classification === classification);
  const keys = new Set(conversations.map(item => `${item.snapshot.platform}:${item.snapshot.root_post_id}`));
  return { ...input, conversations, snapshots: input.snapshots.filter(s => keys.has(`${s.platform}:${s.root_post_id}`)),
    decisions: input.decisions.filter(d => keys.has(`${d.platform}:${d.root_post_id}`)),
    ...(input.decision_snapshots ? { decision_snapshots: input.decision_snapshots.filter(s => keys.has(`${s.platform}:${s.root_post_id}`)) } : {}) };
}
function text(value: unknown): string {
  const result = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (result.length > 32767) throw Error('XLSX_CELL_TEXT_TOO_LONG');
  return result;
}
function sheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: unknown[][]) {
  if (rows.length > 1048575) throw Error('XLSX_ROW_LIMIT');
  const current = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  current.columns = headers.map(header => ({ header, key: header, width: /text|evidence|reason|summary|value/.test(header) ? 65 : 24 }));
  current.getRow(1).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
  current.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  for (const row of rows) { const added = current.addRow(row.map(text)); added.numFmt = '@'; }
  current.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
}
export async function exportOpportunityWorkbook(path: string, value: unknown, classification?: ConversationClassification): Promise<void> {
  const data = selectOpportunityExport(value, classification), workbook = new ExcelJS.Workbook();
  workbook.creator = 'CSD'; workbook.title = 'CSD — Conversation opportunities';
  const current = new Map(data.conversations.filter(item => !item.stale && item.decision.snapshot_id === item.snapshot.id)
    .map(item => [item.snapshot.id, item.decision]));
  // Preserve ranked rows, then include raw snapshots that have not been classified yet.
  // Historical decisions belong in DecisionHistory, never as labels on newer text.
  const snapshots = new Map(data.snapshots.map(snapshot => [snapshot.id, snapshot]));
  const ordered = new Map([...data.conversations.flatMap(item => snapshots.has(item.snapshot.id) ? [[item.snapshot.id, item.snapshot] as const] : []), ...snapshots]);
  sheet(workbook, 'Conversations', ['platform', 'root_post_id', 'classification', 'reason', 'need_summary', 'post_text', 'post_url', 'evidence', 'action_entity_id', 'snapshot_id', 'observed_at', 'coverage', 'assessment_status', 'evaluated_at', 'valid_until', 'temporal_evidence', 'decision_id'],
    [...ordered.values()].map(s => { const d = current.get(s.id); return [s.platform, s.root_post_id, d?.classification, d?.reason_code ?? 'AWAITING_CURRENT_ASSESSMENT', d?.attributes?.need_summary, s.post?.text,
      s.post?.permalink, s.spans.filter(span => d?.evidence_ids.includes(span.id)).map(span => `${span.entity_type}:${span.entity_id}: ${span.text}`).join('\n'), d?.action_target?.entity_id, s.id, s.observed_at, s.coverage.status, d?.assessment_status ?? 'PENDING',
      d?.evaluated_at, d?.valid_until, d?.temporal_evidence, d?.id]; }));
  sheet(workbook, 'Comments', ['platform', 'root_post_id', 'comment_id', 'parent_id', 'text', 'author_name', 'published_at', 'observed_at', 'permalink', 'snapshot_id'],
    data.snapshots.flatMap(s => s.comments.map(c => [s.platform, s.root_post_id, c.entity_id, c.parent_id, c.text, c.author.name, c.published_at, c.observed_at, c.permalink, s.id])));
  const history = new Map([...data.snapshots, ...(data.decision_snapshots ?? [])].map(s => [s.id, s]));
  sheet(workbook, 'DecisionHistory', ['platform', 'root_post_id', 'decision_id', 'snapshot_id', 'classification', 'assessment_status', 'reason_code', 'evidence_ids', 'campaign_version', 'filter_version', 'model', 'created_at', 'evidence_text', 'evaluated_at', 'valid_until', 'temporal_evidence', 'snapshot_observed_at'],
    data.decisions.map(d => [d.platform, d.root_post_id, d.id, d.snapshot_id, d.classification, d.assessment_status, d.reason_code, d.evidence_ids, d.campaign_version, d.filter_version, d.model, d.created_at,
      history.get(d.snapshot_id)?.spans.filter(span => d.evidence_ids.includes(span.id)).map(span => `${span.entity_type}:${span.entity_id}: ${span.text}`).join('\n'),
      d.evaluated_at, d.valid_until, d.temporal_evidence, history.get(d.snapshot_id)?.observed_at]));
  const progress = data.progress && typeof data.progress === 'object' ? { ...data.progress, preview: undefined } : data.progress;
  const capturedAt = data.watermark && typeof data.watermark === 'object' && 'captured_at' in data.watermark ? data.watermark.captured_at : null;
  sheet(workbook, 'Manifest', ['key', 'value'], [['schema_version', 'opportunity-v1'], ['classification_filter', classification ?? 'ALL'], ['exported_at', new Date().toISOString()], ['campaign', data.campaign], ['progress', progress], ['cost', data.cost], ['watermark', data.watermark], ['cost_captured_at', data.cost_captured_at], ['runtime_limits', data.runtime_limits], ['root_resolution', data.root_resolution],
    ['retained_input', data.retained_input], ['ranking', data.ranking], ['storage', data.storage],
    ['export_counts', { conversations: ordered.size, comments: data.snapshots.reduce((count, snapshot) => count + snapshot.comments.length, 0), decision_history: data.decisions.length }],
    ['comment_scope', 'Captured comments and nested replies of exported roots only; coverage does not imply all comments were collected.'],
    ['temporal_columns_version', 1], ['assessment_snapshot_as_of', capturedAt], ['temporal_semantics', {
      evaluated_at: 'Model request as-of time, independent of response completion (created_at) and observation time.',
      valid_until: 'Current validity ends at this instant; current rows reflect the frozen watermark captured_at, not the later workbook write time.',
      temporal_evidence: 'Exact entity/span IDs, quote, native published_at and interpreted expires_at for audit.',
      legacy_missing_fields: 'Not recorded; blank values are not inferred or backfilled.',
    }]]);
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.next-${randomUUID()}.xlsx`;
  try { await workbook.xlsx.writeFile(temporary); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
