import { contentHash } from './conversation.js';
import type { IntentInput, IntentSource } from '../shared/semantic-intent.js';
import type { RequestFacet, DiscoveryQuery, DiscoveryPlan } from '../shared/discovery-plan.js';
import { MAX_SEARCH_QUERIES } from '../shared/collection-limits.js';
export type { RequestFacet, FacetCoverage, DiscoveryFamily, DiscoveryQuery, DiscoveryPlan } from '../shared/discovery-plan.js';

export const OPPORTUNITY_PLANNER_POLICY = 'opportunity-coverage-v2' as const;
export const DISCOVERY_VERSION = '2.0.0' as const;
export const MAX_DISCOVERY_QUERIES = MAX_SEARCH_QUERIES;
export const DISCOVERY_FAMILIES = [
  ['TOPIC', 'Chủ đề nền', 'BROAD'], ['PROVIDER_SEARCH', 'Tìm nơi hoặc người cung cấp', 'REQUEST'],
  ['RECOMMENDATION', 'Xin giới thiệu', 'REQUEST'], ['PROBLEM', 'Vấn đề đang gặp', 'PROBLEM'],
  ['FEELING', 'Cảm xúc và tâm sự', 'EXPERIENCE'], ['ASPIRATION', 'Mong muốn và khát vọng', 'USE_CASE'],
  ['CAUSE', 'Hỏi nguyên nhân', 'PROBLEM'], ['SOLUTION', 'Xin cách giải quyết', 'REQUEST'],
  ['DIY', 'Tự làm tại nhà', 'USE_CASE'], ['FAILED_ATTEMPT', 'Đã thử nhưng chưa đạt', 'PROBLEM'],
  ['DISSATISFACTION', 'Không hài lòng dịch vụ cũ', 'EXPERIENCE'], ['POSITIVE_EXPERIENCE', 'Trải nghiệm tích cực', 'EXPERIENCE'],
  ['REVIEW', 'Đánh giá và xin review', 'EXPERIENCE'], ['COMPARISON', 'So sánh lựa chọn', 'COMPARISON'],
  ['PRICE', 'Giá và ngân sách', 'REQUEST'], ['CONVENIENCE', 'Tiện lợi và thời gian', 'USE_CASE'],
  ['OBJECTION', 'Lo ngại và phản đối', 'PROBLEM'], ['BEGINNER', 'Lần đầu tìm hiểu', 'USE_CASE'],
  ['RETURN_SWITCH', 'Thay đổi hoặc quay lại', 'USE_CASE'], ['OCCASION', 'Dịp và sự kiện', 'USE_CASE'],
  ['LIFESTYLE', 'Thói quen và hoàn cảnh sống', 'USE_CASE'], ['PROXY', 'Người hỏi thay người khác', 'REQUEST'],
  ['DEBATE', 'Quan điểm, tranh luận và xu hướng', 'COMPARISON'], ['COMMUNITY', 'Sở thích và cộng đồng', 'BROAD'],
] as const;

/** Literal source inventory is created before generation, never reconstructed from model branches. */
export function originalRequestFacets(input: IntentInput): RequestFacet[] {
  const answers = new Map(input.answers.map(a => [a.target_field, a]));
  const edits = new Map(input.edits.map(e => [e.field, e]));
  const sources: { source: IntentSource; text: string; field?: string }[] = [
    { source: 'PROMPT', text: input.prompt }, { source: 'CONTEXT', text: input.context },
    ...[...answers.values()].filter(a => !edits.has(a.target_field) || edits.get(a.target_field)!.revision < a.revision)
      .map(a => ({ source: 'ANSWER' as const, text: a.answer, field: a.target_field })),
    ...[...edits.values()].filter(e => !answers.has(e.field) || answers.get(e.field)!.revision <= e.revision)
      .map(e => ({ source: 'EDIT' as const, text: e.value, field: e.field })),
    ...input.seeds.map(text => ({ source: 'SEED' as const, text })),
  ];
  const facets: RequestFacet[] = [];
  for (const [source_index, source] of sources.entries()) {
    const boundary = /[,;\r\n]+|[.!?…]+(?=\s|$)/gu;
    let from = 0, inheritedExclusion = false;
    const append = (to: number) => {
      const segment = source.text.slice(from, to), quote = segment.trim();
      if (!quote || !/[\p{L}\p{N}]/u.test(quote)) return;
      const start = from + segment.indexOf(quote), end = start + quote.length;
      const explicitSearch = /^(?:tìm|nhận|lấy|thu thập|chia sẻ|find|include|collect)\s/iu.test(quote);
      const exclusion = (inheritedExclusion && !explicitSearch) || source.field === 'exclude' || /^(?:không (?:lấy|nhận|thu|tìm)|loại(?: bỏ)?|ngoại trừ|exclude|do not (?:include|collect))/iu.test(quote);
      const constraint = ['geography', 'time'].includes(source.field ?? '') || /^(?:(?:địa bàn|địa điểm|khu vực) (?:chỉ là ưu tiên|là ưu tiên)|ưu tiên|vẫn (?:nhận|lấy)|chỉ (?:tại|ở|lấy bài|nội dung|tiếng)|nội dung (?:bằng|tiếng)|bài (?:đăng|viết) (?:trong|bằng)|không giới hạn|prefer|only (?:in|posts)|posts (?:from|in)|include other (?:places|cities))/iu.test(quote);
      const business = source.source === 'CONTEXT' || /^(?:tôi|mình) (?:là|có|cung cấp|kinh doanh|bán)|^my (?:business|company)|^i (?:sell|provide|own)/iu.test(quote);
      const kind = source.source === 'SEED' ? 'SEARCH' : exclusion ? 'EXCLUSION' : constraint ? 'CONSTRAINT' : business ? 'BUSINESS_CONTEXT' : 'SEARCH';
      let literal = quote.replace(/^(?:hãy\s+)?(?:tìm|thu thập|lấy)\s+(?:(?:những|các)\s+)?(?:người(?:\s+dùng)?|khách hàng)\s+(?:đang\s+)?(?:có nhu cầu\s+|muốn\s+)?/iu, '')
        .replace(/^(?:find|collect|search for)\s+(?:people|users|customers)\s+(?:who\s+)?(?:want to\s+|looking for\s+)?/iu, '')
        .replace(/^(?:tìm|thu thập|lấy)\s+(?:các\s+)?bài\s+(?:viết|đăng)\s+(?:liên quan (?:đến|tới|về)\s+|về\s+)?/iu, '').trim();
      if (kind !== 'SEARCH' || !literal || literal.length > 100 || literal.split(/\s/u).length > 12 || /[<>:#]|https?:/iu.test(literal)) literal = '';
      inheritedExclusion = kind === 'EXCLUSION';
      facets.push({ id: 'facet-' + contentHash({ source: source.source, source_index, start, quote }).slice(0, 12), source: source.source,
        source_index, quote, start, end, kind, literal_query: literal || null });
    };
    for (const match of source.text.matchAll(boundary)) { append(match.index!); if (!match[0].includes(',')) inheritedExclusion = false; from = match.index! + match[0].length; }
    append(source.text.length);
  }
  if (!facets.length || facets.length > 96) throw Error('DISCOVERY_INPUT_FACETS_INVALID');
  return facets;
}

export function queryRoleReversal(text: string, input: IntentInput): boolean {
  // Operator-side phrasing is different from a consumer asking for a provider.
  const operator = /^(?:cần\s+)?(?:tìm|tuyển)\s+(?:người|khách|học viên)\s+(?:có nhu cầu\s+|muốn\s+)?(?:học|mua|thuê|đi|dùng|sử dụng)|^looking for (?:customers|buyers|students)/iu;
  const explicitProviders = /(?:chỉ|tìm)\s+(?:người|bên|đơn vị)\s+(?:rao bán|bán|cung cấp)|tìm (?:nhà cung cấp|giáo viên)|only (?:sellers|providers)/iu;
  const current = [...input.edits.map(e => e.value), ...input.answers.map(a => a.answer), input.prompt].join('\n');
  return operator.test(text.trim()) && !explicitProviders.test(current);
}

/** Cover each family/facet first, then interleave the remaining portfolio in bounded waves. */
export function discoveryWaves(queries: Omit<DiscoveryQuery, 'wave' | 'query_id'>[]): DiscoveryQuery[] {
  if (!queries.length || queries.length > MAX_DISCOVERY_QUERIES) throw Error('DISCOVERY_QUERY_LIMIT');
  const seenFamilies = new Set<string>(), seenFacets = new Set<string>();
  const first: typeof queries = [], remaining: typeof queries = [];
  for (const q of queries) {
    if (!seenFamilies.has(q.family_id) || q.facet_ids.some(id => !seenFacets.has(id))) {
      first.push(q); seenFamilies.add(q.family_id); q.facet_ids.forEach(id => seenFacets.add(id));
    } else remaining.push(q);
  }
  const initialSize = Math.min(48, Math.max(24, first.length));
  first.push(...remaining.splice(0, Math.max(0, initialSize - first.length)));
  return [...first, ...remaining].map((q, index) => ({ ...q,
    query_id: 'query-' + contentHash({ text: q.text.normalize('NFC').toLowerCase(), family: q.family_id, facets: q.facet_ids }).slice(0, 16),
    wave: index < first.length ? 0 : 1 + Math.floor((index - first.length) / 24) }));
}

export function validateDiscoveryPlan(plan: DiscoveryPlan): void {
  if (!plan || plan.version !== DISCOVERY_VERSION || plan.evidence_scope !== 'POST_ONLY' || plan.max_queries !== MAX_DISCOVERY_QUERIES
    || plan.initial_wave !== 0 || !Array.isArray(plan.facets) || !plan.facets.length || plan.facets.length > 96
    || !Array.isArray(plan.queries) || !plan.queries.length || plan.queries.length > MAX_DISCOVERY_QUERIES) throw Error('DISCOVERY_PLAN_INVALID');
  const facetIds = new Set(plan.facets.map(f => f.id)), queryIds = new Set<string>(), texts = new Set<string>();
  if (facetIds.size !== plan.facets.length || !Array.isArray(plan.coverage) || plan.coverage.length !== plan.facets.length
    || new Set(plan.coverage.map(c => c.facet_id)).size !== facetIds.size || plan.coverage.some(c => !facetIds.has(c.facet_id))) throw Error('DISCOVERY_COVERAGE_INVALID');
  for (const q of plan.queries) {
    const key = q.text?.normalize('NFC').toLowerCase();
    if (!q.query_id || queryIds.has(q.query_id) || !key || texts.has(key) || q.text.length > 100 || !Number.isInteger(q.wave) || q.wave < 0
      || !DISCOVERY_FAMILIES.some(f => f[0] === q.family_id) || !Array.isArray(q.facet_ids) || !q.facet_ids.length
      || q.facet_ids.some(id => !facetIds.has(id))) throw Error('DISCOVERY_QUERY_INVALID');
    queryIds.add(q.query_id); texts.add(key);
  }
  for (const c of plan.coverage) if (c.disposition === 'SEARCH' && !plan.queries.some(q => q.facet_ids.includes(c.facet_id))) throw Error('DISCOVERY_FACET_UNCOVERED');
}
