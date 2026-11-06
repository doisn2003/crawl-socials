import type { CampaignPlan } from './campaign-plan.js';
import type { ConversationSnapshot } from './conversation.js';
import { enforceContentLanguage } from './content-language.js';
import { validateConversationDecision, type ConversationDecisionInput } from './conversation-decision.js';
import type { FilterMode } from '../shared/filter-policy.js';
import { POST_ONLY_EVIDENCE_SCOPE, postOnlyEvidenceView } from './post-only-evidence.js';

export const OPPORTUNITY_TYPES = ['DIRECT_NEED', 'LATENT_PROBLEM', 'PERSONAL_DESIRE', 'EXPERIENCE', 'DISCUSSION', 'INTEREST', 'CONTEXT'] as const;
export type OpportunityType = typeof OPPORTUNITY_TYPES[number];
export interface OpportunityEvidence {
  i: number;
  topic: 'RELATED' | 'ADJACENT' | 'UNRELATED' | 'UNKNOWN';
  promotion: 'YES' | 'NO' | 'UNKNOWN';
  actor: 'CONSUMER' | 'PROXY' | 'PROVIDER' | 'OTHER' | 'UNKNOWN';
  opportunities: OpportunityType[];
  usefulness: 'CONCRETE' | 'POSSIBLE' | 'NONE' | 'UNKNOWN';
  goal_fit: 'EXACT' | 'RELATED' | 'NONE' | 'UNKNOWN';
  hard: 'PASS' | 'FAIL' | 'UNKNOWN';
  time: 'CURRENT' | 'PAST' | 'UNBOUNDED' | 'UNKNOWN';
  ev: number[];
  why: string;
  flags: Array<'PROMOTION' | 'NEGATION' | 'CONSTRAINT' | 'CONTEXT' | 'ROLE'>;
}

export function validateOpportunityEvidence(value: unknown, snapshot: ConversationSnapshot): OpportunityEvidence {
  const v = value as OpportunityEvidence;
  if (!v || !Number.isInteger(v.i) || v.i < 0 || !['RELATED', 'ADJACENT', 'UNRELATED', 'UNKNOWN'].includes(v.topic)
    || !['YES', 'NO', 'UNKNOWN'].includes(v.promotion) || !['CONSUMER', 'PROXY', 'PROVIDER', 'OTHER', 'UNKNOWN'].includes(v.actor)
    || !['CONCRETE', 'POSSIBLE', 'NONE', 'UNKNOWN'].includes(v.usefulness) || !['EXACT', 'RELATED', 'NONE', 'UNKNOWN'].includes(v.goal_fit)
    || !['PASS', 'FAIL', 'UNKNOWN'].includes(v.hard) || !['CURRENT', 'PAST', 'UNBOUNDED', 'UNKNOWN'].includes(v.time)
    || !Array.isArray(v.opportunities) || v.opportunities.length > OPPORTUNITY_TYPES.length
    || v.opportunities.some(t => !OPPORTUNITY_TYPES.includes(t)) || new Set(v.opportunities).size !== v.opportunities.length
    || !Array.isArray(v.ev) || v.ev.length > 3 || new Set(v.ev).size !== v.ev.length
    || v.ev.some(e => !Number.isInteger(e) || e < 0 || !snapshot.spans[e])
    || typeof v.why !== 'string' || !v.why.trim() || v.why.length > 300 || !Array.isArray(v.flags)
    || v.flags.length > 5 || v.flags.some(f => !['PROMOTION', 'NEGATION', 'CONSTRAINT', 'CONTEXT', 'ROLE'].includes(f))) throw Error('POST_EVIDENCE_FORMAT_INVALID');
  if ((v.topic !== 'UNKNOWN' || v.promotion !== 'UNKNOWN' || v.hard === 'FAIL') && !v.ev.length) throw Error('POST_EVIDENCE_REQUIRED');
  if (v.opportunities.length && !v.ev.length) throw Error('POST_EVIDENCE_REQUIRED');
  return v;
}

export function opportunityPolicy(mode: FilterMode, v: OpportunityEvidence): { classification: 'SUITABLE' | 'NOT_SUITABLE' | null; reason: string } {
  if (mode === 'OFF') return { classification: null, reason: 'UNASSESSED' };
  if (v.promotion === 'YES') return { classification: 'NOT_SUITABLE', reason: 'POST_PROMOTION' };
  if (v.topic === 'UNRELATED') return { classification: 'NOT_SUITABLE', reason: 'POST_UNRELATED' };
  if (v.hard === 'FAIL') return { classification: 'NOT_SUITABLE', reason: 'POST_REQUIRED_CONSTRAINT' };
  if (v.goal_fit === 'NONE' || v.usefulness === 'NONE') return { classification: 'NOT_SUITABLE', reason: 'POST_NO_OPPORTUNITY' };
  if ([v.topic, v.promotion, v.usefulness, v.goal_fit, v.hard].includes('UNKNOWN') || !v.opportunities.length)
    return { classification: null, reason: 'POST_EVIDENCE_INCOMPLETE' };
  const standard = v.usefulness === 'CONCRETE' || v.opportunities.some(t => ['DIRECT_NEED', 'LATENT_PROBLEM', 'PERSONAL_DESIRE', 'EXPERIENCE', 'DISCUSSION'].includes(t));
  const accept = mode === 'CONSISTENT' || (mode === 'STANDARD' ? standard : standard && v.goal_fit === 'EXACT' && v.usefulness === 'CONCRETE');
  return { classification: accept ? 'SUITABLE' : 'NOT_SUITABLE', reason: accept ? 'POST_OPPORTUNITY_' + mode : 'POST_BELOW_' + mode };
}

export function opportunityEvidenceDecision(plan: CampaignPlan, snapshot: ConversationSnapshot, v: OpportunityEvidence, model: string,
  reviewState = 'NOT_SELECTED'): ConversationDecisionInput {
  const view = postOnlyEvidenceView(snapshot), policy = opportunityPolicy(plan.filter_mode ?? 'STANDARD', v);
  const decision: ConversationDecisionInput = { campaign_id: plan.campaign_id, campaign_version: plan.version,
    filter_version: plan.filter_version, snapshot_id: snapshot.id, classification: policy.classification,
    assessment_status: policy.classification === null ? 'PENDING' : 'ASSESSED', reason_code: policy.reason,
    evidence_ids: v.ev.map(e => view.spans[e]!.id), model, intents: [...v.opportunities],
    action_target: policy.classification === 'SUITABLE' && view.post ? { entity_id: view.post.entity_id, type: 'POST' } : null,
    attributes: { evidence_scope: POST_ONLY_EVIDENCE_SCOPE, need_summary: v.why, opportunity_types: v.opportunities.join(','),
      topic_relation: v.topic, promotion: v.promotion, actor: v.actor, usefulness: v.usefulness, goal_fit: v.goal_fit,
      hard: v.hard, temporal_status: v.time, signal_strength: v.goal_fit === 'EXACT' ? 3 : v.usefulness === 'CONCRETE' ? 2 : 1,
      review_state: reviewState, evidence_json: JSON.stringify(v) } };
  const guarded = enforceContentLanguage(plan, view, decision);
  validateConversationDecision(guarded, view);
  return guarded;
}

/** Different opportunity tags or goal-policy interpretation are not contradictory facts. */
export function evidenceConflict(a: OpportunityEvidence, b: OpportunityEvidence): boolean {
  return (a.promotion !== 'UNKNOWN' && b.promotion !== 'UNKNOWN' && a.promotion !== b.promotion)
    || (a.hard !== 'UNKNOWN' && b.hard !== 'UNKNOWN' && a.hard !== b.hard)
    || (a.topic !== 'UNKNOWN' && b.topic !== 'UNKNOWN' && (a.topic === 'UNRELATED') !== (b.topic === 'UNRELATED'));
}

export function opportunityReviewReasons(v: OpportunityEvidence, snapshot: ConversationSnapshot): string[] {
  const reasons = new Set<string>(v.flags);
  const text = snapshot.post?.text.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').toLowerCase() ?? '';
  // These cues select independent reading, never reject a post by keywords or account type.
  if (/\b(inbox|hotline|khuyen mai|giam gia|dat lich|dang ky ngay|uu dai|ben em|shop em)\b/.test(text)) reasons.add('COMMERCIAL_CONTEXT');
  if (/\b(khong con|het nhu cau|da tim duoc|gia vo|trich dan)\b/.test(text)) reasons.add('NEGATION_CONTEXT');
  return [...reasons];
}
