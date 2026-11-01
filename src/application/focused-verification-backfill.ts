import type { AsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';
import type { ConversationJob } from '../infrastructure/storage/conversation-store.js';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import { contentHash, contextKey, stableJson } from '../domain/conversation.js';
import type { ConversationSnapshot } from '../domain/conversation.js';
import { validateConversationDecision } from '../domain/conversation-decision.js';
import type { ConversationDecisionInput } from '../domain/conversation-decision.js';
import type { ModelGateway } from './ports/model-gateway.js';
import { auditTentativeOpportunitiesV2, FOCUSED_VERIFIER_VERSION, FOCUSED_VERIFIER_PROMPT_SHA256 } from './opportunity-verifier-v2.js';
import type { FocusedVerification } from './opportunity-verifier-v2.js';
import { asDecisionInput, combinedEvaluationRecipe, combinedFilterVersion, evaluationContext, verificationJobKey } from './evaluation-upgrade.js';

type VerificationStore = Pick<AsyncConversationStore, 'recordDecision' | 'enqueue' | 'claim' | 'complete' | 'retry' | 'getSnapshot' | 'snapshot' | 'results'>;
export function focusedVerificationDecision(campaign: CampaignPlan, snapshot: ConversationSnapshot,
  proposal: ConversationDecisionInput, audit: FocusedVerification): ConversationDecisionInput {
  const context = evaluationContext(campaign);
  if (campaign.filter_version !== combinedFilterVersion() || contextKey(proposal) !== contextKey(context) || proposal.classification !== 'SUITABLE' || proposal.assessment_status !== 'ASSESSED'
    || audit.snapshot_id !== snapshot.id || audit.version !== FOCUSED_VERIFIER_VERSION || audit.prompt_sha256 !== FOCUSED_VERIFIER_PROMPT_SHA256) throw Error('FOCUSED_DECISION_CONTEXT_MISMATCH');
  validateConversationDecision(proposal, snapshot);
  const classification = audit.verdict === 'KEEP' ? 'SUITABLE' : audit.verdict === 'DOWNGRADE_NOT_YET' ? 'NOT_YET'
    : audit.verdict === 'DOWNGRADE_UNRELATED' ? 'UNRELATED' : null;
  const decision: ConversationDecisionInput = { ...asDecisionInput(proposal), ...context, classification,
    assessment_status: classification === null ? 'PENDING' : 'ASSESSED', reason_code: `FOCUSED_${audit.reason}`,
    evidence_ids: [...new Set([...proposal.evidence_ids, ...audit.evidence_ids])],
    // Verifier tests contradictions, not the action target. Its evidence may describe a promotional parent.
    action_target: classification === 'SUITABLE' ? proposal.action_target ?? null : null,
    model: audit.model, attributes: { ...proposal.attributes, primary_model: proposal.attributes?.primary_model ?? proposal.model,
      proposed_classification: 'SUITABLE', verification_status: audit.verdict === 'UNRESOLVED' ? 'UNRESOLVED' : 'COMPLETED',
      verification_verdict: audit.verdict, verification_version: audit.version, verification_prompt_sha256: audit.prompt_sha256,
      verification_invocation_id: audit.invocation_id, verification_error_code: audit.error_code ?? null,
      combined_recipe_sha256: contentHash(combinedEvaluationRecipe()), focused_audit_json: JSON.stringify(audit),
      need_summary: audit.explanation } };
  validateConversationDecision(decision, snapshot); return decision;
}

/** Publish only PENDING, then enqueue the proposal durably. A successful job is never re-created. */
export async function enqueueFocusedVerification(store: VerificationStore, campaign: CampaignPlan,
  snapshot: ConversationSnapshot, proposal: ConversationDecisionInput): Promise<ConversationJob> {
  const context = evaluationContext(campaign);
  if (campaign.filter_version !== combinedFilterVersion() || contextKey(context) !== contextKey(proposal) || proposal.classification !== 'SUITABLE' || proposal.assessment_status !== 'ASSESSED') throw Error('VERIFY_PROPOSAL_INVALID');
  validateConversationDecision(proposal, snapshot);
  const recipeHash = contentHash(combinedEvaluationRecipe());
  await store.recordDecision({ ...asDecisionInput(proposal), classification: null, assessment_status: 'PENDING', reason_code: 'AWAITING_FOCUSED_VERIFIER',
    attributes: { ...proposal.attributes, proposed_classification: 'SUITABLE', primary_model: proposal.model,
      combined_recipe_sha256: recipeHash, verification_status: 'REQUIRED' } });
  return store.enqueue({ type: 'VERIFY', idempotency_key: verificationJobKey(context, snapshot.id),
    payload: { ...context, platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_id: snapshot.id,
      recipe_sha256: recipeHash, proposal: asDecisionInput(proposal) }, priority: 20, max_attempts: 3 });
}
/** Caller supplies the SAME campaign gateway/ledger pool, never a fresh per-upgrade budget. */
export async function processFocusedVerificationBatch(input: {
  store: VerificationStore; campaign: CampaignPlan; gateway: ModelGateway; signal?: AbortSignal; batchSize?: number;
}) {
  const size = input.batchSize ?? 8;
  if (!Number.isSafeInteger(size) || size < 1 || size > 16) throw Error('VERIFY_BATCH_SIZE_INVALID');
  if (input.campaign.filter_version !== combinedFilterVersion()) throw Error('VERIFY_CAMPAIGN_POLICY_MISMATCH');
  const context = evaluationContext(input.campaign), recipeHash = contentHash(combinedEvaluationRecipe());
  const jobs: ConversationJob[] = [], snapshots: ConversationSnapshot[] = [], proposals: ConversationDecisionInput[] = [];
  let stale = 0, alreadyCompleted = 0;
  const assessed = new Set((await input.store.results(context)).filter(row => row.decision.assessment_status === 'ASSESSED'
    && row.decision.attributes?.verification_status === 'COMPLETED').map(row => row.snapshot.id));
  for (let i = 0; i < size; i++) {
    if (input.signal?.aborted) break;
    const job = await input.store.claim('focused-verifier', { types: ['VERIFY'], context, lease_ms: 600000 }); if (!job) break;
    if (job.payload.recipe_sha256 !== recipeHash || contextKey(job.payload as unknown as ConversationDecisionInput) !== contextKey(context)) throw Error('VERIFY_JOB_POLICY_MISMATCH');
    const snapshot = await input.store.getSnapshot(String(job.payload.snapshot_id)), latest = snapshot && await input.store.snapshot(snapshot.platform, snapshot.root_post_id);
    if (!snapshot || !latest || snapshot.id !== latest.id) {
      if (latest) await input.store.enqueue({ type: 'CLASSIFY', idempotency_key: stableJson(['CLASSIFY', contextKey(context), latest.id]),
        payload: { ...context, platform: latest.platform, root_post_id: latest.root_post_id, snapshot_id: latest.id }, priority: 50 });
      await input.store.complete(job.id, job.lease_token!); stale++; continue;
    }
    if (assessed.has(snapshot.id)) { await input.store.complete(job.id, job.lease_token!); alreadyCompleted++; continue; }
    const proposal = job.payload.proposal as ConversationDecisionInput;
    if (!proposal || contextKey(proposal) !== contextKey(context)) throw Error('VERIFY_JOB_PROPOSAL_MISMATCH');
    validateConversationDecision(proposal, snapshot);
    jobs.push(job); snapshots.push(snapshot); proposals.push(proposal);
  }
  const result = await auditTentativeOpportunitiesV2(input.campaign, snapshots, proposals, input.gateway,
    { batchSize: size, ...(input.signal ? { signal: input.signal } : {}) });
  const decisions: ConversationDecisionInput[] = [], failures: Array<{ snapshot_id: string; code: string }> = [];
  for (const [index, job] of jobs.entries()) {
    const snapshot = snapshots[index]!, proposal = proposals[index]!, audit = result.audits.find(row => row.snapshot_id === snapshot.id);
    if (!audit) throw Error('VERIFY_AUDIT_MISSING');
    const decision = focusedVerificationDecision(input.campaign, snapshot, proposal, audit);
    if (audit.error_code && job.attempts >= job.max_attempts) decision.assessment_status = 'FAILED';
    await input.store.recordDecision(decision); decisions.push(decision);
    if (audit.error_code) failures.push({ snapshot_id: snapshot.id, code: audit.error_code });
    if (input.signal?.aborted) continue; // Caller pauses interrupted leases after this function settles.
    if (audit.error_code) await input.store.retry(job.id, job.lease_token!, audit.error_code, Math.min(30000, 1000 * 2 ** (job.attempts - 1)));
    else await input.store.complete(job.id, job.lease_token!); // Semantic missing context waits for new evidence.
  }
  return { decisions, failures, model_results: result.model_results, audits: result.audits, stale, already_completed: alreadyCompleted,
    claimed: jobs.length + stale + alreadyCompleted };
}
