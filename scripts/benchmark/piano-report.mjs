// Offline only: freeze a blinded reference sample, reconcile costs, and export CSD results.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exportOpportunityWorkbook } from '../../dist/infrastructure/export/opportunity-workbook.js';

const taskDir = resolve('artifacts/piano-comparison-20261103');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const output = read(join(taskDir, 'output-path.json')).output;
const summary = read(join(output, 'summary.json')), status = read(join(output, 'status.json'));
assert.equal(status.phase, 'COMPLETE', 'Wait until live collection and filtering have finished');
assert.equal(status.raw, summary.raw);
const snapshots = read(join(output, 'snapshots.json')), modes = ['STANDARD', 'QUALITY'];
const key = s => s.platform + ':' + s.root_post_id;
assert.equal(new Set(snapshots.map(key)).size, snapshots.length);
assert.equal(snapshots.length, summary.raw);
const results = Object.fromEntries(modes.map(m => [m, read(join(output, 'results-' + m + '.json'))]));
const maps = Object.fromEntries(modes.map(m => [m, new Map(results[m].decisions.map(r => [key(r.snapshot), r]))]));
const current = (mode, s) => {
  const r = maps[mode].get(key(s));
  return r && !r.stale && r.decision.snapshot_id === s.id && r.decision.assessment_status === 'ASSESSED' ? r.decision.classification : null;
};
const referenceFile = join(taskDir, 'reference-blind.json');
if (!existsSync(referenceFile)) {
  const selected = [...snapshots].sort((a, b) => hash('piano-reference-v1:' + key(a)).localeCompare(hash('piano-reference-v1:' + key(b)))).slice(0, 120);
  writeFileSync(referenceFile, JSON.stringify({ population: snapshots.length, populationHash: hash(snapshots), seed: 'piano-reference-v1',
    method: 'Deterministic uniform hash sample of all final live roots; model decisions and reasons omitted from annotation view.',
    scope: read(join(taskDir, 'task.json')).clarification, rows: selected.map((s, i) => ({ index: i + 1, key: key(s), snapshot_id: s.id,
      text: s.post?.text ?? '', comments: s.comments.map(c => ({ text: c.text, parent: c.parent_id })), published_at: s.post?.published_at })) }, null, 2));
}
const reference = read(referenceFile); assert.equal(reference.populationHash, hash(snapshots));
const histogram = values => values.reduce((o, value) => { o[value ?? 'PENDING'] = (o[value ?? 'PENDING'] ?? 0) + 1; return o; }, {});
const counts = Object.fromEntries(modes.map(m => [m, { total: snapshots.length, ...histogram(snapshots.map(s => current(m, s))),
  platforms: Object.fromEntries(['facebook', 'threads'].map(p => [p, histogram(snapshots.filter(s => s.platform === p).map(s => current(m, s)))])),
  pendingReasons: histogram(snapshots.filter(s => !current(m, s)).map(s => maps[m].get(key(s))?.decision.reason_code ?? 'UNASSESSED')),
  target: results[m].selection.target.length, extra: results[m].selection.extra.length }]));
for (const m of modes) assert.equal(counts[m].SUITABLE ?? 0, summary.accepted[m]);
const ledger = readFileSync(join(taskDir, 'model', 'model-ledger.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const starts = new Map(ledger.filter(e => e.type === 'START').map(e => [e.invocation_id, e]));
const finishes = new Map(ledger.filter(e => e.type === 'FINISH').map(e => [e.invocation_id, e]));
const costByPurpose = {}, tokenUsage = { input: 0, output: 0, thinking: 0, cachedInput: 0 };
let totalCost = 0, held = 0;
for (const [id, s] of starts) {
  const f = finishes.get(id), known = f?.cost_usd ?? 0, unknown = f ? f.unmetered_cost_upper_usd ?? 0 : s.reserved_usd;
  totalCost += known; held += unknown;
  const row = costByPurpose[s.purpose] ??= { calls: 0, usd: 0, held: 0 }; row.calls++; row.usd += known; row.held += unknown;
  const usage = f?.result?.usage;
  if (usage) { tokenUsage.input += usage.input_tokens; tokenUsage.output += usage.output_tokens; tokenUsage.thinking += usage.thinking_tokens; tokenUsage.cachedInput += usage.cached_input_tokens; }
}
assert.ok(totalCost + held <= 6); assert.ok(Math.abs(totalCost - summary.cost.measured_cost_usd) < 1e-8);
const batches = readFileSync(join(output, 'evaluation-batches.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const attributed = new Set(), modeCost = { STANDARD: 0, QUALITY: 0 }, failureOccurrences = {};
for (const b of batches) {
  for (const f of b.failures) { const k = b.mode + ':' + f.code; failureOccurrences[k] = (failureOccurrences[k] ?? 0) + 1; }
  for (const r of b.calls) if (!r.cached && !attributed.has(r.id)) {
    attributed.add(r.id); modeCost[b.mode] += finishes.get(r.id)?.cost_usd ?? 0;
  }
}
const commonCost = totalCost - modeCost.STANDARD - modeCost.QUALITY;
const overlap = histogram(snapshots.map(s => (current('STANDARD', s) === 'SUITABLE' ? 'S' : '-') + (current('QUALITY', s) === 'SUITABLE' ? 'Q' : '-')));
let metrics = null, deliveredMetrics = null, referenceBranches = null;
const labelsFile = join(taskDir, 'reference-labels.json');
if (existsSync(labelsFile)) {
  const labels = read(labelsFile); assert.equal(labels.referenceHash, hash(readFileSync(referenceFile, 'utf8')));
  assert.equal(labels.rows.length, reference.rows.length);
  const labelMap = new Map(labels.rows.map(l => [l.index, l])); assert.equal(labelMap.size, reference.rows.length);
  referenceBranches = histogram(labels.rows.map(l => l.branch));
  const wilson = (p, n) => { if (!n) return null; const z = 1.96, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d,
    h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [c - h, c + h]; };
  metrics = Object.fromEntries(modes.map(m => {
    let tp = 0, fp = 0, fn = 0, tn = 0, unknownAccepted = 0, unknown = 0, pending = 0;
    for (const row of reference.rows) {
      const label = labelMap.get(row.index); assert.ok(['YES', 'NO', 'UNKNOWN'].includes(label.label));
      const s = snapshots.find(s => key(s) === row.key), verdict = current(m, s), accepted = verdict === 'SUITABLE';
      if (!verdict) pending++;
      if (label.label === 'UNKNOWN') { unknown++; if (accepted) unknownAccepted++; continue; }
      if (accepted) label.label === 'YES' ? tp++ : fp++; else label.label === 'YES' ? fn++ : tn++;
    }
    const n = tp + fp, precision = n ? tp / n : null, recall = tp + fn ? tp / (tp + fn) : null;
    return [m, { sampleSize: reference.rows.length, tp, fp, fn, tn, unknown, unknownAccepted, pending,
      acceptedInSample: n + unknownAccepted, precisionKnown: precision, precisionWilson95: wilson(precision, n), recallKnown: recall,
      recallWilson95: wilson(recall, tp + fn), precisionBoundsIncludingUnknown: n + unknownAccepted ? [tp / (n + unknownAccepted), (tp + unknownAccepted) / (n + unknownAccepted)] : null }];
  }));
  deliveredMetrics = Object.fromEntries(modes.map(m => {
    const target = new Set(results[m].selection.target.map(r => r.platform + ':' + r.rootId));
    const selected = reference.rows.filter(r => target.has(r.key));
    const labels = histogram(selected.map(r => labelMap.get(r.index).label));
    const yes = labels.YES ?? 0, no = labels.NO ?? 0, unknown = labels.UNKNOWN ?? 0;
    return [m, { sampledDelivered: selected.length, yes, no, unknown,
      precisionKnown: yes + no ? yes / (yes + no) : null, precisionWilson95: wilson(yes / (yes + no), yes + no),
      precisionBoundsIncludingUnknown: selected.length ? [yes / selected.length, (yes + unknown) / selected.length] : null }];
  }));
}
const dataQuality = { missingPost: snapshots.filter(s => !s.post).length, emptyText: snapshots.filter(s => !s.post?.text.trim()).length,
  missingUrl: snapshots.filter(s => !s.post?.permalink).length, missingPublishedAt: snapshots.filter(s => !s.post?.published_at).length,
  comments: snapshots.reduce((n, s) => n + s.comments.length, 0),
  duplicateExactTextBeyondFirst: snapshots.length - new Set(snapshots.map(s => s.post?.text?.normalize('NFC').trim())).size,
  platforms: histogram(snapshots.map(s => s.platform)) };
const deliveryQuality = Object.fromEntries(modes.map(m => {
  const ids = new Set(results[m].selection.target.map(r => r.platform + ':' + r.rootId));
  const selected = snapshots.filter(s => ids.has(key(s)));
  assert.equal(selected.length, 1000);
  for (const s of selected) {
    const d = maps[m].get(key(s)).decision;
    assert.equal(current(m, s), 'SUITABLE'); assert.equal(d.model, summary.task.model);
    assert.ok(d.evidence_ids.length && d.evidence_ids.every(id => s.spans.some(span => span.id === id)));
  }
  const ageDays = selected.map(s => (Date.parse(summary.finishedAt) - Date.parse(s.post.published_at)) / 86400000);
  return [m, { count: selected.length, platforms: histogram(selected.map(s => s.platform)), evidenceReferencesValid: true,
    duplicateExactTextBeyondFirst: selected.length - new Set(selected.map(s => s.post.text.normalize('NFC').trim())).size,
    ageDays: { upTo30: ageDays.filter(a => a <= 30).length, from31To90: ageDays.filter(a => a > 30 && a <= 90).length,
      over90: ageDays.filter(a => a > 90).length, oldest: Math.round(Math.max(...ageDays)) } }];
}));
const report = { task: summary.task, raw: snapshots.length, counts, overlap, dataQuality, totalCost, held, calls: starts.size,
  tokenUsage, costByPurpose, modeCost, commonCost, failureOccurrences, metrics, deliveredMetrics, referenceBranches, deliveryQuality,
  reference: { count: reference.rows.length, populationHash: reference.populationHash, fileHash: hash(readFileSync(referenceFile, 'utf8')) },
  methodology: 'Both modes evaluated the same final root pool. QUALITY reuses STANDARD then performs selective review. Mode costs are actual invocation-attributed work on the whole shared pool, not separate end-to-end crawl invoices. Reference is one coding-agent annotation, not customer-validated ground truth.' };
writeFileSync(join(taskDir, 'analysis.json'), JSON.stringify(report, null, 2));
if (process.argv.includes('--export')) for (const mode of modes) {
  const r = results[mode], targetKeys = new Set(r.selection.target.map(x => x.platform + ':' + x.rootId));
  const conversations = r.decisions.filter(row => targetKeys.has(key(row.snapshot)) && current(mode, row.snapshot) === 'SUITABLE');
  const data = { campaign: r.campaign, progress: counts[mode], cost: { measuredTaskUsd: totalCost, held, basis: 'TOKEN_USAGE_AT_LIST_PRICE_NOT_INVOICE' },
    snapshots: conversations.map(x => x.snapshot), decisions: conversations.map(x => x.decision), conversations, selection: r.selection };
  const file = join(output, 'CSD-piano-' + mode + '-1000');
  await exportOpportunityWorkbook(file + '.xlsx', data, 'SUITABLE');
  writeFileSync(file + '.json', JSON.stringify(data, null, 2));
}
console.log(JSON.stringify({ raw: report.raw, counts, totalCost, held, calls: report.calls, modeCost, commonCost, metrics, referenceFile, output }));
