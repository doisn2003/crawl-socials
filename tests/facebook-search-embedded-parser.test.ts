import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFacebookEmbeddedSearch } from '../src/infrastructure/browser/facebook-search-embedded-parser.js';
// Structure transcribed from the observed 2026-10-28 document; all identities/text are synthetic.
// Passing these checks is not LIVE evidence.
const context = { query: 'cafe Hà Nội', collectedAt: '2026-10-28T03:15:00Z', documentUrl: 'https://www.facebook.com/search/top?q=cafe%20H%C3%A0%20N%E1%BB%99i' };
function story(id = '9007199254740993123', group = false) {
  const url = group ? `https://www.facebook.com/groups/synthetic/posts/${id}/` : `https://www.facebook.com/synthetic/posts/${id}/`;
  const feedback = { adaptive_ufi_action_renderers: [
    { feedback: { reaction_count: { count: 53 } } },
    { __typename: 'UFICommentActionRenderer', feedback: { comment_rendering_instance: { comments: { total_count: 2 } } } },
    { feedback: { share_count: { count: 0 } } },
  ], top_reactions: { edges: [{ node: { localized_name: 'Yêu thích' }, reaction_count: 6 }] } };
  return { __typename: 'Story', id: 'opaque-' + id, post_id: id, permalink_url: url, creation_time: 1792898761,
    actors: [{ id: 'author-1', __typename: 'User', name: 'Synthetic cafe' }],
    feedback: { associated_group: group ? { id: 'group-1' } : null }, comet_sections: {
      content: { story: { id: 'opaque-' + id, post_id: id, permalink_url: url, message: { text: 'Quán cafe kiểm thử, địa chỉ tổng hợp.' } } },
      context_layout: { story: { comet_sections: {
        title: { story: { to: group ? { __typename: 'Group', id: 'group-1', name: 'Synthetic group' } : null,
          comet_sections: { follow_button: { story: { tracking: JSON.stringify({ page_insights: { 'author-1': {
            page_id_type: 'page', actor_id: 'author-1', post_context: { story_fbid: [id] },
          } } }) } } } } },
        metadata: [{ story: { privacy_scope: { icon_image: { name: 'everyone' }, description: group ? 'Nhóm công khai' : 'Công khai' } } }],
      } } },
      feedback: { story: { story_ufi_container: { story: { feedback_context: { feedback_target_with_context: {
        comet_ufi_summary_and_actions_renderer: { feedback },
      } } } } } },
    } };
}
const edge = (s: unknown, type = 'SearchRichPostRenderingStrategy') => ({ rendering_strategy: { __typename: type, view_model: { click_model: { story: s } } } });
const envelope = (edges: unknown[]) => [{ require: [['loader', [], null, [{ __bbox: { require: [['query', [], null, [null, { __bbox: { result: {
  data: { serpResponse: { results: { edges, page_info: { has_next_page: true, end_cursor: 'secret-cursor-not-exported' } } } },
} } }]]] } }]]] }];
test('observed envelope yields bound post metadata, long string identity, exact zero, love distinct from total', () => {
  const result = parseFacebookEmbeddedSearch(envelope([edge(story())]), context);
  const r = result.records[0]!; assert.equal(result.records.length, 1); assert.equal(r.post_id, '9007199254740993123');
  assert.equal(r.reactions_total, 53); assert.equal(r.love_count, 6); assert.equal(r.shares_count, 0); assert.equal(r.comments_count, 2);
  assert.equal(r.source_type, 'PAGE'); assert.equal(r.visibility, 'PUBLIC'); assert.equal(r.relevance, 'UNVERIFIED');
  assert.equal(result.has_next_page, true); assert.equal(JSON.stringify(result).includes('secret-cursor'), false);
  assert.equal(JSON.stringify(result).includes('page_insights'), true); // evidence code, not tracking payload
  assert.equal(JSON.stringify(result).includes('author-1'), false);
});
test('group publication wins over Page author evidence; ads/unrelated ids are not silently treated as posts', () => {
  const result = parseFacebookEmbeddedSearch([...envelope([edge(story('12345678901', true)), edge(story(), 'SearchResultsAdRenderingStrategy')]),
    { unrelated: { data: { serpResponse: { results: { edges: [edge(story('123'))] } } } } }], context);
  assert.equal(result.records.length, 1); assert.equal(result.records[0]!.source_type, 'GROUP');
  assert.equal(result.skipped[0]!.reason, 'UNSUPPORTED_RENDERING_STRATEGY');
});
test('missing metadata stays null; missing Page evidence does not become personal profile', () => {
  const s = story(); delete (s as { creation_time?: number }).creation_time;
  s.comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback.adaptive_ufi_action_renderers = [];
  s.comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback.top_reactions.edges = [];
  s.comet_sections.context_layout.story.comet_sections.title.story.comet_sections.follow_button.story.tracking = '{}';
  s.comet_sections.context_layout.story.comet_sections.metadata = [];
  const r = parseFacebookEmbeddedSearch(envelope([edge(s)]), context).records[0]!;
  for (const field of ['published_at', 'reactions_total', 'love_count', 'comments_count', 'shares_count'] as const) { assert.equal(r[field], null); assert.ok(r.missing_reasons[field]); }
  assert.equal(r.source_type, 'UNKNOWN'); assert.equal(r.visibility, 'UNKNOWN');
});
test('a text-bearing nested story cannot contaminate another post, URL numeric group identity must match', () => {
  const s = story(); s.comet_sections.content.story.post_id = 'wrong-id';
  const g = story('123456', true); g.permalink_url = 'https://www.facebook.com/groups/synthetic/posts/999999/';
  const p = story('123456'); p.permalink_url = 'https://www.facebook.com/synthetic/posts/999999/';
  const result = parseFacebookEmbeddedSearch(envelope([edge(s), edge(g), edge(p)]), context);
  assert.equal(result.records.length, 0); assert.deepEqual(result.skipped.map(s => s.reason), ['STORY_TEXT_IDENTITY_MISMATCH', 'POST_URL_INVALID', 'POST_URL_INVALID']);
});
test('duplicate observations do not increase identities and source envelopes are bounded', () => {
  const result = parseFacebookEmbeddedSearch(envelope([edge(story()), edge(story())]), context);
  assert.equal(result.records.length, 1); assert.equal(result.skipped[0]!.reason, 'DUPLICATE_OBSERVATION');
  assert.throws(() => parseFacebookEmbeddedSearch(new Array(201).fill({}), context), /BLOCK_LIMIT/);
  assert.throws(() => parseFacebookEmbeddedSearch(envelope([]), { ...context, query: 'different' }), /CONTEXT_INVALID/);
});
test('observed permalink.php and custom public icon preserve a real-link candidate', () => {
  const s=story();const url='https://www.facebook.com/permalink.php?story_fbid=pfbidSyntheticObserved&id=123456';
  s.permalink_url=url;s.comet_sections.content.story.permalink_url=url;
  s.comet_sections.context_layout.story.comet_sections.metadata[0]!.story.privacy_scope.icon_image.name='custom';
  const r=parseFacebookEmbeddedSearch(envelope([edge(s)]),context).records[0]!;
  assert.equal(r.observed_post_url,url);assert.equal(r.visibility,'PUBLIC');
});
