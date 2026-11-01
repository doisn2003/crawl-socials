import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { exportOpportunityWorkbook, selectOpportunityExport } from '../src/infrastructure/export/opportunity-workbook.js';
import type { OpportunityExportData } from '../src/infrastructure/export/opportunity-workbook.js';
import type { ConversationSnapshot } from '../src/domain/conversation.js';
import type { ConversationDecision } from '../src/domain/conversation-decision.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';

test('opportunity export keeps exact IDs/parent/evidence, filters roots and preserves literal formulas', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-opportunity-export-'));
  try {
    const snapshot: ConversationSnapshot = { id: 'snapshot:1', platform: 'threads', root_post_id: '12345678901234567890', revision: 1,
      content_hash: 'hash', observed_at: '2026-10-30T00:00:00Z', coverage: { status: 'PARTIAL' }, post: null,
      comments: [{ entity_id: '12345678901234567891', entity_type: 'COMMENT', root_post_id: '12345678901234567890',
        parent_id: '12345678901234567890', text: '=HYPERLINK("https://example.com")', observed_at: '2026-10-30T00:00:00Z',
        published_at: null, permalink: null, author: {}, source: { kind: 'UNKNOWN' }, media: [], content_hash: 'hash' }],
      spans: [{ id: 'evidence:1', entity_id: '12345678901234567891', entity_type: 'COMMENT', start: 0, end: 8, text: 'quán nào?' }] };
    const decision: ConversationDecision = { id: 'decision:1', snapshot_id: snapshot.id, platform: 'threads', root_post_id: snapshot.root_post_id,
      snapshot_revision: 1, campaign_id: 'c', campaign_version: 'v1', filter_version: 'v2', classification: 'SUITABLE',
      assessment_status: 'ASSESSED', reason_code: 'OPPORTUNITY_REQUEST', evidence_ids: ['evidence:1'], model: 'test', created_at: snapshot.observed_at };
    const oldSnapshot = { ...snapshot, id: 'snapshot:0', spans: [{ ...snapshot.spans[0]!, text: 'historic evidence' }] };
    const oldDecision = { ...decision, id: 'decision:0', snapshot_id: oldSnapshot.id };
    const data: OpportunityExportData = { campaign: {}, progress: { preview: ['x'.repeat(40000)] }, cost: {}, snapshots: [snapshot], decisions: [decision, oldDecision],
      decision_snapshots: [oldSnapshot], watermark: { event_id: 42 }, cost_captured_at: '2026-10-30T00:00:00Z',
      ranking: { recipe: { schema_version: 1, policy: 'campaign-source-priority-v1', source_priority: ['GROUP', 'PROFILE'] }, recipe_sha256: 'fixture-hash' },
      storage: { policy: { policy_sha256: 'storage-fixture-hash', limits: { max_run_bytes: 1073741824 } }, usage: { run_bytes: 3200 }, stop_reason: null },
      conversations: [{ snapshot, decision, stale: false }] };
    assert.equal(selectOpportunityExport(data, 'UNRELATED').snapshots.length, 0);
    assert.equal(selectOpportunityExport(data, 'UNRELATED').decision_snapshots!.length, 0);
    const file = join(dir, 'opportunities.xlsx'); await exportOpportunityWorkbook(file, data, 'SUITABLE');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
    assert.deepEqual(workbook.worksheets.map(s => s.name), ['Conversations', 'Comments', 'DecisionHistory', 'Manifest']);
    assert.deepEqual((workbook.getWorksheet('Conversations')!.getRow(1).values as unknown[]).slice(1, 13),
      ['platform', 'root_post_id', 'classification', 'reason', 'need_summary', 'post_text', 'post_url', 'evidence', 'action_entity_id', 'snapshot_id', 'observed_at', 'coverage']);
    assert.equal(workbook.getWorksheet('Conversations')!.getCell('B2').value, snapshot.root_post_id);
    const comments = workbook.getWorksheet('Comments')!;
    assert.equal(comments.rowCount, 2);
    assert.equal(comments.views[0]!.state, 'frozen');
    assert.ok(comments.autoFilter);
    assert.equal(comments.getCell('D2').value, snapshot.root_post_id);
    assert.equal(comments.getCell('E2').type, ExcelJS.ValueType.String);
    assert.equal(comments.getCell('E2').value, snapshot.comments[0]!.text);
    assert.equal(workbook.getWorksheet('Conversations')!.getCell('H2').value, 'COMMENT:12345678901234567891: quán nào?');
    assert.equal(workbook.getWorksheet('DecisionHistory')!.getCell('M3').value, 'COMMENT:12345678901234567891: historic evidence');
    assert.equal(workbook.getWorksheet('Conversations')!.getCell('N2').value || '', '', 'legacy assessment time is not invented');
    assert.equal(workbook.getWorksheet('DecisionHistory')!.getCell('P2').value || '', '', 'legacy temporal evidence stays absent');
    assert.equal(workbook.getWorksheet('Manifest')!.getCell('B8').value, '{"event_id":42}');
    assert.equal(records(workbook, 'Manifest').find(row => row.key === 'ranking')!.value, JSON.stringify(data.ranking));
    assert.equal(records(workbook, 'Manifest').find(row => row.key === 'storage')!.value, JSON.stringify(data.storage));
    const unassessed = { ...snapshot, id: 'unassessed', root_post_id: 'unassessed-root', comments: [], spans: [] };
    const changed = { ...snapshot, id: 'changed', root_post_id: 'changed-root', comments: [], spans: [], revision: 2 };
    const stale = { ...decision, snapshot_id: 'previous', root_post_id: changed.root_post_id };
    const streaming: OpportunityExportData = { ...data, snapshots: [snapshot, unassessed, changed],
      conversations: [...data.conversations, { snapshot: changed, decision: stale, stale: true }] };
    const allFile = join(dir, 'streaming.xlsx'); await exportOpportunityWorkbook(allFile, streaming);
    const all = new ExcelJS.Workbook(); await all.xlsx.readFile(allFile);
    const sheet = all.getWorksheet('Conversations')!;
    assert.equal(sheet.rowCount, 4, 'all roots remain exportable before classification finishes');
    assert.equal(sheet.getCell('B3').value, 'changed-root');
    assert.equal(sheet.getCell('C3').value || '', '', 'stale suitable label must not attach to newer text');
    assert.equal(sheet.getCell('M3').value, 'PENDING');
    assert.equal(sheet.getCell('B4').value, 'unassessed-root'); assert.equal(sheet.getCell('M4').value, 'PENDING');
    assert.equal(selectOpportunityExport(streaming, 'SUITABLE').snapshots.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function records(workbook: ExcelJS.Workbook, name: string): Array<Record<string, ExcelJS.CellValue>> {
  const sheet = workbook.getWorksheet(name)!;
  const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
  return Array.from({ length: sheet.rowCount - 1 }, (_, offset) => Object.fromEntries(headers.slice(1).map((header, index) => [String(header), sheet.getRow(offset + 2).getCell(index + 1).value])));
}

test('JSON and workbook retain exact temporal provenance and a frozen as-of while expired current rows become pending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-temporal-export-'));
  const observedAt = '2026-10-30T10:00:00.000Z', evaluatedAt = '2026-10-30T10:30:00.000Z', deadline = '2026-10-30T12:00:00.000Z';
  let clock = '2026-10-30T11:00:00.000Z';
  const store = createConversationStore(join(directory, 'store'), { now: () => new Date(clock) });
  const context = { campaign_id: 'travel', campaign_version: '1', filter_version: 'temporal-test' };
  try {
    const snapshot = store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: 'trip', root_post_id: 'trip', parent_id: null,
      text: 'I need hotel advice before noon today.', published_at: observedAt, observed_at: observedAt,
      provenance: { run_id: 'test', method: 'FIXTURE' } }, context).snapshot!;
    const proof = { entity_id: 'trip', evidence_id: snapshot.spans[0]!.id, quote: 'before noon today', published_at: observedAt, expires_at: deadline };
    const original = store.recordDecision({ ...context, snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED',
      reason_code: 'OPPORTUNITY_REQUEST', evidence_ids: [proof.evidence_id], model: 'test', evaluated_at: evaluatedAt, valid_until: deadline, temporal_evidence: [proof] }).decision;
    const before = store.exportSnapshot(context), originalJson = JSON.stringify(before);
    clock = deadline;
    const after = store.exportSnapshot(context), copied = JSON.parse(JSON.stringify(after)) as typeof after;
    assert.equal(before.stats.suitable, 1); assert.equal(copied.stats.suitable, 0); assert.equal(copied.stats.pending, 1);
    assert.equal(copied.snapshots[0]!.id, snapshot.id); assert.deepEqual(copied.decisions, before.decisions);
    assert.deepEqual(copied.decisions[0]!.temporal_evidence, [proof]); assert.equal(copied.decisions[0]!.evaluated_at, evaluatedAt);
    assert.equal(copied.decisions[0]!.created_at, '2026-10-30T11:00:00.000Z', 'completion time is separate from request as-of');
    const data = (value: typeof before): OpportunityExportData => ({ campaign: context, progress: value.stats, cost: {}, ...value });
    const beforeFile = join(directory, 'before.xlsx'), afterFile = join(directory, 'after.xlsx');
    // Both workbooks are written after the store clock advances; the earlier snapshot remains historical truth.
    await exportOpportunityWorkbook(beforeFile, data(before)); await exportOpportunityWorkbook(afterFile, data(copied));
    const beforeWorkbook = new ExcelJS.Workbook(), afterWorkbook = new ExcelJS.Workbook();
    await beforeWorkbook.xlsx.readFile(beforeFile); await afterWorkbook.xlsx.readFile(afterFile);
    const current = records(beforeWorkbook, 'Conversations')[0]!, pending = records(afterWorkbook, 'Conversations')[0]!;
    assert.equal(current.classification, 'SUITABLE'); assert.equal(current.evaluated_at, evaluatedAt); assert.equal(current.valid_until, deadline);
    assert.equal(current.decision_id, original.id); assert.equal(current.snapshot_id, snapshot.id); assert.equal(current.observed_at, observedAt);
    assert.deepEqual(JSON.parse(String(current.temporal_evidence)), [proof]);
    assert.equal(pending.classification || '', ''); assert.equal(pending.assessment_status, 'PENDING');
    assert.equal(pending.evaluated_at || '', '', 'expired assessment must not attach to a current pending row');
    const history = records(afterWorkbook, 'DecisionHistory')[0]!;
    assert.equal(history.classification, 'SUITABLE'); assert.equal(history.evaluated_at, evaluatedAt); assert.equal(history.valid_until, deadline);
    assert.equal(history.snapshot_id, snapshot.id); assert.equal(history.snapshot_observed_at, observedAt); assert.equal(history.created_at, original.created_at);
    assert.deepEqual(JSON.parse(String(history.temporal_evidence)), [proof]);
    const manifest = Object.fromEntries(records(beforeWorkbook, 'Manifest').map(row => [String(row.key), row.value]));
    assert.equal(manifest.assessment_snapshot_as_of, before.watermark.captured_at); assert.equal(manifest.temporal_columns_version, '1');
    assert.equal(selectOpportunityExport(data(copied), 'SUITABLE').snapshots.length, 0);
    assert.equal(JSON.stringify(before), originalJson, 'export never rewrites the original captured data');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
