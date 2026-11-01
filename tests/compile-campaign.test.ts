import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignFromModel, isGroundedShortQuery, literalCampaign } from '../src/application/compile-campaign.js';

test('campaign target is total, defaults prioritize Threads, and geography is never invented', () => {
  const campaign = literalCampaign({ prompt: 'Tìm quán cafe', suitable_target: 1000 });
  assert.equal(campaign.target_scope, 'TOTAL_ACROSS_PLATFORMS'); assert.equal(campaign.suitable_target, 1000);
  assert.deepEqual(campaign.desired_platform_weights, { threads: 0.8, facebook: 0.2 });
  assert.deepEqual(campaign.required_geographies, []); assert.equal(campaign.brand_context, null);
});

test('generic planner preserves user constraints and version changes with criteria', () => {
  const plan = { topic: 'Dịch vụ sửa đàn piano', audience: ['Người chơi đàn'], needs: ['Tìm kỹ thuật viên'],
    participation_intents: ['Hỏi địa chỉ sửa đàn'], research_intents: ['Các lỗi thường gặp'], inclusions: ['Đàn piano'], exclusions: [],
    assumptions: [], queries: [{ text: 'tìm chỗ sửa đàn piano', family: 'REQUEST' }] };
  const a = campaignFromModel({ prompt: 'Tìm người cần sửa đàn piano', required_geographies: ['Hà Nội'] }, plan);
  const b = campaignFromModel({ prompt: 'Tìm người cần sửa đàn piano', required_geographies: ['Đà Nẵng'] }, plan);
  assert.equal(a.queries[0]!.text, 'tìm chỗ sửa đàn piano');
  assert.deepEqual(a.required_geographies, ['Hà Nội']); assert.notEqual(a.version, b.version);
  assert.equal(JSON.stringify(a).includes('cafe'), false);
});

test('generated lexical anchors reject long questions and invented geography or brands without truncation', () => {
  const input = { prompt: 'Tìm quán cafe để làm việc, hẹn hò và yên tĩnh' };
  for (const text of ['cafe làm việc', 'cafe hẹn hò', 'tìm quán cafe', 'cafe yên tĩnh', 'xin quán cafe', 'review cafe']) {
    assert.equal(isGroundedShortQuery(text, input), true, text);
  }
  for (const text of ['quán cafe Hà Nội', 'cafe Sài Gòn', 'review Highlands', 'Có ai biết quán cafe để làm việc không?', 'cafe quận 1']) {
    assert.equal(isGroundedShortQuery(text, input), false, text);
  }
  assert.equal(isGroundedShortQuery('cafe Hà Nội', { ...input, required_geographies: ['Hà Nội'] }), true);
  assert.equal(isGroundedShortQuery('review Highlands', { ...input, brand_context: 'Highlands' }), true);
  const plan = { topic: 'Cafe', audience: [], needs: [], participation_intents: [], research_intents: [], inclusions: [], exclusions: [],
    assumptions: [], queries: [{ text: 'Có ai biết quán cafe để làm việc không?', family: 'REQUEST' },
      { text: 'review Highlands', family: 'EXPERIENCE' }, { text: 'cafe làm việc', family: 'USE_CASE' }] };
  const campaign = campaignFromModel({ ...input, seed_queries: ['cafe hẹn hò'] }, plan);
  assert.deepEqual(campaign.queries.map(q => q.text), ['cafe làm việc', 'cafe hẹn hò']);
  assert.match(campaign.assumptions.at(-1)!, /Removed 2/);
});

test('invalid total weights, raw budgets and query family fail validation', () => {
  assert.throws(() => literalCampaign({ prompt: 'Nhu cầu sửa xe', desired_platform_weights: { threads: 0.8, facebook: 0.8 } }), /WEIGHTS/);
  assert.throws(() => literalCampaign({ prompt: 'Nhu cầu sửa xe', suitable_target: 1000, raw_cap: 100 }), /BUDGET/);
  assert.throws(() => literalCampaign({ prompt: 'Nhu cầu sửa xe', seed_queries: ['x'.repeat(201)] }), /QUERY/);
});
