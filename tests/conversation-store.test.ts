import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import type { ConversationObservation, EvaluationContext } from '../src/domain/conversation.js';
import type { ConversationDecisionInput } from '../src/domain/conversation-decision.js';

const context: EvaluationContext = { campaign_id: 'synthetic-cafe', campaign_version: '1', filter_version: 'conversation-v1' };
const post = (overrides: Partial<ConversationObservation> = {}): ConversationObservation => ({ platform: 'threads', entity_type: 'POST', entity_id: 'post-1', root_post_id: 'post-1', parent_id: null, text: 'Có quán cafe nào yên tĩnh để làm việc không?', observed_at: '2026-10-30T10:00:00.000Z', provenance: { run_id: 'synthetic-run', method: 'TEST_FIXTURE' }, ...overrides });
const decision = (snapshot: NonNullable<ReturnType<ReturnType<typeof createConversationStore>['snapshot']>>, overrides: Partial<ConversationDecisionInput> = {}): ConversationDecisionInput => ({ ...context, snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED', reason_code: 'EXPLICIT_NEED', evidence_ids: snapshot.spans.map(span => span.id).slice(0, 1), model: 'synthetic-model', ...overrides });
function temp(): string { return mkdtempSync(join(tmpdir(), 'csd-conversation-test-')); }

test('classification and verification work is claimed and resumed only within its exact evaluation context', () => {
  const dir = temp(), store = createConversationStore(dir);
  const next = { ...context, campaign_version: '2', filter_version: 'combined-v2' };
  try {
    const original = store.enqueue({ type: 'CLASSIFY', idempotency_key: 'old-context', payload: { ...context, platform: 'threads' } });
    const verification = store.enqueue({ type: 'VERIFY', idempotency_key: 'new-context', payload: { ...next, platform: 'threads' } });
    assert.equal(store.claim('new-worker', { types: ['CLASSIFY', 'VERIFY'], context: next })?.id, verification.id);
    assert.equal(store.getJob(original.id)?.state, 'PENDING');
    assert.equal(store.jobs(undefined, next).length, 1);
    assert.equal(store.pause({ context: next }), 1); assert.equal(store.getJob(original.id)?.state, 'PENDING');
    store.pause({ context }); assert.equal(store.resume({ context: next }), 1);
    assert.equal(store.getJob(original.id)?.state, 'PAUSED'); assert.equal(store.getJob(verification.id)?.state, 'PENDING');
    assert.equal(store.claim('wrong-filter', { types: ['VERIFY'], context: { ...next, filter_version: 'other' } }), null);
    const enrichment = store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'legacy-browser', payload: { platform: 'threads' } });
    store.pause({ types: ['ENRICH_CONVERSATION'] });
    assert.equal(store.resume({ types: [] }), 0);
    assert.equal(store.resume({ types: ['ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'REVISIT'] }), 1);
    assert.equal(store.getJob(enrichment.id)?.state, 'PENDING');
    assert.equal(store.getJob(original.id)?.state, 'PAUSED');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('raw-first ingest retains no-text and unresolved candidates, queues classification per snapshot', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const first = store.ingest(post({ text: '', media: [{ type: 'IMAGE', url: 'https://example.test/check-in.jpg' }] }), context);
    assert.equal(first.changed, true); assert.equal(first.snapshot!.spans.length, 0); assert.equal(first.job!.state, 'PENDING');
    assert.equal(store.observations().length, 1);
    const raw = JSON.parse(readFileSync(store.journalPath, 'utf8').split('\n')[0]!);
    assert.equal(raw.type, 'OBSERVATION'); assert.equal(raw.payload.observation.text, '');
    store.ingest(post({ entity_type: 'CANDIDATE', entity_id: null, root_post_id: null, text: '', provenance: { run_id: 'synthetic-run', method: 'TEST_FIXTURE', locator: 'unknown-candidate' } }), context);
    assert.equal(store.observations().length, 2); assert.equal(store.stats(context).raw_unique_posts, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('repeat captures preserve raw but do not inflate unique roots, revisions, or classification jobs', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const input = post(), first = store.ingest(input, context); input.text = 'caller mutation';
    const second = store.ingest(post({ observed_at: '2026-10-30T11:00:00.000Z' }), context);
    assert.equal(second.changed, false); assert.equal(second.snapshot!.id, first.snapshot!.id);
    assert.equal(store.jobs().length, 1); assert.equal(store.observations().length, 2);
    assert.equal(store.snapshot('threads', 'post-1')!.post!.text.includes('caller mutation'), false);
    assert.equal(store.stats(context).raw_unique_posts, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('root candidate backlog coalesces native identity, preserves known-root hints and excludes resolved historical candidates', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const candidate = post({ entity_type: 'CANDIDATE', entity_id: '2', root_post_id: null, permalink: 'https://www.threads.com/@fixture/post/Reply' });
    store.ingest(candidate, context);
    store.ingest({ ...candidate, observed_at: '2026-10-30T10:01:00Z' }, context);
    store.ingest({ ...candidate, entity_type: 'COMMENT', root_post_id: '1', parent_id: '1', permalink: null, observed_at: '2026-10-30T10:02:00Z' }, context);
    store.ingest({ ...candidate, observed_at: '2026-10-30T10:03:00Z' }, context);
    const unresolved = store.rootCandidates();
    assert.equal(unresolved.length, 1); assert.equal(unresolved[0]?.entity_type, 'COMMENT'); assert.equal(unresolved[0]?.root_post_id, '1');
    assert.equal(unresolved[0]?.permalink, candidate.permalink);
    store.ingest(post({ entity_id: '1', root_post_id: '1' }), context);
    assert.equal(store.rootCandidates().length, 0);
    assert.equal(store.observations().length, 5); // Raw unknown-root observations remain intact.
    store.ingest(post({ entity_type: 'COMMENT', entity_id: '3', root_post_id: '9', parent_id: '9' }), context);
    assert.equal(store.rootCandidates()[0]?.entity_id, '3');
    store.ingest(post({ entity_id: '9', root_post_id: '9' }), context);
    assert.equal(store.rootCandidates().length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('comment evidence changes not-yet to suitable and counts the root once', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const old = store.ingest(post({ text: 'Check-in tại quán' }), context).snapshot!;
    store.recordDecision(decision(old, { classification: 'NOT_YET', reason_code: 'NO_OBSERVED_NEED' }));
    const revised = store.ingest(post({ entity_type: 'COMMENT', entity_id: 'comment-1', parent_id: 'post-1', text: 'Quán yên tĩnh không bạn?', observed_at: '2026-10-30T11:00:00.000Z' }), context).snapshot!;
    assert.equal(revised.revision, 2); assert.equal(revised.comments[0]!.parent_id, 'post-1');
    assert.equal(store.stats(context).pending, 1); assert.equal(store.stats(context).not_yet, 0);
    const commentSpan = revised.spans.find(span => span.entity_type === 'COMMENT')!;
    store.recordDecision(decision(revised, { evidence_ids: [commentSpan.id], action_target: { entity_id: 'comment-1', type: 'COMMENT' } }));
    assert.equal(store.stats(context).suitable, 1); assert.equal(store.stats(context).raw_unique_posts, 1); assert.equal(store.stats(context).observed_comments, 1);
    assert.equal(store.decisionHistory(context).length, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('late decisions from old snapshots never overwrite a newer current result', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const first = store.ingest(post(), context).snapshot!;
    const latest = store.ingest(post({ text: 'Đã tìm được quán rồi, cảm ơn mọi người', observed_at: '2026-10-30T11:00:00.000Z' }), context).snapshot!;
    store.recordDecision(decision(latest, { classification: 'NOT_YET', reason_code: 'NEED_RESOLVED' }));
    const late = store.recordDecision(decision(first)); assert.equal(late.current, false);
    assert.equal(store.stats(context).suitable, 0); assert.equal(store.stats(context).not_yet, 1); assert.equal(store.decisionHistory(context).length, 2);
    const other = { ...context, campaign_version: '2' };
    store.recordDecision(decision(latest, { ...other, classification: 'UNRELATED', reason_code: 'OUTSIDE_CAMPAIGN' }));
    assert.equal(store.stats(context).not_yet, 1); assert.equal(store.stats(other).unrelated, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('invalid evidence and technical failure classifications cannot enter the durable decision stream', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const snapshot = store.ingest(post(), context).snapshot!;
    const before = readFileSync(store.journalPath, 'utf8');
    assert.throws(() => store.recordDecision(decision(snapshot, { evidence_ids: ['invented'] })), /INVALID_EVIDENCE_REFERENCE/);
    assert.throws(() => store.recordDecision(decision(snapshot, { evidence_ids: [] })), /SUITABLE_EVIDENCE_REQUIRED/);
    assert.throws(() => store.recordDecision(decision(snapshot, { assessment_status: 'FAILED', classification: 'UNRELATED' })), /TECHNICAL_FAILURE/);
    assert.equal(readFileSync(store.journalPath, 'utf8'), before);
    store.recordDecision(decision(snapshot, { classification: null, assessment_status: 'FAILED', reason_code: 'MODEL_TIMEOUT', evidence_ids: [] }));
    assert.equal(store.stats(context).failed, 1); assert.equal(store.stats(context).unrelated, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('crash after durable raw append recovers the snapshot and exactly one classify job', () => {
  const dir = temp(); let crash = true;
  const store = createConversationStore(dir, { afterJournalAppend(type) { if (crash && type === 'OBSERVATION') { crash = false; throw Error('INJECTED_CRASH'); } } });
  try {
    assert.throws(() => store.ingest(post(), context), /INJECTED_CRASH/);
    assert.equal(store.snapshots().length, 0);
  } finally { store.close(); }
  const recovered = createConversationStore(dir);
  try { assert.equal(recovered.snapshots().length, 1); assert.equal(recovered.jobs().length, 1); assert.equal(recovered.jobs()[0]!.state, 'PENDING'); }
  finally { recovered.close(); }
  const again = createConversationStore(dir);
  try { assert.equal(again.jobs().length, 1); assert.equal(again.observations().length, 1); }
  finally { again.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('torn last journal line is backed up and recovered; middle corruption is rejected', () => {
  const dir = temp(), store = createConversationStore(dir); store.ingest(post(), context); const file = store.journalPath; store.close();
  const valid = readFileSync(file, 'utf8'); appendFileSync(file, '{"id":"incomplete');
  const recovered = createConversationStore(dir);
  try { assert.equal(readFileSync(file, 'utf8'), valid); assert.equal(recovered.stats(context).raw_unique_posts, 1); assert.equal(readdirSync(dir).some(name => name.includes('.torn-')), true); }
  finally { recovered.close(); }
  appendFileSync(file, 'corrupt\n');
  assert.throws(() => createConversationStore(dir), /JOURNAL_CORRUPT/);
  rmSync(dir, { recursive: true, force: true });
});

test('leases reject stale workers, expire with bounded retries, and explicit stop pauses backlog', () => {
  const dir = temp(); let timestamp = Date.parse('2026-10-30T10:00:00Z');
  const store = createConversationStore(dir, { now: () => new Date(timestamp) });
  try {
    const queued = store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'one', payload: { platform: 'facebook' }, max_attempts: 2 });
    assert.equal(store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'one', payload: {} }).id, queued.id);
    assert.equal(store.claim('wrong-platform', { platform: 'threads' }), null);
    const first = store.claim('worker-a', { lease_ms: 100 })!;
    assert.equal(store.complete(first.id, 'wrong-token'), false);
    timestamp += 101;
    const next = store.claim('worker-b', { lease_ms: 100 })!;
    assert.equal(next.id, first.id); assert.equal(next.attempts, 2); assert.notEqual(next.lease_token, first.lease_token);
    assert.equal(store.complete(first.id, first.lease_token!), false);
    assert.equal(store.retry(next.id, next.lease_token!, 'test failure', 0), true); assert.equal(store.getJob(next.id)!.state, 'FAILED');
    store.ingest(post(), context); assert.equal(store.pause(), 1); assert.equal(store.claim('worker-c'), null);
    assert.equal(store.resume(), 1); const final = store.claim('worker-c')!; assert.equal(store.complete(final.id, final.lease_token!), true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('process restart pauses interrupted running jobs instead of automatically executing them', () => {
  const dir = temp(), store = createConversationStore(dir); store.ingest(post(), context); store.claim('worker-a'); store.close();
  const recovered = createConversationStore(dir);
  try { assert.equal(recovered.jobs()[0]!.state, 'PAUSED'); assert.equal(recovered.claim('worker-b'), null); assert.equal(recovered.resume(), 1); assert.ok(recovered.claim('worker-b')); }
  finally { recovered.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('reservation accounting includes unknown usage and cached responses survive reopening', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const unknown = store.reserveInvocation({ campaign_id: context.campaign_id, campaign_version: context.campaign_version, model: 'test', reserved_usd: 0.7, budget_usd: 1 });
    store.finishInvocation(unknown, { status: 'USAGE_UNKNOWN', cost_usd: null });
    assert.throws(() => store.reserveInvocation({ campaign_id: context.campaign_id, campaign_version: context.campaign_version, model: 'test', reserved_usd: 0.4, budget_usd: 1 }), /BUDGET_EXHAUSTED/);
    const known = store.reserveInvocation({ campaign_id: context.campaign_id, campaign_version: context.campaign_version, platform: 'threads', model: 'test', reserved_usd: 0.2, budget_usd: 1, cache_key: 'snapshot-and-model-hash' });
    store.finishInvocation(known, { status: 'SUCCEEDED', cost_usd: 0.1, usage: { input_tokens: 5 }, response: { classification: 'SUITABLE' } });
    assert.deepEqual(store.costSummary(context.campaign_id, context.campaign_version), { cost_usd: 0.1, reserved_usd: 0.7, usage_unknown: 1 });
    assert.deepEqual(store.costSummary(context.campaign_id, context.campaign_version, 'threads'), { cost_usd: 0.1, reserved_usd: 0, usage_unknown: 0 });
    assert.equal(store.cached<{ classification: string }>('snapshot-and-model-hash')!.response.classification, 'SUITABLE');
  } finally { store.close(); }
  const reopened = createConversationStore(dir);
  try { assert.equal(reopened.cached<{ classification: string }>('snapshot-and-model-hash')!.response.classification, 'SUITABLE'); assert.equal(reopened.costSummary(context.campaign_id, context.campaign_version).usage_unknown, 1); }
  finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('journal rebuild restores snapshots, decisions and paid responses without another model call', () => {
  const dir = temp(), store = createConversationStore(dir);
  const snapshot = store.ingest(post(), context).snapshot!; store.recordDecision(decision(snapshot));
  const id = store.reserveInvocation({ campaign_id: context.campaign_id, campaign_version: context.campaign_version, model: 'test', reserved_usd: 0.1, budget_usd: 1, cache_key: 'cache-1' });
  store.finishInvocation(id, { status: 'SUCCEEDED', cost_usd: 0.05, response: { valid: true } }); store.close();
  rmSync(join(dir, 'conversations.sqlite'));
  const rebuilt = createConversationStore(dir);
  try { assert.equal(rebuilt.stats(context).suitable, 1); assert.equal(rebuilt.stats(context).cost_usd, 0.05); assert.deepEqual(rebuilt.cached('cache-1')!.response, { valid: true }); assert.equal(rebuilt.jobs().length, 1); }
  finally { rebuilt.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('single-writer lock prevents concurrent journal owners and is released on close', () => {
  const dir = temp(), first = createConversationStore(dir);
  assert.throws(() => createConversationStore(dir), /WRITER_ALREADY_OPEN/); first.close();
  const second = createConversationStore(dir); second.close(); rmSync(dir, { recursive: true, force: true });
});

test('an old capture does not overwrite a later entity revision', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const latest = store.ingest(post({ text: 'latest', observed_at: '2026-10-30T11:00:00Z' }), context).snapshot!;
    const old = store.ingest(post({ text: 'old', observed_at: '2026-10-30T10:00:00Z' }), context);
    assert.equal(old.changed, false); assert.equal(old.snapshot!.id, latest.id); assert.equal(old.snapshot!.post!.text, 'latest'); assert.equal(store.observations().length, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('coverage cannot claim empty while more pages or observed comments are present', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    assert.throws(() => store.ingest(post({ coverage: { status: 'OBSERVED_EMPTY', has_more: true } }), context), /EMPTY_COVERAGE_CONTRADICTION/);
    const first = store.ingest(post({ text: '', coverage: { status: 'INACCESSIBLE', stop_reason: 'LOGIN_REQUIRED' } }), context).snapshot!;
    assert.equal(first.coverage.status, 'INACCESSIBLE'); assert.equal(store.stats(context).unrelated, 0);
    store.ingest(post({ entity_type: 'CAPTURE', entity_id: null, text: '', observed_at: '2026-10-30T12:00:00Z', coverage: { status: 'OBSERVED_EMPTY', has_more: false, observed_count: 0 } }), context);
    assert.equal(store.snapshot('threads', 'post-1')!.coverage.status, 'OBSERVED_EMPTY');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('valid final JSON without newline gets a separator before the next append', () => {
  const dir = temp(), first = createConversationStore(dir); first.ingest(post(), context); const file = first.journalPath; first.close();
  writeFileSync(file, readFileSync(file, 'utf8').trimEnd());
  const store = createConversationStore(dir);
  try { store.ingest(post({ entity_id: 'post-2', root_post_id: 'post-2' }), context); assert.equal(store.stats(context).raw_unique_posts, 2); assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2); }
  finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a comment burst supersedes only older pending snapshots, conserving model work', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    store.ingest(post(), context);
    for (let index = 0; index < 10; index++) store.ingest(post({ entity_type: 'COMMENT', entity_id: `comment-${index}`, parent_id: 'post-1', text: `Comment ${index}`, observed_at: '2026-10-30T12:00:00Z' }), context);
    assert.equal(store.jobs(['PENDING']).length, 1); assert.equal(store.jobs(['SUPERSEDED']).length, 10);
    const claimed = store.claim('classifier')!; assert.equal(claimed.payload.snapshot_id, store.snapshot('threads', 'post-1')!.id);
    store.ingest(post({ text: 'Updated root', observed_at: '2026-10-30T13:00:00Z' }), context);
    assert.equal(store.getJob(claimed.id)!.state, 'RUNNING'); assert.equal(store.jobs(['PENDING']).length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('worker RPC runs the same durable ingest and decision API with asynchronous lifecycle', async () => {
  const dir = temp(), store = await createAsyncConversationStore(dir);
  try {
    const result = await store.ingest(post(), context); assert.ok(result.snapshot);
    await store.recordDecision(decision(result.snapshot!)); assert.equal((await store.stats(context)).suitable, 1);
    await assert.rejects(store.recordDecision(decision(result.snapshot!, { evidence_ids: ['invented'] })), /INVALID_EVIDENCE_REFERENCE/);
    assert.equal((await store.stats(context)).suitable, 1);
  } finally { await store.close(); }
  await store.close();
  const reopened = createConversationStore(dir); reopened.close(); rmSync(dir, { recursive: true, force: true });
});

test('sparse rediscovery preserves known metadata while explicit observed empty text is retained', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    store.ingest(post({ author: { id: 'author-1', name: 'Example', role: 'CONSUMER' }, source: { kind: 'GROUP', name: 'Example group' }, permalink: 'https://example.test/post-1', published_at: '2026-10-29T00:00:00Z', media: [{ type: 'IMAGE', url: 'https://example.test/photo' }] }), context);
    const sparse = store.ingest(post({ observed_at: '2026-10-30T11:00:00Z' }), context).snapshot!;
    assert.equal(sparse.post!.author.name, 'Example'); assert.equal(sparse.post!.source.kind, 'GROUP'); assert.equal(sparse.post!.permalink, 'https://example.test/post-1'); assert.equal(sparse.post!.media.length, 1);
    const cleared = store.ingest(post({ text: '', media: [], permalink: null, observed_at: '2026-10-30T12:00:00Z' }), context).snapshot!;
    assert.equal(cleared.post!.text, ''); assert.equal(cleared.post!.media.length, 0); assert.equal(cleared.post!.permalink, null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('SQL stats are scoped to campaign membership and do not count another campaign raw roots', () => {
  const dir = temp(), store = createConversationStore(dir), other = { ...context, campaign_id: 'other-campaign' };
  try {
    store.ingest(post(), context);
    store.ingest(post({ entity_id: 'other-root', root_post_id: 'other-root', platform: 'facebook' }), other);
    assert.equal(store.stats(context).raw_unique_posts, 1); assert.equal(store.stats(context, 'facebook').raw_unique_posts, 0); assert.equal(store.stats(other).raw_unique_posts, 1);
    const snapshot = store.snapshot('threads', 'post-1')!;
    store.recordDecision(decision(snapshot));
    const failed = store.recordDecision(decision(snapshot, { classification: null, assessment_status: 'FAILED', reason_code: 'LATE_RETRY_TIMEOUT', evidence_ids: [] }));
    assert.equal(failed.current, false); assert.equal(store.stats(context).suitable, 1); assert.equal(store.stats(context).failed, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('global categorical ranking is applied before LIMIT instead of ranking only recent rows', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const first = store.ingest(post(), context).snapshot!;
    store.recordDecision(decision(first, { attributes: { observed_need: 'REQUEST', brand_fit: 'ALIGNED', participation_context: 'OPEN', freshness: 'CURRENT' } }));
    for (let i = 0; i < 45; i++) {
      const newer = store.ingest(post({ entity_id: `recent-${i}`, root_post_id: `recent-${i}` }), context).snapshot!;
      store.recordDecision(decision(newer, { attributes: { observed_need: 'EXPERIENCE', brand_fit: 'TOPIC_ONLY', participation_context: 'UNKNOWN', freshness: 'UNKNOWN' } }));
    }
    assert.equal(store.results(context, { classification: 'SUITABLE', ranked: true, limit: 1 })[0]!.snapshot.root_post_id, 'post-1');
    assert.equal(store.results(context, { classification: 'SUITABLE', limit: 1 })[0]!.snapshot.root_post_id, 'recent-44');
    const latest = store.ingest(post({ entity_id: 'newest', root_post_id: 'newest', observed_at: '2026-10-30T12:00:00Z' }), context).snapshot!;
    store.recordDecision(decision(latest, { attributes: { observed_need: 'EXPERIENCE' } }));
    store.recordDecision(decision(first));
    assert.equal(store.results(context, { classification: 'SUITABLE', latestObservedFirst: true, limit: 1 })[0]!.snapshot.root_post_id, 'newest');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('revisit coalescing keeps one missed capture per root and expires TTL without crawling', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    for (let i = 0; i < 3; i++) store.enqueue({ type: 'REVISIT', idempotency_key: `missed-${i}`, not_before: `2026-10-30T0${i}:00:00Z`, payload: { platform: 'threads', root_post_id: 'root', expires_at: '2026-10-31T00:00:00Z' } });
    store.enqueue({ type: 'REVISIT', idempotency_key: 'expired', not_before: '2026-10-29T00:00:00Z', payload: { platform: 'facebook', root_post_id: 'expired-root', expires_at: '2026-10-29T23:00:00Z' } });
    assert.deepEqual(store.coalesceRevisits({ now: '2026-10-30T12:00:00Z' }), { expired: 1, superseded: 2 });
    assert.deepEqual(store.watchSummary(), { pending: 1, next_at: '2026-10-30T02:00:00.000Z' });
    assert.equal(store.jobs(['PENDING'])[0]!.idempotency_key, 'missed-2');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unknown source from conversation parsing cannot erase an identified search source', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    store.ingest(post({ source: { kind: 'PAGE', id: 'page-1', name: 'Example page' } }), context);
    const later = store.ingest(post({ source: { kind: 'UNKNOWN', id: null, name: null, url: null }, observed_at: '2026-10-30T12:00:00Z' }), context).snapshot!;
    assert.deepEqual(later.post!.source, { kind: 'PAGE', id: 'page-1', name: 'Example page' });
    assert.equal(store.observations()[1]!.source!.kind, 'UNKNOWN');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('transactional export is campaign scoped and includes immutable evidence snapshots for decision history', () => {
  const dir = temp(), store = createConversationStore(dir), other = { ...context, campaign_id: 'not-exported' };
  try {
    const first = store.ingest(post(), context).snapshot!; store.recordDecision(decision(first));
    const latest = store.ingest(post({ text: 'Need resolved', observed_at: '2026-10-30T12:00:00Z' }), context).snapshot!;
    store.recordDecision(decision(latest, { classification: 'NOT_YET', reason_code: 'RESOLVED' }));
    store.ingest(post({ entity_id: 'private-other-campaign', root_post_id: 'private-other-campaign' }), other);
    store.enqueue({ type: 'REVISIT', idempotency_key: 'other-campaign-watch', payload: { ...other, platform: 'threads', root_post_id: 'private-other-campaign' } });
    const exported = store.exportSnapshot(context);
    assert.equal(exported.snapshots.length, 1); assert.equal(exported.stats.raw_unique_posts, 1); assert.equal(exported.stats.not_yet, 1);
    assert.equal(exported.conversations[0]!.snapshot.id, latest.id); assert.equal(exported.decisions.length, 2); assert.equal(exported.decision_snapshots.length, 2);
    assert.equal(exported.watch.pending, 0);
    for (const item of exported.decisions) assert.ok(exported.decision_snapshots.some(snapshot => snapshot.id === item.snapshot_id));
    const events = readFileSync(store.journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(exported.watermark.journal_sequence, events.at(-1).seq); assert.equal(exported.watermark.journal_event_id, events.at(-1).id);
    assert.equal(JSON.stringify(exported).includes('private-other-campaign'), false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('worker export stays at one watermark while the next ingestion is queued concurrently', async () => {
  const dir = temp(), store = await createAsyncConversationStore(dir);
  try {
    const first = await store.ingest(post(), context); await store.recordDecision(decision(first.snapshot!));
    const exportWork = store.exportSnapshot(context);
    const later = store.ingest(post({ entity_id: 'later', root_post_id: 'later' }), context);
    const [exported] = await Promise.all([exportWork, later]);
    assert.equal(exported.snapshots.length, 1); assert.equal(exported.conversations.length, 1); assert.equal(exported.stats.raw_unique_posts, 1);
    assert.equal((await store.stats(context)).raw_unique_posts, 2);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('query claims are parameterized and legacy enrichment queues derive first nonempty POST provenance', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    store.ingest(post({ provenance: { run_id: 'test', method: 'SEARCH', query: '' } }), context);
    store.ingest(post({ provenance: { run_id: 'test', method: 'SEARCH', query: 'query A' } }), context);
    store.ingest(post({ provenance: { run_id: 'test', method: 'SEARCH', query: 'later query B' } }), context);
    const legacy = store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'legacy-query-job', payload: { platform: 'threads', root_post_id: 'post-1' } });
    const quoted = "query ' OR 1=1 --";
    const explicit = store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'explicit-query-job', payload: { platform: 'threads', root_post_id: 'explicit', query: quoted } });
    store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'other-platform', payload: { platform: 'facebook', root_post_id: 'other', query: 'facebook query' } });
    store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'future-query', not_before: '2099-01-01T00:00:00Z', payload: { platform: 'threads', root_post_id: 'future', query: 'future query' } });
    assert.deepEqual(new Set(store.enrichmentQueries('threads')), new Set(['query A', quoted]));
    assert.equal(store.claim('comments', { types: ['ENRICH_CONVERSATION'], platform: 'threads', query: 'later query B' }), null);
    const selected = store.claim('comments', { types: ['ENRICH_CONVERSATION'], platform: 'threads', query: quoted })!;
    assert.equal(selected.id, explicit.id); assert.equal(store.getJob(legacy.id)!.state, 'PENDING'); store.complete(selected.id, selected.lease_token!);
    assert.equal(store.claim('comments', { types: ['ENRICH_CONVERSATION'], platform: 'threads', query: 'query A' })!.id, legacy.id);
    assert.throws(() => store.claim('classifier', { types: ['CLASSIFY'], query: 'query A' }), /QUERY_FILTER_REQUIRES_ENRICHMENT/);
    assert.throws(() => store.claim('any', { query: 'query A' }), /QUERY_FILTER_REQUIRES_ENRICHMENT/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
