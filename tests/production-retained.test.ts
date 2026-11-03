import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionService, type ProductionHost } from '../src/application/production-service.js';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { prepareDraft, readDraft } from '../src/application/campaign-drafts.js';
import { importRetainedData, readRetainedImport } from '../src/application/retained-data-service.js';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import type { ConversationObservation } from '../src/domain/conversation.js';
import type { CampaignDraftView } from '../src/shared/campaign-drafts.js';
import type { OpportunityConfig } from '../src/shared/production-api.js';

// Transport fixtures exercise real campaign ledgers and the production pipeline.
// Their deterministic labels are orchestration assertions, not a semantic benchmark.
const sourceTime = '2026-10-30T10:00:00.000Z';
type ModelConversation = { snapshot_id: string; root_post_id: string; as_of: string;
  post: { entity_id: string } | null; comments: Array<{ entity_id: string }>;
  spans: Array<{ id: string; entity_id: string; text: string }> };
type ModelInput = { prompt?: string; campaign?: { topic: string }; conversations?: ModelConversation[] };
function config(topic: string, rawCap = 20): OpportunityConfig {
  return { enabled: true, prompt: `Tìm ${topic}, cần tư vấn trải nghiệm sử dụng.`, brandContext: '',
    totalTarget: 1, threadsShare: .8, rawCap, budgetUsd: 3, commentsEnabled: true };
}
function plan(topic: string) {
  return { topic, audience: ['Người dùng'], needs: ['Tư vấn trải nghiệm'], participation_intents: ['Hỏi trải nghiệm'],
    research_intents: ['Giá'], inclusions: ['Câu hỏi người dùng'], exclusions: ['Tuyển dụng'], assumptions: [],
    constraints: { geographies: [], languages: [], max_age_days: null, source_priority: null, unresolved: [] },
    queries: [{ text: `tìm ${topic}`, family: 'REQUEST' }, { text: `review ${topic}`, family: 'EXPERIENCE' },
      { text: `hỏi ${topic}`, family: 'PROBLEM' }, { text: `${topic}`, family: 'BROAD' }] };
}
function transport() {
  const requests: ModelInput[] = [];
  const factory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ mockTransport: true, ...options,
    apiKey: 'synthetic-retained-test-key', minRequestIntervalMs: 0, maxAttempts: 1,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const input = JSON.parse(body.contents[0]!.parts[0]!.text) as ModelInput;
      requests.push(input);
      const value = input.conversations ? input.conversations.map(conversation => {
        const matching = conversation.spans.find(span => span.text.includes(input.campaign!.topic));
        const span = matching ?? conversation.spans[0]!;
        const thin = Boolean(matching?.text.includes('CHECKIN'));
        return { snapshot_id: conversation.snapshot_id,
          case_code: !matching ? 'UNRELATED_TOPIC' : thin ? 'RELATED_CHECKIN' : 'OPPORTUNITY_REQUEST',
          evidence_ids: [span.id], action_entity_id: matching && !thin ? span.entity_id : '',
          need_summary: matching ? 'Synthetic matching consumer question' : 'Synthetic different topic',
          intents: matching && !thin ? ['request_advice'] : [] };
      }) : plan(input.prompt!.includes('tai nghe') ? 'tai nghe' : 'quán cafe');
      return new Response(JSON.stringify({ modelVersion: 'synthetic-retained-model', candidates: [{ finishReason: 'STOP',
        content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: 1000,
        candidatesTokenCount: 100, totalTokenCount: 1100 } }), { status: 200 });
    } });
  return { factory, requests, classified: () => requests.flatMap(request => request.conversations ?? []) };
}
function observation(id: string, text: string, changes: Partial<ConversationObservation> = {}): ConversationObservation {
  return { platform: 'threads', entity_type: 'POST', entity_id: id, root_post_id: id, parent_id: null, text,
    observed_at: sourceTime, published_at: '2026-10-29T10:00:00.000Z', permalink: `https://example.test/${id}`,
    provenance: { run_id: 'synthetic-source', method: 'TEST_NATIVE_CAPTURE', query: 'synthetic source' }, ...changes };
}
function sourceFixture(directory: string, observations: ConversationObservation[], runId = 'crawl-' + randomUUID()) {
  const output = join(directory, 'collections', runId), store = join(output, 'opportunity', 'store');
  mkdirSync(store, { recursive: true });
  const journal = join(store, 'conversation-events.jsonl');
  const events = observations.map((value, index) => ({ id: randomUUID(), seq: index + 1, type: 'OBSERVATION', at: value.observed_at,
    payload: { observation: value, context: { campaign_id: 'old-source-campaign', campaign_version: 'old-version', filter_version: 'old-filter' } } }));
  writeFileSync(journal, events.map(event => JSON.stringify(event)).join('\n') + '\n');
  return { runId, output, journal, events };
}
function digestTree(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) for (const [child, digest] of Object.entries(digestTree(file))) result[join(entry.name, child)] = digest;
    else result[entry.name] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return result;
}
function noBrowserHost() {
  const calls: string[] = [];
  const fail = async (name: string): Promise<never> => { calls.push(name); throw Error('BROWSER_MUST_NOT_BE_USED'); };
  const host: ProductionHost = { list: () => fail('list'), sessionStatus: () => fail('sessionStatus'),
    create: () => fail('create'), openLogin: () => fail('openLogin') };
  return { host, calls, collect: () => fail('collect'), collectConversation: () => fail('collectConversation'),
    resolveThreadsReplyRoot: () => fail('resolveThreadsReplyRoot'), withConversationWindow: () => fail('withConversationWindow') };
}
function makeService(directory: string, model: ReturnType<typeof transport>, extra: Partial<Parameters<typeof createProductionService>[0]> = {}) {
  const browser = noBrowserHost();
  const service = createProductionService({ directory, version: 'retained-test', ...browser,
    createOpportunity: options => createOpportunityPipeline({ ...options, gateway: model.factory({ directory: join(options.directory, 'opportunity'), budgetUsd: options.config.budgetUsd }) }),
    ...extra });
  return { service, browser };
}
function reference(draft: CampaignDraftView) { return { runId: draft.runId, revision: draft.revision, configHash: draft.configHash }; }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function pauseAfterFirstImport() {
  const entered = deferred(), release = deferred(); let once = false;
  const importer: typeof importRetainedData = options => importRetainedData({ ...options, onProgress: async checkpoint => {
    await options.onProgress?.(checkpoint);
    if (!once && checkpoint.imported_observations === 1) { once = true; entered.resolve(); await release.promise; }
  } });
  return { entered, release, importer };
}
async function prepared(directory: string, model: ReturnType<typeof transport>, topic = 'tai nghe', rawCap = 20) {
  return prepareDraft({ directory, config: config(topic, rawCap), gatewayFactory: model.factory });
}
async function temporary(work: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-production-retained-'));
  try { await work(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-production-retained-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('retained run consumes the exact prepared draft and its ledger without any browser or authentication', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('headphones', 'Có tai nghe nào đeo lâu dễ chịu?'),
    observation('cafe', 'Có quán cafe nào yên tĩnh?', { platform: 'facebook' })]);
  const before = digestTree(source.output), model = transport(), draft = await prepared(directory, model), { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    const listed = await service.listRetainedSources(); assert.equal(listed.sources.some(value => value.runId === source.runId), true);
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await service.settled();
    const state = await service.getState(), run = state.run!;
    assert.equal(run.id, draft.runId); assert.equal(run.mode, 'RETAINED'); assert.equal(run.retained?.status, 'IMPORTED');
    assert.equal(run.outputDirectory, join(directory, 'collections', draft.runId));
    assert.deepEqual(run.platforms.map(item => [item.platform, item.profileId, item.count]).sort(), [['facebook', null, 1], ['threads', null, 1]]);
    assert.equal(run.opportunity?.counts.raw, 2); assert.equal(run.opportunity?.counts.suitable, 1); assert.equal(run.opportunity?.counts.unrelated, 1);
    assert.ok(run.opportunity!.costUsd > draft.cost.measuredUsd); assert.equal(run.opportunity!.usageUnknown, 0);
    assert.equal(readDraft({ directory, runId: draft.runId }).status, 'STARTED');
    assert.equal(model.requests.filter(item => !item.conversations).length, 1, 'prepared campaign must not be planned a second time');
    assert.equal(model.classified().length, 2); assert.equal(browser.calls.length, 0);
    assert.deepEqual(digestTree(source.output), before);
    const exported = await service.snapshotResults();
    assert.equal(exported.run.id, draft.runId); assert.equal((exported.opportunity as { campaign: { campaign_id: string } }).campaign.campaign_id, draft.runId);
    const nextDraft = await prepared(directory, model, 'quán cafe');
    service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: nextDraft.config });
    await service.startRetained({ sourceRunId: source.runId, draft: reference(nextDraft) }); await service.settled();
    const next = await service.snapshotResults(), nextOutput = next.opportunity as { conversations: Array<{ snapshot: { root_post_id: string }; decision: { classification: string } }> };
    assert.equal(next.run.id, nextDraft.runId); assert.notEqual(next.run.id, draft.runId);
    assert.equal(nextOutput.conversations.find(item => item.snapshot.root_post_id === 'cafe')!.decision.classification, 'SUITABLE');
    assert.equal(nextOutput.conversations.find(item => item.snapshot.root_post_id === 'headphones')!.decision.classification, 'UNRELATED');
    assert.equal(browser.calls.length, 0); assert.deepEqual(digestTree(source.output), before);
  } finally { await service.shutdown(); }
}));

test('retained classification waits for latest revisions and comments, and never activates browser watch', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('root', 'quán cafe OLD_REVISION'),
    observation('root', 'Ảnh trải nghiệm mới nhất', { observed_at: '2026-10-30T11:00:00.000Z' }),
    observation('consumer', 'Cho hỏi tai nghe này pin dùng được lâu không?', { entity_type: 'COMMENT', root_post_id: 'root', parent_id: 'root', observed_at: '2026-10-30T11:01:00.000Z' }),
    observation('capture', '', { entity_type: 'CAPTURE', entity_id: null, root_post_id: 'root', observed_at: '2026-10-30T11:02:00.000Z',
      coverage: { status: 'PARTIAL', advertised_count: 20, observed_count: 1, has_more: true, stop_reason: 'PAGE_BUDGET' } }),
    observation('thin', 'tai nghe CHECKIN')]);
  const before = digestTree(source.output), model = transport(), draft = await prepared(directory, model), { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await service.settled();
    const result = await service.snapshotResults(), output = result.opportunity as Awaited<ReturnType<Awaited<ReturnType<typeof createOpportunityPipeline>>['results']>>;
    assert.equal(model.classified().filter(item => item.root_post_id === 'root').length, 1);
    assert.equal(model.classified().some(item => item.spans.some(span => span.text.includes('OLD_REVISION'))), false);
    const root = output.snapshots.find(item => item.root_post_id === 'root')!;
    assert.equal(root.post!.text, 'Ảnh trải nghiệm mới nhất'); assert.equal(root.comments.length, 1);
    assert.equal(root.comments[0]!.parent_id, 'root'); assert.equal(root.comments[0]!.published_at, '2026-10-29T10:00:00.000Z');
    assert.equal(root.coverage.status, 'PARTIAL'); assert.equal(root.coverage.has_more, true);
    assert.equal(output.conversations.find(item => item.snapshot.root_post_id === 'root')!.decision.action_target?.entity_id, 'consumer');
    assert.notEqual(result.run.opportunity?.watchActive, true); assert.notEqual(result.run.opportunity?.assessmentActive, true);
    assert.equal(result.run.opportunity?.watchPending, 0); assert.equal(browser.calls.length, 0);
    assert.equal(model.classified().length, 2); assert.deepEqual(digestTree(source.output), before);
    assert.equal(new Set(model.classified().map(item => item.as_of)).size, 1, 'all retained decisions use the fixed freeze assessment time');
  } finally { await service.shutdown(); }
}));

test('retained Start rejects stale drafts and filesystem or profile injection before any classification', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('root', 'Hỏi tai nghe')]), model = transport(), draft = await prepared(directory, model);
  const { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    for (const input of [
      { sourceRunId: '../outside', draft: reference(draft) },
      { sourceRunId: source.runId, draft: { ...reference(draft), revision: '0'.repeat(64) } },
      { sourceRunId: source.runId, draft: { ...reference(draft), configHash: '0'.repeat(64) } },
      { sourceRunId: source.runId, draft: reference(draft), profiles: [] },
      { sourceRunId: source.runId, draft: reference(draft), directory: source.output },
      { sourceRunId: source.runId },
    ]) await assert.rejects(service.startRetained(input));
    assert.equal(readDraft({ directory, runId: draft.runId }).status, 'DRAFT'); assert.equal(model.classified().length, 0); assert.equal(browser.calls.length, 0);
  } finally { await service.shutdown(); }
}));

test('retained raw cap counts actual roots while preserving unknown candidates and selected-root comments', async () => temporary(async directory => {
  const candidates = Array.from({ length: 12 }, (_, index) => observation(`unknown-${index}`, 'tai nghe candidate', {
    entity_type: 'CANDIDATE', root_post_id: null }));
  const source = sourceFixture(directory, [...candidates,
    observation('orphan', 'tai nghe orphan', { entity_type: 'COMMENT', root_post_id: 'unobserved-root', parent_id: 'unobserved-root' }),
    observation('selected', 'Xin tư vấn tai nghe', { platform: 'facebook' }),
    observation('over-cap', 'Xin quán cafe', { platform: 'facebook' }),
    observation('selected-comment', 'tai nghe này pin bền không?', { platform: 'facebook', entity_type: 'COMMENT', root_post_id: 'selected', parent_id: 'selected' })]);
  const before = digestTree(source.output), model = transport(), draft = await prepared(directory, model, 'tai nghe', 1), { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await service.settled();
    const result = await service.snapshotResults();
    assert.equal(result.run.opportunity?.counts.raw, 1); assert.equal(result.run.opportunity?.counts.comments, 1);
    assert.deepEqual(result.run.platforms.map(item => [item.platform, item.profileId, item.count]), [['facebook', null, 1]]);
    assert.equal(model.classified().length, 1); assert.equal(model.classified()[0]!.root_post_id, 'selected');
    const journal = readFileSync(join(result.run.outputDirectory, 'opportunity', 'store', 'conversation-events.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { type: string; payload: { observation?: ConversationObservation } });
    const raw = journal.filter(item => item.type === 'OBSERVATION').map(item => item.payload.observation!);
    assert.equal(new Set(raw.filter(item => item.entity_type === 'CANDIDATE').map(item => item.entity_id)).size, 12);
    assert.equal(raw.some(item => item.entity_id === 'orphan'), false);
    assert.equal(raw.some(item => item.entity_id === 'over-cap'), false);
    assert.equal(browser.calls.length, 0); assert.deepEqual(digestTree(source.output), before);
  } finally { await service.shutdown(); }
}));

test('retained import never leaves a corrected comment attached to its former selected root', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('first-root', 'Xin quán cafe'), observation('actual-root', 'Xin tư vấn tai nghe'),
    observation('moved-comment', 'tai nghe hỏi pin', { entity_type: 'COMMENT', root_post_id: 'first-root', parent_id: 'first-root' }),
    observation('moved-comment', 'tai nghe hỏi pin', { entity_type: 'COMMENT', root_post_id: 'actual-root', parent_id: 'actual-root', observed_at: '2026-10-30T11:00:00.000Z' })]);
  const model = transport(), draft = await prepared(directory, model), { service } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await service.settled();
    const result = await service.snapshotResults(), output = result.opportunity as Awaited<ReturnType<Awaited<ReturnType<typeof createOpportunityPipeline>>['results']>>;
    const first = output.snapshots.find(item => item.root_post_id === 'first-root')!, actual = output.snapshots.find(item => item.root_post_id === 'actual-root')!;
    assert.equal(first.comments.length, 0); assert.deepEqual(actual.comments.map(item => [item.entity_id, item.parent_id]), [['moved-comment', 'actual-root']]);
    assert.equal(output.conversations.find(item => item.snapshot.root_post_id === 'first-root')!.decision.classification, 'UNRELATED');
    assert.equal(result.run.opportunity?.counts.comments, 1);
  } finally { await service.shutdown(); }
}));

test('retained Stop and app restart require explicit Resume and continue only the frozen source prefix', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('one', 'Hỏi tai nghe một'), observation('two', 'Hỏi tai nghe hai')]);
  const model = transport(), draft = await prepared(directory, model), gate = pauseAfterFirstImport();
  const first = makeService(directory, model, { importRetainedData: gate.importer });
  let restarted: ReturnType<typeof makeService> | null = null;
  first.service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await first.service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await gate.entered.promise;
    assert.equal(model.classified().length, 0, 'no partially imported snapshot reaches the classifier');
    await first.service.stop(); gate.release.resolve(); await first.service.settled();
    const paused = await first.service.getState();
    assert.equal(paused.run?.state, 'STOPPED'); assert.equal(paused.run.retained?.status, 'PAUSED');
    assert.equal(paused.run.retained?.importedObservations, 1);
    const hash = paused.run.retained?.inputHash, cost = paused.run.opportunity?.costUsd;
    await first.service.shutdown();
    // Simulate the durable run marker that survives an abrupt process exit; no work is running.
    const latest = join(directory, 'latest-run.json'), saved = JSON.parse(readFileSync(latest, 'utf8'));
    saved.state = 'RUNNING'; saved.retained.status = 'IMPORTING'; saved.platforms.forEach((item: { state: string }) => { item.state = 'RUNNING'; });
    writeFileSync(latest, JSON.stringify(saved));
    appendFileSync(source.journal, JSON.stringify({ id: randomUUID(), seq: 3, type: 'OBSERVATION', at: sourceTime,
      payload: { observation: observation('appended-later', 'Hỏi tai nghe ngoài frozen prefix') } }) + '\n');
    restarted = makeService(directory, model);
    const interrupted = await restarted.service.getState();
    assert.equal(interrupted.run?.state, 'INTERRUPTED'); assert.equal(interrupted.run.retained?.inputHash, hash);
    assert.equal(model.classified().length, 0); assert.equal(restarted.browser.calls.length, 0);
    await restarted.service.resume(); await restarted.service.settled();
    const finished = await restarted.service.getState();
    assert.equal(finished.run?.id, draft.runId); assert.equal(finished.run.retained?.inputHash, hash);
    assert.equal(finished.run.retained?.status, 'IMPORTED'); assert.equal(finished.run.retained?.importedObservations, 2);
    assert.equal(finished.run.opportunity?.counts.raw, 2); assert.equal(finished.run.opportunity?.counts.suitable, 2);
    assert.ok(finished.run.opportunity!.costUsd > cost!); assert.deepEqual(model.classified().map(item => item.root_post_id).sort(), ['one', 'two']);
    assert.equal(first.browser.calls.length + restarted.browser.calls.length, 0);
    const metadata = await readRetainedImport({ dataDirectory: directory, targetRunId: draft.runId });
    assert.equal(metadata.manifest.source.watermark.sequence, 2); assert.equal(metadata.checkpoint.status, 'IMPORTED');
  } finally { gate.release.resolve(); await first.service.shutdown(); await restarted?.service.shutdown(); }
}));

test('mutating an unfinished retained source prefix fails closed before classification', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('one', 'Hỏi tai nghe một'), observation('two', 'Hỏi tai nghe hai')]);
  const model = transport(), draft = await prepared(directory, model), gate = pauseAfterFirstImport(), { service, browser } = makeService(directory, model, { importRetainedData: gate.importer });
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await gate.entered.promise;
    await service.stop(); gate.release.resolve(); await service.settled();
    const hash = (await service.getState()).run!.retained!.inputHash;
    writeFileSync(source.journal, readFileSync(source.journal, 'utf8').replace('Hỏi tai nghe một', 'Hỏi loa nghe một'));
    await service.resume(); await service.settled();
    const state = await service.getState();
    assert.equal(state.run?.state, 'FAILED'); assert.equal(state.run.retained?.status, 'FAILED');
    assert.equal(state.run.retained?.inputHash, hash); assert.equal(model.classified().length, 0); assert.equal(browser.calls.length, 0);
    const metadata = await readRetainedImport({ dataDirectory: directory, targetRunId: draft.runId });
    assert.equal(metadata.checkpoint.error_code, 'RETAINED_SOURCE_PREFIX_CHANGED'); assert.equal(metadata.checkpoint.imported_observations, 1);
  } finally { gate.release.resolve(); await service.shutdown(); }
}));

test('retained recovery after append-before-checkpoint failure does not duplicate raw history or charge partial classification', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('one', 'Hỏi tai nghe một'), observation('two', 'Hỏi tai nghe hai')]);
  const before = digestTree(source.output), model = transport(), draft = await prepared(directory, model); let crash = true;
  const importer: typeof importRetainedData = options => importRetainedData({ ...options, store: {
    async ingestImported(...args) {
      const value = await options.store.ingestImported(...args);
      if (crash) { crash = false; throw Error('TEST_AFTER_DURABLE_IMPORT'); }
      return value;
    },
  } });
  const { service, browser } = makeService(directory, model, { importRetainedData: importer });
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await service.settled();
    assert.equal((await service.getState()).run?.state, 'FAILED'); assert.equal(model.classified().length, 0);
    const partial = await readRetainedImport({ dataDirectory: directory, targetRunId: draft.runId });
    assert.equal(partial.checkpoint.imported_observations, 0); assert.equal(partial.checkpoint.last_source_sequence, 0);
    await service.resume(); await service.settled();
    const state = await service.getState();
    assert.equal(state.run?.retained?.status, 'IMPORTED'); assert.equal(state.run.opportunity?.counts.raw, 2);
    const journal = readFileSync(join(state.run.outputDirectory, 'opportunity', 'store', 'conversation-events.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { type: string; payload: { observation?: ConversationObservation } });
    assert.equal(journal.filter(event => event.type === 'OBSERVATION').length, 2);
    assert.equal(model.classified().length, 2); assert.equal(browser.calls.length, 0); assert.deepEqual(digestTree(source.output), before);
  } finally { await service.shutdown(); }
}));

test('completed retained import remains resumable from its own durable data when the source is unavailable', async () => temporary(async directory => {
  const source = sourceFixture(directory, [observation('one', 'Xin tư vấn tai nghe')]);
  const model = transport(), draft = await prepared(directory, model), first = makeService(directory, model);
  let restarted: ReturnType<typeof makeService> | null = null;
  first.service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await first.service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await first.service.settled();
    const before = await first.service.getState(), calls = model.requests.length;
    assert.equal(before.run?.retained?.status, 'IMPORTED'); await first.service.shutdown();
    assert.ok(source.journal.startsWith(directory + '\\') || source.journal.startsWith(directory + '/'));
    unlinkSync(source.journal);
    restarted = makeService(directory, model);
    await restarted.service.getState(); assert.equal(model.requests.length, calls);
    await restarted.service.resume(); await restarted.service.settled();
    const after = await restarted.service.snapshotResults();
    assert.equal(after.run.retained?.status, 'IMPORTED'); assert.equal(after.run.retained?.inputHash, before.run.retained?.inputHash);
    assert.equal(after.run.opportunity?.counts.suitable, 1); assert.equal(after.run.opportunity?.costUsd, before.run.opportunity?.costUsd);
    assert.equal(model.requests.length, calls); assert.equal(first.browser.calls.length + restarted.browser.calls.length, 0);
    const output = after.opportunity as { retained_input: { source_run_id: string; status: string } };
    assert.equal(output.retained_input.source_run_id, source.runId); assert.equal(output.retained_input.status, 'IMPORTED');
  } finally { await first.service.shutdown(); await restarted?.service.shutdown(); }
}));

test('retained service reuses legacy Facebook and Threads JSONL without inventing comments or promoting unresolved replies', async () => temporary(async directory => {
  const sourceRunId = 'crawl-' + randomUUID(), output = join(directory, 'collections', sourceRunId);
  const first = { run_id: sourceRunId, batch_id: 'synthetic-batch', query_index: 0, scroll_index: 0,
    method: 'BROWSER_RESPONSE', response_sha256: '0'.repeat(64), operation: null };
  const facebook = [{ post_id: '1001', text: 'Xin tư vấn tai nghe phù hợp?', query: 'tai nghe', collected_at: sourceTime,
    published_at: '2026-10-29T10:00:00.000Z', observed_post_url: 'https://www.facebook.com/synthetic/posts/1001', comments_count: 12,
    first_observation: { ...first, transport_request_id: null } }];
  const threads = [{ platform: 'threads', post_id: '2001', shortcode: 'Code1', post_url: 'https://www.threads.com/@synthetic/post/Code1',
    author_username: 'synthetic', text: 'Hỏi tai nghe dùng khi làm việc', query: 'tai nghe', collected_at: sourceTime,
    published_at: '2026-10-29T11:00:00.000Z', search_mode: 'top', replies: 9, first_observation: { ...first, request_id: null } },
  { platform: 'threads', post_id: '2002', shortcode: 'ReplyCode', post_url: 'https://www.threads.com/@synthetic/post/ReplyCode',
    author_username: 'synthetic', text: 'tai nghe giá bao nhiêu?', query: 'tai nghe', collected_at: sourceTime,
    search_mode: 'top', is_reply: true, entity_type: 'COMMENT', root_post_id: null, parent_id: null,
    first_observation: { ...first, request_id: null } }];
  for (const [platform, rows] of [['facebook', facebook], ['threads', threads]] as const) {
    mkdirSync(join(output, platform), { recursive: true });
    writeFileSync(join(output, platform, 'posts.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  const before = digestTree(output), model = transport(), draft = await prepared(directory, model), { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    assert.equal((await service.listRetainedSources()).sources.find(item => item.runId === sourceRunId)?.format, 'LEGACY_JSONL');
    await service.startRetained({ sourceRunId, draft: reference(draft) }); await service.settled();
    const result = await service.snapshotResults(), retained = await readRetainedImport({ dataDirectory: directory, targetRunId: draft.runId });
    assert.equal(retained.manifest.source.kind, 'LEGACY_POSTS_JSONL'); assert.equal(retained.checkpoint.status, 'IMPORTED');
    assert.equal(result.run.opportunity?.counts.raw, 2); assert.equal(result.run.opportunity?.counts.comments, 0);
    assert.equal(result.run.opportunity?.counts.suitable, 2);
    const exported = result.opportunity as Awaited<ReturnType<Awaited<ReturnType<typeof createOpportunityPipeline>>['results']>>;
    assert.deepEqual(exported.snapshots.map(snapshot => snapshot.root_post_id).sort(), ['1001', '2001']);
    for (const snapshot of exported.snapshots) { assert.equal(snapshot.comments.length, 0); assert.equal(snapshot.coverage.status, 'NOT_ATTEMPTED'); }
    assert.equal(model.classified().length, 2); assert.equal(browser.calls.length, 0); assert.deepEqual(digestTree(output), before);
  } finally { await service.shutdown(); }
}));

test('retained service applies prepared platform weights to the actual bounded root selection', async () => temporary(async directory => {
  const facebook = Array.from({ length: 10 }, (_, index) => observation(`facebook-${index}`, `Xin tư vấn tai nghe ${index}`, { platform: 'facebook' }));
  const threads = Array.from({ length: 10 }, (_, index) => observation(`threads-${index}`, `Xin tư vấn tai nghe ${index}`));
  // The entire Facebook prefix comes first, so an unweighted cap would exclude Threads.
  const source = sourceFixture(directory, [...facebook, ...threads]), model = transport(), draft = await prepared(directory, model, 'tai nghe', 10);
  const { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    await service.startRetained({ sourceRunId: source.runId, draft: reference(draft) }); await service.settled();
    const result = await service.snapshotResults(), retained = await readRetainedImport({ dataDirectory: directory, targetRunId: draft.runId });
    const output = result.opportunity as Awaited<ReturnType<Awaited<ReturnType<typeof createOpportunityPipeline>>['results']>>;
    assert.deepEqual(retained.manifest.source.source_root_counts, { facebook: 10, threads: 10 });
    assert.deepEqual(retained.manifest.source.selected_root_counts, { facebook: 2, threads: 8 });
    assert.equal(output.snapshots.length, 10);
    assert.deepEqual(output.snapshots.filter(item => item.platform === 'facebook').map(item => item.root_post_id).sort(), ['facebook-0', 'facebook-1']);
    assert.deepEqual(output.snapshots.filter(item => item.platform === 'threads').map(item => item.root_post_id).sort(), threads.slice(0, 8).map(item => item.entity_id));
    assert.equal(result.run.opportunity?.byPlatform.facebook.raw, 2); assert.equal(result.run.opportunity?.byPlatform.threads.raw, 8);
    assert.equal(model.classified().length, 10); assert.equal(browser.calls.length, 0);
  } finally { await service.shutdown(); }
}));

test('external root IDs isolate colliding run IDs and a missing registered root does not hide readable sources', async () => temporary(async fixture => {
  const directory = join(fixture, 'app-data'), externalDirectory = join(fixture, 'external-data'), missingDirectory = join(fixture, 'removable-data');
  const local = sourceFixture(directory, [observation('local-only', 'Xin quán cafe')]);
  const external = sourceFixture(externalDirectory, [observation('external-only', 'Xin tư vấn tai nghe')], local.runId);
  sourceFixture(missingDirectory, [observation('missing-only', 'tai nghe trên ổ rời')], local.runId);
  const beforeLocal = digestTree(local.output), beforeExternal = digestTree(external.output), model = transport(), draft = await prepared(directory, model);
  const { service, browser } = makeService(directory, model);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 1, opportunity: draft.config });
  try {
    let catalog = await service.registerRetainedSourceRoot(externalDirectory);
    const selected = catalog.sources.find(item => item.sourceRootId && item.sourceLabel === 'external-data')!;
    assert.ok(selected.sourceRootId); assert.equal(selected.runId, local.runId);
    catalog = await service.registerRetainedSourceRoot(missingDirectory);
    const missing = catalog.sources.find(item => item.sourceLabel === 'removable-data')!;
    assert.equal(catalog.sources.filter(item => item.runId === local.runId).length, 3);
    assert.equal(new Set(catalog.sources.map(item => item.sourceRootId ?? 'LOCAL')).size, 3);
    const moved = join(fixture, 'removed-data');
    assert.equal(dirname(resolve(missingDirectory)), resolve(fixture)); assert.equal(dirname(resolve(moved)), resolve(fixture));
    renameSync(missingDirectory, moved);
    catalog = await service.listRetainedSources();
    assert.equal(catalog.sources.filter(item => item.runId === local.runId).length, 2);
    assert.deepEqual(catalog.issues.map(item => [item.sourceRootId, item.label, item.code]),
      [[missing.sourceRootId, 'removable-data', 'RETAINED_SOURCE_ROOT_MISSING']]);
    await assert.rejects(service.startRetained({ sourceRunId: external.runId, sourceRootId: externalDirectory, draft: reference(draft) }), /SOURCE_ROOT_ID_INVALID/);
    await assert.rejects(service.startRetained({ sourceRunId: external.runId, sourceDataDirectory: externalDirectory, draft: reference(draft) }), /RETAINED_INPUT_INVALID/);
    await service.startRetained({ sourceRunId: selected.runId, sourceRootId: selected.sourceRootId, draft: reference(draft) }); await service.settled();
    const result = await service.snapshotResults(), imported = await readRetainedImport({ dataDirectory: directory, targetRunId: draft.runId });
    assert.equal(imported.manifest.source_location?.root_id, selected.sourceRootId);
    assert.equal(imported.manifest.source.source_run_id, local.runId);
    assert.deepEqual(model.classified().map(item => item.root_post_id), ['external-only']);
    assert.equal(result.run.opportunity?.counts.raw, 1); assert.equal(result.run.opportunity?.counts.suitable, 1);
    assert.equal(browser.calls.length, 0); assert.deepEqual(digestTree(local.output), beforeLocal); assert.deepEqual(digestTree(external.output), beforeExternal);
  } finally { await service.shutdown(); }
}));
