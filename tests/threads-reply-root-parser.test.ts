import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThreadsReplyRoot } from '../src/infrastructure/browser/threads-reply-root-parser.js';

const ctx = { candidateId: '102', url: 'https://www.threads.com/@reply/post/Reply', runId: 'synthetic-resolver', observedAt: '2026-10-30T08:00:00Z', method: 'EMBEDDED_DOCUMENT_JSON' as const };
const post = (id: string, code: string, isReply: boolean, text = 'Synthetic text') => ({ pk: id, id: `${id}_9`, code, user: { pk: '9', username: 'synthetic' }, caption: { text }, text_post_app_info: { is_reply: isReply } });
const root = post('100', 'Root', false);
const reply = post('102', 'Reply', true);
const target = (info: Record<string, unknown>, p = reply) => ({ require: [{ __bbox: { result: { data: { media: { ...p, text_post_app_info: { ...p.text_post_app_info, ...info } } } } } }] });
const ancestors = (nodes: unknown[]) => ({ posts: { edges: nodes.map(node => ({ node })) } });

test('Reply containing-thread root is proven without treating reply permalink as root or inventing parent', () => {
  const result = parseThreadsReplyRoot([target({ containing_thread: ancestors([root]) })], ctx);
  assert.equal(result.status, 'RESOLVED'); assert.equal(result.root?.id, '100'); assert.equal(result.root?.url, 'https://www.threads.com/@synthetic/post/Root');
  assert.equal(result.proof, 'CONTAINING_THREAD_ROOT');
  assert.deepEqual(result.observations.map(o => [o.entity_type, o.entity_id, o.root_post_id, o.parent_id]), [['POST', '100', '100', null], ['COMMENT', '102', '100', null]]);
});

test('Explicit native root reference binds a separately observed root response and nested chain', () => {
  const parent = { ...post('101', 'Parent', true), text_post_app_info: { is_reply: true, reply_to_post_id: '100' } };
  const result = parseThreadsReplyRoot([target({ root_post_id: '100', reply_to_post_id: '101', containing_thread: ancestors([parent]) }), { data: { media: root } }], ctx);
  assert.equal(result.status, 'RESOLVED'); assert.equal(result.proof, 'EXPLICIT_ROOT_REFERENCE');
  assert.equal(result.observations.find(o => o.entity_id === '102')?.parent_id, '101');
  assert.equal(result.observations.find(o => o.entity_id === '101')?.parent_id, '100');
});

test('Unresolved reply remains a raw candidate and unrelated visible roots cannot supply identity', () => {
  const unrelated = { data: { media: root } };
  for (const objects of [[target({})], [target({}), unrelated], [target({ reply_to_author: { id: '9' }, reply_level: 1 }), unrelated]]) {
    const result = parseThreadsReplyRoot(objects, ctx);
    assert.equal(result.status, 'UNRESOLVED'); assert.equal(result.root, null);
    assert.equal(result.observations.length, 1); assert.equal(result.observations[0]?.entity_type, 'CANDIDATE'); assert.equal(result.observations[0]?.root_post_id, null);
  }
});

test('Native root identity conflicts, ambiguous roots and expected-root mismatch cannot resolve', () => {
  const other = post('900', 'Other', false);
  for (const objects of [
    [target({ root_post_id: '900', containing_thread: ancestors([root]) })],
    [target({ root_post_id: '100', root_post: other })],
    [target({ containing_thread: ancestors([root, other]) })],
    [target({ containing_thread: ancestors([root]) }), target({ containing_thread: ancestors([other]) })],
  ]) {
    const result = parseThreadsReplyRoot(objects, ctx);
    assert.equal(result.status, 'UNRESOLVED'); assert.equal(result.reason, 'ROOT_IDENTITY_CONFLICT'); assert.ok(result.observations.every(o => o.entity_type === 'CANDIDATE'));
  }
  assert.equal(parseThreadsReplyRoot([target({ containing_thread: ancestors([root]) })], { ...ctx, expectedRootId: '900' }).reason, 'ROOT_IDENTITY_CONFLICT');
});

test('Reply root requires actual content/permalink, explicit non-reply marker and bound target identity', () => {
  for (const invalid of [
    { pk: '100', text_post_app_info: { is_reply: false } },
    { ...root, code: null },
    { ...root, text_post_app_info: {} },
    { ...root, text_post_app_info: { is_reply: true } },
    { ...root, id: '999_9' },
  ]) assert.equal(parseThreadsReplyRoot([target({ root_post: invalid })], ctx).status, 'UNRESOLVED');
  assert.equal(parseThreadsReplyRoot([target({ containing_thread: ancestors([root]) }, { ...reply, code: 'Different' })], ctx).candidate_found, false);
  assert.equal(parseThreadsReplyRoot([{ recommendations: target({ containing_thread: ancestors([root]) }) }], ctx).candidate_found, false);
  assert.throws(() => parseThreadsReplyRoot([], { ...ctx, url: 'https://threads.com.evil.example/@reply/post/Reply' }), /CONTEXT_INVALID/);
});

test('Resolved reply retains media-only actual root and all already observed children', () => {
  const mediaOnly = { ...root, caption: { text: '' }, image_versions2: { candidates: [{ url: 'https://cdn.example/image.jpg' }] } };
  const child = post('103', 'Child', true);
  const result = parseThreadsReplyRoot([target({ containing_thread: ancestors([mediaOnly]), direct_replies: { edges: [{ node: { posts: { edges: [{ node: child }], page_info: { has_next_page: false } } } }], page_info: { has_next_page: false } } })], ctx);
  assert.equal(result.status, 'RESOLVED'); assert.equal(result.observations.find(o => o.entity_type === 'POST')?.text, '');
  assert.equal(result.observations.find(o => o.entity_type === 'POST')?.media?.length, 1);
  assert.equal(result.observations.find(o => o.entity_id === '103')?.parent_id, '102');
});

test('Real Relay shape joins ID-bound caption and ancestry fragments while preserving each source path', () => {
  const head = { ...root, user: { pk: '10', username: 'synthetic' }, text_post_app_info: { is_reply: false, reply_level: 0 } };
  const caption = target({ reply_to_author: { id: '10' } });
  const ancestry = { data: { media: { pk: '102', id: '102_9', user: { pk: '9' }, text_post_app_info: { is_reply: true, reply_level: 1, containing_thread: ancestors([head]) } } } };
  for (const objects of [[caption, ancestry], [ancestry, caption]]) {
    const result = parseThreadsReplyRoot(objects, ctx);
    assert.equal(result.status, 'RESOLVED'); assert.equal(result.root?.id, '100');
    const child = result.observations.find(o => o.entity_id === '102')!;
    assert.equal(child.text, 'Synthetic text'); assert.equal(child.parent_id, '100');
    const locator = JSON.parse(child.provenance.locator!);
    assert.notDeepEqual(locator.content_path, locator.relationship_path); assert.equal(locator.parent_binding, 'THREAD_REPLY_LEVEL_AND_AUTHOR');
  }
  assert.equal(parseThreadsReplyRoot([ancestry], ctx).status, 'UNRESOLVED'); // No ID+shortcode anchor.
  assert.equal(parseThreadsReplyRoot([caption, { data: { media: { ...ancestry.data.media, pk: '999', id: '999_9' } } }], ctx).status, 'UNRESOLVED');
});

test('Fragment joins reject same native identity with conflicting shortcode or root reference', () => {
  const ancestry = { data: { media: { pk: '102', text_post_app_info: { is_reply: true, containing_thread: ancestors([root]) } } } };
  assert.equal(parseThreadsReplyRoot([target({}), ancestry, { data: { media: { pk: '102', code: 'Other' } } }], ctx).reason, 'CANDIDATE_IDENTITY_CONFLICT');
  const result = parseThreadsReplyRoot([target({ root_post_id: '100' }), ancestry, { data: { media: { pk: '102', text_post_app_info: { root_post_id: '900' } } } }], ctx);
  assert.equal(result.reason, 'ROOT_IDENTITY_CONFLICT'); assert.equal(result.status, 'UNRESOLVED');
});
