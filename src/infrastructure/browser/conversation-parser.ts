import type { ConversationObservation, ConversationMedia, SocialPlatform } from '../../domain/conversation.js';

type Obj = Record<string, any>;
const object = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string | null => typeof v === 'string' && v.length ? v : null;
const native = (v: unknown): string | null => typeof v === 'string' && /^\d+$/.test(v) ? v : null;
const count = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null;
const date = (v: unknown): string | null => typeof v === 'number' && v > 0 && v < 1e11 ? new Date(v * 1000).toISOString() : null;
const mediaId = (v: Obj): string | null => native(v.pk) ?? (typeof v.id === 'string' ? v.id.match(/^(\d+)(?:_\d+)?$/)?.[1] ?? null : null);

export interface ConversationParseContext {
  rootId: string;
  url: string;
  observedAt: string;
  runId: string;
  method: 'EMBEDDED_DOCUMENT_JSON' | 'BROWSER_RESPONSE';
  knownIds?: ReadonlySet<string>;
}
export interface ConversationParseResult {
  observations: ConversationObservation[];
  recognized: boolean;
  root_found: boolean;
  has_more: boolean | null;
  cursor: string | null;
  advertised_count: number | null;
  unresolved_parents: number;
  skipped: string[];
}
function base(): ConversationParseResult {
  return { observations: [], recognized: false, root_found: false, has_more: null, cursor: null, advertised_count: null, unresolved_parents: 0, skipped: [] };
}
function provenance(context: ConversationParseContext, path: (string | number)[]) {
  return { run_id: context.runId, method: context.method, url: context.url, locator: JSON.stringify(path) };
}
function media(v: Obj): ConversationMedia[] {
  const result: ConversationMedia[] = [];
  for (const [type, values] of [['IMAGE', v.image_versions2?.candidates], ['VIDEO', v.video_versions]] as const) {
    const first = list(values).find(x => typeof x?.url === 'string' && x.url.startsWith('https://'));
    if (first) result.push({ type, url: first.url });
  }
  return result;
}
function validateContext(context: ConversationParseContext, platform: SocialPlatform) {
  const url = new URL(context.url);
  if (!/^\d+$/.test(context.rootId) || !Number.isFinite(Date.parse(context.observedAt)) || !context.runId ||
      url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(platform === 'threads' ? ['www.threads.com', 'threads.com', 'www.threads.net', 'threads.net'].includes(url.hostname) : ['www.facebook.com', 'facebook.com'].includes(url.hostname))) throw Error('CONVERSATION_CONTEXT_INVALID');
}

/** Parse only the requested media's conversation connections, never unrelated feed/recommendations. */
export function parseThreadsConversation(objects: unknown[], context: ConversationParseContext): ConversationParseResult {
  validateContext(context, 'threads');
  const result = base(), seen = new WeakSet<object>(), emitted = new Map<string, ConversationObservation>();
  let visited = 0;
  function page(value: Obj) {
    if (typeof value.page_info?.has_next_page === 'boolean') result.has_more = result.has_more === true || value.page_info.has_next_page;
    if (typeof value.page_info?.end_cursor === 'string') result.cursor = value.page_info.end_cursor;
  }
  function post(value: Obj, parent: string | null, path: (string | number)[], parentBinding?: string) {
    const id = mediaId(value), info = object(value.text_post_app_info);
    if (!id || info.is_post_unavailable === true) { result.skipped.push('UNAVAILABLE_OR_MISSING_ID'); return; }
    // Partial identity-only nodes must not replace already observed content with an empty string.
    if (!value.user || !('caption' in value || 'media_type' in value || 'image_versions2' in value)) return;
    const isRoot = id === context.rootId;
    const explicitParent = native(info.reply_to_post?.pk ?? info.reply_to_post_id ?? info.replied_to?.pk);
    const parentId = isRoot ? null : explicitParent ?? parent;
    const username = str(value.user.username), code = str(value.code);
    const permalink = username && /^[a-zA-Z0-9._]+$/.test(username) && code && /^[a-zA-Z0-9_-]+$/.test(code)
      ? `https://www.threads.com/@${username}/post/${code}` : null;
    const observation: ConversationObservation = {
      platform: 'threads', entity_type: isRoot ? 'POST' : 'COMMENT', entity_id: id,
      root_post_id: context.rootId, parent_id: parentId,
      text: typeof value.caption?.text === 'string' ? value.caption.text : '', observed_at: context.observedAt,
      published_at: date(value.taken_at), permalink,
      author: { id: native(value.user.pk ?? value.user.id), name: str(value.user.full_name) ?? username, role: 'UNKNOWN' },
      source: { kind: 'PROFILE' }, media: media(value), provenance: {
        ...provenance(context, path),
        ...(parentBinding ? { locator: JSON.stringify({ path, parent_binding: parentBinding, reply_level: info.reply_level, reply_to_author_id: info.reply_to_author?.id ?? null }) } : {}),
      },
    };
    const prior = emitted.get(id);
    if (!prior || observation.text.length > prior.text.length || prior.parent_id === null && parentId !== null) emitted.set(id, observation);
    if (isRoot) { result.root_found = true; result.advertised_count = count(info.direct_reply_count) ?? result.advertised_count; }
  }
  function threadConnection(value: Obj, parent: string | null, path: (string | number)[]) {
    if (!Array.isArray(value.edges)) return;
    result.recognized = true; page(value);
    for (const [i, edge] of value.edges.entries()) {
      const node = object(edge?.node), posts = object(node.posts);
      if (Array.isArray(posts.edges)) {
        page(posts);
        const ancestors = new Map<number, { id: string; author: string | null }>();
        for (const [j, item] of posts.edges.entries()) {
          const p = object(item?.node), level = count(p.text_post_app_info?.reply_level), id = mediaId(p);
          const ancestor = level === null ? undefined : ancestors.get(level - 1);
          const replyTo = native(p.text_post_app_info?.reply_to_author?.id ?? p.text_post_app_info?.reply_to_author?.pk);
          // Observed Threads thread views contain an ordered depth-labelled tree. A parent is
          // recoverable only when the depth predecessor AND reply-to author agree in that branch.
          const boundParent = j === 0 ? parent : ancestor && replyTo && ancestor.author === replyTo ? ancestor.id : null;
          const binding = j > 0 && boundParent ? 'THREAD_REPLY_LEVEL_AND_AUTHOR' : undefined;
          post(p, boundParent, [...path, 'edges', i, 'node', 'posts', 'edges', j, 'node'], binding);
          if (level !== null && id) {
            for (const key of ancestors.keys()) if (key >= level) ancestors.delete(key);
            ancestors.set(level, { id, author: native(p.user?.pk ?? p.user?.id) });
          }
        }
      } else if (Array.isArray(node.thread_items)) {
        for (const [j, item] of node.thread_items.entries()) post(object(item?.post), j === 0 ? parent : null, [...path, 'edges', i, 'node', 'thread_items', j, 'post']);
      } else if (mediaId(node)) post(node, parent, [...path, 'edges', i, 'node']);
    }
  }
  function envelope(value: unknown, path: (string | number)[], depth: number) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (++visited > 200000 || depth > 80) throw Error('CONVERSATION_PAYLOAD_LIMIT');
    seen.add(value);
    if (Array.isArray(value)) { value.forEach((x, i) => envelope(x, [...path, i], depth + 1)); return; }
    const v = object(value), current = object(v.data?.media), id = mediaId(current);
    if (id && (id === context.rootId || context.knownIds?.has(id))) {
      const info = object(current.text_post_app_info), at = [...path, 'data', 'media'];
      post(current, null, at);
      threadConnection(object(info.direct_replies), id, [...at, 'text_post_app_info', 'direct_replies']);
      threadConnection(object(info.inline_expansion), id, [...at, 'text_post_app_info', 'inline_expansion']);
      // Root/self-thread text can be read without interpreting it as a reply opportunity.
      if (id === context.rootId) {
        const containing = object(info.containing_thread?.posts);
        for (const [i, edge] of list(containing.edges).entries()) if (mediaId(object(edge?.node)) === context.rootId) post(object(edge.node), null, [...at, 'text_post_app_info', 'containing_thread', 'posts', 'edges', i, 'node']);
      }
    }
    for (const key of ['require', '__bbox', 'result', 'data']) if (v[key] !== undefined) envelope(v[key], [...path, key], depth + 1);
  }
  objects.forEach((value, i) => envelope(value, [i], 0));
  result.observations = [...emitted.values()];
  result.unresolved_parents = result.observations.filter(o => o.entity_type === 'COMMENT' && !o.parent_id).length;
  return result;
}

function facebookIdentity(value: unknown): { root: string | null; id: string | null } {
  if (typeof value !== 'string') return { root: null, id: null };
  if (/^\d+$/.test(value)) return { root: null, id: value };
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const match = decoded.match(/^comment:(\d+)_(\d+)$/);
    if (match) return { root: match[1]!, id: match[2]! };
  } catch { /* Opaque unsupported IDs remain unresolved. */ }
  return { root: null, id: null };
}
function facebookLinkIdentity(value: unknown): { root: string | null; id: string | null; parent: string | null; url: string | null } {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || !['www.facebook.com', 'facebook.com'].includes(url.hostname) || url.username || url.password) throw Error();
    const root = native(url.pathname.match(/\/posts\/(\d+)/)?.[1]) ?? native(url.searchParams.get('story_fbid'));
    const parent = native(url.searchParams.get('comment_id')), reply = native(url.searchParams.get('reply_comment_id'));
    return { root, id: reply ?? parent, parent: reply ? parent : null, url: url.href };
  } catch { return { root: null, id: null, parent: null, url: null }; }
}

/** Facebook Comment IDs bind to root IDs; unrelated feed comments are never adopted. */
export function parseFacebookConversation(objects: unknown[], context: ConversationParseContext): ConversationParseResult {
  validateContext(context, 'facebook');
  const result = base(), seen = new WeakSet<object>(), emitted = new Map<string, ConversationObservation>();
  let visited = 0;
  function walk(value: unknown, path: (string | number)[], depth: number, boundRoot: boolean, parent: string | null) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (++visited > 250000 || depth > 90) throw Error('CONVERSATION_PAYLOAD_LIMIT');
    seen.add(value);
    if (Array.isArray(value)) { value.forEach((x, i) => walk(x, [...path, i], depth + 1, boundRoot, parent)); return; }
    const v = object(value);
    const storyId = native(v.post_id);
    if (storyId && v.__typename === 'Story') {
      // A different root resets inherited scope, including quoted/shared stories.
      boundRoot = storyId === context.rootId;
      if (boundRoot) {
        result.root_found = true;
        const content = object(v.comet_sections?.content?.story), nested = object(content.comet_sections?.message?.story);
        const chosen = typeof content.message?.text === 'string' ? content : typeof nested.message?.text === 'string' ? nested : v;
        const matching = chosen === v || chosen.post_id === storyId || chosen.id === v.id;
        const text = matching && typeof chosen.message?.text === 'string' ? chosen.message.text : '';
        const actor = object(list(v.actors)[0]);
        const prior = emitted.get(storyId);
        if (('comet_sections' in v || 'message' in v) && (!prior || text.length > prior.text.length)) emitted.set(storyId, {
          platform: 'facebook', entity_type: 'POST', entity_id: storyId, root_post_id: storyId, parent_id: null,
          text, observed_at: context.observedAt, published_at: date(v.creation_time), permalink: str(v.permalink_url) ?? context.url,
          author: { id: str(actor.id), name: str(actor.name), role: 'UNKNOWN' },
          source: { kind: new URL(context.url).pathname.startsWith('/groups/') ? 'GROUP' : 'UNKNOWN' },
          provenance: provenance(context, path),
        });
      }
    }
    if (v.__typename === 'Comment') {
      const identity = facebookIdentity(v.id), link = facebookLinkIdentity(v.url ?? v.feedback?.url);
      const root = identity.root ?? link.root;
      const id = native(v.legacy_fbid) ?? identity.id ?? link.id;
      if (identity.root && link.root && identity.root !== link.root || identity.id && link.id && identity.id !== link.id ||
          native(v.legacy_fbid) && identity.id && v.legacy_fbid !== identity.id) { result.skipped.push('COMMENT_IDENTITY_CONFLICT'); return; }
      if (root !== null && root !== context.rootId) return;
      if (!id || !(root === context.rootId || boundRoot)) return;
      boundRoot = true;
      const explicit = facebookIdentity(v.comment_direct_parent?.id ?? v.comment_parent?.id ?? v.parent_comment?.id);
      const parentId = (explicit.root && explicit.root !== context.rootId ? null : explicit.id) ?? link.parent ?? parent ?? (v.depth === 0 ? context.rootId : null);
      // Identity-only objects (e.g. parent_object_ent) must never erase full comment content.
      if ('body' in v || 'attachments' in v) {
        const observation: ConversationObservation = {
          platform: 'facebook', entity_type: 'COMMENT', entity_id: id, root_post_id: context.rootId, parent_id: parentId,
          text: typeof v.body?.text === 'string' ? v.body.text : '', observed_at: context.observedAt,
          published_at: date(v.created_time), permalink: link.url,
          author: { id: str(v.author?.id), name: str(v.author?.name), role: 'UNKNOWN' },
          provenance: provenance(context, path),
        };
        const prior = emitted.get(id);
        if (!prior || observation.text.length > prior.text.length || prior.parent_id === null && parentId !== null) emitted.set(id, observation);
      }
      parent = id;
    }
    const key = String(path.at(-1) ?? '');
    if (Array.isArray(v.edges) && /comments|replies/.test(key)) {
      const matched = v.edges.some((e: Obj) => facebookIdentity(e?.node?.id).root === context.rootId);
      if (boundRoot || matched) {
        result.recognized = true;
        if (typeof v.page_info?.has_next_page === 'boolean') result.has_more = result.has_more === true || v.page_info.has_next_page;
        if (typeof v.page_info?.end_cursor === 'string') result.cursor = v.page_info.end_cursor;
        result.advertised_count = count(v.total_count) ?? result.advertised_count;
        for (const [i, edge] of v.edges.entries()) walk(edge, [...path, 'edges', i], depth + 1, true, parent ?? context.rootId);
        return;
      }
    }
    // Restrict obviously irrelevant branches; root-identity checks remain mandatory below.
    for (const [key, child] of Object.entries(v)) {
      if (['viewer', 'me', 'notifications', 'quoted_post', 'attached_story', 'tracking', 'actors', 'author', 'user'].includes(key)) continue;
      walk(child, [...path, key], depth + 1, boundRoot, parent);
    }
  }
  objects.forEach((value, i) => walk(value, [i], 0, false, null));
  result.observations = [...emitted.values()];
  result.recognized ||= result.observations.some(o => o.entity_type === 'COMMENT');
  result.unresolved_parents = result.observations.filter(o => o.entity_type === 'COMMENT' && !o.parent_id).length;
  return result;
}
