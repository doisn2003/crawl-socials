// Observed on 2026-10-28. Pure parsing only: no requests, UI actions, or permission claims.
// Candidate records are not benchmark acceptance decisions.
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const path = (v: unknown, ...keys: string[]): unknown => keys.reduce((a, k) => object(a)[k], v);
const str = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;
const integer = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null;
const same = (values: unknown[]): number | null => {
  const observed = values.map(integer).filter((v): v is number => v !== null);
  return observed.length && new Set(observed).size === 1 ? observed[0]! : null;
};

export interface EmbeddedSearchRecord {
  post_id: string; observed_post_url: string; text: string;
  source_type: 'PAGE' | 'GROUP' | 'UNKNOWN'; source_name: string | null;
  source_evidence: string | null; visibility: 'PUBLIC' | 'PRIVATE' | 'UNKNOWN';
  source_url: string | null; author_name: string | null; author_url: string | null;
  visibility_evidence: { description: string; icon: string }[];
  published_at: string | null; published_at_raw: number | null;
  reactions_total: number | null; love_count: number | null;
  comments_count: number | null; shares_count: number | null;
  query: string; collected_at: string; extraction_method: 'EMBEDDED_DOCUMENT_JSON' | 'BROWSER_RESPONSE';
  text_completeness: 'UNKNOWN'; relevance: 'UNVERIFIED';
  evidence_ref: { document_url: string; json_path: (string | number)[] };
  missing_reasons: Record<string, string>;
  source_signals: { actor_typename: string | null; page_id_type: string | null; actor_post_match: boolean };
  needs_context?: boolean;
}
export interface EmbeddedSearchResult {
  records: EmbeddedSearchRecord[];
  skipped: { path: (string | number)[]; reason: string; observed_post_url?: string; post_id?: string; text?: string }[];
  connections: number; has_next_page: boolean | null;
  // Deliberately does not export or use opaque cursors. They do not authorize replay.
}
export interface EmbeddedSearchContext { query: string; collectedAt: string; documentUrl: string; extractionMethod?: EmbeddedSearchRecord['extraction_method']; includeContextCandidates?: boolean; }

export function parseFacebookEmbeddedSearch(blocks: unknown[], context: EmbeddedSearchContext): EmbeddedSearchResult {
  const document = new URL(context.documentUrl);
  if (document.origin !== 'https://www.facebook.com' || !['/search/top', '/search/top/'].includes(document.pathname) ||
      document.searchParams.get('q') !== context.query || !Number.isFinite(Date.parse(context.collectedAt))) throw new Error('SEARCH_CONTEXT_INVALID');
  if (blocks.length > 200) throw new Error('SEARCH_BLOCK_LIMIT');
  const result: EmbeddedSearchResult = { records: [], skipped: [], connections: 0, has_next_page: null };
  const ids = new Set<string>(), urls = new Set<string>(), visited = new WeakSet<object>();
  let nodes = 0;
  function consume(raw: unknown, jsonPath: (string | number)[]) {
    const connection = object(raw); result.connections++;
    const hasNext = path(connection, 'page_info', 'has_next_page');
    if (typeof hasNext === 'boolean') result.has_next_page = result.has_next_page === null ? hasNext : result.has_next_page || hasNext;
    const edges = list(connection.edges);
    if (edges.length > 100) throw new Error('SEARCH_EDGE_LIMIT');
    for (const [i, edge] of edges.entries()) {
      const at = [...jsonPath, 'edges', i];
      const strategy = object(object(edge).rendering_strategy);
      const rawStory = object(path(strategy, 'view_model', 'click_model', 'story'));
      const skip = (reason: string) => result.skipped.push({ path: at, reason,
        ...(typeof rawStory.permalink_url === 'string' ? { observed_post_url: rawStory.permalink_url } : {}),
        ...(typeof rawStory.post_id === 'string' ? { post_id: rawStory.post_id } : {}),
        ...(typeof path(rawStory, 'comet_sections', 'content', 'story', 'message', 'text') === 'string' ?
          { text: String(path(rawStory, 'comet_sections', 'content', 'story', 'message', 'text')).slice(0,2000) } : {}) });
      if (strategy.__typename !== 'SearchRichPostRenderingStrategy') { skip('UNSUPPORTED_RENDERING_STRATEGY'); continue; }
      const story = object(path(strategy, 'view_model', 'click_model', 'story'));
      const id = str(story.post_id), url = str(story.permalink_url), storyId = str(story.id);
      if (story.__typename !== 'Story' || !id || !/^\d+$/.test(id) || !url || !storyId) { skip('STORY_IDENTITY_MISSING'); continue; }
      let parsed: URL;
      try { parsed = new URL(url); } catch { skip('POST_URL_INVALID'); continue; }
      const groupRoute = parsed.pathname.match(/^\/groups\/[^/]+\/posts\/(\d+)\/?$/);
      const pageRoute = /^\/[^/]+\/posts\/(?:pfbid[A-Za-z0-9]+|\d+)\/?$/.test(parsed.pathname);
      const numericPost = parsed.pathname.match(/\/posts\/(\d+)\/?$/)?.[1];
      const queryPost = parsed.searchParams.get('story_fbid');
      // Observed in pilot-b: native permalink.php?story_fbid=pfbid...&id=... .
      const queryRoute = parsed.pathname === '/permalink.php' && queryPost !== null && /^(?:pfbid[A-Za-z0-9]+|\d+)$/.test(queryPost) &&
        /^\d+$/.test(parsed.searchParams.get('id') || '') && [...parsed.searchParams.keys()].every(k => ['story_fbid','id'].includes(k)) &&
        parsed.searchParams.getAll('story_fbid').length === 1 && parsed.searchParams.getAll('id').length === 1;
      if (parsed.origin !== 'https://www.facebook.com' || parsed.username || parsed.password || parsed.hash ||
          (parsed.search && !queryRoute) || (!groupRoute && !pageRoute && !queryRoute) || (numericPost && numericPost !== id) ||
          (queryRoute && /^\d+$/.test(queryPost!) && queryPost !== id)) { skip('POST_URL_INVALID'); continue; }
      const content = object(path(story, 'comet_sections', 'content', 'story'));
      const messageStory = object(path(content, 'comet_sections', 'message', 'story'));
      const chosen = typeof path(content, 'message', 'text') === 'string' ? content : messageStory;
      const text = str(path(chosen, 'message', 'text')) ?? '';
      if ((!text.trim() && !context.includeContextCandidates) || text.length > 50000) { skip('POST_TEXT_MISSING_OR_TOO_LARGE'); continue; }
      // Never borrow the text of an attached/shared/quoted story or a different root post.
      if (text.trim() && ((chosen.id !== storyId && chosen.post_id !== id) || (chosen.post_id !== undefined && chosen.post_id !== id) ||
          (chosen.permalink_url !== undefined && chosen.permalink_url !== url))) { skip('STORY_TEXT_IDENTITY_MISMATCH'); continue; }
      if (ids.has(id) || urls.has(url)) { skip('DUPLICATE_OBSERVATION'); continue; }
      const sections = object(story.comet_sections);
      const title = object(path(sections, 'context_layout', 'story', 'comet_sections', 'title', 'story'));
      const actor = object(list(story.actors)[0]);
      const group = object(path(story, 'feedback', 'associated_group'));
      const destination = object(title.to);
      let source: EmbeddedSearchRecord['source_type'] = 'UNKNOWN', sourceName: string | null = null, sourceEvidence: string | null = null;
      const sourceSignals = { actor_typename: str(actor.__typename), page_id_type: null as string | null, actor_post_match: false };
      if (str(group.id) && groupRoute && destination.__typename === 'Group' && destination.id === group.id) {
        source = 'GROUP'; sourceName = str(destination.name); sourceEvidence = 'same_story_associated_group_and_title_destination';
      } else if (!groupRoute && !str(group.id)) {
        const tracking = path(title, 'comet_sections', 'follow_button', 'story', 'tracking');
        if (typeof tracking === 'string' && tracking.length <= 16384 && typeof actor.id === 'string') {
          try {
            const info = object(object(object(JSON.parse(tracking)).page_insights)[actor.id]);
            sourceSignals.page_id_type = str(info.page_id_type);
            sourceSignals.actor_post_match = info.actor_id === actor.id && list(path(info, 'post_context', 'story_fbid')).includes(id);
            if (info.page_id_type === 'page' && info.actor_id === actor.id && list(path(info, 'post_context', 'story_fbid')).includes(id)) {
              source = 'PAGE'; sourceName = str(actor.name); sourceEvidence = 'same_story_page_insights_type_actor_and_post_match';
            }
          } catch { /* Unknown source remains a saved candidate. */ }
        }
      }
      const metadata = list(path(sections, 'context_layout', 'story', 'comet_sections', 'metadata'));
      const privacy = metadata.map(m => object(path(m, 'story', 'privacy_scope'))).flatMap(p => {
        const description = str(p.description), icon = str(path(p, 'icon_image', 'name'));
        return description && icon ? [{ description, icon }] : [];
      });
      // Explicit per-Story audience text is evidence; decorative icon names may be custom.
      const publicScope = privacy.length > 0 && privacy.every(p => groupRoute ? p.description === 'Nhóm công khai' : p.description === 'Công khai');
      const privateScope = privacy.length > 0 && privacy.every(p => ['Nhóm riêng tư','Riêng tư','Chỉ mình tôi','Bạn bè'].includes(p.description));
      const feedback = object(path(sections, 'feedback', 'story', 'story_ufi_container', 'story', 'feedback_context',
        'feedback_target_with_context', 'comet_ufi_summary_and_actions_renderer', 'feedback'));
      const actions = list(feedback.adaptive_ufi_action_renderers);
      const reactions = same(actions.map(a => path(a, 'feedback', 'reaction_count', 'count')));
      const shares = same(actions.map(a => path(a, 'feedback', 'share_count', 'count')));
      const comments = same(actions.filter(a => object(a).__typename === 'UFICommentActionRenderer')
        .map(a => path(a, 'feedback', 'comment_rendering_instance', 'comments', 'total_count')));
      const love = same(list(path(feedback, 'top_reactions', 'edges'))
        .filter(e => path(e, 'node', 'localized_name') === 'Yêu thích').map(e => object(e).reaction_count));
      const epoch = integer(story.creation_time);
      const time = epoch !== null && epoch <= 8640000000000 ? new Date(epoch * 1000).toISOString() : null;
      const missing: Record<string, string> = {};
      for (const [field, value] of Object.entries({ published_at: time, reactions_total: reactions, love_count: love, comments_count: comments, shares_count: shares })) {
        if (value === null) missing[field] = 'ABSENT_OR_CONFLICTING_IN_OBSERVED_STORY';
      }
      if (source === 'UNKNOWN') missing.source_type = 'NO_MATCHED_PUBLICATION_CONTEXT_EVIDENCE';
      if (!sourceName) missing.source_name = 'NOT_OBSERVED';
      if (!(source === 'GROUP' ? str(destination.url) : str(actor.url))) missing.source_url = 'NOT_OBSERVED';
      if (!publicScope && !privateScope) missing.visibility = 'NO_UNAMBIGUOUS_PER_STORY_AUDIENCE_LABEL';
      if (!text.trim()) missing.text = 'NO_TEXT_NEEDS_CONVERSATION_OR_MEDIA';
      result.records.push({ post_id: id, observed_post_url: url, text, source_type: source, source_name: sourceName,
        source_evidence: sourceEvidence, source_url: source === 'GROUP' ? str(destination.url) : str(actor.url),
        author_name: str(actor.name), author_url: str(actor.url), visibility: publicScope ? 'PUBLIC' : privateScope ? 'PRIVATE' : 'UNKNOWN', visibility_evidence: privacy,
        published_at: time, published_at_raw: epoch, reactions_total: reactions, love_count: love, comments_count: comments,
        shares_count: shares, query: context.query, collected_at: context.collectedAt, extraction_method: context.extractionMethod ?? 'EMBEDDED_DOCUMENT_JSON',
        text_completeness: 'UNKNOWN', relevance: 'UNVERIFIED', evidence_ref: { document_url: context.documentUrl,
          json_path: [...at, 'rendering_strategy', 'view_model', 'click_model', 'story'] }, missing_reasons: missing, source_signals: sourceSignals,
        ...(context.includeContextCandidates ? { needs_context: !text.trim() } : {}) });
      ids.add(id); urls.add(url);
    }
  }
  function walk(value: unknown, at: (string | number)[], depth: number) {
    if (++nodes > 50000 || depth > 24) throw new Error('SEARCH_STRUCTURE_LIMIT');
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) return; visited.add(value);
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, [...at, i], depth + 1)); return; }
    const obj = object(value), connection = path(obj, 'data', 'serpResponse', 'results');
    if (connection !== undefined) { consume(connection, [...at, 'data', 'serpResponse', 'results']); return; }
    // Only the observed data envelope; do not search every id/story across unrelated data.
    for (const key of ['require', '__bbox', 'result']) if (obj[key] !== undefined) walk(obj[key], [...at, key], depth + 1);
  }
  walk(blocks, [], 0);
  return result;
}
