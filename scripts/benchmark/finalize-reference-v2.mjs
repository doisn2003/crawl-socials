#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const directory = path.resolve(process.argv[2] ?? path.join(process.env.APPDATA, 'csd-desktop/data/benchmarks/coffee-intent-20261030/conversation-reference-v2'));
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const readLines = name => fs.readFileSync(path.join(directory, name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const reference = readLines('reference-final.jsonl'), snapshots = new Map(readLines('snapshots-private.jsonl').map(s => [s.id, s]));
const blind = read('agent-blind-labels.json'), targeted = read('agent-disagreement-review.json'), queue = read('agent-audit-queue.json');
const reviews = new Map([...blind.labels, ...targeted.labels].map(r => [r.id, r]));
const required = [...new Set([...queue.disagreement_ids, ...queue.random_agreement_ids])];
if (required.some(id => !reviews.has(id))) throw Error('AGENT_AUDIT_INCOMPLETE');
if (new Set(reference.map(r => r.id)).size !== reference.length) throw Error('REFERENCE_DUPLICATE_ID');
let overrides = 0;
const final = reference.map(row => {
  const review = reviews.get(row.id);
  if (!review) return { ...row, resolution: row.resolution.replace('_PENDING_AGENT_AUDIT', ''), independent_agent_review: false };
  if (!['SUITABLE', 'NOT_YET', 'UNRELATED', 'REFERENCE_UNRESOLVED'].includes(review.label)) throw Error('AGENT_LABEL_INVALID');
  const snapshot = snapshots.get(row.snapshot_id);
  if (!snapshot) throw Error('SNAPSHOT_MISSING');
  if (review.label !== row.final_label) overrides++;
  return { ...row, model_adjudicated_label: row.final_label, final_label: review.label,
    resolution: 'AGENT_REVIEWED_WITH_FROZEN_TEXT', independent_agent_review: true,
    agent_review: { ...review, provenance: blind.labels.some(r => r.id === row.id) ? 'INDEPENDENT_AGENT_BLIND_REVIEW' : 'INDEPENDENT_AGENT_DISAGREEMENT_OR_AGREEMENT_AUDIT',
      snapshot_id: snapshot.id, as_of: snapshot.observed_at, evidence_ids: snapshot.spans.length ? [snapshot.spans[0].id] : [] } };
});
const counts = Object.fromEntries(['facebook', 'threads'].map(platform => [platform, Object.fromEntries(['SUITABLE', 'NOT_YET', 'UNRELATED', 'REFERENCE_UNRESOLVED']
  .map(label => [label, final.filter(r => snapshots.get(r.snapshot_id)?.platform === platform && r.final_label === label).length]))]));
const report = { records: final.length, human_anchors_preserved: final.filter(r => r.human_anchor?.decision).length,
  ai_completed_previously_unlabeled: final.filter(r => !r.human_anchor?.decision).length,
  independently_reviewed: reviews.size, blind_random_sample: blind.labels.length, all_model_disagreements_reviewed: queue.disagreement_ids.length,
  random_agreements_reviewed: queue.random_agreement_ids.length, overrides, counts,
  canonical_reference_file: 'reference-final-agent.jsonl',
  provenance: 'AI_ADJUDICATED_REFERENCE_WITH_INDEPENDENT_AGENT_AUDIT_NOT_HUMAN_GOLD',
  limitations: ['Historical calibration/regression sample, already seen; not fresh production holdout.',
    'Two small-model passes share a model family; 50 independently reviewed cases reduce but do not remove correlated error.',
    'Historical snapshots have no comment text; this reference cannot certify comments/revisit capability.',
    'Targeted disagreements/human-conflict cases are not a representative population sample.'],
  model_cost: read('summary.json').cost,
};
fs.writeFileSync(path.join(directory, 'reference-final-agent.jsonl'), final.map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(directory, 'agent-audit-summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
