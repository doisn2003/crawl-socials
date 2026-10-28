import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildCampaignIntent } from '../src/application/campaign-intent.js';
import { expandCampaignQueries, QUERY_EXPANSION_LIMITS, QUERY_EXPANSION_VERSION } from '../src/application/query-expansion.js';
import type { QueryExpansionOptions } from '../src/application/query-expansion.js';
import { createCampaignValidator } from '../src/infrastructure/config/campaign-validator.js';
import type { CampaignSpec } from '../src/domain/campaign.js';
import type { CampaignIntent, Immutable, KeywordDeclaration } from '../src/domain/campaign-intent.js';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const validator = createCampaignValidator(read('.brain/specs/campaign.schema.json') as object);
const coffee = (): CampaignSpec => validator.parse(read('.brain/specs/campaign.coffee.json'));
const options = (): QueryExpansionOptions => ({ max_queries: 256, max_depth: 3, max_candidate_checks: 10000,
  strategies: { COFFEE_SPELLING: true, INTENT_PHRASING: true, CONFIGURED_PLACE: true } });
function model(keywords: string[] = ['quán cà phê'], change?: (campaign: CampaignSpec) => void, declarations: KeywordDeclaration[] = []) {
  const campaign = coffee(); campaign.workload.keywords = keywords; change?.(campaign);
  return buildCampaignIntent(campaign, validator, declarations);
}
const errorCode = (code: string) => (error: unknown) => error instanceof Error && error.message === code;
const texts = (result: ReturnType<typeof expandCampaignQueries>) => result.queries.map(query => query.text);

test('coffee workload retains every original, raw spelling, order and campaign provenance without mutating intent', () => {
  const intent = buildCampaignIntent(coffee(), validator), before = structuredClone(intent);
  const result = expandCampaignQueries(intent, options());
  assert.deepEqual(intent, before);
  assert.deepEqual(result.queries.slice(0, intent.keywords.length).map(query => query.text), intent.keywords.map(keyword => keyword.text.canonical));
  for (const [index, keyword] of intent.keywords.entries()) {
    const query = result.queries[index]!;
    assert.equal(query.raw_keyword, keyword.text.raw); assert.equal(query.depth, 0);
    assert.equal(query.provenance.parent_query_id, null); assert.equal(query.provenance.root_keyword_id, keyword.id);
    assert.deepEqual(query.provenance.source_refs, [keyword.origin.source_path]);
  }
  assert.equal(result.version, QUERY_EXPANSION_VERSION);
  assert.equal(result.campaign_id, intent.provenance.campaign_id);
  assert.equal(result.policy_version, 'coffee-intent-v1');
  assert.equal(result.filter_semantics, 'UNCHANGED_USE_CAMPAIGN_SNAPSHOT');
  assert.equal(result.external_services_used, false);
  assert(result.report.unrecognized_keyword_ids.includes('workload.keywords[6]')); // Tiny Cafe is not a generic phrase.
});

test('DISABLED and all strategies disabled keep originals without candidate work', () => {
  const intent = model(['  QUÁN cà phê  ', 'Tiny Cafe'], campaign => {
    campaign.discovery_policy.expansion = 'DISABLED'; campaign.discovery_policy.expansion_rule_version = null;
  });
  const result = expandCampaignQueries(intent, options());
  assert.deepEqual(texts(result), ['QUÁN cà phê', 'Tiny Cafe']);
  assert.equal(result.queries[0]!.raw_keyword, '  QUÁN cà phê  ');
  assert.equal(result.report.stop_reason, 'DISABLED'); assert.equal(result.report.candidate_checks, 0);
  const off = options(); off.strategies = { COFFEE_SPELLING: false, INTENT_PHRASING: false, CONFIGURED_PLACE: false };
  const stopped = expandCampaignQueries(model(), off);
  assert.deepEqual(texts(stopped), ['quán cà phê']); assert.equal(stopped.report.stop_reason, 'STRATEGIES_DISABLED');
});

test('each strategy can be enabled independently and changes only its dimension', () => {
  const spelling = options(); spelling.max_depth = 1;
  spelling.strategies = { COFFEE_SPELLING: true, INTENT_PHRASING: false, CONFIGURED_PLACE: false };
  assert.deepEqual(texts(expandCampaignQueries(model(), spelling)), ['quán cà phê', 'quán cafe', 'quán café', 'quán coffee']);
  const phrasing = options(); phrasing.max_depth = 1;
  phrasing.strategies = { COFFEE_SPELLING: false, INTENT_PHRASING: true, CONFIGURED_PLACE: false };
  assert.deepEqual(texts(expandCampaignQueries(model(['review quán cà phê']), phrasing)), ['review quán cà phê', 'đánh giá quán cà phê']);
  const place = options(); place.strategies = { COFFEE_SPELLING: false, INTENT_PHRASING: false, CONFIGURED_PLACE: true };
  assert.deepEqual(texts(expandCampaignQueries(model(), place)), ['quán cà phê', 'quán cà phê Hà Nội']);
});

test('parent provenance forms a bounded acyclic graph, preserves intent groups and traces configured places', () => {
  const result = expandCampaignQueries(model(['quán cà phê hẹn hò']), options());
  const byId = new Map(result.queries.map(query => [query.id, query]));
  assert(result.queries.some(query => query.depth === 3));
  for (const query of result.queries.slice(1)) {
    const parent = byId.get(query.provenance.parent_query_id!)!;
    assert(parent); assert.equal(query.depth, parent.depth + 1); assert(query.depth <= 3);
    assert.equal(query.provenance.root_keyword_id, 'workload.keywords[0]');
    assert(query.provenance.strategy_version.startsWith(QUERY_EXPANSION_VERSION));
    assert(query.provenance.rule_id.length > 0); assert(query.provenance.source_refs.includes('workload.keywords[0]'));
    assert(query.text.includes('hẹn hò')); assert(!query.text.includes('sự kiện')); assert(!query.text.includes('review'));
    if (query.text.endsWith('Hà Nội')) assert(query.provenance.source_refs.includes('workload.geography.preferred_places[0]'));
  }
});

test('depth zero retains originals; depth one cannot emit multi-step transformations', () => {
  const zero = options(); zero.max_depth = 0;
  const result = expandCampaignQueries(model(), zero);
  assert.deepEqual(texts(result), ['quán cà phê']); assert.equal(result.report.candidate_checks, 0);
  assert.equal(result.report.stop_reason, 'DEPTH_LIMIT');
  const one = options(); one.max_depth = 1;
  const shallow = expandCampaignQueries(model(), one);
  assert(shallow.queries.every(query => query.depth <= 1));
  assert(!texts(shallow).includes('tiệm cafe Hà Nội'));
  assert(texts(expandCampaignQueries(model(), options())).includes('tiệm cafe Hà Nội'));
});

test('total query cap includes seeds and never silently drops an original', () => {
  const cap = options(); cap.max_queries = 3;
  const result = expandCampaignQueries(model(), cap);
  assert.equal(result.queries.length, 3); assert.equal(result.report.stop_reason, 'QUERY_LIMIT');
  const larger = options(); larger.max_queries = 5;
  assert.deepEqual(texts(result), texts(expandCampaignQueries(model(), larger)).slice(0, 3));
  const tooSmall = options(); tooSmall.max_queries = 1;
  assert.throws(() => expandCampaignQueries(model(['quán cà phê', 'Tiny Cafe']), tooSmall), errorCode('EXPANSION_SEEDS_EXCEED_QUERY_LIMIT'));
  const noRoom = expandCampaignQueries(model(), tooSmall);
  assert.equal(noRoom.queries.length, 1); assert.equal(noRoom.report.candidate_checks, 0);
});

test('candidate cap bounds duplicate and filtered work even when no unique output is added', () => {
  const bounded = options(); bounded.max_candidate_checks = 2;
  bounded.strategies = { COFFEE_SPELLING: true, INTENT_PHRASING: false, CONFIGURED_PLACE: false };
  const result = expandCampaignQueries(model(['quán cà phê', 'quán cafe', 'quán café', 'quán coffee']), bounded);
  assert.equal(result.report.stop_reason, 'CANDIDATE_LIMIT'); assert.equal(result.report.candidate_checks, 2);
  assert.equal(result.report.duplicate_candidates, 2); assert.equal(result.queries.length, 4);
  bounded.max_candidate_checks = 0;
  const none = expandCampaignQueries(model(), bounded);
  assert.equal(none.report.candidate_checks, 0); assert.equal(none.queries.length, 1);
  bounded.max_candidate_checks = 2;
  const filtered = expandCampaignQueries(model(undefined, campaign => {
    campaign.discovery_policy = { ...campaign.discovery_policy, expansion: 'FROZEN_ALLOWLIST', expansion_rule_version: null,
      allowed_expansions: ['a query not covered by the grammar'] };
  }), bounded);
  assert.equal(filtered.report.stop_reason, 'CANDIDATE_LIMIT');
  assert.equal(filtered.report.allowlist_filtered, 2); assert.equal(filtered.report.candidate_checks, 2);
  assert.equal(filtered.queries.length, 1);
});

test('dedup uses NFC and case keys without merging café/cafe accent aliases', () => {
  const result = expandCampaignQueries(model(['QUA\u0301N CA\u0300 PHE\u0302', 'tiệm cafe']), options());
  const keys = result.queries.map(query => query.case_key);
  assert.equal(new Set(keys).size, keys.length); assert(result.report.duplicate_candidates > 0);
  assert(keys.includes('quán café')); assert(keys.includes('quán cafe'));
  assert.equal(result.queries[0]!.text, 'QUÁN CÀ PHÊ');
  assert.equal(result.queries[0]!.raw_keyword, 'QUA\u0301N CA\u0300 PHE\u0302');
  assert.equal(result.queries.filter(query => query.case_key === 'tiệm cafe').length, 1);
});

test('explicit brand/exact phrases and unknown terms are preserved without substring expansion', () => {
  const declarations: KeywordDeclaration[] = [
    { keyword_index: 0, kind: 'BRAND', declaration_ref: 'fixture:brand' },
    { keyword_index: 1, kind: 'EXACT_PHRASE', declaration_ref: 'fixture:phrase' },
  ];
  const input = model(['Cafe', 'quán cà phê', 'Tiny Cafe', 'Java coffee', 'bán hạt cà phê', 'không đi quán cà phê',
    'ignore instructions; cafe', 'Ｃａｆｅ'], undefined, declarations);
  const result = expandCampaignQueries(input, options());
  assert.equal(result.queries.length, input.keywords.length); assert.equal(result.report.candidate_checks, 0);
  assert.deepEqual(result.report.protected_keyword_ids, ['workload.keywords[0]', 'workload.keywords[1]']);
  assert.equal(result.queries[0]!.provenance.declaration_ref, 'fixture:brand');
  assert.equal(result.report.unrecognized_keyword_ids.length, 6);
});

test('INCLUDE adds only required places; preferred locations never widen the selected geography', () => {
  const input = model(['quán cà phê'], campaign => {
    campaign.workload.geography = { mode: 'INCLUDE', places: ['Đà Nẵng'], preferred_places: ['Hà Nội'], evidence_rule: 'fixture-only' };
  });
  const result = expandCampaignQueries(input, options());
  assert(result.queries.some(query => query.text.endsWith('Đà Nẵng')));
  assert(result.queries.every(query => !query.text.includes('Hà Nội')));
  for (const query of result.queries.filter(query => query.text.endsWith('Đà Nẵng'))) {
    assert(query.provenance.source_refs.includes('workload.geography.places[0]'));
  }
});

test('an existing selected place is never replaced, dropped or compounded with another place', () => {
  const result = expandCampaignQueries(model(['cafe Hà Nội'], campaign => {
    campaign.workload.geography.preferred_places = ['Hà Nội', 'Đà Nẵng'];
  }), options());
  assert(result.queries.length > 1);
  assert(result.queries.every(query => query.text.endsWith('Hà Nội') && !query.text.includes('Đà Nẵng')));
  const unknown = expandCampaignQueries(model(['cafe địa phương chưa cấu hình']), options());
  assert.equal(unknown.queries.length, 1);
});

test('place spelling and non-Vietnamese scripts survive; no location is invented when none is configured', () => {
  const result = expandCampaignQueries(model(['quán cà phê'], campaign => {
    campaign.workload.geography.preferred_places = ['и\u0306 α\u0301 Mu\u0308ller'];
  }), options());
  assert(result.queries.some(query => query.text.endsWith('й ά Müller')));
  assert(result.queries.every(query => !query.text.includes('и α Muller')));
  const onlyPlaces = options(); onlyPlaces.strategies = { COFFEE_SPELLING: false, INTENT_PHRASING: false, CONFIGURED_PLACE: true };
  assert.equal(expandCampaignQueries(model(undefined, campaign => { campaign.workload.geography.preferred_places = []; }), onlyPlaces).queries.length, 1);
});

test('unevaluated exclusions or unresolved geography conservatively keep seeds, without turning words into a denylist', () => {
  const excluded = expandCampaignQueries(model(['quán cà phê', 'tuyển dụng quán cà phê'], campaign => {
    campaign.workload.exclusions = ['chỉ loại nếu không có nội dung trải nghiệm'];
  }), options());
  assert.equal(excluded.report.stop_reason, 'UNEVALUATED_EXCLUSIONS'); assert.equal(excluded.queries.length, 2);
  assert(texts(excluded).includes('tuyển dụng quán cà phê'));
  const unresolved = expandCampaignQueries(model(undefined, campaign => {
    campaign.workload.geography.mode = 'UNRESOLVED';
  }), options());
  assert.equal(unresolved.report.stop_reason, 'GEOGRAPHY_UNRESOLVED'); assert.equal(unresolved.queries.length, 1);
});

test('FROZEN_ALLOWLIST emits only configured queries with real parent derivations and reports unhandled entries', () => {
  const input = model(undefined, campaign => {
    campaign.discovery_policy = { ...campaign.discovery_policy, expansion: 'FROZEN_ALLOWLIST', expansion_rule_version: null,
      allowed_expansions: ['QUÁN CAFE', 'quán cafe Hà Nội', 'Tiny Cafe sự kiện', 'nhà hàng bất kỳ'] };
  });
  const result = expandCampaignQueries(input, options());
  assert.deepEqual(texts(result), ['quán cà phê', 'QUÁN CAFE', 'quán cafe Hà Nội']);
  assert.equal(result.queries[2]!.provenance.parent_query_id, result.queries[1]!.id);
  assert(result.queries[1]!.provenance.source_refs.includes('discovery_policy.allowed_expansions[0]'));
  assert.deepEqual(result.report.unemitted_allowlist_refs, ['discovery_policy.allowed_expansions[2]', 'discovery_policy.allowed_expansions[3]']);
  const disconnected = model(undefined, campaign => {
    campaign.discovery_policy = { ...campaign.discovery_policy, expansion: 'FROZEN_ALLOWLIST', expansion_rule_version: null,
      allowed_expansions: ['quán cafe Hà Nội'] };
  });
  const noInventedParent = expandCampaignQueries(disconnected, options());
  assert.deepEqual(texts(noInventedParent), ['quán cà phê']);
  assert.deepEqual(noInventedParent.report.unemitted_allowlist_refs, ['discovery_policy.allowed_expansions[0]']);
});

test('options fail at runtime on invalid bounds, scalar coercion and unknown fields', () => {
  const bad: unknown[] = [null, [], {}, { ...options(), extra: true }, { ...options(), max_queries: '12' },
    { ...options(), max_queries: 0 }, { ...options(), max_depth: 4 }, { ...options(), max_depth: -1 },
    { ...options(), max_queries: Number.NaN }, { ...options(), max_candidate_checks: 10001 },
    { ...options(), max_candidate_checks: 0.5 }, { ...options(), strategies: [] },
    { ...options(), strategies: { ...options().strategies, COFFEE_SPELLING: ['true'] } }];
  for (const value of bad) assert.throws(() => expandCampaignQueries(model(), value), errorCode('EXPANSION_OPTIONS_INVALID'));
});

test('a valid place at the text cap cannot break disabled originals; oversized generated queries are bounded and reported', () => {
  const longPlace = 'Đ'.repeat(QUERY_EXPANSION_LIMITS.text_length);
  const input = model(undefined, campaign => { campaign.workload.geography.preferred_places = [longPlace]; });
  const off = options(); off.strategies = { COFFEE_SPELLING: false, INTENT_PHRASING: false, CONFIGURED_PLACE: false };
  assert.deepEqual(texts(expandCampaignQueries(input, off)), ['quán cà phê']);
  const disabled = model(undefined, campaign => {
    campaign.workload.geography.preferred_places = [longPlace];
    campaign.discovery_policy.expansion = 'DISABLED'; campaign.discovery_policy.expansion_rule_version = null;
  });
  assert.deepEqual(texts(expandCampaignQueries(disabled, options())), ['quán cà phê']);
  const placeOnly = options(); placeOnly.max_candidate_checks = 1;
  placeOnly.strategies = { COFFEE_SPELLING: false, INTENT_PHRASING: false, CONFIGURED_PLACE: true };
  const expanded = expandCampaignQueries(input, placeOnly);
  assert.deepEqual(texts(expanded), ['quán cà phê']);
  assert.equal(expanded.report.oversize_candidates, 1); assert.equal(expanded.report.candidate_checks, 1);
  assert(expanded.queries.every(query => query.text.length <= QUERY_EXPANSION_LIMITS.text_length));
});

test('bounded input and model coherence checks reject invalid data without exposing it in error text', () => {
  const many = model(Array.from({ length: QUERY_EXPANSION_LIMITS.keywords + 1 }, (_, index) => 'unknown ' + index));
  assert.throws(() => expandCampaignQueries(many, options()), errorCode('EXPANSION_INPUT_LIMIT'));
  const long = model(['x'.repeat(QUERY_EXPANSION_LIMITS.text_length + 1)]);
  assert.throws(() => expandCampaignQueries(long, options()), errorCode('EXPANSION_INPUT_LIMIT'));
  // U+0344 canonically decomposes into two combining marks even under NFC.
  const growsUnderNfc = model(['\u0344'.repeat(600)]);
  assert.throws(() => expandCampaignQueries(growsUnderNfc, options()), errorCode('EXPANSION_INPUT_LIMIT'));
  const manyPlaces = model(undefined, campaign => { campaign.workload.geography.preferred_places = Array.from({ length: 33 }, (_, i) => 'place' + i); });
  assert.throws(() => expandCampaignQueries(manyPlaces, options()), errorCode('EXPANSION_INPUT_LIMIT'));
  const forged = structuredClone(model()) as CampaignIntent;
  forged.keywords[0]!.text.case_key = 'synthetic-private-marker';
  assert.throws(() => expandCampaignQueries(forged, options()), errorCode('EXPANSION_INTENT_INVALID'));
  const malformedEnum = structuredClone(model()) as unknown as { keywords: { kind: unknown }[] };
  malformedEnum.keywords[0]!.kind = ['KEYWORD'];
  assert.throws(() => expandCampaignQueries(malformedEnum as unknown as CampaignIntent, options()), errorCode('EXPANSION_INTENT_INVALID'));
  assert.throws(() => expandCampaignQueries(null as unknown as Immutable<CampaignIntent>, options()), errorCode('EXPANSION_INTENT_INVALID'));
});

test('identical inputs replay identically; caller options are detached and result is deeply immutable', () => {
  const intent = model(), config = options(), result = expandCampaignQueries(intent, config);
  assert.deepEqual(expandCampaignQueries(intent, options()), result);
  config.max_depth = 0; config.strategies.COFFEE_SPELLING = false;
  assert.equal(result.options.max_depth, 3); assert.equal(result.options.strategies.COFFEE_SPELLING, true);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.queries));
  assert(Object.isFrozen(result.queries[1]!.provenance.source_refs));
  assert.throws(() => { (result.queries as unknown as { text: string }[])[0]!.text = 'changed'; }, TypeError);
  const reordered = { ...options(), strategies: { CONFIGURED_PLACE: true, INTENT_PHRASING: true, COFFEE_SPELLING: true } };
  assert.deepEqual(expandCampaignQueries(intent, reordered), result);
});
