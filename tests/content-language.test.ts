import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vietnameseEvidence, enforceContentLanguage } from '../src/domain/content-language.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { withFilterPolicy as currentFilterPolicy, unassessedGateway } from '../src/application/filter-policy.js';
import type { CampaignPlan } from '../src/domain/campaign-plan.js';
import type { FilterMode } from '../src/shared/filter-policy.js';
// Historical conversation policies still support language evidence on comment candidates.
const withFilterPolicy = (plan: CampaignPlan, mode: FilterMode) => ({ ...currentFilterPolicy(plan, mode),
  filter_version: mode === 'QUALITY' ? 'coverage-quality-v1' : mode === 'STANDARD' ? 'coverage-standard-v1' : 'unassessed-v1' });
import { classifyConversations } from '../src/application/classification-service.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';

test('Vietnamese content includes unaccented and overseas writing, without using names, tags or locations as language proof', () => {
  for (const text of ['Mình ở Tokyo, muốn tìm giáo viên piano online.', 'Tôi thích piano', 'Mê piano',
    'minh muon hoc dan piano', 'can tim lop piano', 'Các bác ơi, em muốn tự học piano thì bắt đầu ở đâu ạ?',
    'Cho mình hỏi học online có khó hơn học offline nhiều không ạ?',
    'Bonjour à tous!\nMình đang học piano ở Paris và muốn chia sẻ trải nghiệm.'])
    assert.equal(vietnameseEvidence(text).state, 'MATCH', text);
  for (const text of ['毎日のピアノ練習を楽しんでいます。先生と一緒に音楽を学びます。',
    'The piano concert was wonderful and I would love to learn more about this instrument.',
    'Merci beaucoup pour ce beau concert de piano.', 'Can Tim play piano?',
    'Đặng Thái Sơn: thank you for the lovely performance, I enjoyed the piano concert.',
    'piano 🎹 #hoctiengviet @nguyen_piano https://example.test/tieng-viet'])
    assert.notEqual(vietnameseEvidence(text).state, 'MATCH', text);
  assert.equal(vietnameseEvidence('piano 🎹').state, 'UNKNOWN');
});

test('colloquial short venue questions retain Vietnamese while names and foreign advertising remain insufficient', () => {
  for (const text of ['Sg quán cafe nào decor giáng sinh đẹp mng ơii',
    'Mấy quán cafe xik xik gần đây ☺️☺️', 'Tiệm nào xinh vậy mng', 'Chỗ nào đẹp nè mấy bà'])
    assert.equal(vietnameseEvidence(text).state, 'MATCH', text);
  for (const text of ['Nguyễn Chí Thanh', 'Đặng Thái Sơn', 'Nguyễn Phương Thảo', 'Quán Cafe Đẹp',
    'Beautiful cafe in Hà Nội — best coffee, book your table now!',
    'Buy now for the best price! #quán #nào #mấy #đây', 'Cafe https://example.test/mấy-quán-nào-đẹp'])
    assert.notEqual(vietnameseEvidence(text).state, 'MATCH', text);
});

test('foreign-only evidence is excluded in both filter modes before any paid call; OFF retains raw evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-language-')), store = createConversationStore(join(root, 'store'));
  try {
    store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: 'foreign', root_post_id: 'foreign', parent_id: null,
      text: 'ピアノの練習について先生が詳しく説明します。毎日音楽を楽しみましょう。', observed_at: '2026-11-03T00:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } });
    const plan = literalCampaign({ prompt: 'Tìm người chia sẻ về piano', languages: ['vi'] });
    for (const mode of ['STANDARD', 'QUALITY'] as const) {
      const result = await classifyConversations(withFilterPolicy(plan, mode), store.snapshots(), unassessedGateway);
      assert.equal(result.decisions[0]?.classification, 'NOT_SUITABLE');
      assert.equal(result.decisions[0]?.reason_code, 'CONTENT_LANGUAGE_MISMATCH'); assert.equal(result.model_results.length, 0);
    }
    const off = await classifyConversations(withFilterPolicy(plan, 'OFF'), store.snapshots(), unassessedGateway);
    assert.equal(off.model_results.length, 0); assert.equal(off.decisions[0]?.classification, null);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a Vietnamese passage cannot validate a decision citing only a foreign passage in the same post', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-language-proof-')), store = createConversationStore(join(root, 'store'));
  try {
    store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: 'p', root_post_id: 'p', parent_id: null,
      text: 'This piano performance was wonderful and I enjoyed the music. '.repeat(50) + '\nMình muốn học piano và tìm giáo viên dạy bằng tiếng Việt.',
      observed_at: '2026-11-03T00:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } });
    const snapshot = store.snapshots()[0]!, plan = withFilterPolicy(literalCampaign({ prompt: 'Tìm người học piano', languages: ['vi'] }), 'STANDARD');
    const decision = { campaign_id: plan.campaign_id, campaign_version: plan.version, filter_version: plan.filter_version, snapshot_id: snapshot.id,
      classification: 'SUITABLE' as const, assessment_status: 'ASSESSED' as const, reason_code: 'FIXTURE', model: 'FIXTURE',
      action_target: { entity_id: 'p', type: 'POST' as const }, evidence_ids: [snapshot.spans[0]!.id] };
    assert.equal(enforceContentLanguage(plan, snapshot, decision).classification, null);
    const vi = snapshot.spans.find(s => vietnameseEvidence(s.text).state === 'MATCH'); assert.ok(vi);
    assert.equal(enforceContentLanguage(plan, snapshot, { ...decision, evidence_ids: [vi.id] }).classification, 'SUITABLE');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a Vietnamese reply can qualify under a foreign root; a model or cache cannot switch the accepted actor to that root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-language-candidate-')), store = createConversationStore(join(root, 'store'));
  try {
    const common = { platform: 'threads' as const, root_post_id: 'p', observed_at: '2026-11-03T00:00:00Z', provenance: { run_id: 'test', method: 'FIXTURE' } };
    store.ingest({ ...common, entity_type: 'POST', entity_id: 'p', parent_id: null, text: 'ピアノ教室で子供たちが毎日楽しく音楽を勉強しています。' });
    store.ingest({ ...common, entity_type: 'COMMENT', entity_id: 'c', parent_id: 'p', text: 'Mình ở Nhật, muốn tìm lớp học piano online bằng tiếng Việt.' });
    const plan = withFilterPolicy(literalCampaign({ prompt: 'Tìm người học piano', languages: ['vi'] }), 'STANDARD');
    let actor = 'p', calls = 0;
    const gateway: ModelGateway = { ...unassessedGateway, generateJson: async request => {
      calls++;
      const input = request.input as { conversations: { entities: { candidate: string; vietnamese_content: string }[]; spans: { candidate: string }[] }[] };
      const doc = input.conversations[0]!; assert.equal(doc.entities[0]!.vietnamese_content, 'MISMATCH');
      return { value: [{ i: 0, candidate: actor, role: 'TARGET', fit: 'DIRECT', hard: 'PASS', ev: [doc.spans.findIndex(s => s.candidate === actor)], why: 'fixture', flags: [] }],
        model: 'fixture', model_version: null, invocation_id: 'fixture', request_hash: 'fixture', usage: null, cost_usd: 0,
        unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: '', source: 'FIXTURE' } };
    } };
    const options = { assessmentCacheDirectory: join(root, 'cache') };
    const first = await classifyConversations(plan, store.snapshots(), gateway, options);
    assert.equal(first.decisions[0]?.classification, null);
    const cached = await classifyConversations(plan, store.snapshots(), gateway, options);
    assert.equal(cached.decisions[0]?.classification, null); assert.equal(calls, 1);
    actor = 'c1';
    const valid = await classifyConversations(plan, store.snapshots(), gateway);
    assert.equal(valid.decisions[0]?.classification, 'SUITABLE'); assert.equal(valid.decisions[0]?.action_target?.entity_id, 'c');
    // Historical unrestricted campaigns are not silently rewritten to Vietnamese.
    const unrestricted = withFilterPolicy(literalCampaign({ prompt: 'International piano stories' }), 'STANDARD');
    assert.deepEqual(unrestricted.languages, []);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
