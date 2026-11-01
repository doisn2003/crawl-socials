import assert from 'node:assert/strict';
import test from 'node:test';
import { overlapNotes, run, selectSample } from '../scripts/benchmark/cross-topic-paired-v1.mjs';

const snapshot = (platform, id, text = 'Một trải nghiệm có nội dung cụ thể và đủ dài để kiểm tra nhóm bản sao trong bộ mẫu.', handle = 'writer') => ({
  id: `snapshot-${platform}-${id}`, platform, root_post_id: id, observed_at: '2026-10-30T00:00:00Z',
  post: { text, permalink: platform === 'threads' ? `https://www.threads.com/@${handle}/post/${id}` : `https://www.facebook.com/groups/group/posts/${id}` },
});
test('cross-topic selection is label-blind, deterministic and stratified independent of source order', () => {
  const population = ['facebook', 'threads'].flatMap(platform => Array.from({ length: 20 }, (_, i) => snapshot(platform, String(i))));
  const first = selectSample(population, 'piano', { facebook: 5, threads: 7 });
  const reversed = selectSample([...population].reverse(), 'piano', { facebook: 5, threads: 7 });
  assert.deepEqual(first, reversed);
  assert.equal(first.filter(row => row.platform === 'facebook').length, 5);
  assert.equal(first.filter(row => row.platform === 'threads').length, 7);
  assert.equal(first.find(row => row.platform === 'facebook').sampling.design_weight, 4);
  assert.equal(first.find(row => row.platform === 'threads').sampling.design_weight, 20 / 7);
  assert.ok(first.every(row => row.as_of === row.observed_at && !('classification' in row)));
});
test('duplicate roots and undersized frames fail instead of multiplying records to meet the quota', () => {
  const row = snapshot('facebook', '1');
  assert.throws(() => selectSample([row, row], 'piano', { facebook: 1, threads: 0 }), /DUPLICATE_ROOT_POPULATION/);
  assert.throws(() => selectSample([row], 'piano', { facebook: 2, threads: 0 }), /SOURCE_POPULATION_TOO_SMALL/);
});
test('copy/author diagnostics disclose overlap without silently changing the sample frame', () => {
  const rows = [snapshot('threads', '1'), snapshot('threads', '2'), snapshot('facebook', '3')];
  const notes = overlapNotes(rows, [rows[0]]);
  assert.equal(notes.missing_stable_author_identity, 1); // A group URL is not an author identity.
  assert.equal(notes.authors.population_groups, 1);
  assert.equal(notes.authors.selected_remainder_overlap_groups, 1);
  assert.equal(notes.exact_text.population_groups, 1);
  assert.equal(notes.exact_text.selected_remainder_overlap_groups, 1);
  assert.equal(rows.length, 3);
  const explicit = overlapNotes(rows, [rows[0]], new Map([['facebook:3', { author_url: 'https://www.facebook.com/profile.php?id=1234' }]]));
  assert.equal(explicit.missing_stable_author_identity, 0);
});
test('model phase cannot execute without its explicit developer execution flag', async () => {
  await assert.rejects(run({}), /EXPLICIT_EXECUTE_REQUIRED/);
});
