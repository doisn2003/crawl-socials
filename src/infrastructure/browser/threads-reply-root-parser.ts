import type { ConversationObservation } from '../../domain/conversation.js';
import { parseThreadsConversation } from './conversation-parser.js';

type Obj = Record<string, any>;
const object = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const native = (v: unknown): string | null => typeof v === 'string' && /^\d+$/.test(v) ? v : null;
const idOf = (v: Obj): string | null => {
  const pk = native(v.pk), id = typeof v.id === 'string' ? v.id.match(/^(\d+)(?:_\d+)?$/)?.[1] ?? null : null;
  return pk && id && pk !== id ? null : pk ?? id;
};
const permalink = (v: Obj): string | null => typeof v.user?.username === 'string' && /^[A-Za-z0-9._]+$/.test(v.user.username) &&
  typeof v.code === 'string' && /^[A-Za-z0-9_-]+$/.test(v.code) ? `https://www.threads.com/@${v.user.username}/post/${v.code}` : null;
const hasContent = (v: Obj) => Boolean(v.user && ('caption' in v || 'media_type' in v || 'image_versions2' in v));

export interface ThreadsReplyRootContext {
  candidateId: string;
  url: string;
  observedAt: string;
  runId: string;
  method: 'EMBEDDED_DOCUMENT_JSON' | 'BROWSER_RESPONSE';
  expectedRootId?: string;
}
export interface ThreadsReplyRootResult {
  status: 'RESOLVED' | 'UNRESOLVED';
  root: { id: string; url: string } | null;
  observations: ConversationObservation[];
  candidate_found: boolean;
  proof: 'EXPLICIT_ROOT_REFERENCE' | 'CONTAINING_THREAD_ROOT' | null;
  reason: string;
}

/** A reply permalink is never itself promoted to a root. Only native relationship evidence binds it. */
export function parseThreadsReplyRoot(objects: unknown[], context: ThreadsReplyRootContext): ThreadsReplyRootResult {
  const url = new URL(context.url), code = url.pathname.match(/^\/@[^/]+\/post\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  if (!native(context.candidateId) || !code || url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(url.hostname) ||
    !Number.isFinite(Date.parse(context.observedAt)) || !context.runId || (context.expectedRootId !== undefined && !native(context.expectedRootId))) throw Error('REPLY_ROOT_CONTEXT_INVALID');
  const result: ThreadsReplyRootResult = { status: 'UNRESOLVED', root: null, observations: [], candidate_found: false, proof: null, reason: 'CANDIDATE_NOT_FOUND' };
  type LocatedPost = { value: Obj; path: (string | number)[]; relationPath?: (string | number)[] };
  const targets: LocatedPost[] = [], media = new Map<string, LocatedPost>();
  let visited = 0, candidateCodeConflict = false;
  const seen = new WeakSet<object>();
  function envelope(value: unknown, path: (string | number)[], depth: number) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (++visited > 200000 || depth > 80) throw Error('REPLY_ROOT_PAYLOAD_LIMIT');
    seen.add(value);
    if (Array.isArray(value)) { value.forEach((child, index) => envelope(child, [...path, index], depth + 1)); return; }
    const v = object(value), p = object(v.data?.media), id = idOf(p);
    if (id) {
      if (hasContent(p)) media.set(id, { value: p, path: [...path, 'data', 'media'] });
      if (id === context.candidateId && p.code !== undefined && p.code !== null && p.code !== code) candidateCodeConflict = true;
      // Relay commonly sends caption/code and ancestry in separate media fragments.
      // A fragment without a code is usable only after another same-ID fragment anchors the permalink below.
      if (id === context.candidateId && (p.code === undefined || p.code === null || p.code === code)) targets.push({ value: p, path: [...path, 'data', 'media'] });
    }
    for (const key of ['require', '__bbox', 'result', 'data']) if (v[key] !== undefined) envelope(v[key], [...path, key], depth + 1);
  }
  objects.forEach((value, index) => envelope(value, [index], 0));
  if (!targets.some(({ value }) => value.code === code)) return result;
  result.candidate_found = true;
  const candidates = targets.filter(({ value }) => value.code === code && value.text_post_app_info?.is_reply === true && hasContent(value));
  if (!candidates.length) { result.reason = 'CANDIDATE_NOT_CONFIRMED_REPLY'; return result; }

  function observation(p: Obj, root: string | null, path: (string | number)[], kind: 'POST' | 'COMMENT' | 'CANDIDATE', parent: string | null = null): ConversationObservation {
    const mediaRefs: NonNullable<ConversationObservation['media']> = [];
    for (const [type, values] of [['IMAGE', p.image_versions2?.candidates], ['VIDEO', p.video_versions]] as const) {
      const first = Array.isArray(values) ? values.find(x => typeof x?.url === 'string' && x.url.startsWith('https://')) : null;
      if (first) mediaRefs.push({ type, url: first.url });
    }
    return { platform: 'threads', entity_type: kind, entity_id: idOf(p), root_post_id: root, parent_id: parent,
      text: typeof p.caption?.text === 'string' ? p.caption.text : '', observed_at: context.observedAt,
      ...(typeof p.taken_at === 'number' && p.taken_at > 0 && p.taken_at < 1e11 ? { published_at: new Date(p.taken_at * 1000).toISOString() } : {}),
      permalink: permalink(p), author: { id: native(p.user?.pk ?? p.user?.id), name: typeof p.user?.full_name === 'string' ? p.user.full_name : p.user?.username ?? null, role: 'UNKNOWN' },
      source: { kind: 'PROFILE' }, media: mediaRefs,
      provenance: { run_id: context.runId, method: context.method, url: context.url, locator: JSON.stringify({ path, binding: kind === 'CANDIDATE' ? 'UNRESOLVED_REPLY_PERMALINK' : result.proof }) } };
  }
  // Preserve observed reply content even when the page exposes no trustworthy ancestor.
  result.observations = candidates.map(({ value, path }) => observation(value, null, path, 'CANDIDATE'));
  if (candidateCodeConflict) { result.reason = 'CANDIDATE_IDENTITY_CONFLICT'; return result; }
  const proofs: Array<{ rootId: string; root: LocatedPost; nodes: LocatedPost[]; proof: NonNullable<ThreadsReplyRootResult['proof']> }> = [];
  let conflict = false;
  const explicitRootIds = new Set(targets.flatMap(({ value }) => {
    const info = object(value.text_post_app_info);
    return [native(info.root_post_id), idOf(object(info.root_post))].filter((id): id is string => id !== null);
  }));
  if (explicitRootIds.size > 1) conflict = true;
  const anchor = candidates.reduce((previous, item) => String(item.value.caption?.text ?? '').length > String(previous.value.caption?.text ?? '').length ? item : previous);
  for (const fragment of targets) {
    if (fragment.value.text_post_app_info?.is_reply === false) { conflict = true; continue; }
    const info = { ...object(anchor.value.text_post_app_info), ...object(fragment.value.text_post_app_info) };
    const candidate: LocatedPost = { value: { ...anchor.value, text_post_app_info: info }, path: anchor.path, relationPath: fragment.path };
    const explicitObject = object(info.root_post), explicitId = native(info.root_post_id) ?? idOf(explicitObject);
    if (native(info.root_post_id) && idOf(explicitObject) && native(info.root_post_id) !== idOf(explicitObject)) { conflict = true; continue; }
    const edges = info.containing_thread?.posts?.edges;
    const ancestors = Array.isArray(edges) ? edges.map((edge, i) => ({ value: object(edge?.node), path: [...fragment.path, 'text_post_app_info', 'containing_thread', 'posts', 'edges', i, 'node'] })) : [];
    const roots = ancestors.filter(({ value }) => idOf(value) && value.text_post_app_info?.is_reply === false);
    const rootIds = new Set(roots.map(({ value }) => idOf(value)!));
    if (rootIds.size > 1 || (explicitId && rootIds.size && !rootIds.has(explicitId))) { conflict = true; continue; }
    const rootId = explicitId ?? [...rootIds][0];
    if (!rootId || rootId === context.candidateId) continue;
    if (context.expectedRootId && context.expectedRootId !== rootId) { conflict = true; continue; }
    const root = roots.find(({ value }) => idOf(value) === rootId) ?? (idOf(explicitObject) === rootId && hasContent(explicitObject)
      ? { value: explicitObject, path: [...fragment.path, 'text_post_app_info', 'root_post'] } : media.get(rootId));
    // Even an explicit identity reference needs actual root content/permalink and a non-reply marker.
    if (!root || root.value.text_post_app_info?.is_reply !== false || !hasContent(root.value) || !permalink(root.value)) continue;
    proofs.push({ rootId, root, nodes: [candidate, ...ancestors.filter(({ value }) => hasContent(value) && idOf(value))], proof: explicitId ? 'EXPLICIT_ROOT_REFERENCE' : 'CONTAINING_THREAD_ROOT' });
  }
  if (conflict || new Set(proofs.map(p => p.rootId)).size > 1 || new Set(proofs.map(p => `${p.rootId}:${p.root.value.code}`)).size > 1) { result.reason = 'ROOT_IDENTITY_CONFLICT'; return result; }
  const proof = proofs[0];
  if (!proof) { result.reason = 'ROOT_RELATIONSHIP_UNPROVEN'; return result; }
  result.status = 'RESOLVED'; result.reason = 'ROOT_RELATIONSHIP_PROVEN'; result.proof = proof.proof;
  result.root = { id: proof.rootId, url: permalink(proof.root.value)! };
  const resolved = new Map<string, ConversationObservation>();
  const knownIds = new Set<string>([proof.rootId, ...proofs.flatMap(p => p.nodes.map(n => idOf(n.value)!))]);
  for (const item of proofs) {
    resolved.set(proof.rootId, observation(item.root.value, proof.rootId, item.root.path, 'POST'));
    for (const node of item.nodes) {
      const id = idOf(node.value)!;
      if (id === proof.rootId) continue;
      const info = object(node.value.text_post_app_info);
      if (info.is_reply !== true) continue;
      const explicitParent = native(info.reply_to_post_id) ?? idOf(object(info.reply_to_post)) ?? idOf(object(info.replied_to));
      const level = Number.isSafeInteger(info.reply_level) ? info.reply_level : null;
      const replyTo = native(info.reply_to_author?.pk ?? info.reply_to_author?.id);
      const parentCandidates = level !== null && level > 0 && replyTo ? [item.root, ...item.nodes].filter(other => {
        const otherInfo = object(other.value.text_post_app_info);
        return idOf(other.value) !== id && otherInfo.reply_level === level - 1 && native(other.value.user?.pk ?? other.value.user?.id) === replyTo;
      }) : [];
      const parentIds = new Set(parentCandidates.map(other => idOf(other.value)).filter((value): value is string => value !== null));
      const parent = explicitParent && knownIds.has(explicitParent) && explicitParent !== id ? explicitParent : parentIds.size === 1 ? [...parentIds][0]! : null;
      const next = observation(node.value, proof.rootId, node.path, 'COMMENT', parent), previous = resolved.get(id);
      if (node.relationPath) next.provenance.locator = JSON.stringify({ content_path: node.path, relationship_path: node.relationPath, binding: result.proof,
        parent_binding: explicitParent && parent === explicitParent ? 'NATIVE_PARENT_ID' : parent ? 'THREAD_REPLY_LEVEL_AND_AUTHOR' : 'UNRESOLVED_PARENT' });
      if (!previous || next.text.length > previous.text.length || (!previous.parent_id && parent)) resolved.set(id, next);
    }
  }
  // Once root membership is proven, reuse the existing strict connection parser for direct replies.
  const parsed = parseThreadsConversation(objects, { rootId: proof.rootId, url: result.root.url, observedAt: context.observedAt, runId: context.runId, method: context.method, knownIds });
  for (const next of parsed.observations) {
    const previous = resolved.get(next.entity_id!);
    if (!previous || next.text.length > previous.text.length || (!previous.parent_id && next.parent_id)) resolved.set(next.entity_id!, next);
  }
  result.observations = [...resolved.values()];
  return result;
}
