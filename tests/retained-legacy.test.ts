import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CollectedPost } from '../src/infrastructure/browser/facebook-collector-store.js';
import type { CollectedThreadsPost } from '../src/infrastructure/browser/threads-collector-store.js';
import type { EvaluationContext } from '../src/domain/conversation.js';
import { createConversationStore, type ConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { freezeRetainedSource, readRetainedObservations, verifyRetainedSource, type RetainedObservation } from '../src/infrastructure/storage/retained-observation-reader.js';
import { importRetainedData, prepareRetainedImport, readRetainedImport } from '../src/application/retained-data-service.js';
import { discardCompletedRunWork } from '../src/infrastructure/projects/compact-project.js';

const SOURCE = 'crawl-11111111-1111-1111-1111-111111111111', TARGET = 'crawl-22222222-2222-2222-2222-222222222222';
const at = '2026-01-01T00:00:00.000Z', published = '2025-12-31T12:00:00.000Z';
const context: EvaluationContext = { campaign_id: TARGET, campaign_version: 'new-criteria-v1', filter_version: 'new-policy' };
const capture = { run_id: SOURCE, batch_id: 'native-batch-1', query_index: 0, scroll_index: 2,
  method: 'BROWSER_RESPONSE' as const, response_sha256: 'a'.repeat(64), operation: 'native-search', transport_request_id: 'native-request-1' };
const facebook = (id = '10', changes: Partial<CollectedPost> = {}): CollectedPost => ({ post_id: id,
  observed_post_url: `https://www.facebook.com/example/posts/${id}`, text: 'A first-hand hotel review.', source_type: 'GROUP', source_name: 'Travel discussion',
  source_evidence: 'same_story_associated_group_and_title_destination', visibility: 'PUBLIC', source_url: 'https://www.facebook.com/groups/synthetic',
  author_name: 'Synthetic author', author_url: 'https://www.facebook.com/synthetic', visibility_evidence: [{ description: 'Public', icon: 'public' }],
  published_at: published, published_at_raw: Date.parse(published) / 1000, reactions_total: 4, love_count: 1, comments_count: 23, shares_count: null,
  query: 'hotel review', collected_at: at, extraction_method: 'EMBEDDED_DOCUMENT_JSON', text_completeness: 'UNKNOWN', relevance: 'UNVERIFIED',
  evidence_ref: { document_url: 'https://www.facebook.com/search/top?q=hotel%20review', json_path: ['data', 'edges', 0] }, missing_reasons: {},
  source_signals: { actor_typename: 'User', page_id_type: null, actor_post_match: false }, first_observation: capture, ...changes });
const threads = (id = '20', changes: Partial<CollectedThreadsPost> = {}): CollectedThreadsPost => ({ platform: 'threads', post_id: id,
  shortcode: `Code${id}`, post_url: `https://www.threads.com/@synthetic/post/Code${id}`, text: 'Which hotel is quiet?', author_username: 'synthetic',
  author_name: null, published_at: published, likes: 0, replies: 12, reposts: null, quotes: null, shares: null,
  query: 'quiet hotel', search_mode: 'recent', collected_at: at, visibility: 'PUBLIC_PROFILE', relevance: 'NOT_EVALUATED',
  text_completeness: 'UNKNOWN', extraction_method: 'BROWSER_RESPONSE', first_observation: { run_id: SOURCE, batch_id: 'threads-batch-1',
    query_index: 1, scroll_index: 0, method: 'BROWSER_RESPONSE', response_sha256: 'b'.repeat(64), operation: null, request_id: 'native-threads-1' }, ...changes });
const lines = (rows: unknown[]) => rows.map(row => JSON.stringify(row) + '\n').join('');
function fixture(facebookRows: CollectedPost[] = [facebook()], threadsRows: CollectedThreadsPost[] = [threads()]) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-retained-legacy-')), source = join(directory, 'collections', SOURCE), target = join(directory, 'collections', TARGET);
  mkdirSync(join(source, 'facebook'), { recursive: true }); mkdirSync(join(source, 'threads'), { recursive: true }); mkdirSync(join(target, 'opportunity', 'store'), { recursive: true });
  const fb = join(source, 'facebook', 'posts.jsonl'), th = join(source, 'threads', 'posts.jsonl');
  writeFileSync(fb, lines(facebookRows)); writeFileSync(th, lines(threadsRows));
  return { directory, source, target, fb, th, fbBytes: readFileSync(fb), thBytes: readFileSync(th) };
}
const port = (store: ConversationStore) => ({ ingestImported: async (...args: Parameters<ConversationStore['ingestImported']>) => store.ingestImported(...args) });
const freeze = (directory: string, maxRoots = 10) => freezeRetainedSource({ dataDirectory: directory, sourceRunId: SOURCE, targetRunId: TARGET, maxRoots });
const prepare = (directory: string, maxRoots = 10) => prepareRetainedImport({ dataDirectory: directory, sourceRunId: SOURCE, targetRunId: TARGET, targetContext: context, maxRoots });
async function observations(directory: string, manifest: Awaited<ReturnType<typeof freeze>>) {
  const rows: RetainedObservation[] = []; for await (const row of readRetainedObservations({ dataDirectory: directory, manifest })) rows.push(row); return rows;
}

test('a finished run can be filtered from saved JSON after its working journals are released', async () => {
  const f = fixture();
  try {
    const resultFile = join(f.source, 'results.json');
    writeFileSync(resultFile, JSON.stringify({ facebook: [facebook()], threads: [threads()] }));
    await discardCompletedRunWork(f.directory, SOURCE, false);
    assert.equal(existsSync(f.fb), false);
    const manifest = await freeze(f.directory);
    assert.ok(manifest.kind === 'LEGACY_POSTS_JSONL' && manifest.files.every(file => file.from_results));
    const rows = await observations(f.directory, manifest);
    assert.deepEqual(rows.map(row => row.observation.entity_id), ['10', '20']);
    assert.equal(rows[0]!.observation.provenance.response_sha256, capture.response_sha256);
    writeFileSync(resultFile, JSON.stringify({ facebook: [facebook('11')], threads: [threads()] }));
    await assert.rejects(verifyRetainedSource({ dataDirectory: f.directory, manifest }), /RETAINED_SOURCE_PREFIX_CHANGED/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('real collector row shapes preserve capture provenance, native timestamps, reply parents and media under a combined root cap', async () => {
  const f = fixture([facebook()], [threads('21', { entity_type: 'COMMENT', is_reply: true, root_post_id: '20', parent_id: '20', text: 'Is the room quiet?' }),
    threads('22', { entity_type: 'COMMENT', is_reply: true, root_post_id: null, parent_id: '999', text: 'Unresolved native reply' }),
    threads('20', { entity_type: 'POST', root_post_id: '20', media_refs: [{ type: 'IMAGE', url: 'https://example.invalid/synthetic-image.jpg' }] }), threads('30')]);
  try {
    const manifest = await freeze(f.directory, 2); assert.equal(manifest.kind, 'LEGACY_POSTS_JSONL');
    if (manifest.kind !== 'LEGACY_POSTS_JSONL') throw Error('EXPECTED_LEGACY');
    assert.deepEqual(manifest.files.map(file => file.relative_path), ['facebook/posts.jsonl', 'threads/posts.jsonl']);
    assert.deepEqual(manifest.source_root_counts, { facebook: 1, threads: 2 }); assert.deepEqual(manifest.selected_root_counts, { facebook: 1, threads: 1 });
    const rows = await observations(f.directory, manifest), values = rows.map(row => row.observation);
    assert.deepEqual(values.map(value => [value.platform, value.entity_type, value.entity_id]), [
      ['facebook', 'POST', '10'], ['threads', 'COMMENT', '21'], ['threads', 'CANDIDATE', '22'], ['threads', 'POST', '20']]);
    assert.deepEqual(values[0]!.source, { kind: 'GROUP', name: 'Travel discussion', url: 'https://www.facebook.com/groups/synthetic' });
    assert.equal(values[0]!.provenance.method, 'BROWSER_RESPONSE'); assert.equal(values[0]!.provenance.response_sha256, capture.response_sha256);
    const locator = JSON.parse(values[0]!.provenance.locator!);
    assert.deepEqual(locator.first_observation, capture); assert.equal(locator.extraction_method, 'EMBEDDED_DOCUMENT_JSON');
    assert.equal(values[0]!.observed_at, at); assert.equal(values[0]!.published_at, published);
    assert.deepEqual(values[0]!.coverage, { status: 'NOT_ATTEMPTED', advertised_count: 23 });
    assert.equal(values[1]!.parent_id, '20'); assert.equal(values[1]!.root_post_id, '20'); assert.equal(values[1]!.coverage, undefined);
    assert.equal(values[2]!.root_post_id, null); assert.equal(values[2]!.parent_id, '999');
    assert.deepEqual(values[3]!.media, [{ type: 'IMAGE', url: 'https://example.invalid/synthetic-image.jpg' }]);
    assert.deepEqual(readFileSync(f.fb), f.fbBytes); assert.deepEqual(readFileSync(f.th), f.thBytes);
    const subset = await observations(f.directory, await freeze(f.directory, 1));
    assert.deepEqual(subset.map(row => row.observation.entity_id), ['10', '22'], 'unknown reply remains raw but never consumes a root quota');
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('both frozen prefixes permit append but independently reject truncation or mutation without repairing incomplete tails', async () => {
  const f = fixture();
  try {
    appendFileSync(f.fb, '{"unfinished":'); appendFileSync(f.th, '{"unfinished":');
    const originalFb = readFileSync(f.fb), originalTh = readFileSync(f.th), manifest = await freeze(f.directory);
    assert.equal(manifest.ignored_tail_bytes, 28); assert.equal((await observations(f.directory, manifest)).length, 2);
    assert.deepEqual(readFileSync(f.fb), originalFb); assert.deepEqual(readFileSync(f.th), originalTh);
    writeFileSync(f.fb, Buffer.concat([f.fbBytes, Buffer.from(lines([facebook('11')]))]));
    writeFileSync(f.th, Buffer.concat([f.thBytes, Buffer.from(lines([threads('30')]))]));
    assert.equal((await observations(f.directory, manifest)).length, 2);
    for (const [file, bytes] of [[f.fb, f.fbBytes], [f.th, f.thBytes]] as const) {
      writeFileSync(file, bytes.subarray(0, bytes.length - 1));
      await assert.rejects(verifyRetainedSource({ dataDirectory: f.directory, manifest }), /RETAINED_SOURCE_TRUNCATED/);
      writeFileSync(file, bytes);
      writeFileSync(file, bytes.toString().replace('hotel', 'motel'));
      await assert.rejects(verifyRetainedSource({ dataDirectory: f.directory, manifest }), /RETAINED_SOURCE_PREFIX_CHANGED/);
      writeFileSync(file, bytes);
    }
    assert.equal((await observations(f.directory, manifest)).length, 2);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('legacy Stop/resume validates both prefixes before new writes; restoring the exact prefix resumes the same independent import', async () => {
  const f = fixture([facebook()], [threads(), threads('22', { is_reply: true, root_post_id: null, parent_id: null })]);
  const store = createConversationStore(join(f.target, 'opportunity', 'store')); let stop = false;
  try {
    const prepared = await prepare(f.directory, 2);
    assert.equal(prepared.manifest.total_observations, 3); assert.equal(prepared.exportMetadata.source_kind, 'LEGACY_POSTS_JSONL');
    assert.ok(JSON.stringify(prepared.exportMetadata).length < 5000);
    await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context, store: port(store), shouldStop: () => stop,
      onProgress: checkpoint => { if (checkpoint.imported_observations === 1) stop = true; } });
    appendFileSync(f.fb, lines([facebook('11')])); appendFileSync(f.th, lines([threads('30')]));
    const appendedTh = readFileSync(f.th); writeFileSync(f.th, appendedTh.toString().replace('Which hotel', 'Which motel'));
    await assert.rejects(importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context, store: port(store) }), /RETAINED_SOURCE_PREFIX_CHANGED/);
    assert.equal(store.observations().length, 1); assert.equal(store.decisionHistory(context).length, 0);
    writeFileSync(f.th, appendedTh);
    const complete = await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context, store: port(store) });
    assert.equal(complete.checkpoint.status, 'IMPORTED'); assert.equal(complete.manifest.input_sha256, prepared.manifest.input_sha256);
    assert.equal(store.observations().length, 3); assert.equal(store.stats(context).raw_unique_posts, 2);
    for (const platform of ['facebook', 'threads'] as const) {
      const snapshot = store.snapshot(platform, platform === 'facebook' ? '10' : '20')!;
      assert.equal(snapshot.coverage.status, 'NOT_ATTEMPTED'); assert.equal(snapshot.comments.length, 0);
    }
    assert.equal(store.costSummary(TARGET, context.campaign_version).cost_usd, 0);
    assert.equal(store.decisionHistory(context).length, 0);
    const imported = readFileSync(join(f.target, 'opportunity', 'store', 'conversation-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const events = imported.filter(event => event.type === 'OBSERVATION');
    assert.equal(events.length, 3); assert.equal(events[0].payload.import_lineage.source_prefix_sha256, prepared.manifest.source.prefix_sha256);
    assert.equal(events[0].payload.observation.provenance.run_id, SOURCE);
    assert.deepEqual(readFileSync(f.fb).subarray(0, f.fbBytes.length), f.fbBytes); assert.deepEqual(readFileSync(f.th).subarray(0, f.thBytes.length), f.thBytes);
    rmSync(f.source, { recursive: true, force: true });
    assert.equal((await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context, store: port(store) })).checkpoint.status, 'IMPORTED');
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('legacy crash after durable target append replays once under the original lineage and frozen source order', async () => {
  const f = fixture(); let fail = true;
  const directory = join(f.target, 'opportunity', 'store');
  let store = createConversationStore(directory, { afterJournalAppend: type => { if (fail && type === 'OBSERVATION') { fail = false; throw Error('SIMULATED_CRASH'); } } });
  try {
    const prepared = await prepare(f.directory);
    await assert.rejects(importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context, store: port(store) }), /SIMULATED_CRASH/);
    assert.equal((await readRetainedImport({ dataDirectory: f.directory, targetRunId: TARGET })).checkpoint.imported_observations, 0);
    store.close(); store = createConversationStore(directory);
    await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context, store: port(store) });
    assert.equal(store.observations().length, 2); assert.equal(store.stats(context).raw_unique_posts, 2);
    const journal = readFileSync(join(directory, 'conversation-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(event => event.type === 'OBSERVATION');
    assert.equal(journal.length, 2); assert.equal(new Set(journal.map(event => event.id)).size, 2);
    assert.ok(journal.every(event => event.payload.import_lineage.import_id === prepared.manifest.import_id));
    assert.deepEqual(readFileSync(f.fb), f.fbBytes); assert.deepEqual(readFileSync(f.th), f.thBytes);
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('a present journal never falls back to legacy, and invalid late legacy rows fail before target materialization', async () => {
  const f = fixture();
  try {
    const journal = join(f.source, 'opportunity', 'store', 'conversation-events.jsonl'); mkdirSync(join(f.source, 'opportunity', 'store'), { recursive: true });
    writeFileSync(journal, ''); await assert.rejects(freeze(f.directory), /RETAINED_SOURCE_EMPTY/);
    writeFileSync(journal, '{invalid}\n'); await assert.rejects(freeze(f.directory), /RETAINED_JOURNAL_CORRUPT/);
    rmSync(join(f.source, 'opportunity'), { recursive: true, force: true });
    for (const invalid of [
      { ...threads(), collected_at: null }, { ...threads(), first_observation: undefined },
      { ...threads(), is_reply: true, root_post_id: 'not-native' }, { ...threads(), post_url: 'https://unrelated.invalid/@synthetic/post/Code20' },
      { ...threads(), post_id: '20', root_post_id: '21' },
    ]) {
      writeFileSync(f.th, lines([invalid]));
      await assert.rejects(prepare(f.directory), /RETAINED_LEGACY_(RECORD|URL)_INVALID/);
      assert.equal(existsSync(join(f.target, 'opportunity', 'retained-import.json')), false);
      assert.equal(existsSync(join(f.target, 'opportunity', 'store', 'conversation-events.jsonl')), false);
    }
    writeFileSync(f.th, f.thBytes); assert.equal((await prepare(f.directory)).manifest.total_observations, 2);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('legacy source symlinks cannot escape their trusted source run', async () => {
  const f = fixture();
  try {
    const outside = join(f.directory, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'posts.jsonl'), f.fbBytes);
    rmSync(join(f.source, 'facebook'), { recursive: true, force: true }); symlinkSync(outside, join(f.source, 'facebook'), 'junction');
    await assert.rejects(freeze(f.directory), /RETAINED_SOURCE_INVALID/);
    assert.deepEqual(readFileSync(join(outside, 'posts.jsonl')), f.fbBytes);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('Facebook native permalink routes bind numeric post identity and retain observed opaque pfbid routes', async () => {
  const f = fixture([facebook('1001')], []);
  try {
    for (const url of [
      'https://www.facebook.com/example/posts/1001',
      'https://www.facebook.com/example/posts/pfbidSynthetic123',
      'https://www.facebook.com/groups/synthetic/posts/1001/',
      'https://www.facebook.com/permalink.php?story_fbid=1001&id=555',
      'https://www.facebook.com/permalink.php?story_fbid=pfbidSynthetic123&id=555',
    ]) {
      writeFileSync(f.fb, lines([facebook('1001', { observed_post_url: url })]));
      assert.equal((await observations(f.directory, await freeze(f.directory)))[0]!.observation.permalink, url);
    }
    for (const url of [
      'https://www.facebook.com/example/posts/1002', 'https://www.facebook.com/groups/synthetic/posts/1002',
      'https://www.facebook.com/permalink.php?story_fbid=1002&id=555',
      'https://www.facebook.com/permalink.php?story_fbid=1001&story_fbid=1002&id=555',
      'https://www.facebook.com/permalink.php?story_fbid=1001&id=555&extra=1001',
      'https://www.facebook.com/example/posts/1001?extra=true', 'https://www.facebook.com/example/posts/1001#different',
      'https://www.facebook.com/search/top?q=1001',
    ]) {
      writeFileSync(f.fb, lines([facebook('1001', { observed_post_url: url })]));
      await assert.rejects(freeze(f.directory), /RETAINED_LEGACY_URL_INVALID/);
    }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('legacy reply indicators must be Boolean, mutually consistent, and cannot attach a parent to a root post', async () => {
  const f = fixture([], [threads()]);
  try {
    for (const changes of [
      { is_reply: 'true' }, { is_reply: null }, { entity_type: 'POST', is_reply: true },
      { entity_type: 'COMMENT', is_reply: false }, { entity_type: 'POST', parent_id: '99' },
      { is_reply: false, parent_id: '99' }, { parent_id: '99' },
    ]) {
      writeFileSync(f.th, lines([{ ...threads(), ...changes }]));
      await assert.rejects(freeze(f.directory), /RETAINED_LEGACY_RECORD_INVALID/);
    }
    writeFileSync(f.th, lines([threads('21', { entity_type: 'COMMENT', is_reply: true, root_post_id: null, parent_id: '99' }), threads()]));
    const rows = await observations(f.directory, await freeze(f.directory));
    assert.equal(rows[0]!.observation.entity_type, 'CANDIDATE'); assert.equal(rows[0]!.observation.parent_id, '99');
    assert.deepEqual((await freeze(f.directory)).source_root_counts, { facebook: 0, threads: 1 });
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('optional weighted root selection pins a mixed prefix, fills availability shortfalls, and keeps old manifests unchanged', async () => {
  const fb = Array.from({ length: 100 }, (_, i) => facebook(String(1000 + i))), th = Array.from({ length: 100 }, (_, i) => threads(String(2000 + i)));
  const f = fixture(fb, th), platformWeights = { facebook: 0.2, threads: 0.8 };
  const input = { dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, maxRoots: 20, platformWeights };
  try {
    const original = await freeze(f.directory, 20);
    assert.deepEqual(original.selected_root_counts, { facebook: 20, threads: 0 }); assert.equal('allocation' in original.selection, false);
    const weighted = await freezeRetainedSource(input);
    assert.deepEqual(weighted.selected_root_counts, { facebook: 4, threads: 16 });
    assert.deepEqual(weighted.selection.allocation, { policy: 'PLATFORM_WEIGHTED_PREFIX_V1', weights: platformWeights,
      requested_counts: { facebook: 4, threads: 16 }, shortfall_policy: 'FILL_FROM_REMAINING_SOURCE_ORDER' });
    assert.equal((await observations(f.directory, weighted)).length, 20);
    assert.deepEqual(weighted.selection.roots.filter(root => root.platform === 'threads').map(root => root.root_post_id), th.slice(0, 16).map(row => row.post_id));
    const odd = await freezeRetainedSource({ ...input, maxRoots: 21 }); assert.deepEqual(odd.selected_root_counts, { facebook: 4, threads: 17 });
    const single = await freezeRetainedSource({ ...input, maxRoots: 1 }); assert.deepEqual(single.selected_root_counts, { facebook: 0, threads: 1 });
    writeFileSync(f.th, lines(th.slice(0, 3)));
    const limited = await freezeRetainedSource(input); assert.deepEqual(limited.selected_root_counts, { facebook: 17, threads: 3 });
    assert.equal((await observations(f.directory, limited)).length, 20);
    writeFileSync(f.fb, '');
    const onlyThreads = await freezeRetainedSource(input); assert.deepEqual(onlyThreads.selected_root_counts, { facebook: 0, threads: 3 });
    assert.deepEqual(onlyThreads.selection.allocation!.requested_counts, { facebook: 0, threads: 20 });
    await assert.rejects(freezeRetainedSource({ ...input, platformWeights: { facebook: 0.9, threads: 0.8 } }), /PLATFORM_TARGETS_INVALID/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('a prepared weighted import rejects changed or omitted weights without changing its frozen selection', async () => {
  const f = fixture(Array.from({ length: 5 }, (_, i) => facebook(String(100 + i))), Array.from({ length: 5 }, (_, i) => threads(String(200 + i))));
  const input = { dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, targetContext: context, maxRoots: 5, platformWeights: { facebook: 0.2, threads: 0.8 } };
  try {
    const initial = await prepareRetainedImport(input), saved = readFileSync(join(f.target, 'opportunity', 'retained-import.json'));
    assert.deepEqual(initial.manifest.source.selected_root_counts, { facebook: 1, threads: 4 });
    assert.deepEqual(initial.exportMetadata.platform_allocation!.weights, input.platformWeights);
    assert.equal((await prepareRetainedImport(input)).manifest.input_sha256, initial.manifest.input_sha256);
    await assert.rejects(prepareRetainedImport({ ...input, platformWeights: { facebook: 0.8, threads: 0.2 } }), /RETAINED_IMPORT_INPUT_CHANGED/);
    await assert.rejects(prepare(f.directory, 5), /RETAINED_IMPORT_INPUT_CHANGED/);
    assert.deepEqual(readFileSync(join(f.target, 'opportunity', 'retained-import.json')), saved);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('legacy files import from a pinned external root while all new records and checkpoints stay in the destination', async () => {
  const f = fixture(), directory = mkdtempSync(join(tmpdir(), 'csd-retained-legacy-destination-'));
  mkdirSync(join(directory, 'collections', TARGET, 'opportunity', 'store'), { recursive: true });
  const store = createConversationStore(join(directory, 'collections', TARGET, 'opportunity', 'store'));
  try {
    const prepared = await prepareRetainedImport({ dataDirectory: directory, targetRunId: TARGET, sourceRunId: SOURCE, targetContext: context, maxRoots: 2,
      sourceDataDirectory: f.directory, sourceRootId: 'legacy-archive', platformWeights: { facebook: 0.2, threads: 0.8 } });
    assert.equal(prepared.manifest.source.kind, 'LEGACY_POSTS_JSONL'); assert.equal(prepared.manifest.source_location!.root_id, 'legacy-archive');
    await importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context, store: port(store) });
    assert.equal(store.stats(context).raw_unique_posts, 2); assert.equal(store.snapshot('facebook', '10')!.coverage.status, 'NOT_ATTEMPTED');
    assert.equal(store.snapshot('threads', '20')!.comments.length, 0);
    assert.equal(existsSync(join(f.source, 'opportunity', 'retained-import.json')), false);
    assert.deepEqual(readFileSync(f.fb), f.fbBytes); assert.deepEqual(readFileSync(f.th), f.thBytes);
    assert.equal(existsSync(join(directory, 'collections', TARGET, 'opportunity', 'retained-import-checkpoint.json')), true);
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});
