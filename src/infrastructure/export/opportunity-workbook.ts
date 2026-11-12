import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { KeywordCommentCapture } from '../../domain/keyword-comments.js';
import type { ConversationSnapshot } from '../../domain/conversation.js';
import type { ConversationClassification, ConversationDecision } from '../../domain/conversation-decision.js';

export interface OpportunityExportData {
  campaign: unknown; progress: unknown; cost: unknown;
  cost_unit?: 'credits';
  snapshots: ConversationSnapshot[]; decisions: ConversationDecision[];
  keyword_comments?: KeywordCommentCapture[];
  decision_snapshots?: ConversationSnapshot[]; watermark?: unknown; cost_captured_at?: string;
  runtime_limits?: unknown; root_resolution?: unknown; retained_input?: unknown; ranking?: unknown; storage?: unknown;
  selection?: { target: { platform: string; rootId: string; acceptedSequence: number }[]; extra: { platform: string; rootId: string; acceptedSequence: number }[] };
  conversations: { snapshot: ConversationSnapshot; decision: ConversationDecision; stale: boolean }[];
}
function retainExportRoots(input: OpportunityExportData, keys: Set<string>): OpportunityExportData {
  const keep = (platform: string, rootId: string) => keys.has(platform + ':' + rootId);
  return { ...input, conversations: input.conversations.filter(r => keep(r.snapshot.platform, r.snapshot.root_post_id)),
    snapshots: input.snapshots.filter(s => keep(s.platform, s.root_post_id)),
    decisions: input.decisions.filter(d => keep(d.platform, d.root_post_id)),
    ...(input.selection ? { selection: { target: input.selection.target.filter(r => keep(r.platform, r.rootId)), extra: input.selection.extra.filter(r => keep(r.platform, r.rootId)) } } : {}),
    ...(input.keyword_comments ? { keyword_comments: input.keyword_comments.filter(row => keep(row.platform, row.root_post_id)) } : {}),
    ...(input.decision_snapshots ? { decision_snapshots: input.decision_snapshots.filter(s => keep(s.platform, s.root_post_id)) } : {}) };
}
function isUnassessedExport(input: OpportunityExportData): boolean {
  return !!input.campaign && typeof input.campaign === 'object' && 'filter_mode' in input.campaign && input.campaign.filter_mode === 'OFF';
}
/** Customer exports omit earlier deliveries; the immutable internal raw archive remains complete. */
export function selectOpportunityExport(value: unknown, classification?: ConversationClassification, excludedRootKeys: readonly string[] = []): OpportunityExportData {
  if (!value || typeof value !== 'object') throw Error('OPPORTUNITY_EXPORT_INVALID');
  let input = value as OpportunityExportData;
  if (!Array.isArray(input.snapshots) || !Array.isArray(input.decisions) || !Array.isArray(input.conversations)) throw Error('OPPORTUNITY_EXPORT_INVALID');
  if (classification && isUnassessedExport(input)) throw Error('OFF_EXPORT_CLASSIFICATION_INVALID');
  if (excludedRootKeys.length) {
    const excluded = new Set(excludedRootKeys);
    input = retainExportRoots(input, new Set(input.snapshots.map(s => s.platform + ':' + s.root_post_id).filter(k => !excluded.has(k))));
  }
  if (!classification) return input;
  const targetKeys = input.selection ? new Set(input.selection.target.map(r => r.platform + ':' + r.rootId)) : null;
  const conversations = input.conversations.filter(item => !item.stale && item.decision.snapshot_id === item.snapshot.id
    && item.decision.assessment_status === 'ASSESSED'
    && (classification !== 'SUITABLE' || !targetKeys || targetKeys.has(item.snapshot.platform + ':' + item.snapshot.root_post_id))
    && (classification === 'NOT_SUITABLE' ? ['NOT_SUITABLE', 'NOT_YET', 'UNRELATED'].includes(item.decision.classification ?? '') : item.decision.classification === classification));
  const keys = new Set(conversations.map(item => item.snapshot.platform + ':' + item.snapshot.root_post_id));
  return { ...retainExportRoots(input, keys), conversations,
    // Keyword matches are a separate deliverable, including when the caller asks for suitable posts.
    ...(classification === 'SUITABLE' && input.keyword_comments ? { keyword_comments: input.keyword_comments } : {}) };
}
/** Count only roots present in the actual delivered file; OFF rows remain explicitly unassessed. */
export function deliveredOpportunityRoots(input: OpportunityExportData): string[] {
  const present = new Set(input.snapshots.filter(s => !!s.post).map(s => s.platform + ':' + s.root_post_id));
  if (isUnassessedExport(input)) return [...present];
  return [...new Set(input.conversations.filter(r => !r.stale && r.decision.snapshot_id === r.snapshot.id
    && r.decision.classification === 'SUITABLE' && r.decision.assessment_status === 'ASSESSED')
    .map(r => r.snapshot.platform + ':' + r.snapshot.root_post_id).filter(key => present.has(key)))];
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
  for (const row of rows) { const added = current.addRow(row.map(value => typeof value === 'boolean' ? value : text(value))); added.numFmt = '@'; }
  current.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
}
export async function exportOpportunityWorkbook(path: string, value: unknown, classification?: ConversationClassification): Promise<void> {
  const data = selectOpportunityExport(value, classification), workbook = new ExcelJS.Workbook();
  workbook.creator = 'FindLink'; workbook.title = 'FindLink — Conversation opportunities';
  const current = new Map(data.conversations.filter(item => !item.stale && item.decision.snapshot_id === item.snapshot.id)
    .map(item => [item.snapshot.id, item.decision]));
  // Preserve ranked rows, then include raw snapshots that have not been classified yet.
  // Historical decisions belong in DecisionHistory, never as labels on newer text.
  const snapshots = new Map(data.snapshots.map(snapshot => [snapshot.id, snapshot]));
  const ordered = new Map([...data.conversations.flatMap(item => snapshots.has(item.snapshot.id) ? [[item.snapshot.id, item.snapshot] as const] : []), ...snapshots]);
  const goalRows=data.conversations.filter(r=>!r.stale&&r.decision.snapshot_id===r.snapshot.id&&r.decision.goal_assessment);
  const membership = new Map(['target', 'extra'].flatMap(group => (data.selection?.[group as 'target' | 'extra'] ?? [])
    .map(row => [row.platform + ':' + row.rootId, { group: group.toUpperCase(), sequence: row.acceptedSequence }] as const)));
  const off = !!data.campaign && typeof data.campaign === 'object' && 'filter_mode' in data.campaign && data.campaign.filter_mode === 'OFF';
  sheet(workbook, 'Conversations', ['platform', 'root_post_id', 'classification', 'reason', 'need_summary', 'post_text', 'post_url', 'evidence', 'action_entity_id', 'snapshot_id', 'observed_at', 'coverage', 'assessment_status', 'evaluated_at', 'valid_until', 'temporal_evidence', 'decision_id', 'selection_group', 'accepted_sequence', 'opportunity_types', 'published_at', 'previouslyCollected', 'assessmentReused', 'assessmentSourceRun', 'assessmentSourceMode'],
    [...ordered.values()].map(s => { const d = current.get(s.id); return [s.platform, s.root_post_id, d?.classification, d?.reason_code ?? 'AWAITING_CURRENT_ASSESSMENT', d?.attributes?.need_summary, s.post?.text,
      s.post?.permalink, s.spans.filter(span => d?.evidence_ids.includes(span.id)).map(span => `${span.entity_type}:${span.entity_id}: ${span.text}`).join('\n'), d?.action_target?.entity_id, s.id, s.observed_at, s.coverage.status, d?.assessment_status ?? (off ? 'UNASSESSED' : 'PENDING'),
      d?.evaluated_at, d?.valid_until, d?.temporal_evidence, d?.id, membership.get(s.platform + ':' + s.root_post_id)?.group, membership.get(s.platform + ':' + s.root_post_id)?.sequence, d?.attributes?.opportunity_types, s.post?.published_at, s.previouslyCollected ?? false, d?.attributes?.project_assessment_reused === true, d?.attributes?.project_source_run_id, d?.attributes?.project_source_filter_mode]; }));
  sheet(workbook, 'Comments', ['platform', 'root_post_id', 'comment_id', 'parent_id', 'text', 'author_name', 'published_at', 'observed_at', 'permalink', 'snapshot_id'],
    data.snapshots.flatMap(s => s.comments.map(c => [s.platform, s.root_post_id, c.entity_id, c.parent_id, c.text, c.author.name, c.published_at, c.observed_at, c.permalink, s.id])));
  if (data.keyword_comments) sheet(workbook, 'Matched Comments',
    ['platform', 'root_post_id', 'post_url', 'comment_id', 'parent_id', 'text', 'likes', 'keyword', 'language', 'author_name', 'permalink', 'observed_at'],
    data.keyword_comments.flatMap(root => root.comments.map(c => [root.platform, root.root_post_id, root.post_url,
      c.comment_id, c.parent_id, c.text, c.likes, c.keyword, c.language, c.author_name, c.permalink, c.observed_at])));
  if(goalRows.length)sheet(workbook,'GoalEvidence',['platform','root_post_id','snapshot_id','classification','assessment_status','candidate_entity_id','candidate_text','candidate_url','criterion_id','criterion','strength','branches','status','evidence','contract_hash'],
    goalRows.flatMap(({snapshot:s,decision:d})=>{
      const a=d.goal_assessment!,target=[s.post,...s.comments].find(e=>e?.entity_id===a.candidate_entity_id);
      const prefix=[s.platform,s.root_post_id,s.id,d.classification,d.assessment_status,a.candidate_entity_id,target?.text,target?.permalink??s.post?.permalink];
      const rows=a.checks.map(check=>{const criterion=a.contract.criteria.find(c=>c.id===check.criterion_id)!;
        return [...prefix,criterion.id,criterion.description,criterion.strength,criterion.branches,check.status,check.evidence,a.contract_hash];});
      if(a.contract.platform_preferences?.length)rows.push([...prefix,'platform-preference',
        'Ưu tiên nền tảng: '+a.contract.platform_preferences.map(p=>p.platform).join(' → '),'PREFERRED',[],
        Number(d.attributes?.goal_platform_preference)>0?'PASS':'FAIL',
        [{id:'metadata:platform',quote:s.platform}],a.contract_hash]);
      if(d.goal_scope_review)rows.push([...prefix,'scope','Đúng ngữ cảnh của mục tiêu: '+d.goal_scope_review.explanation,'REQUIRED',[],
        d.goal_scope_review.verdict==='IN_SCOPE'?'PASS':d.goal_scope_review.verdict==='OUT_OF_SCOPE'?'FAIL':'UNKNOWN',d.goal_scope_review.evidence,a.contract_hash]);
      return rows;
    }));
  const history = new Map([...data.snapshots, ...(data.decision_snapshots ?? [])].map(s => [s.id, s]));
  sheet(workbook, 'DecisionHistory', ['platform', 'root_post_id', 'decision_id', 'snapshot_id', 'classification', 'assessment_status', 'reason_code', 'evidence_ids', 'campaign_version', 'filter_version', 'model', 'created_at', 'evidence_text', 'evaluated_at', 'valid_until', 'temporal_evidence', 'snapshot_observed_at'],
    data.decisions.map(d => [d.platform, d.root_post_id, d.id, d.snapshot_id, d.classification, d.assessment_status, d.reason_code, d.evidence_ids, d.campaign_version, d.filter_version, d.model, d.created_at,
      history.get(d.snapshot_id)?.spans.filter(span => d.evidence_ids.includes(span.id)).map(span => `${span.entity_type}:${span.entity_id}: ${span.text}`).join('\n'),
      d.evaluated_at, d.valid_until, d.temporal_evidence, history.get(d.snapshot_id)?.observed_at]));
  const progress = data.progress && typeof data.progress === 'object' ? { ...data.progress, preview: undefined } : data.progress;
  const capturedAt = data.watermark && typeof data.watermark === 'object' && 'captured_at' in data.watermark ? data.watermark.captured_at : null;
  sheet(workbook, 'Manifest', ['key', 'value'], [['schema_version', 'opportunity-v1'], ['classification_filter', classification ?? 'ALL'], ['exported_at', new Date().toISOString()], ['campaign', data.campaign], ['progress', progress], ['cost', data.cost],
    ...(data.cost_unit ? [['cost_unit', data.cost_unit]] : []), ['watermark', data.watermark], ['cost_captured_at', data.cost_captured_at], ['runtime_limits', data.runtime_limits], ['root_resolution', data.root_resolution],
    ['retained_input', data.retained_input], ['ranking', data.ranking], ['storage', data.storage],
    ['export_counts', { conversations: ordered.size, comments: data.snapshots.reduce((count, snapshot) => count + snapshot.comments.length, 0), decision_history: data.decisions.length, ...(data.keyword_comments ? { keyword_comments: data.keyword_comments.reduce((count, root) => count + root.comments.length, 0) } : {}) }],
    ['comment_scope', 'Captured comments and nested replies of exported roots only; coverage does not imply all comments were collected.'],
    ...(data.keyword_comments ? [['keyword_comment_scope', 'Local keyword matches from rejected posts, up to 20 per root. Likes rank the observed matches. These rows do not change post verdicts.']] : []),
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
