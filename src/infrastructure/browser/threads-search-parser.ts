type Obj = Record<string, any>;
export interface ThreadsPost {
  platform: 'threads'; post_id: string; shortcode: string; post_url: string; text: string;
  author_username: string; author_name: string | null; published_at: string | null;
  likes: number | null; replies: number | null; reposts: number | null; quotes: number | null; shares: number | null;
  query: string; search_mode: 'top' | 'recent'; collected_at: string;
  visibility: 'PUBLIC_PROFILE' | 'PRIVATE_PROFILE' | 'UNKNOWN'; relevance: 'NOT_EVALUATED';
  text_completeness: 'UNKNOWN'; extraction_method: 'EMBEDDED_DOCUMENT_JSON' | 'BROWSER_RESPONSE';
  entity_type?: 'POST' | 'COMMENT'; is_reply?: boolean; root_post_id?: string | null; parent_id?: string | null;
  needs_context?: boolean; media_refs?: { type: 'IMAGE' | 'VIDEO'; url: string }[];
}
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
export function parseThreadsSearch(objects: unknown[], context: {
  query: string; mode: 'top' | 'recent'; collectedAt: string; method: ThreadsPost['extraction_method'];
  includeContextCandidates?: boolean;
}) {
  const records: ThreadsPost[] = [], skipped: string[] = [];
  let connections = 0, hasNext: boolean | null = null, visited = 0;
  function connection(value: Obj) {
    connections++;
    if (typeof value.page_info?.has_next_page === 'boolean') {
      hasNext = hasNext === null ? value.page_info.has_next_page : hasNext || value.page_info.has_next_page;
    }
    for (const edge of value.edges) {
      const items = edge?.node?.thread?.thread_items;
      if (!Array.isArray(items)) { skipped.push('UNSUPPORTED_SEARCH_EDGE'); continue; }
      for (const item of items) {
        const p = item?.post, info = p?.text_post_app_info;
        if (!p || info?.is_post_unavailable) { skipped.push('UNAVAILABLE'); continue; }
        if (info?.is_reply === true && !context.includeContextCandidates) { skipped.push('REPLY'); continue; }
        if (typeof p.pk !== 'string' || !/^\d+$/.test(p.pk) || typeof p.code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(p.code) ||
            typeof p.user?.username !== 'string' || !/^[A-Za-z0-9._]+$/.test(p.user.username)) { skipped.push('MISSING_IDENTITY'); continue; }
        const text = typeof p.caption?.text === 'string' ? p.caption.text : '';
        if (!text.trim() && !context.includeContextCandidates) { skipped.push('NO_TEXT'); continue; }
        const nativeId = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) ? value : null;
        const isReply = info?.is_reply === true;
        const media: { type: 'IMAGE' | 'VIDEO'; url: string }[] = [];
        for (const [type, items] of [['IMAGE', p.image_versions2?.candidates], ['VIDEO', p.video_versions]] as const) {
          const first = Array.isArray(items) ? items.find((item: Obj) => typeof item?.url === 'string' && item.url.startsWith('https://')) : null;
          if (first) media.push({ type, url: first.url });
        }
        records.push({ platform: 'threads', post_id: p.pk, shortcode: p.code,
          post_url: `https://www.threads.com/@${p.user.username}/post/${p.code}`, text,
          author_username: p.user.username, author_name: typeof p.user.full_name === 'string' ? p.user.full_name : null,
          published_at: typeof p.taken_at === 'number' && Number.isFinite(p.taken_at) && p.taken_at > 0 && p.taken_at < 1e11 ? new Date(p.taken_at * 1000).toISOString() : null,
          likes: count(p.like_count), replies: count(info?.direct_reply_count), reposts: count(info?.repost_count), quotes: count(info?.quote_count), shares: count(info?.reshare_count),
          query: context.query, search_mode: context.mode, collected_at: context.collectedAt,
          visibility: p.user.text_post_app_is_private === false ? 'PUBLIC_PROFILE' : p.user.text_post_app_is_private === true ? 'PRIVATE_PROFILE' : 'UNKNOWN',
          relevance: 'NOT_EVALUATED', text_completeness: 'UNKNOWN', extraction_method: context.method,
          ...(context.includeContextCandidates ? { entity_type: isReply ? 'COMMENT' as const : 'POST' as const, is_reply: isReply,
            root_post_id: isReply ? nativeId(info?.root_post?.pk ?? info?.root_post_id) : p.pk,
            parent_id: isReply ? nativeId(info?.reply_to_post?.pk ?? info?.reply_to_post_id ?? info?.replied_to?.pk) : null,
            needs_context: !text.trim() || isReply, media_refs: media } : {}) });
      }
    }
  }
  function walk(value: unknown, depth: number) {
    if (!value || typeof value !== 'object') return;
    if (++visited > 300000 || depth > 80) throw new Error('THREADS_PAYLOAD_LIMIT');
    if (Array.isArray(value)) { for (const x of value) walk(x, depth + 1); return; }
    const v = value as Obj;
    if (v.searchResults && Array.isArray(v.searchResults.edges)) connection(v.searchResults);
    for (const [key, child] of Object.entries(v)) if (key !== 'searchResults') walk(child, depth + 1);
  }
  objects.forEach(o => walk(o, 0));
  return { records, connections, has_next_page: hasNext, skipped };
}
