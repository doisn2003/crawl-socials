import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { withFilterPolicy } from '../src/application/filter-policy.js';
import { classifyConversations } from '../src/application/classification-service.js';
import { unassessedGateway } from '../src/application/filter-policy.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';

test('one missing or duplicated model item does not discard its valid batch siblings or trigger a paid repair', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-partial-')), store = createConversationStore(join(root, 'store'));
  try {
    const plan = withFilterPolicy(literalCampaign({ prompt: 'Tìm người học piano' }), 'STANDARD');
    for (const id of ['1', '2', '3']) store.ingest({ platform: 'facebook', entity_type: 'POST', entity_id: id, root_post_id: id,
      parent_id: null, text: 'Muốn học piano ' + id, observed_at: '2026-11-03T10:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } });
    let calls = 0;
    const verdict = (i: number) => ({ i, candidate: 'p', role: 'TARGET', fit: 'DIRECT', hard: 'PASS', ev: [0], why: 'Có nhu cầu học', flags: [] });
    const model: ModelGateway = { ...unassessedGateway, generateJson: async () => {
      calls++; return { value: [verdict(0), verdict(2), verdict(2)], model: 'fixture', model_version: null, invocation_id: 'x', request_hash: 'x',
        usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
        price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: '', source: 'FIXTURE' } };
    } };
    const snapshots = store.snapshots(), result = await classifyConversations(plan, snapshots, model);
    assert.equal(calls, 1);
    assert.equal(result.decisions.find(d => d.snapshot_id === snapshots[0]!.id)?.classification, 'SUITABLE');
    assert.deepEqual(result.failures.map(f => f.code), ['COVERAGE_ITEM_MISSING', 'COVERAGE_ITEM_DUPLICATED']);
    assert.equal(result.decisions.filter(d => d.assessment_status === 'PENDING').length, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('standard accepts direct/proxy/plausible need, preserves unknown hard limits, rejects contradictions, caches across metadata changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-coverage-')), store = createConversationStore(join(root, 'store'));
  try {
    const campaign = withFilterPolicy(literalCampaign({ prompt: 'Tìm người có nhu cầu học và mua hoặc mượn đàn piano', seed_queries: ['học piano'] }), 'STANDARD');
    const context = { campaign_id: campaign.campaign_id, campaign_version: campaign.version, filter_version: campaign.filter_version };
    const texts = ['Tìm giáo viên piano cho con', 'Mới bắt đầu thì chọn đàn piano nào?', 'Cần mượn đàn piano', 'Trung tâm tuyển học viên', 'Có phòng nhưng không nói giá', 'Phòng giá vượt giới hạn'];
    for (let i = 0; i < texts.length; i++) store.ingest({ platform: 'facebook', entity_type: 'POST', entity_id: String(i), root_post_id: String(i), parent_id: null,
      text: texts[i]!, observed_at: '2026-11-03T10:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } }, context);
    const snapshots = store.snapshots(); let calls = 0;
    const model: ModelGateway = { summary: () => ({ ...unassessedGateway.summary(), model: 'gemini-2.5-flash-lite' }), generateJson: async request => {
      calls++; assert.equal(request.purpose, 'coverage-standard-v1');
      const value = (request.input as { conversations: { i: number; spans: { text: string }[] }[] }).conversations.map(c => {
        const text = c.spans[0]!.text;
        return { i: c.i, candidate: 'p', ev: [0], why: text, role: text.includes('cho con') ? 'REPRESENTATIVE' : text.includes('Trung tâm') ? 'WRONG' : 'TARGET',
          fit: text.includes('Trung tâm') ? 'NONE' : text.includes('Mới bắt đầu') ? 'PLAUSIBLE' : 'DIRECT', hard: text.includes('không nói giá') ? 'UNKNOWN' : text.includes('vượt giới hạn') ? 'FAIL' : 'PASS', flags: [] };
      });
      return { value, model: 'gemini-2.5-flash-lite', model_version: 'fixture', invocation_id: 'fixture', request_hash: 'fixture', usage: null, cost_usd: 0,
        unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price: { input_per_million: .1, output_per_million: .4, cached_input_per_million: .01, observed_at: '', source: 'FIXTURE' } };
    } };
    const options = { assessmentCacheDirectory: join(root, 'cache'), evaluatedAt: '2026-11-03T10:00:00Z' };
    const first = await classifyConversations(campaign, snapshots, model, options);
    assert.deepEqual(first.decisions.map(d => d.classification), ['SUITABLE', 'SUITABLE', 'SUITABLE', 'NOT_SUITABLE', null, 'NOT_SUITABLE']);
    assert.equal(calls, 1); assert.equal(first.failures.length, 0);
    const revised = snapshots.map(s => ({ ...s, id: s.id + '-revision', observed_at: '2026-11-03T11:00:00Z', revision: 2 }));
    const second = await classifyConversations(campaign, revised, model, options);
    assert.equal(calls, 1); assert.equal(second.decisions.length, 6);
    assert.ok(second.decisions.every(d => d.snapshot_id.endsWith('-revision')));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('quality reuses standard cache, reviews selected cases once, and keeps disagreement pending instead of rejecting a parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-quality-')), store = createConversationStore(join(root, 'store'));
  try {
    const standard = withFilterPolicy(literalCampaign({ prompt: 'Tìm người học piano', seed_queries: ['học piano'] }), 'STANDARD');
    const context = { campaign_id: standard.campaign_id, campaign_version: standard.version, filter_version: standard.filter_version };
    for (const [id, text] of [['1', 'Tôi cần học piano'], ['2', 'Tìm giáo viên piano cho con'], ['3', 'Bắt đầu học thì chọn đàn nào?']]) store.ingest({
      platform: 'facebook', entity_type: 'POST', entity_id: id!, root_post_id: id!, parent_id: null, text: text!, observed_at: '2026-11-03T10:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } }, context);
    const purposes: string[] = [], sizes: number[] = [];
    const model: ModelGateway = { summary: () => ({ ...unassessedGateway.summary(), model: 'gemini-2.5-flash-lite' }), generateJson: async request => {
      purposes.push(request.purpose); const conversations = (request.input as { conversations: { i: number; spans: { text: string }[] }[] }).conversations;
      sizes.push(conversations.length);
      if (request.purpose === 'coverage-quality-v1') for (const c of conversations) {
        assert.equal((c as typeof c & { first_assessment: { i: number } }).first_assessment.i, c.i,
          'the review subset must not inherit indexes from the original primary batch');
      }
      const value = conversations.map(c => {
        const parent = c.spans[0]!.text.includes('cho con'), plausible = c.spans[0]!.text.includes('chọn đàn');
        const review = request.purpose === 'coverage-quality-v1';
        return { i: c.i, candidate: 'p', ev: [0], why: review && parent ? 'fixture: reviewer wrongly rejects proxy' : 'fixture: evidence supports need',
          role: review && parent ? 'WRONG' : parent ? 'REPRESENTATIVE' : 'TARGET', fit: review && parent ? 'NONE' : plausible && !review ? 'PLAUSIBLE' : 'DIRECT', hard: 'PASS', flags: [] };
      });
      return { value, model: 'gemini-2.5-flash-lite', model_version: 'fixture', invocation_id: 'fixture', request_hash: 'fixture', usage: null, cost_usd: 0,
        unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price: { input_per_million: .1, output_per_million: .4, cached_input_per_million: .01, observed_at: '', source: 'FIXTURE' } };
    } };
    const options = { assessmentCacheDirectory: join(root, 'cache'), evaluatedAt: '2026-11-03T10:00:00Z' };
    await classifyConversations(standard, store.snapshots(), model, options);
    const quality = withFilterPolicy(standard, 'QUALITY');
    const result = await classifyConversations(quality, store.snapshots(), model, options);
    assert.deepEqual(purposes, ['coverage-standard-v1', 'coverage-quality-v1']); assert.deepEqual(sizes, [3, 2]);
    assert.deepEqual(result.decisions.map(d => d.classification), ['SUITABLE', null, 'SUITABLE']);
    assert.equal(result.decisions[1]!.reason_code, 'COVERAGE_REVIEW_DISAGREEMENT');
    assert.equal(result.decisions[1]!.attributes?.standard_classification, 'SUITABLE');
    assert.equal(result.decisions[1]!.attributes?.review_classification, 'NOT_SUITABLE');
    await classifyConversations(quality, store.snapshots(), model, options); assert.equal(purposes.length, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('fabricated evidence remains pending with no automatic format repair', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-evidence-')), store = createConversationStore(join(root, 'store'));
  try {
    const plan = withFilterPolicy(literalCampaign({ prompt: 'Tìm phòng để tôi thuê' }), 'STANDARD');
    store.ingest({ platform: 'facebook', entity_type: 'POST', entity_id: '1', root_post_id: '1', parent_id: null,
      text: 'Cho thuê phòng', observed_at: '2026-11-03T10:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } },
      { campaign_id: plan.campaign_id, campaign_version: plan.version, filter_version: plan.filter_version });
    let calls = 0;
    const model: ModelGateway = { ...unassessedGateway, generateJson: async () => {
      calls++; return { value: [{ i: 0, candidate: 'p', role: 'TARGET', fit: 'DIRECT', hard: 'PASS', ev: [999], why: 'missing evidence', flags: [] }],
        model: 'fixture', model_version: null, invocation_id: 'x', request_hash: 'x', usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0,
        cache_hit: false, elapsed_ms: 0, price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: '', source: 'FIXTURE' } };
    } };
    const result = await classifyConversations(plan, store.snapshots(), model);
    assert.equal(calls, 1); assert.equal(result.decisions[0]!.classification, null); assert.equal(result.failures.length, 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('posts with no textual evidence remain pending in both modes without spending on either model pass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-no-evidence-')), store = createConversationStore(join(root, 'store'));
  try {
    store.ingest({ platform: 'facebook', entity_type: 'POST', entity_id: '1', root_post_id: '1', parent_id: null,
      text: '', observed_at: '2026-11-03T10:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } });
    const plan = literalCampaign({ prompt: 'Tìm người chơi piano' });
    for (const mode of ['STANDARD', 'QUALITY'] as const) {
      const result = await classifyConversations(withFilterPolicy(plan, mode), store.snapshots(), unassessedGateway);
      assert.equal(result.decisions[0]?.assessment_status, 'PENDING');
      assert.equal(result.decisions[0]?.reason_code, 'COVERAGE_NO_TEXT_EVIDENCE');
      assert.equal(result.model_results.length, 0);
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
