// Offline Gemini response for the Starter integration test and local preview.
export function starterGeminiFixture(url, request) {
  if (url !== 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent') {
    throw Error('FIXTURE_MODEL_UNEXPECTED');
  }
  const input = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
  let value = [{ i: 0, e0: 0, ev: [] }];
  if (Array.isArray(input.ORIGINAL_FACETS)) {
    const facets = input.ORIGINAL_FACETS;
    const search = facets.filter(facet => facet.kind === 'SEARCH');
    value = {
      state: 'READY', intent_revision: input.revision, understanding: 'Tìm bài đúng ý gốc', target_roles: [], constraints: [],
      intent: input.INTENT_FIELD_CATALOG.map(field => ({ field, value: 'Chưa đặt giới hạn', status: 'UNSPECIFIED', evidence: [] })),
      branches: search.map((facet, i) => ({ id: 'b' + i, label: facet.quote, anchor: facet.literal_query ?? 'chủ đề',
        source: facet.source, quote: facet.quote, scope: 'CORE', reason: 'Ý gốc', facet_ids: [facet.id] })),
      queries: search.map((facet, i) => ({ text: facet.literal_query ?? 'chủ đề', branch_id: 'b' + i, kind: 'EXACT',
        anchor: facet.literal_query ?? 'chủ đề', family_id: 'TOPIC', facet_ids: [facet.id], rationale: 'Ý gốc', risk: 'LOW' })),
      coverage: facets.map(facet => ({ facet_id: facet.id, disposition: facet.kind,
        branch_ids: facet.kind === 'SEARCH' ? ['b' + search.indexOf(facet)] : [], reason: 'Giữ ý gốc', superseded_by: null })),
      questions: [], unresolved_fields: [], unconfirmed_assumptions: [], caveats: [], improvements: [],
    };
  }
  return Response.json({ modelVersion: 'fixture-3.1',
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100, cachedContentTokenCount: 100, thoughtsTokenCount: 8 } });
}
