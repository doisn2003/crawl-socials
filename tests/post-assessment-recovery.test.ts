import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { recoverPostAssessmentJobs } from '../src/application/post-assessment-recovery.js';
import type { EvaluationContext } from '../src/domain/conversation.js';

test('completed technical pending work is recovered once durably, without replaying assessed or genuinely uncertain posts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-post-recovery-'));
  const context: EvaluationContext = { campaign_id: 'recovery', campaign_version: '1', filter_version: 'opportunity-posts-consistent-v1' };
  let store = await createAsyncConversationStore(dir);
  try {
    for (const [id, reason, status] of [
      ['repair', 'POST_PRIMARY_UNRESOLVED', 'PENDING'],
      ['language', 'CONTENT_LANGUAGE_UNVERIFIED', 'PENDING'],
      ['uncertain', 'POST_EVIDENCE_INCOMPLETE', 'PENDING'],
      ['conflict', 'POST_REVIEW_FACT_CONFLICT', 'PENDING'],
      ['delivered', 'POST_PRIMARY_UNRESOLVED', 'PENDING'],
      ['assessed', 'POST_OPPORTUNITY_CONSISTENT', 'ASSESSED'],
    ] as const) {
      const { snapshot } = await store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: id, root_post_id: id,
        parent_id: null, text: 'Mình muốn tìm quán cafe yên tĩnh.', observed_at: '2026-11-06T00:00:00Z',
        provenance: { run_id: 'recovery', method: 'MOCK' } }, context);
      const job = await store.claim('initial', { context, types: ['CLASSIFY'] });
      assert.ok(snapshot && job);
      await store.recordDecision({ ...context, snapshot_id: snapshot.id, classification: status === 'ASSESSED' ? 'SUITABLE' : null,
        assessment_status: status, reason_code: reason, evidence_ids: status === 'ASSESSED' ? [snapshot.spans[0]!.id] : [], model: 'mock' });
      await store.complete(job.id, job.lease_token!);
    }
    assert.equal(await recoverPostAssessmentJobs(store, context, new Set(['threads:delivered'])), 2);
    assert.equal(await recoverPostAssessmentJobs(store, context, new Set(['threads:delivered'])), 0);
    for (let i = 0; i < 2; i++) { const job = await store.claim('repair', { context, types: ['CLASSIFY'] }); assert.ok(job); await store.complete(job.id, job.lease_token!); }
    await store.close(); store = await createAsyncConversationStore(dir);
    assert.equal(await recoverPostAssessmentJobs(store, context, new Set(['threads:delivered'])), 0);
    assert.equal((await store.jobs(undefined, context)).length, 8);
    assert.equal(await recoverPostAssessmentJobs(store, { ...context, filter_version: 'coverage-off-v1' }), 0);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
