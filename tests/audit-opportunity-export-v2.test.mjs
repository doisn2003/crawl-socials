import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditOpportunityExport, writeOpportunityAudit } from '../scripts/benchmark/audit-opportunity-export-v2.mjs';

const at = '2026-10-30T10:00:00Z', later = '2026-10-30T11:00:00Z';
const campaign = { campaign_id: 'test', version: '1', filter_version: 'filter-1' };
const counts = (raw, suitable = 0, notYet = 0, unrelated = 0, comments = 0, failed = 0) => ({ raw, comments, suitable, notYet, unrelated, pending: raw - suitable - notYet - unrelated, failed });
function snapshot(platform = 'threads', root = '10001', revision = 1, body = 'PRIVATE_POST_TEXT') {
  const post = { entity_type: 'POST', entity_id: root, root_post_id: root, parent_id: null, text: body, observed_at: at, published_at: at,
    permalink: `https://${platform === 'facebook' ? 'www.facebook.com' : 'www.threads.com'}/${root}`, content_hash: 'content-hash',
    author: { name: 'PRIVATE_AUTHOR_NAME' }, source: { kind: 'PROFILE' }, media: [] };
  return { id: `${platform}:${root}:${revision}:hash`, platform, root_post_id: root, revision, content_hash: 'hash', observed_at: revision === 1 ? at : later,
    post, comments: [], coverage: { status: 'NOT_ATTEMPTED' }, spans: body ? [{ id: 'post-span-' + revision, entity_type: 'POST', entity_id: root, start: 0, end: body.length, text: body }] : [] };
}
function addComment(s, entityId = '20001', parent = s.root_post_id, text = 'PRIVATE_COMMENT_TEXT') {
  s.comments.push({ ...s.post, entity_type: 'COMMENT', entity_id: entityId, parent_id: parent, text, observed_at: later });
  s.spans.push({ id: 'comment-span-' + entityId, entity_type: 'COMMENT', entity_id: entityId, start: 0, end: text.length, text });
  s.coverage = { status: 'PARTIAL', observed_count: s.comments.length, has_more: true }; return s;
}
function decision(s, label = 'SUITABLE', overrides = {}) {
  return { id: 'decision-' + s.id, campaign_id: campaign.campaign_id, campaign_version: campaign.version, filter_version: campaign.filter_version,
    platform: s.platform, root_post_id: s.root_post_id, snapshot_id: s.id, snapshot_revision: s.revision,
    classification: label, assessment_status: label === null ? 'PENDING' : 'ASSESSED', reason_code: 'TEST', evidence_ids: s.spans.slice(0, 1).map(span => span.id), model: 'model-1',
    action_target: label === 'SUITABLE' ? { entity_id: s.root_post_id, type: 'POST' } : null, created_at: s.observed_at, ...overrides };
}
function exported(snapshots = [snapshot()], decisions = snapshots.map(s => decision(s))) {
  const byPlatform = Object.fromEntries(['facebook', 'threads'].map(platform => {
    const roots = snapshots.filter(s => s.platform === platform), rows = decisions.filter(d => d.platform === platform);
    return [platform, counts(roots.length, rows.filter(d => d.classification === 'SUITABLE').length, rows.filter(d => d.classification === 'NOT_YET').length,
      rows.filter(d => d.classification === 'UNRELATED').length, roots.reduce((sum, s) => sum + s.comments.length, 0), rows.filter(d => d.assessment_status === 'FAILED').length)];
  }));
  return { campaign, snapshots, conversations: decisions.map(d => ({ snapshot: snapshots.find(s => s.id === d.snapshot_id), decision: d, stale: false })),
    decisions, decision_snapshots: structuredClone(snapshots), watermark: { journal_sequence: 50, captured_at: '2026-10-30T12:00:00Z' },
    progress: { counts: Object.fromEntries(Object.keys(counts(0)).map(k => [k, byPlatform.facebook[k] + byPlatform.threads[k]])), byPlatform } };
}
const finding = (audit, code) => audit.findings.checks.find(check => check.code === code);
function promotion() {
  const old = snapshot(), current = addComment(snapshot('threads', old.root_post_id, 2)), before = decision(old, 'NOT_YET');
  const after = decision(current, 'SUITABLE', { evidence_ids: ['comment-span-20001'], action_target: { type: 'COMMENT', entity_id: '20001' } });
  const data = exported([current], [after]); data.decisions.unshift(before); data.decision_snapshots.unshift(old); return data;
}

test('platform plus root is the counting grain and pending includes failed without double counting', () => {
  const roots = [snapshot('facebook'), snapshot('threads'), snapshot('threads', '10002'), snapshot('threads', '10003')];
  const data = exported(roots, [decision(roots[0]), decision(roots[1], 'NOT_YET'), decision(roots[2], null, { assessment_status: 'FAILED' })]);
  const audit = auditOpportunityExport({ opportunity: data });
  assert.equal(audit.status, 'PASS'); assert.equal(audit.counts.raw, 4); assert.equal(audit.counts.pending, 2); assert.equal(audit.counts.failed, 1); assert.equal(audit.counts.missing, 1);
  assert.equal(audit.by_platform.facebook.raw, 1); assert.equal(audit.by_platform.threads.raw, 3);
  assert.equal(audit.counts.raw, audit.counts.suitable + audit.counts.notYet + audit.counts.unrelated + audit.counts.pending);
  const duplicate = structuredClone(data); duplicate.snapshots.push(duplicate.snapshots[0]);
  assert.equal(finding(auditOpportunityExport(duplicate), 'DUPLICATE_CURRENT_ROOT').count, 1);
});

test('current decisions must match the latest snapshot revision and frozen snapshot content', () => {
  const data = exported(), changed = structuredClone(data);
  changed.conversations[0].decision.snapshot_revision = 9;
  assert.equal(finding(auditOpportunityExport(changed), 'DECISION_SNAPSHOT_REVISION_MISMATCH').count, 1);
  const stale = structuredClone(data); stale.conversations[0].stale = true;
  assert.ok(finding(auditOpportunityExport(stale), 'STALE_OR_INCONSISTENT_CURRENT_VIEW'));
  const conflicting = JSON.parse(JSON.stringify(data)); conflicting.snapshots[0].post.author.name = 'DIFFERENT_PRIVATE_AUTHOR';
  const audit = auditOpportunityExport(conflicting);
  assert.ok(finding(audit, 'CONFLICTING_SNAPSHOT_CONTENT')); assert.ok(finding(audit, 'STALE_OR_INCONSISTENT_CURRENT_VIEW'));
  assert.equal(audit.status, 'FAIL');
});

test('evidence must preserve exact text offsets and suitable action targets must be cited', () => {
  const data = exported(), bad = structuredClone(data); bad.snapshots[0].spans[0].start = 1;
  const audit = auditOpportunityExport(bad); assert.ok(finding(audit, 'INVALID_EXACT_EVIDENCE_SPAN')); assert.ok(finding(audit, 'INVALID_DECISION_EVIDENCE_REFERENCE'));
  const noEvidence = exported(); noEvidence.decisions[0].evidence_ids = [];
  assert.ok(finding(auditOpportunityExport(noEvidence), 'SUITABLE_WITHOUT_EVIDENCE'));
  const wrongTarget = exported(); wrongTarget.decisions[0].action_target = { type: 'COMMENT', entity_id: 'not-observed' };
  assert.ok(finding(auditOpportunityExport(wrongTarget), 'INVALID_ACTION_TARGET'));
  assert.ok(finding(auditOpportunityExport(wrongTarget), 'SUITABLE_ACTION_TARGET_NOT_EVIDENCED'));
});

test('unresolved comment parents remain explicit coverage gaps while parent cycles fail', () => {
  const s = addComment(snapshot(), 'reply', 'not-observed-parent'), data = exported([s]);
  const audit = auditOpportunityExport(data);
  assert.equal(audit.status, 'PASS'); assert.equal(audit.by_platform.threads.unresolved_comment_parents, 1);
  assert.equal(finding(audit, 'COMMENT_PARENT_NOT_OBSERVED').severity, 'INFO');
  const unknown = addComment(snapshot(), 'reply', null); const a = auditOpportunityExport(exported([unknown]));
  assert.equal(a.by_platform.threads.comments_with_unknown_parent, 1);
  const cycle = addComment(addComment(snapshot(), 'reply1', 'reply2'), 'reply2', 'reply1');
  assert.ok(finding(auditOpportunityExport(exported([cycle])), 'COMMENT_PARENT_CYCLE'));
});

test('coverage contradictions, future timestamps, deceptive URL hosts and count mismatches are detected', () => {
  const s = addComment(snapshot()); s.coverage = { status: 'OBSERVED_EMPTY', observed_count: 0, has_more: false };
  s.post.published_at = '2026-11-01T00:00:00Z'; s.post.permalink = 'https://www.threads.com.evil.test/PRIVATE_URL';
  const data = exported([s]); data.progress.counts.raw++;
  const audit = auditOpportunityExport(data);
  for (const code of ['EMPTY_COVERAGE_WITH_COMMENTS_OR_MORE', 'FUTURE_PUBLISHED_TIMESTAMP', 'INVALID_ENTITY_PERMALINK_HOST', 'EXPORTED_COUNTS_DO_NOT_RECONCILE']) assert.ok(finding(audit, code), code);
  assert.equal(finding(audit, 'FUTURE_PUBLISHED_TIMESTAMP').severity, 'WARN');
  const valid = snapshot(); valid.post.permalink = 'https://www.threads.net/@example/post/abc'; assert.equal(auditOpportunityExport(exported([valid])).status, 'PASS');
});

test('comment-supported promotion requires a prior not-yet snapshot, unchanged text and newly cited comment target', () => {
  const audit = auditOpportunityExport(promotion());
  assert.equal(audit.status, 'PASS'); assert.equal(audit.by_platform.threads.suitable_with_comment_evidence, 1);
  assert.equal(audit.by_platform.threads.suitable_comment_target, 1); assert.equal(audit.by_platform.threads.qualified_comment_supported_promotions, 1);
  const changed = promotion(); const old = changed.decision_snapshots.find(s => s.revision === 1); old.post.text = 'DIFFERENT_ROOT_TEXT'; old.spans[0].text = old.post.text; old.spans[0].end = old.post.text.length;
  const changedAudit = auditOpportunityExport(changed); assert.equal(changedAudit.by_platform.threads.qualified_comment_supported_promotions, 0); assert.equal(changedAudit.promotion_exclusion_counts.root_text_changed_or_unavailable, 1);
  const alreadySuitable = promotion(); alreadySuitable.decisions[0].classification = 'SUITABLE'; alreadySuitable.decisions[0].action_target = { type: 'POST', entity_id: '10001' };
  assert.equal(auditOpportunityExport(alreadySuitable).promotion_exclusion_counts.prior_label_not_not_yet, 1);
  const newModel = promotion(); newModel.decisions[0].model = 'different-model';
  assert.equal(auditOpportunityExport(newModel).promotion_exclusion_counts.model_changed, 1);
  const existingComment = promotion(); const previous = existingComment.decision_snapshots.find(s => s.revision === 1); addComment(previous);
  assert.equal(auditOpportunityExport(existingComment).promotion_exclusion_counts.no_new_comment_action_evidence, 1);
});

test('incomplete parent ancestry and missing historical snapshots cannot establish a promotion', () => {
  const data = promotion(); data.snapshots[0].comments[0].parent_id = 'unknown-parent'; data.decision_snapshots.find(s => s.revision === 2).comments[0].parent_id = 'unknown-parent';
  const partial = auditOpportunityExport(data); assert.equal(partial.promotion_exclusion_counts.new_comment_parent_context_incomplete, 1);
  const noHistory = promotion(); noHistory.decision_snapshots = noHistory.decision_snapshots.filter(s => s.revision === 2);
  const audit = auditOpportunityExport(noHistory); assert.equal(audit.by_platform.threads.qualified_comment_supported_promotions, 0); assert.ok(finding(audit, 'DECISION_SNAPSHOT_UNAVAILABLE'));
  const priorEdit = promotion(), old = priorEdit.decision_snapshots.find(s => s.revision === 1); addComment(old, 'older-comment', old.root_post_id, 'old text');
  assert.equal(auditOpportunityExport(priorEdit).promotion_exclusion_counts.preexisting_comment_changed_or_removed, 1);
});

test('audit report contains bounded IDs only and CLI writes once outside the repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-export-audit-test-'));
  try {
    const data = exported(); data.snapshots[0].post.permalink = 'https://evil.test/PRIVATE_URL';
    const audit = auditOpportunityExport(data, { maxExamples: 1 });
    const encoded = JSON.stringify(audit);
    for (const marker of ['PRIVATE_POST_TEXT', 'PRIVATE_AUTHOR_NAME', 'PRIVATE_URL', 'https://']) assert.equal(encoded.includes(marker), false);
    assert.ok(audit.findings.checks.every(row => row.examples.length <= 1));
    const input = path.join(dir, 'export.json'), output = path.join(dir, 'audit.json'); fs.writeFileSync(input, JSON.stringify(data));
    const script = fileURLToPath(new URL('../scripts/benchmark/audit-opportunity-export-v2.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--input', input, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 2); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).status, 'FAIL'); assert.equal(result.stdout.includes('PRIVATE_'), false);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).status, 'FAIL');
    assert.throws(() => writeOpportunityAudit({ input, output }));
    assert.throws(() => writeOpportunityAudit({ input, output: fileURLToPath(new URL('../.brain/forbidden-audit.json', import.meta.url)) }), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('malformed entity and label types produce findings without leaking raw values or crashing the audit', () => {
  const data = exported(); data.snapshots[0].post.text = 123;
  data.snapshots[0].coverage.status = 'PRIVATE_INVALID_COVERAGE'; data.decisions[0].assessment_status = 'FAILED'; data.decisions[0].model = '';
  const audit = auditOpportunityExport(data);
  assert.equal(audit.status, 'FAIL'); assert.ok(finding(audit, 'INVALID_ENTITY_IDENTITY')); assert.ok(finding(audit, 'INVALID_COVERAGE_STATUS'));
  assert.ok(finding(audit, 'DECISION_CLASS_STATUS_CONTRADICTION')); assert.ok(finding(audit, 'DECISION_PROVENANCE_MISSING'));
  assert.equal(JSON.stringify(audit).includes('PRIVATE_INVALID_COVERAGE'), false);
});
