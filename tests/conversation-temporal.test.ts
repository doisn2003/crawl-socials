import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { validateConversationDecision, type ConversationDecisionInput } from '../src/domain/conversation-decision.js';
import type { ConversationObservation, ConversationSnapshot, EvaluationContext } from '../src/domain/conversation.js';

const context: EvaluationContext = { campaign_id: 'travel-test', campaign_version: '1', filter_version: 'temporal-test' };
const at = '2026-10-30T10:00:00.000Z', deadline = '2026-10-30T12:00:00.000Z';
const observation = (overrides: Partial<ConversationObservation> = {}): ConversationObservation => ({ platform: 'threads', entity_type: 'POST', entity_id: 'hotel-request',
  root_post_id: 'hotel-request', parent_id: null, text: 'I need a hotel before noon today.', published_at: at, observed_at: at,
  provenance: { run_id: 'synthetic-temporal-test', method: 'FIXTURE' }, ...overrides });
const decision = (snapshot: ConversationSnapshot, overrides: Partial<ConversationDecisionInput> = {}): ConversationDecisionInput => ({ ...context,
  snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED', reason_code: 'EXPLICIT_NEED',
  evidence_ids: [snapshot.spans[0]!.id], model: 'synthetic-model', ...overrides });
const bounded = (snapshot: ConversationSnapshot): ConversationDecisionInput => decision(snapshot, { evaluated_at: at, valid_until: deadline,
  temporal_evidence: [{ entity_id: snapshot.post!.entity_id, evidence_id: snapshot.spans[0]!.id, quote: 'before noon today', published_at: at, expires_at: deadline }] });
const temp = () => mkdtempSync(join(tmpdir(), 'csd-temporal-test-'));

test('legacy decisions retain exact behavior and optional temporal fields are not backfilled', () => {
  const directory = temp(), store = createConversationStore(directory, { now: () => new Date('2030-01-01T00:00:00.000Z') });
  try {
    const snapshot = store.ingest(observation(), context).snapshot!;
    const original = store.recordDecision(decision(snapshot)).decision;
    assert.equal(store.stats(context).suitable, 1); assert.equal(store.results(context)[0]!.stale, false);
    assert.deepEqual(store.assessmentsDue(context), []);
    assert.equal(Object.hasOwn(original, 'evaluated_at'), false); assert.equal(Object.hasOwn(original, 'valid_until'), false);
    assert.deepEqual(store.decisionHistory(context), [original]);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a time boundary makes unchanged current content pending, while export preserves raw and immutable history', () => {
  const directory = temp(); let clock = '2026-10-30T11:59:59.999Z';
  const store = createConversationStore(directory, { now: () => new Date(clock) });
  try {
    const snapshot = store.ingest(observation(), context).snapshot!;
    const original = store.recordDecision(bounded(snapshot)).decision;
    assert.equal(store.results(context, { classification: 'SUITABLE' }).length, 1); assert.equal(store.assessmentsDue(context).length, 0);
    clock = deadline;
    assert.equal(store.results(context).length, 0); assert.equal(store.results(context, { include_stale: true })[0]!.stale, true);
    const stats = store.stats(context); assert.equal(stats.suitable, 0); assert.equal(stats.pending, 1); assert.equal(stats.unrelated, 0); assert.equal(stats.stale_decisions, 1);
    assert.equal(store.assessmentsDue(context)[0]!.snapshot.id, snapshot.id);
    const exported = store.exportSnapshot(context);
    assert.equal(exported.conversations.length, 0); assert.equal(exported.snapshots.length, 1); assert.deepEqual(exported.decisions, [original]);
    assert.equal(exported.stats.pending, 1); assert.equal(exported.by_platform.threads.pending, 1); assert.equal(exported.watermark.captured_at, deadline);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unchanged rediscovery can receive one time-keyed job without inventing a content revision or retry polling loop', () => {
  const directory = temp(); let clock = at;
  const store = createConversationStore(directory, { now: () => new Date(clock) });
  try {
    const first = store.ingest(observation(), context), snapshot = first.snapshot!;
    store.recordDecision(bounded(snapshot));
    const originalJob = store.claim('worker', { types: ['CLASSIFY'], context })!; store.complete(originalJob.id, originalJob.lease_token!);
    clock = '2026-10-30T12:00:01.000Z';
    const same = store.ingest(observation({ observed_at: clock }), context);
    assert.equal(same.snapshot!.id, snapshot.id); assert.equal(same.changed, false); assert.equal(store.jobs().length, 1);
    const due = store.assessmentsDue(context); assert.equal(due.length, 1);
    const job = store.requestAssessment(context, snapshot.id, { evaluated_at: clock });
    assert.notEqual(job.id, originalJob.id); assert.equal(job.payload.evaluated_at, clock);
    assert.equal(store.requestAssessment(context, snapshot.id, { evaluated_at: '2026-10-30T19:00:01+07:00' }).id, job.id);
    assert.equal(store.jobs().length, 2); assert.equal(store.assessmentsDue(context).length, 0);
    assert.equal(store.stats(context).raw_unique_posts, 1);
    for (let i = 0; i < job.max_attempts; i++) {
      const claimed = store.claim('worker', { types: ['CLASSIFY'], context })!;
      store.retry(claimed.id, claimed.lease_token!, 'MODEL_FAILURE', 0);
    }
    assert.equal(store.getJob(job.id)!.state, 'FAILED'); assert.equal(store.assessmentsDue(context).length, 0);
    clock = '2026-10-30T12:01:00.000Z';
    assert.notEqual(store.requestAssessment(context, snapshot.id, { evaluated_at: clock }).id, job.id, 'explicit retry may request a new assessment');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('later requested and committed times both guard same-snapshot results; newer technical pending replaces earlier assessed output', () => {
  const directory = temp(), store = createConversationStore(directory, { now: () => new Date('2026-10-30T14:00:00.000Z') });
  try {
    const snapshot = store.ingest(observation(), context).snapshot!;
    store.recordDecision(decision(snapshot));
    const requestedAt = '2026-10-30T13:00:00.000Z'; store.requestAssessment(context, snapshot.id, { evaluated_at: requestedAt });
    assert.equal(store.results(context).length, 0); assert.equal(store.stats(context).pending, 1);
    assert.equal(store.recordDecision(decision(snapshot, { evaluated_at: '2026-10-30T12:00:00.000Z' })).current, false);
    assert.equal(store.recordDecision(decision(snapshot, { created_at: '2030-01-01T00:00:00.000Z' })).current, false, 'late completion time is not assessment time');
    const technical = store.recordDecision(decision(snapshot, { evaluated_at: requestedAt, classification: null, assessment_status: 'PENDING', reason_code: 'MODEL_USAGE_UNKNOWN' }));
    assert.equal(technical.current, true); assert.equal(store.results(context)[0]!.decision.assessment_status, 'PENDING');
    const settled = store.recordDecision(decision(snapshot, { evaluated_at: '2026-10-30T13:30:00.000Z', classification: 'NOT_YET', reason_code: 'REQUEST_WINDOW_ENDED' }));
    assert.equal(settled.current, true);
    assert.equal(store.recordDecision(decision(snapshot, { evaluated_at: requestedAt })).current, false);
    assert.equal(store.stats(context).suitable, 0); assert.equal(store.stats(context).not_yet, 1);
    assert.equal(store.recordDecision(decision(snapshot, { campaign_id: 'other-campaign' })).current, true, 'another context has an independent clock');
    assert.equal(store.stats({ ...context, campaign_id: 'other-campaign' }).suitable, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('newer time request supersedes only queued older work, keeps running work auditable and rejects obsolete content', () => {
  const directory = temp(), store = createConversationStore(directory, { now: () => new Date('2026-10-30T14:00:00.000Z') });
  try {
    const first = store.ingest(observation(), context), snapshot = first.snapshot!;
    const older = store.requestAssessment(context, snapshot.id, { evaluated_at: '2026-10-30T11:00:00.000Z' });
    assert.equal(store.getJob(first.job!.id)!.state, 'SUPERSEDED');
    const running = store.claim('worker', { types: ['CLASSIFY'], context })!; assert.equal(running.id, older.id);
    store.requestAssessment(context, snapshot.id, { evaluated_at: '2026-10-30T12:00:00.000Z' });
    assert.equal(store.getJob(running.id)!.state, 'RUNNING');
    assert.equal(store.recordDecision(decision(snapshot, { evaluated_at: '2026-10-30T11:00:00.000Z' })).current, false);
    store.ingest(observation({ text: 'A new hotel request for next week.', observed_at: '2026-10-30T13:00:00.000Z' }), context);
    assert.throws(() => store.requestAssessment(context, snapshot.id, { evaluated_at: '2026-10-30T14:00:00.000Z' }), /ASSESSMENT_SNAPSHOT_STALE/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('time-keyed request and stale guard recover after journal append crash and complete SQLite rebuild', () => {
  const directory = temp(), clock = '2026-10-30T13:00:00.000Z'; let crash = false;
  let store = createConversationStore(directory, { now: () => new Date(clock), afterJournalAppend: type => { if (crash && type === 'JOB_ENQUEUED') { crash = false; throw Error('SIMULATED_REQUEST_CRASH'); } } });
  try {
    const snapshot = store.ingest(observation(), context).snapshot!; store.recordDecision(bounded(snapshot)); crash = true;
    assert.throws(() => store.requestAssessment(context, snapshot.id, { evaluated_at: clock }), /SIMULATED_REQUEST_CRASH/);
    const journal = readFileSync(store.journalPath, 'utf8'); store.close();
    store = createConversationStore(directory, { now: () => new Date(clock) });
    assert.equal(store.assessmentsDue(context).length, 0); assert.equal(store.recordDecision(decision(snapshot)).current, false);
    store.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(join(directory, 'conversations.sqlite' + suffix), { force: true });
    store = createConversationStore(directory, { now: () => new Date(clock) });
    assert.equal(store.assessmentsDue(context).length, 0); assert.equal(store.results(context).length, 0);
    assert.equal(store.jobs().filter(job => job.payload.evaluated_at === clock).length, 1);
    assert.equal(store.recordDecision(decision(snapshot)).current, false);
    assert.ok(readFileSync(store.journalPath, 'utf8').startsWith(journal));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('temporal evidence validates exact entity/span/quote/native publication and future validity without calendar guessing', () => {
  const directory = temp(), store = createConversationStore(directory);
  try {
    const snapshot = store.ingest(observation(), context).snapshot!, valid = bounded(snapshot), proof = valid.temporal_evidence![0]!;
    validateConversationDecision(valid, snapshot);
    for (const patch of [{ entity_id: 'invented' }, { evidence_id: 'invented' }, { quote: 'tomorrow morning' }, { published_at: '2026-10-29T10:00:00Z' },
      { expires_at: '2026-10-29T12:00:00Z' }, { expires_at: '10/30/2026' }]) {
      assert.throws(() => validateConversationDecision({ ...valid, temporal_evidence: [{ ...proof, ...patch }] }, snapshot), /INVALID_TEMPORAL_EVIDENCE/);
    }
    for (const patch of [{ evaluated_at: 'today' }, { valid_until: at }, { temporal_evidence: [] }, { valid_until: '2026-10-30T13:00:00Z' }]) {
      assert.throws(() => validateConversationDecision({ ...valid, ...patch }, snapshot), /INVALID_ASSESSMENT_TIME|INVALID_DECISION_VALIDITY/);
    }
    const { evaluated_at: _evaluatedAt, ...withoutAsOf } = valid;
    assert.throws(() => validateConversationDecision(withoutAsOf, snapshot), /INVALID_DECISION_VALIDITY/);
    assert.throws(() => store.requestAssessment(context, snapshot.id, { evaluated_at: '2026-10-29T10:00:00Z' }), /ASSESSMENT_BEFORE_OBSERVATION/);
    assert.throws(() => store.requestAssessment(context, snapshot.id, { evaluated_at: '2100-01-01T00:00:00Z' }), /ASSESSMENT_TIME_IN_FUTURE/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('worker exposes temporal due/request APIs and keeps original evidence across asynchronous reassessment', async () => {
  const directory = temp(), store = await createAsyncConversationStore(directory);
  try {
    const oldAt = '2001-01-01T00:00:00.000Z', oldEnd = '2001-01-01T12:00:00.000Z';
    const snapshot = (await store.ingest(observation({ published_at: oldAt, observed_at: oldAt }), context)).snapshot!;
    await store.recordDecision(decision(snapshot, { evaluated_at: oldAt, valid_until: oldEnd,
      temporal_evidence: [{ entity_id: snapshot.post!.entity_id, evidence_id: snapshot.spans[0]!.id, quote: 'before noon today', published_at: oldAt, expires_at: oldEnd }] }));
    const due = await store.assessmentsDue(context); assert.equal(due.length, 1);
    const requested = new Date().toISOString(), job = await store.requestAssessment(context, snapshot.id, { evaluated_at: requested });
    assert.equal(job.payload.evaluated_at, requested); assert.equal((await store.assessmentsDue(context)).length, 0);
    assert.equal((await store.stats(context)).pending, 1); assert.equal((await store.getSnapshot(snapshot.id))!.content_hash, snapshot.content_hash);
  } finally { await store.close(); rmSync(directory, { recursive: true, force: true }); }
});
