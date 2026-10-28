import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildCampaignIntent, normalizeIntentText } from '../src/application/campaign-intent.js';
import { createCampaignValidator } from '../src/infrastructure/config/campaign-validator.js';
import type { CampaignSpec } from '../src/domain/campaign.js';

const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const validator = createCampaignValidator(read('.brain/specs/campaign.schema.json') as object);
const coffee = (): CampaignSpec => validator.parse(read('.brain/specs/campaign.coffee.json'));
const exactError = (code: string) => (error: unknown): boolean => error instanceof Error && error.message === code;

test('NFC, whitespace and case keys are deterministic while raw text remains inspectable', () => {
  const fixtures = read('tests/fixtures/intent/normalization.json') as {
    raw: string; canonical: string; case_key: string; alias: string;
  }[];
  for (const fixture of fixtures) {
    const result = normalizeIntentText(fixture.raw);
    assert.equal(result.raw, fixture.raw);
    assert.equal(result.nfc, fixture.raw.normalize('NFC'));
    assert.equal(result.canonical, fixture.canonical);
    assert.equal(result.case_key, fixture.case_key);
    assert.equal(result.accent_alias.value, fixture.alias);
    assert.equal(result.accent_alias.purpose, 'COMPARISON_ONLY');
    assert.deepEqual(normalizeIntentText(fixture.raw), result);
  }
  const decomposed = normalizeIntentText('Qua\u0301n ca\u0300 phe\u0302');
  const composed = normalizeIntentText('Quán cà phê');
  assert.equal(decomposed.case_key, composed.case_key);
  assert.notEqual(decomposed.raw, composed.raw);
  assert.equal(decomposed.trace.nfc_changed, true);
});

test('normalization rejects empty or non-text input without coercion or data echo', () => {
  for (const value of [null, undefined, 1, false, [], ['cafe'], {}, new String('cafe'), '', ' \t\n\u00a0 ',
    'cafe\u0000synthetic-secret', '\ud800', '\udfff']) {
    assert.throws(() => normalizeIntentText(value), exactError('INTENT_TEXT_INVALID'));
  }
  assert.equal(normalizeIntentText('Cafe 🚀').canonical, 'Cafe 🚀');
});

test('canonical text preserves accents, punctuation and compatibility characters', () => {
  const literal = normalizeIntentText(' Tiny Café [A+B]? ');
  assert.equal(literal.canonical, 'Tiny Café [A+B]?');
  assert.equal(literal.accent_alias.value, 'tiny cafe [a+b]?');
  assert.notEqual(normalizeIntentText('Ｃａｆｅ').case_key, normalizeIntentText('Cafe').case_key);
  assert.notEqual(normalizeIntentText('Müller').accent_alias.value, normalizeIntentText('Muller').accent_alias.value);
});

test('R05 Vietnamese aliases preserve composed/decomposed Cyrillic, Greek and mixed-script marks', () => {
  for (const [raw, alias] of [
    ['й', 'й'], ['и\u0306', 'й'], ['и', 'и'], ['ά', 'ά'], ['α\u0301', 'ά'], ['α', 'α'],
    ['Đặng', 'dang'], ['Đa\u0323\u0306ng', 'dang'], ['café', 'cafe'], ['cafe\u0301', 'cafe'],
    ['Müller', 'müller'], ['Mu\u0308ller', 'müller'],
    ['Đặng й ά café Müller', 'dang й ά cafe müller'],
    ['Đa\u0323\u0306ng и\u0306 α\u0301 cafe\u0301 Mu\u0308ller', 'dang й ά cafe müller'],
    ['đường phố hữu nghị', 'duong pho huu nghi'], ['x\u0301', 'x\u0301'],
  ]) {
    const result = normalizeIntentText(raw);
    assert.equal(result.raw, raw);
    assert.equal(result.canonical, raw!.normalize('NFC'));
    assert.equal(result.accent_alias.value, alias);
  }
});

test('R05 collision reports do not conflate Greek/Cyrillic letters that share combining marks', () => {
  const campaign = coffee(); campaign.workload.keywords = ['й', 'и', 'ά', 'α', 'Đặng', 'Dang'];
  const result = buildCampaignIntent(campaign, validator);
  assert.deepEqual(result.accent_alias_collisions.map(group => [group.alias, group.canonical_forms]), [
    ['dang', ['Đặng', 'Dang']],
  ]);
  assert.equal(result.keywords.length, 6);
});

test('coffee input preserves policy, draft state, sources and Hanoi preference without inferred brands/exclusions', () => {
  const campaign = coffee();
  const result = buildCampaignIntent(campaign, validator);
  assert.deepEqual(result.source_snapshot, campaign);
  assert.equal(result.source_snapshot.mode, 'DRAFT');
  assert.deepEqual(result.source_snapshot.target, campaign.target);
  assert.deepEqual(result.source_snapshot.source_requirements, campaign.source_requirements);
  assert.equal(result.geography.mode, 'ANY');
  assert.deepEqual(result.geography.required_places, []);
  assert.equal(result.geography.preferred_places[0]?.text.canonical, 'Hà Nội');
  assert.equal(result.geography.preferred_places[0]?.role, 'PREFERRED_LOCATION');
  assert.deepEqual(result.exclusions, []);
  assert.equal(result.keywords.length, campaign.workload.keywords.length);
  assert.equal(result.keywords[6]?.text.canonical, 'Tiny Cafe');
  assert.equal(result.keywords[6]?.kind, 'KEYWORD');
});

test('brand and exact-phrase declarations retain literal boundaries and source trace', () => {
  const result = buildCampaignIntent(coffee(), validator, [
    { keyword_index: 6, kind: 'BRAND', declaration_ref: 'contract://1.0.0/coffee-workload/tiny-cafe' },
    { keyword_index: 3, kind: 'EXACT_PHRASE', declaration_ref: 'fixture://explicit-phrase' },
  ]);
  const brand = result.keywords[6];
  assert.equal(brand?.kind, 'BRAND');
  assert.equal(brand?.text.canonical, 'Tiny Cafe');
  assert.notEqual(brand?.text.case_key, 'cafe');
  assert.equal(brand?.origin.source_path, 'workload.keywords[6]');
  assert.equal(brand?.origin.declaration_ref, 'contract://1.0.0/coffee-workload/tiny-cafe');
  assert.equal(brand?.entity_verification, 'NOT_PERFORMED');
  assert.equal(result.keywords[3]?.kind, 'EXACT_PHRASE');
  assert.equal(result.keywords[3]?.text.canonical, 'địa điểm đi coffee');
  assert.equal(result.keywords.length, 8, 'declarations do not generate new queries');
});

test('accent collisions remain distinct keywords and are labelled for comparison only', () => {
  const campaign = coffee(); campaign.workload.keywords = ['ma', 'má', 'mà', 'Tiny Cafe', 'Tiny Café'];
  const result = buildCampaignIntent(campaign, validator);
  assert.equal(result.keywords.length, 5);
  assert.equal(new Set(result.keywords.map(keyword => keyword.id)).size, 5);
  assert.deepEqual(result.accent_alias_collisions.map(group => [group.alias, group.canonical_forms]), [
    ['ma', ['ma', 'má', 'mà']], ['tiny cafe', ['Tiny Cafe', 'Tiny Café']],
  ]);
  assert.deepEqual(result.keywords.map(keyword => keyword.text.canonical), campaign.workload.keywords);
});

test('equivalent NFC, spacing or case keywords are rejected rather than silently dropping input traces', () => {
  for (const second of ['Qua\u0301n ca\u0300 phe\u0302', '  Quán   cà phê ', 'QUÁN CÀ PHÊ']) {
    const campaign = coffee(); campaign.workload.keywords = ['Quán cà phê', second];
    assert.throws(() => buildCampaignIntent(campaign, validator), exactError('INTENT_DUPLICATE_KEYWORD'));
  }
});

test('exclusions are unevaluated conditions, not substring filters or inferred negative-review exclusions', () => {
  const campaign = coffee();
  campaign.workload.exclusions = ['Chỉ loại tuyển dụng khi không có nội dung về trải nghiệm quán'];
  campaign.workload.intent = 'Tìm review quán kể cả đánh giá không tốt';
  const result = buildCampaignIntent(campaign, validator);
  assert.equal(result.exclusions.length, 1);
  assert.equal(result.exclusions[0]?.text.raw, campaign.workload.exclusions[0]);
  assert.equal(result.exclusions[0]?.kind, 'EXCLUSION');
  assert.equal(result.exclusions[0]?.evaluation, 'NOT_EVALUATED');
  assert.equal(result.intent?.evaluation, 'NOT_EVALUATED');
  assert.equal(result.intent?.text.raw, campaign.workload.intent);
  assert.deepEqual(result.source_snapshot.workload.exclusions, campaign.workload.exclusions);
});

test('explicit required geography remains distinct from preference and is not inferred from query text', () => {
  const campaign = coffee();
  campaign.workload.geography = { mode: 'INCLUDE', places: ['Đà Nẵng'], preferred_places: ['Hà Nội'], evidence_rule: 'POST_CONTENT_OR_VERIFIED_VENUE' };
  const result = buildCampaignIntent(campaign, validator);
  assert.equal(result.geography.required_places[0]?.role, 'REQUIRED_LOCATION');
  assert.equal(result.geography.required_places[0]?.text.canonical, 'Đà Nẵng');
  assert.equal(result.geography.preferred_places[0]?.role, 'PREFERRED_LOCATION');
  assert.equal(result.geography.evidence_rule, 'POST_CONTENT_OR_VERIFIED_VENUE');
});

test('provenance identifies campaign/model versions without inventing capture or run facts', () => {
  const result = buildCampaignIntent(coffee(), validator);
  assert.deepEqual(result.provenance, { kind: 'CAMPAIGN_SPEC', campaign_id: 'coffee-public-facebook-v1',
    schema_version: '1.0.0', contract_version: '1.0.0' });
  assert.equal(result.interpretation, 'EXPLICIT_STRUCTURE_ONLY');
  const json = JSON.stringify(result);
  for (const key of ['capture_mode', 'run_id', 'started_at', 'verified_valid_unique_posts']) assert.equal(json.includes('"' + key + '"'), false);
});

test('invalid campaigns use fixed errors from the existing validator boundary', () => {
  for (const input of [null, [], {}, 'synthetic-secret', { ...coffee(), access_token: 'synthetic-secret' }]) {
    assert.throws(() => buildCampaignIntent(input, validator), exactError('INTENT_CAMPAIGN_INVALID'));
  }
  const range = coffee(); range.historical_window = { mode: 'RANGE', from_utc: '2026-01-01T00:00:00Z', to_utc: '2026-01-01T00:00:00Z' };
  assert.throws(() => buildCampaignIntent(range, validator), exactError('INTENT_CAMPAIGN_INVALID'));
  const empty = coffee(); empty.workload.keywords = [];
  assert.throws(() => buildCampaignIntent(empty, validator), exactError('INTENT_KEYWORDS_EMPTY'));
});

test('draft null intent stays unresolved instead of fabricating semantic criteria', () => {
  const campaign = coffee(); campaign.workload.intent = null;
  const result = buildCampaignIntent(campaign, validator);
  assert.equal(result.intent, null);
  assert.equal(result.source_snapshot.mode, 'DRAFT');
  assert.deepEqual(result.source_snapshot.open_questions, campaign.open_questions);
});

test('declaration boundary rejects enum coercion, out-of-range indices, duplicates and unexpected fields', () => {
  const valid = { keyword_index: 6, kind: 'BRAND', declaration_ref: 'fixture://brand' };
  for (const value of [null, {}, 'BRAND', [null], [{ ...valid, kind: ['BRAND'] }], [{ ...valid, kind: { value: 'BRAND' } }],
    [{ ...valid, keyword_index: '6' }], [{ ...valid, keyword_index: -1 }], [{ ...valid, keyword_index: 8 }],
    [{ ...valid, keyword_index: 6.5 }], [valid, valid], [{ ...valid, declaration_ref: '' }],
    [{ ...valid, declaration_ref: 'https://invalid/?token=synthetic-secret' }], [{ ...valid, text: 'all cafes' }]]) {
    assert.throws(() => buildCampaignIntent(coffee(), validator, value), exactError('INTENT_DECLARATION_INVALID'));
  }
});

test('model is deterministic, deeply immutable and detached from input and explicit declarations', () => {
  const campaign = coffee();
  const declarations = [{ keyword_index: 6, kind: 'BRAND', declaration_ref: 'fixture://brand' }];
  const first = buildCampaignIntent(campaign, validator, declarations);
  const second = buildCampaignIntent(campaign, validator, declarations);
  assert.deepEqual(first, second);
  campaign.workload.keywords[6] = 'Changed'; campaign.source_requirements.PAGE.minimum_valid_unique_posts = 9;
  declarations[0]!.declaration_ref = 'fixture://changed';
  assert.equal(first.keywords[6]?.text.raw, 'Tiny Cafe');
  assert.equal(first.source_snapshot.source_requirements.PAGE.minimum_valid_unique_posts, 1);
  assert.equal(first.keywords[6]?.origin.declaration_ref, 'fixture://brand');
  assert.throws(() => { (first.source_snapshot as CampaignSpec).workload.keywords.length = 0; }, TypeError);
  assert.throws(() => { (first.keywords as unknown as { kind: string }[])[6]!.kind = 'KEYWORD'; }, TypeError);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(campaign), false, 'caller input was not frozen');
});
