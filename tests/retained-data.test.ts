import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contentHash, type ConversationObservation, type ConversationSnapshot, type EvaluationContext } from '../src/domain/conversation.js';
import { createConversationStore, type ConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { freezeRetainedSource, readRetainedObservations, verifyRetainedSource } from '../src/infrastructure/storage/retained-observation-reader.js';
import { importRetainedData, prepareRetainedImport, readRetainedImport } from '../src/application/retained-data-service.js';
import { classifyConversations } from '../src/application/classification-service.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';

const SOURCE = 'crawl-11111111-1111-1111-1111-111111111111', TARGET = 'crawl-22222222-2222-2222-2222-222222222222', SECOND = 'crawl-33333333-3333-3333-3333-333333333333';
const at = '2026-01-01T00:00:00.000Z';
const context = (id = TARGET): EvaluationContext => ({ campaign_id: id, campaign_version: 'test-v1', filter_version: 'test-policy' });
const obs = (id: string, changes: Partial<ConversationObservation> = {}): ConversationObservation => ({ platform: 'threads', entity_type: 'POST', entity_id: id, root_post_id: id,
  parent_id: null, text: 'A hotel review.', observed_at: at, published_at: at, provenance: { run_id: SOURCE, method: 'ORIGINAL_CAPTURE', query: 'hotel review' }, ...changes });
function fixture(observations: ConversationObservation[]) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-retained-test-'));
  for (const id of [SOURCE, TARGET, SECOND]) mkdirSync(join(directory, 'collections', id, 'opportunity', 'store'), { recursive: true });
  const source = join(directory, 'collections', SOURCE, 'opportunity', 'store', 'conversation-events.jsonl');
  const events = observations.map((observation, index) => ({ id: `source-event-${index + 1}`, seq: index + 1, type: 'OBSERVATION', at, payload: { observation, context: context(SOURCE) } }));
  const ignored = { id: 'old-decision', seq: events.length + 1, type: 'DECISION', at, payload: { classification: 'SUITABLE', model: 'old-model', cost: 999 } };
  writeFileSync(source, [...events, ignored].map(value => JSON.stringify(value) + '\n').join(''));
  return { directory, source, initial: readFileSync(source), eventCount: events.length + 1 };
}
const port = (store: ConversationStore) => ({ ingestImported: async (...args: Parameters<ConversationStore['ingestImported']>) => store.ingestImported(...args) });
const collect = async (iterable: AsyncIterable<unknown>) => { const values = []; for await (const value of iterable) values.push(value); return values; };

test('reader freezes a complete prefix, preserves unknown raw and comments before roots, and enforces canonical membership under a root cap', async () => {
  const f = fixture([
    obs('c1', { entity_type: 'COMMENT', root_post_id: 'a', parent_id: 'a', text: 'Advice please?' }),
    obs('unknown', { entity_type: 'CANDIDATE', root_post_id: null, text: 'Reply without root' }), obs('a'), obs('b'),
    obs('c1', { entity_type: 'COMMENT', root_post_id: 'b', parent_id: 'b', observed_at: '2026-01-02T00:00:00Z', text: 'Advice please?' }),
    obs('capture-a', { entity_type: 'CAPTURE', entity_id: null, root_post_id: 'a', text: '', coverage: { status: 'PARTIAL', pages: 1 } }),
  ]);
  try {
    appendFileSync(f.source, '{"id":"unfinished');
    const sourceBytes = readFileSync(f.source), manifest = await freezeRetainedSource({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, maxRoots: 1 });
    assert.equal(manifest.prefix_bytes, f.initial.length); assert.equal(manifest.ignored_tail_bytes, sourceBytes.length - f.initial.length);
    assert.deepEqual(manifest.source_root_counts, { facebook: 0, threads: 2 }); assert.deepEqual(manifest.selected_root_counts, { facebook: 0, threads: 1 });
    assert.deepEqual(manifest.selection.excluded_comment_keys, ['threads:c1']);
    const rows = await collect(readRetainedObservations({ dataDirectory: f.directory, manifest })) as Array<{ observation: ConversationObservation }>;
    assert.deepEqual(rows.map(row => row.observation.entity_type), ['CANDIDATE', 'POST', 'CAPTURE']);
    assert.ok(rows.every(row => row.observation.provenance.method === 'ORIGINAL_CAPTURE'));
    assert.deepEqual(readFileSync(f.source), sourceBytes); assert.deepEqual(readdirSync(join(f.directory, 'collections', SOURCE, 'opportunity', 'store')), ['conversation-events.jsonl']);
    const full = await freezeRetainedSource({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: SECOND, maxRoots: 2 });
    assert.equal((await collect(readRetainedObservations({ dataDirectory: f.directory, manifest: full }))).length, 6);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('prefix append is allowed while modification, truncation, traversal and self-import fail without source repair', async () => {
  const f = fixture([obs('a')]);
  try {
    const input = { dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, maxRoots: 1 }, manifest = await freezeRetainedSource(input);
    appendFileSync(f.source, JSON.stringify({ id: 'new', seq: 3, type: 'OBSERVATION', payload: { observation: obs('b') } }) + '\n');
    assert.equal((await collect(readRetainedObservations({ dataDirectory: f.directory, manifest }))).length, 1);
    writeFileSync(f.source, f.initial.toString().replace('A hotel review.', 'A motel review.'));
    await assert.rejects(verifyRetainedSource({ dataDirectory: f.directory, manifest }), /RETAINED_SOURCE_PREFIX_CHANGED/);
    writeFileSync(f.source, f.initial.subarray(0, f.initial.length - 1));
    await assert.rejects(verifyRetainedSource({ dataDirectory: f.directory, manifest }), /RETAINED_SOURCE_TRUNCATED/);
    await assert.rejects(freezeRetainedSource({ ...input, sourceRunId: '../outside' }), /RETAINED_RUN_ID_INVALID/);
    await assert.rejects(freezeRetainedSource({ ...input, targetRunId: SOURCE }), /RETAINED_SELF_IMPORT/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('source event validation fails closed and complete records are bounded in memory', async () => {
  const f = fixture([obs('a')]);
  try {
    const input = { dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, maxRoots: 1 };
    appendFileSync(f.source, JSON.stringify({ id: 'out-of-order', seq: 1, type: 'DECISION' }) + '\n');
    await assert.rejects(freezeRetainedSource(input), /RETAINED_JOURNAL_EVENT_INVALID/);
    writeFileSync(f.source, 'x'.repeat(8 * 1024 * 1024 + 1) + '\n');
    await assert.rejects(freezeRetainedSource(input), /RETAINED_LINE_LIMIT/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('weighted journal selection preserves all revisions and comments for chosen roots without changing source event order', async () => {
  const f = fixture([
    obs('10', { platform: 'facebook' }), obs('11', { platform: 'facebook' }), obs('12', { platform: 'facebook' }),
    obs('21', { entity_type: 'COMMENT', root_post_id: '20', parent_id: '20', text: 'A consumer follow-up' }),
    obs('20'), obs('30'), obs('40'), obs('50'), obs('60'),
    obs('20', { text: 'A revised review', observed_at: '2026-01-02T00:00:00Z' }),
  ]);
  try {
    const manifest = await freezeRetainedSource({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, maxRoots: 5, platformWeights: { facebook: 0.2, threads: 0.8 } });
    assert.deepEqual(manifest.selected_root_counts, { facebook: 1, threads: 4 });
    const rows = await collect(readRetainedObservations({ dataDirectory: f.directory, manifest })) as Array<{ sequence: number; observation: ConversationObservation }>;
    assert.deepEqual(rows.map(row => row.observation.entity_id), ['10', '21', '20', '30', '40', '50', '20']);
    assert.deepEqual(rows.map(row => row.sequence), [...rows.map(row => row.sequence)].sort((a, b) => a - b));
    assert.equal(rows.at(-1)!.observation.text, 'A revised review'); assert.deepEqual(readFileSync(f.source), f.initial);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('import persists lineage separately, ignores decisions/charges and resumes exactly the frozen selected observations', async () => {
  const f = fixture([obs('a'), obs('reply', { entity_type: 'COMMENT', root_post_id: 'a', parent_id: 'a', text: 'Is it quiet?' }), obs('b')]);
  const store = await createAsyncConversationStore(join(f.directory, 'collections', TARGET, 'opportunity', 'store')); let stop = false;
  try {
    const prepared = await prepareRetainedImport({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, targetContext: context(), maxRoots: 1 });
    assert.equal(prepared.manifest.total_observations, 2); assert.equal(prepared.manifest.excluded_observations, 1);
    const paused = await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store, shouldStop: () => stop,
      onProgress: checkpoint => { if (checkpoint.imported_observations === 1) stop = true; } });
    assert.equal(paused.checkpoint.status, 'PAUSED'); assert.equal(paused.checkpoint.imported_observations, 1);
    appendFileSync(f.source, JSON.stringify({ id: 'later', seq: f.eventCount + 1, type: 'OBSERVATION', payload: { observation: obs('c') } }) + '\n');
    const complete = await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store });
    assert.equal(complete.checkpoint.status, 'IMPORTED'); assert.equal(complete.checkpoint.imported_observations, 2);
    assert.equal((await store.stats(context())).raw_unique_posts, 1); assert.equal((await store.observations()).length, 2);
    assert.equal((await store.decisionHistory(context())).length, 0); assert.equal((await store.costSummary(TARGET, 'test-v1')).cost_usd, 0);
    const snapshot = await store.snapshot('threads', 'a'); assert.equal(snapshot!.comments[0]!.parent_id, 'a'); assert.equal(snapshot!.post!.observed_at, at);
    const journal = readFileSync(join(f.directory, 'collections', TARGET, 'opportunity', 'store', 'conversation-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(journal[0].payload.observation.provenance.method, 'ORIGINAL_CAPTURE'); assert.equal(journal[0].payload.import_lineage.source_run_id, SOURCE);
    assert.equal(journal[0].payload.import_lineage.source_prefix_sha256, prepared.manifest.source.prefix_sha256);
    assert.ok(JSON.stringify(complete.exportMetadata).length < 4000); assert.equal('selection' in complete.exportMetadata, false);
    assert.equal(complete.exportMetadata.assessment_as_of, prepared.manifest.captured_at);
    assert.equal(complete.exportMetadata.assessment_semantics, 'FROZEN_HISTORICAL_AS_OF_ACROSS_RESUME');
    assert.match(complete.exportMetadata.current_eligibility_semantics, /CURRENT_VIEW_CLOCK_EXPIRED_RECORDS_PENDING/);
    assert.deepEqual(readFileSync(f.source).subarray(0, f.initial.length), f.initial);
    rmSync(join(f.directory, 'collections', SOURCE), { recursive: true, force: true });
    assert.equal((await readRetainedImport({ dataDirectory: f.directory, targetRunId: TARGET })).checkpoint.status, 'IMPORTED');
    assert.equal((await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store })).checkpoint.status, 'IMPORTED');
    assert.equal((await store.observations()).length, 2);
  } finally { await store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('a final progress callback failure cannot undo completed import or reintroduce a source dependency', async () => {
  const f = fixture([obs('a')]), store = createConversationStore(join(f.directory, 'collections', TARGET, 'opportunity', 'store'));
  try {
    await prepareRetainedImport({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, targetContext: context(), maxRoots: 1 });
    await assert.rejects(importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store: port(store),
      onProgress: checkpoint => { if (checkpoint.status === 'IMPORTED') throw Error('PRESENTATION_FAILED'); } }), /PRESENTATION_FAILED/);
    assert.equal((await readRetainedImport({ dataDirectory: f.directory, targetRunId: TARGET })).checkpoint.status, 'IMPORTED');
    rmSync(join(f.directory, 'collections', SOURCE), { recursive: true, force: true });
    assert.equal((await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store: port(store) })).checkpoint.status, 'IMPORTED');
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

function destination() {
  const directory = mkdtempSync(join(tmpdir(), 'csd-retained-destination-'));
  for (const id of [SOURCE, TARGET, SECOND]) mkdirSync(join(directory, 'collections', id, 'opportunity', 'store'), { recursive: true });
  return directory;
}

test('an external trusted source pins canonical root identity and permits equal run IDs across physically distinct roots', async () => {
  const source = fixture([obs('a'), obs('c', { entity_type: 'COMMENT', root_post_id: 'a', parent_id: 'a', text: 'A native follow-up.' })]);
  const directory = destination(), aliasParent = mkdtempSync(join(tmpdir(), 'csd-retained-alias-')), alias = join(aliasParent, 'source-root');
  symlinkSync(source.directory, alias, 'junction');
  const targetContext = context(SOURCE), store = createConversationStore(join(directory, 'collections', SOURCE, 'opportunity', 'store'));
  const input = { dataDirectory: directory, targetRunId: SOURCE, sourceRunId: SOURCE, targetContext, maxRoots: 2, sourceDataDirectory: alias, sourceRootId: 'archive-one' };
  try {
    const prepared = await prepareRetainedImport(input);
    assert.deepEqual(prepared.manifest.source_location, { root_id: 'archive-one', canonical_data_directory: realpathSync(source.directory) });
    assert.equal(prepared.manifest.target_run_id, prepared.manifest.source.source_run_id);
    assert.equal((await prepareRetainedImport(input)).manifest.import_id, prepared.manifest.import_id);
    assert.equal(prepared.exportMetadata.source_location!.root_id, 'archive-one');
    assert.equal(prepared.exportMetadata.source_location!.canonical_data_directory_sha256, contentHash(realpathSync(source.directory)));
    assert.equal(JSON.stringify(prepared.exportMetadata).includes(source.directory), false);
    assert.equal(JSON.stringify(prepared.exportMetadata).includes(alias), false);
    const result = await importRetainedData({ dataDirectory: directory, targetRunId: SOURCE, targetContext, store: port(store) });
    assert.equal(result.checkpoint.status, 'IMPORTED'); assert.equal(store.stats(targetContext).raw_unique_posts, 1);
    assert.equal(store.snapshot('threads', 'a')!.comments[0]!.parent_id, 'a'); assert.equal(store.observations().length, 2);
    assert.equal(store.decisionHistory(targetContext).length, 0); assert.equal(store.costSummary(SOURCE, targetContext.campaign_version).cost_usd, 0);
    assert.deepEqual(readFileSync(source.source), source.initial);
    rmSync(source.directory, { recursive: true, force: true });
    assert.equal((await readRetainedImport({ dataDirectory: directory, targetRunId: SOURCE })).checkpoint.status, 'IMPORTED');
    assert.equal((await importRetainedData({ dataDirectory: directory, targetRunId: SOURCE, targetContext, store: port(store),
      sourceDataDirectory: join(directory, 'removed-registry-entry'), sourceRootId: 'no-longer-registered' })).checkpoint.status, 'IMPORTED');
    assert.equal(store.observations().length, 2, 'completed import does not resolve or revisit its external source');
  } finally { store.close(); rmSync(aliasParent, { recursive: true, force: true }); rmSync(source.directory, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});

test('incomplete external imports reject changed registry root/path mappings and resume only their pinned source', async () => {
  const source = fixture([obs('a'), obs('b')]), other = fixture([obs('a'), obs('b')]), directory = destination();
  const store = createConversationStore(join(directory, 'collections', TARGET, 'opportunity', 'store')); let stop = false;
  const input = { dataDirectory: directory, targetRunId: TARGET, sourceRunId: SOURCE, targetContext: context(), maxRoots: 2,
    sourceDataDirectory: source.directory, sourceRootId: 'archive-one' };
  try {
    const prepared = await prepareRetainedImport(input), manifestBytes = readFileSync(join(directory, 'collections', TARGET, 'opportunity', 'retained-import.json'));
    await importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context(), store: port(store), shouldStop: () => stop,
      onProgress: checkpoint => { if (checkpoint.imported_observations === 1) stop = true; } });
    await assert.rejects(prepareRetainedImport({ ...input, sourceDataDirectory: other.directory }), /RETAINED_IMPORT_INPUT_CHANGED/);
    await assert.rejects(prepareRetainedImport({ ...input, sourceRootId: 'different-root-id' }), /RETAINED_IMPORT_INPUT_CHANGED/);
    await assert.rejects(importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context(), store: port(store),
      sourceDataDirectory: other.directory, sourceRootId: 'archive-one' }), /RETAINED_IMPORT_INPUT_CHANGED/);
    assert.equal(store.observations().length, 1); assert.equal(store.decisionHistory(context()).length, 0);
    assert.deepEqual(readFileSync(join(directory, 'collections', TARGET, 'opportunity', 'retained-import.json')), manifestBytes);
    // A same-named local run has different bytes. It must never silently replace the pinned external source.
    writeFileSync(join(directory, 'collections', SOURCE, 'opportunity', 'store', 'conversation-events.jsonl'), JSON.stringify({
      id: 'local-only', seq: 1, type: 'OBSERVATION', payload: { observation: obs('local-only') } }) + '\n');
    const complete = await importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context(), store: port(store) });
    assert.equal(complete.manifest.import_id, prepared.manifest.import_id); assert.equal(complete.checkpoint.status, 'IMPORTED');
    assert.equal(store.observations().length, 2); assert.equal(store.snapshot('threads', 'local-only'), null);
    assert.deepEqual(readFileSync(source.source), source.initial); assert.deepEqual(readFileSync(other.source), other.initial);
  } finally { store.close(); rmSync(source.directory, { recursive: true, force: true }); rmSync(other.directory, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});

test('external-source crash recovery uses the same frozen prefix and import ledger after reopening the target store', async () => {
  const source = fixture([obs('a'), obs('b')]), directory = destination(), storeDirectory = join(directory, 'collections', TARGET, 'opportunity', 'store');
  let fail = true, store = createConversationStore(storeDirectory, { afterJournalAppend: type => { if (fail && type === 'OBSERVATION') { fail = false; throw Error('SIMULATED_CRASH'); } } });
  try {
    const prepared = await prepareRetainedImport({ dataDirectory: directory, targetRunId: TARGET, sourceRunId: SOURCE, targetContext: context(), maxRoots: 2,
      sourceDataDirectory: source.directory, sourceRootId: 'archive-one' });
    await assert.rejects(importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context(), store: port(store) }), /SIMULATED_CRASH/);
    store.close(); store = createConversationStore(storeDirectory);
    appendFileSync(source.source, JSON.stringify({ id: 'new-after-freeze', seq: source.eventCount + 1, type: 'OBSERVATION', payload: { observation: obs('new') } }) + '\n');
    const result = await importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context(), store: port(store) });
    assert.equal(result.manifest.import_id, prepared.manifest.import_id); assert.equal(result.checkpoint.status, 'IMPORTED');
    assert.equal(store.observations().length, 2); assert.equal(store.snapshot('threads', 'new'), null);
    const events = readFileSync(join(storeDirectory, 'conversation-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(event => event.type === 'OBSERVATION');
    assert.equal(events.length, 2); assert.equal(new Set(events.map(event => event.id)).size, 2);
    assert.ok(events.every(event => event.payload.import_lineage.import_id === prepared.manifest.import_id));
    assert.deepEqual(readFileSync(source.source).subarray(0, source.initial.length), source.initial);
  } finally { store.close(); rmSync(source.directory, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});

test('external source identities require paired trusted inputs and cannot name the target physical run through an alias', async () => {
  const source = fixture([obs('a')]), directory = destination(), aliasParent = mkdtempSync(join(tmpdir(), 'csd-retained-self-alias-')), alias = join(aliasParent, 'same-root');
  symlinkSync(directory, alias, 'junction');
  try {
    const input = { dataDirectory: directory, targetRunId: TARGET, sourceRunId: SOURCE, targetContext: context(), maxRoots: 1 };
    await assert.rejects(prepareRetainedImport({ ...input, sourceDataDirectory: source.directory }), /RETAINED_SOURCE_LOCATION_REQUIRED/);
    await assert.rejects(prepareRetainedImport({ ...input, sourceRootId: 'missing-directory' }), /RETAINED_SOURCE_LOCATION_REQUIRED/);
    await assert.rejects(prepareRetainedImport({ ...input, sourceRunId: TARGET, sourceDataDirectory: alias, sourceRootId: 'self-alias' }), /RETAINED_SELF_IMPORT/);
    await assert.rejects(freezeRetainedSource({ dataDirectory: alias, sourceRunId: TARGET, targetDataDirectory: directory, targetRunId: TARGET, maxRoots: 1 }), /RETAINED_SELF_IMPORT/);
    const sourceRun = join(directory, 'collections', SOURCE), targetRun = join(directory, 'collections', TARGET);
    rmSync(sourceRun, { recursive: true, force: true }); symlinkSync(targetRun, sourceRun, 'junction');
    await assert.rejects(prepareRetainedImport({ ...input, sourceDataDirectory: directory, sourceRootId: 'same-physical-run' }), /RETAINED_SELF_IMPORT/);
  } finally { rmSync(aliasParent, { recursive: true, force: true }); rmSync(source.directory, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});

test('an incomplete pinned canonical root cannot be redirected by replacing its directory with a junction', async () => {
  const source = fixture([obs('a')]), replacement = fixture([obs('a')]), directory = destination();
  const store = createConversationStore(join(directory, 'collections', TARGET, 'opportunity', 'store'));
  try {
    await prepareRetainedImport({ dataDirectory: directory, targetRunId: TARGET, sourceRunId: SOURCE, targetContext: context(), maxRoots: 1,
      sourceDataDirectory: source.directory, sourceRootId: 'archive-one' });
    rmSync(source.directory, { recursive: true, force: true }); symlinkSync(replacement.directory, source.directory, 'junction');
    await assert.rejects(importRetainedData({ dataDirectory: directory, targetRunId: TARGET, targetContext: context(), store: port(store) }), /RETAINED_IMPORT_INPUT_CHANGED/);
    assert.equal(store.observations().length, 0); assert.deepEqual(readFileSync(replacement.source), replacement.initial);
  } finally { store.close(); rmSync(source.directory, { recursive: true, force: true }); rmSync(replacement.directory, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});

test('an incomplete import rejects source-prefix mutation before another target observation is persisted', async () => {
  const f = fixture([obs('a'), obs('b')]), store = createConversationStore(join(f.directory, 'collections', TARGET, 'opportunity', 'store')); let stopped = false;
  try {
    await prepareRetainedImport({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, targetContext: context(), maxRoots: 2 });
    await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store: port(store), shouldStop: () => stopped,
      onProgress: checkpoint => { if (checkpoint.imported_observations === 1) stopped = true; } });
    writeFileSync(f.source, f.initial.toString().replace('A hotel review.', 'A motel review.'));
    await assert.rejects(importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store: port(store) }), /RETAINED_SOURCE_PREFIX_CHANGED/);
    assert.equal(store.observations().length, 1); assert.equal((await readRetainedImport({ dataDirectory: f.directory, targetRunId: TARGET })).checkpoint.status, 'FAILED');
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('crash between target append and checkpoint resumes idempotently after process/store restart', async () => {
  const f = fixture([obs('a'), obs('b')]); let fail = true;
  const target = join(f.directory, 'collections', TARGET, 'opportunity', 'store');
  let store = createConversationStore(target, { afterJournalAppend: type => { if (fail && type === 'OBSERVATION') { fail = false; throw Error('SIMULATED_CRASH'); } } });
  try {
    await prepareRetainedImport({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: TARGET, targetContext: context(), maxRoots: 2 });
    await assert.rejects(importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store: port(store) }), /SIMULATED_CRASH/);
    assert.equal((await readRetainedImport({ dataDirectory: f.directory, targetRunId: TARGET })).checkpoint.imported_observations, 0);
    store.close(); store = createConversationStore(target);
    const complete = await importRetainedData({ dataDirectory: f.directory, targetRunId: TARGET, targetContext: context(), store: port(store) });
    assert.equal(complete.checkpoint.imported_observations, 2); assert.equal(store.observations().length, 2); assert.equal(store.jobs().length, 2);
    assert.deepEqual(readFileSync(f.source), f.initial);
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('an imported event retries in the same process without a duplicate journal row and rejects changed source content', () => {
  const f = fixture([obs('a')]); let fail = true;
  const store = createConversationStore(join(f.directory, 'collections', TARGET, 'opportunity', 'store'), {
    afterJournalAppend: type => { if (fail && type === 'OBSERVATION') { fail = false; throw Error('SIMULATED_CRASH'); } },
  });
  const lineage = { import_id: 'a'.repeat(64), source_run_id: SOURCE, source_prefix_sha256: 'b'.repeat(64), source_event_id: 'source-event-1', source_sequence: 1 };
  try {
    assert.throws(() => store.ingestImported(obs('a'), context(), lineage), /SIMULATED_CRASH/);
    assert.equal(store.ingestImported(obs('a'), context(), lineage).duplicate, true);
    assert.equal(store.observations().length, 1); assert.equal(readFileSync(store.journalPath, 'utf8').trim().split('\n').length, 1);
    assert.throws(() => store.ingestImported(obs('a', { text: 'Altered source content' }), context(), lineage), /IMPORT_SOURCE_EVENT_CHANGED/);
    assert.equal(store.snapshot('threads', 'a')!.post!.text, obs('a').text);
  } finally { store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('root correction rebuilds both projections and subset import never retains a comment whose final root is excluded', async () => {
  const observations = [obs('a'), obs('b'), obs('reply', { entity_type: 'COMMENT', root_post_id: 'a', parent_id: 'a', text: 'Is it quiet?' }),
    obs('reply', { entity_type: 'COMMENT', root_post_id: 'b', parent_id: 'b', text: 'Is it quiet?', observed_at: '2026-01-02T00:00:00Z' })];
  const f = fixture(observations), full = createConversationStore(join(f.directory, 'collections', TARGET, 'opportunity', 'store')),
    subset = createConversationStore(join(f.directory, 'collections', SECOND, 'opportunity', 'store'));
  try {
    const a = full.ingest(observations[0]!, context()).snapshot!; full.ingest(observations[1]!, context());
    const before = full.ingest(observations[2]!, context()).snapshot!, commentSpan = before.spans.find(span => span.entity_type === 'COMMENT')!;
    const decision = full.recordDecision({ ...context(), snapshot_id: before.id, classification: 'SUITABLE', assessment_status: 'ASSESSED', reason_code: 'REQUEST', evidence_ids: [commentSpan.id], model: 'test' });
    full.ingest(observations[3]!, context());
    assert.equal(full.snapshot('threads', 'a')!.comments.length, 0); assert.equal(full.snapshot('threads', 'b')!.comments.length, 1);
    assert.notEqual(full.snapshot('threads', 'a')!.id, a.id); assert.equal(full.results(context()).length, 0);
    assert.equal(full.getSnapshot(before.id)!.comments.length, 1); assert.equal(full.decisionHistory(context())[0]!.id, decision.decision.id);
    assert.ok(full.jobs().some(job => job.payload.snapshot_id === full.snapshot('threads', 'a')!.id));
    await prepareRetainedImport({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: SECOND, targetContext: context(SECOND), maxRoots: 1 });
    const imported = await importRetainedData({ dataDirectory: f.directory, targetRunId: SECOND, targetContext: context(SECOND), store: port(subset) });
    assert.equal(subset.snapshot('threads', 'a')!.comments.length, 0); assert.equal(subset.snapshot('threads', 'b'), null);
    assert.equal(imported.exportMetadata.excluded_comment_entities, 1); assert.equal(subset.stats(context(SECOND)).raw_unique_posts, 1);
  } finally { full.close(); subset.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('the same retained evidence receives independent decisions in two campaigns without importing old decisions or invoking a browser', async () => {
  const f = fixture([obs('a'), obs('reply', { entity_type: 'COMMENT', root_post_id: 'a', parent_id: 'a', text: 'Is the hotel quiet?' })]);
  const stores = [TARGET, SECOND].map(id => createConversationStore(join(f.directory, 'collections', id, 'opportunity', 'store')));
  let calls = 0;
  const gateway: ModelGateway = {
    async generateJson(request) {
      calls++; const input = request.input as { campaign: { prompt: string }; conversations: Array<{ snapshot_id: string; spans: Array<{ id: string; entity_id: string }> }> };
      const related = input.campaign.prompt === 'Hotel advice';
      return { value: input.conversations.map(snapshot => ({ snapshot_id: snapshot.snapshot_id, case_code: related ? 'OPPORTUNITY_REQUEST' : 'UNRELATED_TOPIC',
        evidence_ids: [snapshot.spans[1]!.id], action_entity_id: related ? snapshot.spans[1]!.entity_id : '', need_summary: 'Synthetic campaign-specific assertion', intents: [] })),
        invocation_id: String(calls), request_hash: contentHash(request.input), model: 'synthetic', model_version: null, usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, thinking_tokens: 0 },
        cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
        price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: at, source: 'TEST' } };
    }, summary: () => ({ model: 'synthetic', budget_usd: 3, measured_cost_usd: 0, unmetered_cost_upper_usd: 0, reserved_usd: 0, remaining_usd: 3, billable_attempts: calls, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
  };
  try {
    const snapshots: ConversationSnapshot[] = [];
    for (const [index, id] of [TARGET, SECOND].entries()) {
      const campaign = literalCampaign({ campaign_id: id, prompt: index === 0 ? 'Hotel advice' : 'Education advice', seed_queries: ['explicit query'] }, at);
      const evaluation = { campaign_id: id, campaign_version: campaign.version, filter_version: campaign.filter_version }, store = stores[index]!;
      await prepareRetainedImport({ dataDirectory: f.directory, sourceRunId: SOURCE, targetRunId: id, targetContext: evaluation, maxRoots: 1 });
      await importRetainedData({ dataDirectory: f.directory, targetRunId: id, targetContext: evaluation, store: port(store) });
      assert.equal(store.decisionHistory(evaluation).length, 0); const snapshot = store.snapshot('threads', 'a')!; snapshots.push(snapshot);
      const result = await classifyConversations(campaign, [snapshot], gateway); assert.equal(result.failures.length, 0); store.recordDecision(result.decisions[0]!);
      assert.equal(store.results(evaluation)[0]!.decision.classification, index === 0 ? 'SUITABLE' : 'UNRELATED');
    }
    assert.equal(calls, 2); assert.deepEqual(snapshots[0]!.spans, snapshots[1]!.spans); assert.deepEqual(readFileSync(f.source), f.initial);
  } finally { stores.forEach(store => store.close()); rmSync(f.directory, { recursive: true, force: true }); }
});
