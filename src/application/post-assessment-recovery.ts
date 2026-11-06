import { contentHash, type EvaluationContext } from '../domain/conversation.js';
import type { AsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';

const recoverable = new Set([
  'POST_PRIMARY_UNRESOLVED', 'POST_REVIEW_UNRESOLVED', 'POST_EVIDENCE_REQUIRED',
  'POST_EVIDENCE_FORMAT_INVALID', 'POST_ITEM_MISSING', 'POST_ITEM_DUPLICATED',
  'POST_BATCH_INCOMPLETE', 'POST_REVIEW_BATCH_INCOMPLETE',
  'POST_REVIEW_ITEM_INVALID', 'MODEL_INCOMPLETE_RESPONSE', 'MODEL_OUTPUT_NOT_JSON', 'MODEL_RESPONSE_NOT_JSON',
  'CONTENT_LANGUAGE_UNVERIFIED', 'CONTENT_LANGUAGE_EVIDENCE_UNVERIFIED', 'CONTENT_LANGUAGE_CANDIDATE_UNVERIFIED',
]);

/** One durable recovery job per unchanged snapshot. Model/cache attempt limits still apply.
 * Semantic uncertainty and factual review conflicts must wait for evidence, not a majority vote. */
export async function recoverPostAssessmentJobs(
  store: Pick<AsyncConversationStore, 'results' | 'jobs' | 'enqueue' | 'getJobByKey'>,
  context: EvaluationContext, excludedRoots: ReadonlySet<string> = new Set(),
): Promise<number> {
  if (!context.filter_version.startsWith('opportunity-posts-')) return 0;
  const active = new Set((await store.jobs(['PENDING', 'RETRY', 'RUNNING', 'PAUSED'], context))
    .filter(job => job.type === 'CLASSIFY').map(job => String(job.payload.snapshot_id)));
  let queued = 0;
  for (const { snapshot, decision, stale } of await store.results(context)) {
    if (stale || active.has(snapshot.id) || excludedRoots.has(snapshot.platform + ':' + snapshot.root_post_id)
      || !['PENDING', 'FAILED'].includes(decision.assessment_status) || !recoverable.has(decision.reason_code)) continue;
    const key = 'post-technical-recovery-v1:' + contentHash({ context, snapshot: snapshot.id });
    if (await store.getJobByKey(key)) continue;
    await store.enqueue({ type: 'CLASSIFY', idempotency_key: key, priority: 55, max_attempts: 3,
      payload: { ...context, platform: snapshot.platform, root_post_id: snapshot.root_post_id,
        snapshot_id: snapshot.id, recovery_reason: decision.reason_code } });
    queued++;
  }
  return queued;
}
