import { contentHash, type ConversationSnapshot } from './conversation.js';

export const POST_ONLY_EVIDENCE_SCOPE = 'POST_ONLY_V1';

/** Keep stored snapshot/span identities for decisions without letting historical comments affect judgment. */
export function postOnlyEvidenceView(snapshot: ConversationSnapshot): ConversationSnapshot {
  const post = snapshot.post;
  return { ...snapshot, comments: [], coverage: { status: 'NOT_ATTEMPTED', observed_count: 0 },
    spans: post ? snapshot.spans.filter(s => s.entity_type === 'POST' && s.entity_id === post.entity_id) : [],
    content_hash: contentHash({ scope: POST_ONLY_EVIDENCE_SCOPE, platform: snapshot.platform,
      root: snapshot.root_post_id, text: post?.text ?? null, published_at: post?.published_at ?? null }) };
}

/** Wire indexes bind to the view's original spans. Counters, comments, capture times and profiles are absent. */
export function postEvidenceDocument(snapshot: ConversationSnapshot) {
  const view = postOnlyEvidenceView(snapshot);
  return { evidence_scope: POST_ONLY_EVIDENCE_SCOPE, published_at: view.post?.published_at ?? null,
    spans: view.spans.map((s, e) => ({ e, text: s.text })) };
}
