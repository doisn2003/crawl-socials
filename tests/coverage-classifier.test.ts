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
