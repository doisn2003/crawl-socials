import type { ConversationDecision, ConversationDecisionInput } from './conversation-decision.js';
import { FILTER_VERSIONS } from '../shared/filter-policy.js';

export const POST_REVIEW_FACT_CONFLICT = 'POST_REVIEW_FACT_CONFLICT';
export const QUALITY_REVIEW_CONFLICT = 'POST_QUALITY_REVIEW_CONFLICT';
export const QUALITY_REVIEW_UNCONFIRMED = 'POST_QUALITY_REVIEW_UNCONFIRMED';
export const UNCONFIRMED_REVIEW_REASONS = [
  'POST_EVIDENCE_INCOMPLETE', 'CONTENT_LANGUAGE_EVIDENCE_UNVERIFIED', 'CONTENT_LANGUAGE_CANDIDATE_UNVERIFIED',
];

export function completedQualityRejection(reason: string, reviewState: unknown): string | null {
  if (reason === POST_REVIEW_FACT_CONFLICT) return QUALITY_REVIEW_CONFLICT;
  return reviewState === 'COMPLETE' && UNCONFIRMED_REVIEW_REASONS.includes(reason) ? QUALITY_REVIEW_UNCONFIRMED : null;
}

/** A valid second reading closes QUALITY. Transport errors and unfinished reviews do not. */
export function resolveCompletedQualityReview<T extends ConversationDecisionInput>(decision: T): T {
  if (decision.filter_version !== FILTER_VERSIONS.QUALITY || decision.assessment_status !== 'PENDING') return decision;
  const reason = completedQualityRejection(decision.reason_code, decision.attributes?.review_state);
  if (!reason) return decision;
  return { ...decision, classification: 'NOT_SUITABLE', assessment_status: 'ASSESSED', action_target: null,
    reason_code: reason,
    attributes: { ...decision.attributes, review_state: 'COMPLETE', previous_pending_reason: decision.reason_code } };
}

/** Saved decisions remain in the audit history. The new view links back to its source decision. */
export function presentCompletedQualityReview(decision: ConversationDecision): ConversationDecision {
  const resolved = resolveCompletedQualityReview(decision);
  return resolved === decision ? decision : { ...resolved, id: 'quality-review-' + decision.id,
    attributes: { ...resolved.attributes, resolved_from_decision_id: decision.id } };
}
