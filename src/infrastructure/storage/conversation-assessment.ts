import type { DatabaseSync } from 'node:sqlite';
import { assertEvaluationContext, contextKey, type EvaluationContext, type SocialPlatform } from '../../domain/conversation.js';
import { completedQualityRejection, POST_REVIEW_FACT_CONFLICT, QUALITY_REVIEW_CONFLICT, QUALITY_REVIEW_UNCONFIRMED,
  UNCONFIRMED_REVIEW_REASONS } from '../../domain/post-review-resolution.js';
import { FILTER_VERSIONS } from '../../shared/filter-policy.js';
import type { OpportunityAssessmentDetails, OpportunityCounts } from '../../shared/production-api.js';

export interface ConversationAssessmentCounts {
  raw_unique_posts: number;
  observed_comments: number;
  suitable: number;
  not_yet: number;
  unrelated: number;
  pending: number;
  failed: number;
  stale_decisions: number;
  assessmentDetails?: OpportunityAssessmentDetails;
}

const reason = "json_extract(d.payload,'$.reason_code')";
const review = "json_extract(d.payload,'$.attributes.review_state')";
const languageReasons = new Set(['CONTENT_LANGUAGE_UNVERIFIED', 'CONTENT_LANGUAGE_EVIDENCE_UNVERIFIED', 'CONTENT_LANGUAGE_CANDIDATE_UNVERIFIED']);

export function historicalQualityRejectionSql(context: EvaluationContext): string {
  return context.filter_version !== FILTER_VERSIONS.QUALITY ? '0' : `(d.assessment_status='PENDING' AND (
    ${reason}='${POST_REVIEW_FACT_CONFLICT}' OR (${review}='COMPLETE' AND ${reason} IN (${UNCONFIRMED_REVIEW_REASONS.map(code => `'${code}'`).join(',')}))))`;
}

type Bucket = { n: number; comments: number; valid: number; queued: number; assessment: string | null;
  classification: string | null; reason: string | null; review: string | null };

export function conversationAssessmentCounts(db: DatabaseSync, context: EvaluationContext, asOf: string, platform?: SocialPlatform): ConversationAssessmentCounts {
  assertEvaluationContext(context);
  const key = contextKey(context), params = [asOf, key, context.campaign_id, context.campaign_version, context.filter_version];
  if (platform) params.push(platform);
  // One active job per current snapshot, even when a retry and a verification overlap.
  const waiting = platform ? '' : `, waiting AS (
    SELECT DISTINCT json_extract(payload,'$.snapshot_id') AS snapshot_id FROM jobs
    WHERE state IN ('PENDING','RETRY','RUNNING','PAUSED') AND type IN ('CLASSIFY','VERIFY')
      AND json_extract(payload,'$.campaign_id')=(SELECT campaign FROM scope)
      AND json_extract(payload,'$.campaign_version')=(SELECT version FROM scope)
      AND json_extract(payload,'$.filter_version')=(SELECT filter FROM scope)
  )`;
  const rows = db.prepare(`WITH scope(as_of,context_key,campaign,version,filter) AS (VALUES (?,?,?,?,?))${waiting}
    SELECT COUNT(*) AS n, COALESCE(SUM(json_array_length(s.payload,'$.comments')),0) AS comments,
      CASE WHEN cd.snapshot_revision=r.revision
        AND (json_extract(d.payload,'$.valid_until') IS NULL OR julianday(json_extract(d.payload,'$.valid_until'))>julianday(scope.as_of))
        AND (ar.evaluated_at IS NULL OR julianday(COALESCE(json_extract(d.payload,'$.evaluated_at'),s.observed_at))>=julianday(ar.evaluated_at))
        THEN 1 ELSE 0 END AS valid,
      ${platform ? '0' : 'waiting.snapshot_id IS NOT NULL'} AS queued,
      d.assessment_status AS assessment,d.classification,${reason} AS reason,${review} AS review
    FROM campaign_roots cr JOIN conversations r ON r.platform=cr.platform AND r.root_post_id=cr.root_post_id
    JOIN snapshots s ON s.id=r.snapshot_id LEFT JOIN current_decisions cd ON cd.context_key=cr.context_key AND cd.platform=cr.platform AND cd.root_post_id=cr.root_post_id
    LEFT JOIN decisions d ON d.id=cd.decision_id LEFT JOIN assessment_requests ar ON ar.context_key=cd.context_key AND ar.snapshot_id=d.snapshot_id
    ${platform ? '' : 'LEFT JOIN waiting ON waiting.snapshot_id=r.snapshot_id'} CROSS JOIN scope WHERE cr.context_key=scope.context_key${platform ? ' AND cr.platform=?' : ''}
    GROUP BY valid,queued,assessment,d.classification,reason,review`).all(...params) as unknown as Bucket[];
  const details: OpportunityAssessmentDetails = { queued: 0, language: 0, incomplete: 0, conflict: 0, stale: 0, failed: 0, unrecorded: 0,
    qualityConflict: 0, qualityUnconfirmed: 0 };
  const result: ConversationAssessmentCounts = { raw_unique_posts: 0, observed_comments: 0, suitable: 0, not_yet: 0, unrelated: 0,
    pending: 0, failed: 0, stale_decisions: 0, ...(!platform ? { assessmentDetails: details } : {}) };
  for (const row of rows) {
    result.raw_unique_posts += row.n; result.observed_comments += row.comments;
    if (row.assessment && !row.valid) result.stale_decisions += row.n;
    if (row.valid && row.assessment === 'FAILED') result.failed += row.n;
    const resolved = row.valid && row.assessment === 'PENDING' && context.filter_version === FILTER_VERSIONS.QUALITY
      ? completedQualityRejection(row.reason ?? '', row.review) : null;
    if (row.valid && (row.assessment === 'ASSESSED' || resolved)) {
      if (row.classification === 'SUITABLE') result.suitable += row.n;
      else if (row.classification === 'NOT_YET') result.not_yet += row.n;
      else result.unrelated += row.n;
      const code = resolved ?? row.reason;
      if (code === QUALITY_REVIEW_CONFLICT) details.qualityConflict += row.n;
      if (code === QUALITY_REVIEW_UNCONFIRMED) details.qualityUnconfirmed += row.n;
      continue;
    }
    result.pending += row.n;
    if (row.queued) details.queued += row.n;
    else if (!row.valid && row.assessment) details.stale += row.n;
    else if (row.assessment === 'FAILED') details.failed += row.n;
    else if (languageReasons.has(row.reason ?? '')) details.language += row.n;
    else if (row.reason === POST_REVIEW_FACT_CONFLICT) details.conflict += row.n;
    else if (row.reason === 'POST_EVIDENCE_INCOMPLETE') details.incomplete += row.n;
    else details.unrecorded += row.n;
  }
  return result;
}

export function opportunityCounts(s: ConversationAssessmentCounts): OpportunityCounts {
  return { raw: s.raw_unique_posts, comments: s.observed_comments, suitable: s.suitable, notSuitable: s.not_yet + s.unrelated,
    notYet: s.not_yet, unrelated: s.unrelated, pending: s.pending, failed: s.failed };
}
