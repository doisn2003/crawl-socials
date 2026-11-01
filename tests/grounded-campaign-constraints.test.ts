import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignFromModel, compileCampaign, plannerRecipe } from '../src/application/compile-campaign.js';
import { GROUNDED_CONSTRAINT_PLANNER_POLICY, OPPORTUNITY_FILTER_VERSION, validateCampaignPlan } from '../src/domain/campaign-plan.js';
import type { CampaignPlanInput } from '../src/domain/campaign-plan.js';
import type { JsonModelRequest, ModelGateway } from '../src/application/ports/model-gateway.js';
import { contentHash } from '../src/domain/conversation.js';

const policy = GROUNDED_CONSTRAINT_PLANNER_POLICY;
const empty = () => ({ geographies: [] as unknown[], languages: [] as unknown[], max_age_days: null as unknown,
  source_priority: null as unknown, unresolved: [] as unknown[] });
const evidence = (value: unknown, quote: string, strength = 'REQUIRED', source = 'PROMPT') => ({ value, quote, strength, source });
function model(queries: string[], constraints = empty()) {
  return { topic: 'Chủ đề từ yêu cầu', audience: [], needs: [], participation_intents: [], research_intents: [], inclusions: [], exclusions: [], assumptions: [],
    queries: queries.map(text => ({ text, family: 'BROAD' })), constraints };
}
function compile(prompt: string, constraints: ReturnType<typeof empty>, overrides: Partial<CampaignPlanInput> = {}, query = 'tìm quán') {
  return campaignFromModel({ prompt, planner_policy: policy, ...overrides }, model([query], constraints), '2026-10-31T00:00:00Z');
}

test('grounded constraints preserve hard versus soft scope across products, travel and education', () => {
  for (const fixture of [
    { request: 'Tìm tai nghe ở Hà Nội', query: 'tìm tai nghe', required: 'Hà Nội', preferred: 'Hải Phòng' },
    { request: 'Tìm khách sạn tại Đà Nẵng', query: 'tìm khách sạn', required: 'Đà Nẵng', preferred: 'Hội An' },
    { request: 'Tìm khóa học tiếng Anh tại Huế', query: 'tìm khóa học', required: 'Huế', preferred: 'Đà Nẵng' },
  ]) {
    const soft = `Ưu tiên ${fixture.preferred}`, language = 'Chỉ lấy bài viết bằng tiếng Việt', age = 'Chỉ lấy bài viết trong 2 tuần gần đây';
    const order = 'Ưu tiên cá nhân, nhóm, fanpage';
    const prompt = [fixture.request, soft, language, age, order].join('. ');
    const constraints = empty(); constraints.geographies = [evidence(fixture.required, fixture.request), evidence(fixture.preferred, soft, 'PREFERRED')];
    constraints.languages = [evidence('vi', language)]; constraints.max_age_days = evidence(14, age);
    constraints.source_priority = { source: 'PROMPT', quote: order, value: ['PROFILE', 'GROUP', 'PAGE'] };
    const plan = compile(prompt, constraints, {}, fixture.query);
    assert.deepEqual(plan.required_geographies, [fixture.required]); assert.deepEqual(plan.preferred_geographies, [fixture.preferred]);
    assert.deepEqual(plan.languages, ['vi']); assert.equal(plan.max_age_days, 14); assert.deepEqual(plan.source_priority, ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN']);
    assert.equal(plan.filter_version, OPPORTUNITY_FILTER_VERSION); assert.equal(plan.planner_policy, policy);
    assert.equal(plan.constraint_provenance!.unresolved.length, 0);
    for (const entry of plan.constraint_provenance!.entries.filter(e => e.source === 'PROMPT' || e.source === 'BRAND_CONTEXT')) {
      const source = plan.constraint_provenance!.sources[entry.source as 'PROMPT' | 'BRAND_CONTEXT'];
      assert.equal(source.slice(entry.start!, entry.end!), entry.quote);
    }
    validateCampaignPlan(plan);
  }
});

test('soft geography is never silently hardened; biography, examples and dropped negations remain unresolved', () => {
  for (const fixture of [
    { prompt: 'Tìm quán. Ưu tiên Hà Nội', quote: 'Ưu tiên Hà Nội', reason: 'STRENGTH_MISMATCH' },
    { prompt: 'Tìm quán. Mình ở Hà Nội', quote: 'Mình ở Hà Nội', reason: 'MENTION_NOT_CONSTRAINT' },
    { prompt: 'Tìm quán. Ví dụ: chỉ Hà Nội', quote: 'chỉ Hà Nội', reason: 'MENTION_NOT_CONSTRAINT' },
    { prompt: 'Tìm quán, không chỉ Hà Nội mà cả nơi khác', quote: 'chỉ Hà Nội', reason: 'AMBIGUOUS_SCOPE' },
  ]) {
    const constraints = empty(); constraints.geographies = [evidence('Hà Nội', fixture.quote)];
    const plan = compile(fixture.prompt, constraints);
    assert.deepEqual(plan.required_geographies, []); assert.deepEqual(plan.preferred_geographies, []);
    assert.equal(plan.constraint_provenance!.unresolved[0]!.reason, fixture.reason); assert.match(plan.assumptions[0]!, /Unresolved/);
    assert.deepEqual(plan.exclusions, []);
  }
  const constraints = empty(); constraints.geographies = [evidence('Hà Nội', 'Ưu tiên Hà Nội', 'PREFERRED')];
  assert.deepEqual(compile('Tìm quán. Ưu tiên Hà Nội', constraints).preferred_geographies, ['Hà Nội']);
});

test('fabricated, nonunique or value-free quotes fail instead of inventing geography', () => {
  const constraints = empty(); constraints.geographies = [evidence('Hà Nội', 'Chỉ Hà Nội')];
  assert.throws(() => compile('Tìm quán ở Huế', constraints), /QUOTE_NOT_FOUND/);
  assert.throws(() => compile('Tìm quán. Chỉ Hà Nội. Chỉ Hà Nội', constraints), /QUOTE_AMBIGUOUS/);
  constraints.geographies = [evidence('Hải Phòng', 'Chỉ Hà Nội')];
  assert.throws(() => compile('Tìm quán. Chỉ Hà Nội', constraints), /VALUE_NOT_GROUNDED/);
});

test('language-course topic, soft language preference and non-post ages do not become hard filters', () => {
  const constraints = empty(); constraints.languages = [evidence('en', 'Tìm khóa học tiếng Anh')];
  const education = compile('Tìm khóa học tiếng Anh', constraints, {}, 'tìm khóa học');
  assert.deepEqual(education.languages, []); assert.equal(education.constraint_provenance!.unresolved[0]!.reason, 'MENTION_NOT_CONSTRAINT');
  constraints.languages = [evidence('vi', 'Ưu tiên bài viết bằng tiếng Việt', 'PREFERRED')];
  const softLanguage = compile('Tìm quán. Ưu tiên bài viết bằng tiếng Việt', constraints);
  assert.deepEqual(softLanguage.languages, []); assert.equal(softLanguage.constraint_provenance!.unresolved[0]!.reason, 'SOFT_CONSTRAINT_UNREPRESENTED');
  for (const age of [
    { quote: 'Bài viết về sản phẩm ra mắt 30 ngày', value: 30, strength: 'REQUIRED' },
    { quote: 'Ưu tiên bài viết trong 7 ngày gần đây', value: 7, strength: 'PREFERRED' },
    { quote: 'Bài viết trong 1 tháng gần đây', value: 30, strength: 'REQUIRED' },
    { quote: 'Bài viết trong 7 ngày tới', value: 7, strength: 'REQUIRED' },
    { quote: 'Bài viết trong 2 tuần gần đây', value: 2, strength: 'REQUIRED' },
  ]) {
    const c = empty(); c.max_age_days = evidence(age.value, age.quote, age.strength);
    const plan = compile(`Tìm quán. ${age.quote}`, c);
    assert.equal(plan.max_age_days, null); assert.equal(plan.constraint_provenance!.unresolved.length, 1);
  }
});

test('explicit values, empty lists and null override inferred values with explicit-field provenance', () => {
  const prompt = 'Tìm quán. Chỉ Hà Nội. Ưu tiên Huế. Chỉ lấy bài viết bằng tiếng Việt. Bài viết trong 7 ngày gần đây. Ưu tiên nhóm, cá nhân';
  const constraints = empty(); constraints.geographies = [evidence('Hà Nội', 'Chỉ Hà Nội'), evidence('Huế', 'Ưu tiên Huế', 'PREFERRED')];
  constraints.languages = [evidence('vi', 'Chỉ lấy bài viết bằng tiếng Việt')]; constraints.max_age_days = evidence(7, 'Bài viết trong 7 ngày gần đây');
  constraints.source_priority = { source: 'PROMPT', quote: 'Ưu tiên nhóm, cá nhân', value: ['GROUP', 'PROFILE'] };
  const plan = compile(prompt, constraints, { required_geographies: [], preferred_geographies: [], languages: ['en'], max_age_days: null, source_priority: ['PAGE', 'PROFILE'] });
  assert.deepEqual(plan.required_geographies, []); assert.deepEqual(plan.preferred_geographies, []); assert.deepEqual(plan.languages, ['en']);
  assert.equal(plan.max_age_days, null); assert.deepEqual(plan.source_priority, ['PAGE', 'PROFILE']);
  assert.equal(plan.constraint_provenance!.entries.length, 5);
  assert.ok(plan.constraint_provenance!.entries.every(entry => entry.source === 'EXPLICIT_FIELD' && entry.quote === null));
  assert.deepEqual(plan.constraint_provenance!.compiled_values.languages, ['en']);
});

test('brand restrictions retain their exact source and ordered source preferences cannot be reversed', () => {
  const constraints = empty(); constraints.geographies = [evidence('Huế', 'Chỉ phục vụ tại Huế', 'REQUIRED', 'BRAND_CONTEXT')];
  constraints.source_priority = { source: 'PROMPT', quote: 'Ưu tiên nhóm trước fanpage', value: ['GROUP', 'PAGE'] };
  const plan = compile('Tìm quán. Ưu tiên nhóm trước fanpage', constraints, { brand_context: 'Chỉ phục vụ tại Huế' });
  assert.deepEqual(plan.required_geographies, ['Huế']); assert.deepEqual(plan.source_priority, ['GROUP', 'PAGE', 'PROFILE', 'UNKNOWN']);
  assert.equal(plan.constraint_provenance!.entries.find(entry => entry.field === 'required_geographies')!.source, 'BRAND_CONTEXT');
  constraints.source_priority = { source: 'PROMPT', quote: 'Ưu tiên nhóm trước fanpage', value: ['PAGE', 'GROUP'] };
  const reversed = compile('Tìm quán. Ưu tiên nhóm trước fanpage', constraints, { brand_context: 'Chỉ phục vụ tại Huế' });
  assert.deepEqual(reversed.source_priority, ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN']);
  assert.ok(reversed.constraint_provenance!.unresolved.some(entry => entry.field === 'source_priority' && entry.reason === 'UNSUPPORTED_FORMAT'));
});

test('historical compiler provenance validates exact offsets and stays distinct from later explicit user edits', () => {
  const constraints = empty(); constraints.geographies = [evidence('Huế', 'Chỉ phục vụ tại Huế', 'REQUIRED', 'BRAND_CONTEXT')];
  const plan = compile('Tìm quán', constraints, { brand_context: 'Chỉ phục vụ tại Huế' });
  const history = structuredClone(plan.constraint_provenance!);
  const userEdited = { ...plan, brand_context: 'Người dùng sửa phạm vi phục vụ', required_geographies: ['Đà Nẵng'] };
  validateCampaignPlan(userEdited); assert.deepEqual(userEdited.constraint_provenance, history);
  const invalid = structuredClone(plan); invalid.constraint_provenance!.entries[0]!.start = 1;
  assert.throws(() => validateCampaignPlan(invalid), /PROVENANCE_INVALID/);
  const inventedCompiledValue = structuredClone(plan); inventedCompiledValue.constraint_provenance!.compiled_values.required_geographies = ['Hà Nội'];
  assert.throws(() => validateCampaignPlan(inventedCompiledValue), /PROVENANCE_INVALID/);
});

test('planner policy is opt-in, versioned and immutable while old campaign shapes and hashes stay unchanged', async () => {
  const plain = { prompt: 'Tìm quán', campaign_id: 'stable' }, raw = model(['tìm quán']);
  const legacy = campaignFromModel(plain, raw, '2026-10-31T00:00:00Z');
  assert.deepEqual(legacy, campaignFromModel({ ...plain, planner_policy: 'legacy-short-v1' }, raw, '2026-10-31T00:00:00Z'));
  assert.equal('planner_policy' in legacy, false); assert.equal('constraint_provenance' in legacy, false);
  assert.ok(Object.isFrozen(plannerRecipe(policy).schema)); assert.notEqual(contentHash(plannerRecipe(policy)), contentHash(plannerRecipe()));
  const calls: JsonModelRequest[] = [];
  const gateway: ModelGateway = { summary: () => { throw Error('UNUSED'); }, generateJson: async request => {
    calls.push(request); return { value: raw, invocation_id: 'fixture', request_hash: 'fixture', model: 'fixture', model_version: null, usage: null,
      cost_usd: null, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
      price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: '2026-10-31', source: 'fixture' } };
  } };
  const compiled = await compileCampaign({ ...plain, planner_policy: policy, required_geographies: [], max_age_days: null }, gateway);
  assert.equal(calls[0]!.purpose, 'campaign-planner-v1.2.1-grounded-constraints');
  assert.deepEqual((calls[0]!.input as { explicit_constraints: unknown }).explicit_constraints, { required_geographies: [], max_age_days: null });
  assert.equal(compiled.campaign.filter_version, OPPORTUNITY_FILTER_VERSION);
  await assert.rejects(compileCampaign({ ...plain, planner_policy: policy, source_priority: ['GROUP', 'GROUP'] }, gateway), /SOURCE_PRIORITY_INVALID/);
  await assert.rejects(compileCampaign({ ...plain, planner_policy: policy, languages: [''] }, gateway), /LIST_INVALID/);
  await assert.rejects(compileCampaign({ ...plain, planner_policy: '__proto__' as never }, gateway), /POLICY_INVALID/);
  assert.equal(calls.length, 1);
});

test('short model quotes expand to exact local post-language and publication-age clauses', () => {
  const prompt = 'Tìm máy ảnh. Chỉ lấy bài viết bằng tiếng Anh. Bài đăng trong 3 tuần gần nhất.';
  const constraints = empty(); constraints.languages = [evidence('en', 'bằng tiếng Anh')]; constraints.max_age_days = evidence(21, 'trong 3 tuần gần nhất');
  const plan = compile(prompt, constraints, {}, 'tìm máy ảnh');
  assert.deepEqual(plan.languages, ['en']); assert.equal(plan.max_age_days, 21);
  const entries = plan.constraint_provenance!.entries;
  assert.equal(entries.find(entry => entry.field === 'languages')!.quote, 'Chỉ lấy bài viết bằng tiếng Anh');
  assert.equal(entries.find(entry => entry.field === 'max_age_days')!.quote, 'Bài đăng trong 3 tuần gần nhất');
  for (const entry of entries.filter(entry => entry.source === 'PROMPT')) assert.equal(prompt.slice(entry.start!, entry.end!), entry.quote);
});

test('English explicit post language and numeric week lookback use the same grounded semantics', () => {
  const prompt = 'Find hotel discussions in Bristol only. Collect posts written in French. Posts from the last 2 weeks.';
  const constraints = empty(); constraints.geographies = [evidence('Bristol', 'in Bristol only')];
  constraints.languages = [evidence('fr', 'written in French')]; constraints.max_age_days = evidence(14, 'from the last 2 weeks');
  const plan = compile(prompt, constraints, {}, 'hotel discussions');
  assert.deepEqual(plan.required_geographies, ['Bristol']); assert.deepEqual(plan.languages, ['fr']); assert.equal(plan.max_age_days, 14);
  assert.equal(plan.constraint_provenance!.unresolved.length, 0);
});

test('expansion cannot drop soft preference, negation, examples or turn a language-course topic into a filter', () => {
  for (const fixture of [
    { prefix: 'Ưu tiên bài viết bằng tiếng Việt', quote: 'bằng tiếng Việt', language: 'vi' },
    { prefix: 'Không bắt buộc bài viết bằng tiếng Việt', quote: 'bằng tiếng Việt', language: 'vi' },
    { prefix: 'Ví dụ: chỉ lấy bài viết bằng tiếng Việt', quote: 'bằng tiếng Việt', language: 'vi' },
    { prefix: 'Do not collect posts written in English', quote: 'written in English', language: 'en' },
    { prefix: 'Tìm khóa học tiếng Anh', quote: 'tiếng Anh', language: 'en' },
  ]) {
    const constraints = empty(); constraints.languages = [evidence(fixture.language, fixture.quote)];
    const plan = compile(`Tìm quán. ${fixture.prefix}`, constraints); assert.deepEqual(plan.languages, []);
    assert.equal(plan.constraint_provenance!.unresolved.length, 1);
  }
  const constraints = empty(); constraints.max_age_days = evidence(5, 'trong 5 ngày gần đây');
  const soft = compile('Tìm quán, ưu tiên bài đăng trong 5 ngày gần đây', constraints); assert.equal(soft.max_age_days, null);
  assert.equal(soft.constraint_provenance!.unresolved[0]!.reason, 'SOFT_CONSTRAINT_UNREPRESENTED');
  constraints.max_age_days = evidence(7, 'from the next 7 days');
  assert.equal(compile('Tìm quán. Posts from the next 7 days', constraints).max_age_days, null);
});

test('source defaults appended by a model are not falsely attributed to the quoted instruction', () => {
  const constraints = empty(); constraints.source_priority = { source: 'PROMPT', quote: 'Ưu tiên nhóm trước page', value: ['GROUP', 'PAGE', 'PROFILE', 'UNKNOWN'] };
  const plan = compile('Tìm quán. Ưu tiên nhóm trước page', constraints);
  assert.deepEqual(plan.source_priority, ['GROUP', 'PAGE', 'PROFILE', 'UNKNOWN']);
  const entries = plan.constraint_provenance!.entries.filter(entry => entry.field === 'source_priority');
  assert.deepEqual(entries.map(entry => ({ source: entry.source, value: entry.value })), [
    { source: 'PROMPT', value: ['GROUP', 'PAGE'] }, { source: 'DEFAULT', value: ['PROFILE', 'UNKNOWN'] },
  ]);
  assert.equal(plan.constraint_provenance!.unresolved.length, 0);
});
