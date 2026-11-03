// Offline correction of the completed R7 result. No model transport or live crawler.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { campaignVersion, validateCampaignPlan } from '../../dist/domain/campaign-plan.js';
import { enforceContentLanguage, CONTENT_LANGUAGE_POLICY } from '../../dist/domain/content-language.js';
import { validateConversationDecision } from '../../dist/domain/conversation-decision.js';
import { exportOpportunityWorkbook } from '../../dist/infrastructure/export/opportunity-workbook.js';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const artifacts = resolve('artifacts/piano-language-20261103'); mkdirSync(artifacts, { recursive: true });
const source = read(resolve('artifacts/piano-comparison-20261103/output-path.json')).output;
const output = join(source, '..', 'piano-vietnamese-20261103'); mkdirSync(output, { recursive: true });
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { flush: true });
const sourceHashes = Object.fromEntries(['snapshots.json', 'results-STANDARD.json', 'results-QUALITY.json'].map(f => [f, hash(readFileSync(join(source, f)))]));
const previous = existsSync(join(output, 'revision.json')) ? read(join(output, 'revision.json')) : null;
if (previous) assert.deepEqual(previous.sourceHashes, sourceHashes);
const revision = { id: 'piano-vietnamese-20261103', revisedAt: previous?.revisedAt ?? new Date().toISOString(), source, sourceHashes,
  instruction: 'Nội dung tiếng Việt, kể cả người Việt ở nước ngoài', languages: ['vi'], languagePolicy: CONTENT_LANGUAGE_POLICY,
  method: 'Reuse frozen semantic decisions; apply the local language rule to the selected actor. No fresh LLM assessment.',
  newApiCalls: 0, newAiCostUsd: 0, targetPerMode: 1000 };
write('revision.json', revision);
const examples = ['4022196867861602374', '4022198781940510857', '4022185160535688913', '4022187160706634464'];
const counts = {}, checks = {}, files = {};
for (const mode of ['STANDARD', 'QUALITY']) {
  const old = read(join(source, 'results-' + mode + '.json'));
  const campaign = { ...structuredClone(old.campaign), campaign_id: revision.id, languages: ['vi'], created_at: revision.revisedAt };
  const { version: _, created_at: __, ...base } = campaign; campaign.version = campaignVersion(base); validateCampaignPlan(campaign);
  const decisions = old.decisions.map(row => {
    const before = row.decision;
    const seeded = { ...before, campaign_id: campaign.campaign_id, campaign_version: campaign.version,
      id: 'language-' + hash(before.id + ':' + campaign.version + ':' + CONTENT_LANGUAGE_POLICY).slice(0, 32), created_at: revision.revisedAt,
      attributes: { ...before.attributes, semantic_source_decision_id: before.id, language_revision: CONTENT_LANGUAGE_POLICY } };
    const decision = enforceContentLanguage(campaign, row.snapshot, seeded);
    validateConversationDecision(decision, row.snapshot);
    return { snapshot: row.snapshot, decision, stale: row.stale };
  });
  assert.equal(decisions.length, 3222);
  const accepted = new Map(decisions.filter(r => !r.stale && r.decision.classification === 'SUITABLE' && r.decision.assessment_status === 'ASSESSED')
    .map(r => [r.snapshot.platform + ':' + r.snapshot.root_post_id, r]));
  const admitted = [...old.selection.target, ...old.selection.extra].filter(r => accepted.has(r.platform + ':' + r.rootId));
  assert.equal(admitted.length, accepted.size);
  const selection = { target: admitted.slice(0, 1000), extra: admitted.slice(1000) };
  const target = selection.target.map(r => accepted.get(r.platform + ':' + r.rootId));
  const languageRejected = decisions.filter(r => r.decision.reason_code === 'CONTENT_LANGUAGE_MISMATCH').length;
  const languagePending = decisions.filter(r => r.decision.reason_code.startsWith('CONTENT_LANGUAGE_') && r.decision.assessment_status === 'PENDING').length;
  counts[mode] = { previouslyAccepted: old.selection.target.length + old.selection.extra.length, accepted: accepted.size, exported: target.length,
    extra: selection.extra.length, target: 1000, shortfall: Math.max(0, 1000 - target.length), removedForLanguage: languageRejected,
    heldForUnverifiedLanguage: languagePending, allPending: decisions.filter(r => r.decision.assessment_status === 'PENDING').length };
  checks[mode] = examples.map(id => {
    const row = decisions.find(r => r.snapshot.root_post_id === id); assert.ok(row);
    assert.equal(row.decision.classification, 'NOT_SUITABLE'); assert.equal(row.decision.reason_code, 'CONTENT_LANGUAGE_MISMATCH');
    return { id, classification: row.decision.classification, reason: row.decision.reason_code };
  });
  write('results-' + mode + '.json', { mode, campaign, selection, decisions, revision });
  const data = { campaign, conversations: target, snapshots: target.map(r => r.snapshot), decisions: target.map(r => r.decision), selection,
    progress: counts[mode], cost: { incrementalUsd: 0, incrementalApiCalls: 0, reusedSemanticResults: true },
    retained_input: { source, originalSnapshotSha256: sourceHashes['snapshots.json'], revision } };
  const name = 'CSD-piano-' + mode + '-VI-' + target.length;
  write(name + '.json', data); await exportOpportunityWorkbook(join(output, name + '.xlsx'), data, 'SUITABLE');
  files[mode] = { json: join(output, name + '.json'), xlsx: join(output, name + '.xlsx'),
    jsonSha256: hash(readFileSync(join(output, name + '.json'))), xlsxSha256: hash(readFileSync(join(output, name + '.xlsx'))) };
}
for (const [f, digest] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(join(source, f))), digest);
const summary = { revision, output, counts, reportedExamples: checks, files,
  qualityNote: 'R7 precision/recall used the former unrestricted-language scope and must not be reused as the score of this revision.' };
write('summary.json', summary); writeFileSync(join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2), { flush: true });
writeFileSync(join(source, 'LATEST-LANGUAGE-CORRECTION.json'), JSON.stringify({ supersededExports: true, correctedOutput: output,
  scope: revision.instruction, correctedAt: revision.revisedAt }, null, 2), { flush: true });
console.log(JSON.stringify({ output, counts, files, newApiCalls: 0, sourcePreserved: true }));
