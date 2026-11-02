import type { ConversationSnapshot, EvaluationContext } from './conversation.js';

/** The last two values are readable legacy history only; new policy emits two outcomes. */
export type ConversationClassification = 'SUITABLE' | 'NOT_SUITABLE' | 'NOT_YET' | 'UNRELATED';
export type AssessmentStatus = 'ASSESSED' | 'PENDING' | 'FAILED';
export interface ConversationActionTarget { entity_id: string; type: 'POST' | 'COMMENT' }
export interface ConversationTemporalEvidence {
  entity_id: string;
  evidence_id: string;
  quote: string;
  published_at: string;
  expires_at: string;
}
/** An explicit timestamp with a timezone; never interpret a locale-dependent date. */
export function isAssessmentTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
export interface ConversationDecisionInput extends EvaluationContext {
  snapshot_id: string;
  classification: ConversationClassification | null;
  assessment_status: AssessmentStatus;
  reason_code: string;
  evidence_ids: string[];
  model: string;
  intents?: string[];
  action_target?: ConversationActionTarget | null;
  attributes?: Record<string, string | number | boolean | null>;
  created_at?: string;
  /** Request as-of time, not the later model-response completion time. Absent on legacy decisions. */
  evaluated_at?: string;
  valid_until?: string | null;
  temporal_evidence?: ConversationTemporalEvidence[];
  goal_assessment?: { contract_hash: string; contract: import('./goal-filter.js').GoalContract; candidate_entity_id: string; candidate_description: string;
    checks: import('./goal-filter.js').GoalCheck[]; branches: { id: string; state: string }[] };
  goal_review?: { primary_classification: ConversationClassification | null; primary_reason: string;
    primary_assessment: ConversationDecisionInput['goal_assessment'] | null };
  goal_scope_review?: { verdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNCLEAR'; explanation: string;
    evidence: { id: string; quote: string }[]; model: string };
  goal_comment_review?: { primary_classification: ConversationClassification | null; primary_reason: string;
    primary_assessment: ConversationDecisionInput['goal_assessment'] | null;
    comment_classification: ConversationClassification | null; comment_assessment_status: AssessmentStatus;
    comment_reason: string; comment_assessment: ConversationDecisionInput['goal_assessment'] | null };
}
export interface ConversationDecision extends ConversationDecisionInput {
  id: string;
  platform: ConversationSnapshot['platform'];
  root_post_id: string;
  snapshot_revision: number;
  created_at: string;
}
export function validateConversationDecision(input: ConversationDecisionInput, snapshot: ConversationSnapshot): void {
  if (input.snapshot_id !== snapshot.id) throw Error('DECISION_SNAPSHOT_MISMATCH');
  if (!['ASSESSED', 'PENDING', 'FAILED'].includes(input.assessment_status)) throw Error('INVALID_ASSESSMENT_STATUS');
  if (input.classification !== null && !['SUITABLE', 'NOT_SUITABLE', 'NOT_YET', 'UNRELATED'].includes(input.classification)) throw Error('INVALID_CLASSIFICATION');
  if (input.assessment_status === 'ASSESSED' && input.classification === null) throw Error('ASSESSED_CLASSIFICATION_REQUIRED');
  if (input.assessment_status !== 'ASSESSED' && input.classification !== null) throw Error('TECHNICAL_FAILURE_IS_NOT_CLASSIFICATION');
  if (!input.reason_code?.trim() || !input.model?.trim()) throw Error('DECISION_PROVENANCE_REQUIRED');
  if (!Array.isArray(input.evidence_ids) || input.evidence_ids.some(id => typeof id !== 'string')) throw Error('INVALID_EVIDENCE_IDS');
  const spans = new Set(snapshot.spans.map(span => span.id));
  if (new Set(input.evidence_ids).size !== input.evidence_ids.length || input.evidence_ids.some(id => !spans.has(id))) throw Error('INVALID_EVIDENCE_REFERENCE');
  if (input.classification === 'SUITABLE' && !input.evidence_ids.length) throw Error('SUITABLE_EVIDENCE_REQUIRED');
  if (input.action_target) {
    const entity = input.action_target.type === 'POST' ? snapshot.post : snapshot.comments.find(comment => comment.entity_id === input.action_target?.entity_id);
    if (!entity || entity.entity_id !== input.action_target.entity_id) throw Error('INVALID_ACTION_TARGET');
  }
  if (input.created_at && !Number.isFinite(Date.parse(input.created_at))) throw Error('INVALID_DECISION_TIME');
  if (input.evaluated_at !== undefined && !isAssessmentTime(input.evaluated_at)) throw Error('INVALID_ASSESSMENT_TIME');
  if (input.temporal_evidence !== undefined) {
    if (!Array.isArray(input.temporal_evidence)) throw Error('INVALID_TEMPORAL_EVIDENCE');
    for (const proof of input.temporal_evidence) {
      const span = snapshot.spans.find(item => item.id === proof?.evidence_id);
      const entity = [snapshot.post, ...snapshot.comments].find(item => item?.entity_id === proof?.entity_id);
      if (!proof || !span || !entity || span.entity_id !== entity.entity_id || !input.evidence_ids.includes(span.id)
        || typeof proof.quote !== 'string' || !proof.quote.trim() || !span.text.includes(proof.quote)
        || proof.published_at !== entity.published_at || !isAssessmentTime(proof.published_at) || !isAssessmentTime(proof.expires_at)
        || Date.parse(proof.expires_at) < Date.parse(proof.published_at)) throw Error('INVALID_TEMPORAL_EVIDENCE');
    }
  }
  if (input.valid_until !== undefined && input.valid_until !== null) {
    if (!isAssessmentTime(input.valid_until) || !input.evaluated_at || Date.parse(input.valid_until) <= Date.parse(input.evaluated_at)
      || !input.temporal_evidence?.some(proof => Date.parse(proof.expires_at) === Date.parse(input.valid_until!))) throw Error('INVALID_DECISION_VALIDITY');
  }
}
