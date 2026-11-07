import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThreadsConversation, parseFacebookConversation } from '../src/infrastructure/browser/conversation-parser.js';
import { parseThreadsSearch } from '../src/infrastructure/browser/threads-search-parser.js';
import { parseFacebookEmbeddedSearch } from '../src/infrastructure/browser/facebook-search-embedded-parser.js';

const ctx = { rootId: '100', url: 'https://www.threads.com/@synthetic/post/Root', observedAt: '2026-10-30T08:00:00Z', runId: 'synthetic-probe', method: 'BROWSER_RESPONSE' as const };
const post = (id: string, text: string, reply = false) => ({ pk: id, id: `${id}_99`, code: `Code${id}`, user: { pk: '99', username: 'synthetic', full_name: 'Synthetic' }, caption: { text }, taken_at: 1793340000, text_post_app_info: { is_reply: reply, direct_reply_count: 2 } });
const connection = (posts: unknown[], hasMore = false) => ({ edges: [{ node: { posts: { edges: posts.map(node => ({ node })), page_info: { has_next_page: hasMore } } } }], page_info: { has_next_page: hasMore, end_cursor: hasMore ? 'opaque' : null } });

test('Threads binds root/direct replies and preserves unresolved nested parent without fabricating a relationship', () => {
  const root = { ...post('100', 'Check-in'), text_post_app_info: { direct_reply_count: 3, direct_replies: connection([{ ...post('101', 'Is it quiet?', true), like_count: 8 }, post('102', 'Yes.', true)], true) } };
  const result = parseThreadsConversation([{ require: [[{ __bbox: { result: { data: { media: root } } } }]] }], ctx);
  assert.equal(result.recognized, true); assert.equal(result.root_found, true); assert.equal(result.has_more, true);
  assert.equal(result.observations.length, 3);
  assert.equal(result.observations.find(o => o.entity_id === '101')?.parent_id, '100');
  assert.equal(result.observations.find(o => o.entity_id === '102')?.parent_id, null);
  assert.equal(result.unresolved_parents, 1);
  assert.equal(result.observations.find(o => o.entity_id === '101')?.like_count, 8);
});

test('Threads rejects unrelated media/recommendations and supports a known comment inline expansion', () => {
  const unrelated = { data: { media: { ...post('900', 'Not the target'), text_post_app_info: { direct_replies: connection([post('901', 'Wrong', true)]) } } } };
  assert.equal(parseThreadsConversation([unrelated], ctx).observations.length, 0);
  const expansion = { data: { media: { id: '101_99', text_post_app_info: { inline_expansion: connection([{ ...post('103', 'Follow-up', true), text_post_app_info: { is_reply: true, reply_to_post_id: '101' } }]) } } } };
  const parsed = parseThreadsConversation([expansion], { ...ctx, knownIds: new Set(['100', '101']) });
  assert.equal(parsed.observations[0]?.root_post_id, '100'); assert.equal(parsed.observations[0]?.parent_id, '101');
  assert.equal(parsed.observations[0]?.text, 'Follow-up');
});

test('Threads nested parent uses observed reply level AND author agreement, without crossing sibling branches', () => {
  const rootReply = { ...post('101', 'Question', true), user: { id: '11', username: 'one' }, text_post_app_info: { is_reply: true, reply_level: 1, reply_to_author: { id: '99' } } };
  const nested = { ...post('102', 'Answer', true), user: { id: '22', username: 'two' }, text_post_app_info: { is_reply: true, reply_level: 2, reply_to_author: { id: '11' } } };
  const sibling = { ...post('103', 'Sibling answer', true), user: { id: '33', username: 'three' }, text_post_app_info: { is_reply: true, reply_level: 2, reply_to_author: { id: '11' } } };
  const conflict = { ...post('104', 'Unknown parent', true), text_post_app_info: { is_reply: true, reply_level: 3, reply_to_author: { id: '88' } } };
  const root = { ...post('100', 'Root'), text_post_app_info: { direct_replies: connection([rootReply, nested, sibling, conflict]) } };
  const result = parseThreadsConversation([{ data: { media: root } }], ctx);
  assert.equal(result.observations.find(o => o.entity_id === '102')?.parent_id, '101');
  assert.equal(result.observations.find(o => o.entity_id === '103')?.parent_id, '101');
  assert.equal(result.observations.find(o => o.entity_id === '104')?.parent_id, null);
  assert.match(result.observations.find(o => o.entity_id === '102')!.provenance.locator!, /THREAD_REPLY_LEVEL_AND_AUTHOR/);
});

test('Threads retains media-only posts and identity-only fragments cannot erase content', () => {
  const p = { ...post('100', ''), image_versions2: { candidates: [{ url: 'https://cdn.example/image.jpg' }] } };
  const result = parseThreadsConversation([{ data: { media: p } }, { data: { media: { pk: '100', user: { username: 'synthetic' }, text_post_app_info: {} } } }], ctx);
  assert.equal(result.observations.length, 1); assert.equal(result.observations[0]?.media?.length, 1);
  assert.equal(result.recognized, false); // A post without a comment connection is not observed-empty.
});

const fbContext = { ...ctx, url: 'https://www.facebook.com/groups/synthetic/posts/100/' };
const commentId = (root: string, id: string) => Buffer.from(`comment:${root}_${id}`).toString('base64');
const comment = (id: string, text: string, root = '100') => ({ __typename: 'Comment', id: commentId(root, id), legacy_fbid: id, depth: 0, body: { text }, author: { id: '99', name: 'Synthetic' }, created_time: 1793340000, feedback: { url: `https://www.facebook.com/groups/synthetic/posts/${root}/?comment_id=${id}` } });
test('Facebook uses root-bound comment identity, preserves text and explicit parent relationships', () => {
  const reply = comment('102', 'Reply');
  const child = { ...reply, depth: 1, comment_direct_parent: { id: commentId('100', '101') },
    feedback: { ...reply.feedback, top_reactions: { edges: [
      { node: { localized_name: 'Yêu thích' }, reaction_count: 50 }, { node: { localized_name: 'Thích' }, reaction_count: 9 },
    ] } } };
  const p = { data: { node_v2: { __typename: 'Story', post_id: '100', id: 'story100', message: { text: 'Root' }, comments: { edges: [{ node: comment('101', 'Question') }, { node: child }], total_count: 2, page_info: { has_next_page: false } } } } };
  const result = parseFacebookConversation([p, { other: comment('999', 'Wrong root', '900') }], fbContext);
  assert.equal(result.recognized, true); assert.equal(result.observations.length, 3);
  assert.equal(result.observations.find(o => o.entity_id === '102')?.parent_id, '101');
  assert.equal(result.observations.find(o => o.entity_id === '101')?.parent_id, '100');
  assert.equal(result.has_more, false); assert.equal(result.advertised_count, 2);
  assert.equal(result.observations.find(o => o.entity_id === '102')?.like_count, 9);
});

test('Facebook partial parent objects never overwrite full comment text or borrow attached story text', () => {
  const c = { ...comment('101', 'Question'), parent_object_ent: { __typename: 'Comment', id: commentId('100', '101') }, attached_story: { message: { text: 'Injected borrowed content' } } };
  const result = parseFacebookConversation([{ data: { comments: { edges: [{ node: c }], page_info: { has_next_page: true } } } }], fbContext);
  assert.equal(result.observations.length, 1); assert.equal(result.observations[0]?.text, 'Question');
  assert.equal(result.has_more, true);
});

test('Unbound/foreign comments and malformed context remain unsupported rather than empty', () => {
  const result = parseFacebookConversation([{ __typename: 'Comment', id: '777', body: { text: 'Unbound' } }], fbContext);
  assert.equal(result.recognized, false); assert.equal(result.observations.length, 0);
  assert.throws(() => parseFacebookConversation([], { ...fbContext, url: 'https://facebook.com.evil.test/posts/100' }), /CONTEXT_INVALID/);
  assert.throws(() => parseThreadsConversation([], { ...ctx, rootId: 'unsafe' }), /CONTEXT_INVALID/);
  const conflict = { ...comment('101', 'Inconsistent identity'), legacy_fbid: '999' };
  assert.equal(parseFacebookConversation([{ data: { comment: conflict } }], fbContext).observations.length, 0);
});

test('Conversation-mode discovery keeps Threads replies and media-only identities while legacy mode stays compatible', () => {
  const reply = post('101', 'A reply', true), empty = post('100', '');
  const objects = [{ data: { searchResults: { edges: [reply, empty].map(p => ({ node: { thread: { thread_items: [{ post: p }] } } })), page_info: { has_next_page: false } } } }];
  const search = { query: 'cafe', mode: 'top' as const, collectedAt: ctx.observedAt, method: ctx.method };
  assert.equal(parseThreadsSearch(objects, search).records.length, 0);
  const result = parseThreadsSearch(objects, { ...search, includeContextCandidates: true });
  assert.equal(result.records.length, 2); assert.equal(result.records[0]?.entity_type, 'COMMENT');
  assert.equal(result.records[0]?.root_post_id, null); assert.equal(result.records[1]?.needs_context, true);
});

test('Threads search stays expandable when any observed search connection has another page', () => {
  const page = (id: string, hasNext?: boolean) => ({ data: { searchResults: {
    edges: [{ node: { thread: { thread_items: [{ post: post(id, 'Synthetic discussion') }] } } }],
    page_info: hasNext === undefined ? {} : { has_next_page: hasNext },
  } } });
  const search = { query: 'cafe', mode: 'top' as const, collectedAt: ctx.observedAt, method: ctx.method };
  for (const objects of [[page('100', true), page('101', false)], [page('100', false), page('101', true)]]) {
    const result = parseThreadsSearch(objects, search);
    assert.equal(result.connections, 2); assert.equal(result.records.length, 2); assert.equal(result.has_next_page, true);
  }
  assert.equal(parseThreadsSearch([page('100', false), page('101', false)], search).has_next_page, false);
  assert.equal(parseThreadsSearch([page('100'), page('101')], search).has_next_page, null);
});

test('Conversation-mode Facebook discovery preserves empty-text root without borrowing a share caption', () => {
  const story = { __typename: 'Story', id: 'opaque100', post_id: '100', permalink_url: 'https://www.facebook.com/synthetic/posts/100/', comet_sections: { content: { story: { id: 'opaque100', post_id: '100', attached_story: { message: { text: 'Do not borrow' } } } } } };
  const objects = [{ require: [{ __bbox: { result: { data: { serpResponse: { results: { edges: [{ rendering_strategy: { __typename: 'SearchRichPostRenderingStrategy', view_model: { click_model: { story } } } }] } } } } } }] }];
  const search = { query: 'cafe', collectedAt: ctx.observedAt, documentUrl: 'https://www.facebook.com/search/top?q=cafe' };
  assert.equal(parseFacebookEmbeddedSearch(objects, search).records.length, 0);
  const result = parseFacebookEmbeddedSearch(objects, { ...search, includeContextCandidates: true });
  assert.equal(result.records.length, 1); assert.equal(result.records[0]?.text, ''); assert.equal(result.records[0]?.needs_context, true);
});
