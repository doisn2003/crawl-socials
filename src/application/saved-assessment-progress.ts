import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import { presentCompletedQualityReview } from '../domain/post-review-resolution.js';
import { conversationAssessmentCounts, opportunityCounts } from '../infrastructure/storage/conversation-assessment.js';
import type { OpportunityExportData } from '../infrastructure/export/opportunity-workbook.js';
import type { OpportunityCounts, OpportunityProgress, RunState } from '../shared/production-api.js';
import { evaluationContext } from './evaluation-upgrade.js';

const platforms = ['facebook', 'threads'] as const;

/** Restore the reason counts for an older run without opening a writer or resuming its jobs. */
export function restoreAssessmentProgress(run: RunState): void {
  const progress = run.opportunity;
  if (!progress || progress.assessmentDetails || progress.filterMode === 'OFF' || progress.previouslyDelivered) return;
  const opportunity = join(run.outputDirectory, 'opportunity');
  const file = join(opportunity, 'store', 'conversations.sqlite');
  if (!existsSync(file) || existsSync(join(opportunity, 'active-evaluation.json'))) return;
  try {
    const plan = JSON.parse(readFileSync(join(opportunity, 'campaign.json'), 'utf8')) as CampaignPlan;
    if (plan.campaign_id !== run.id || plan.filter_mode !== progress.filterMode) return;
    const context = evaluationContext(plan), asOf = run.finishedAt ?? new Date().toISOString();
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec('BEGIN');
      const total = conversationAssessmentCounts(db, context, asOf);
      const counts = opportunityCounts(total);
      const byPlatform = { facebook: opportunityCounts(conversationAssessmentCounts(db, context, asOf, 'facebook')),
        threads: opportunityCounts(conversationAssessmentCounts(db, context, asOf, 'threads')) };
      // Do not replace an older snapshot with counts from a different collection state.
      if (counts.raw !== progress.counts.raw || counts.suitable !== progress.counts.suitable
        || platforms.some(p => byPlatform[p].raw !== progress.byPlatform[p].raw || byPlatform[p].suitable !== progress.byPlatform[p].suitable)) return;
      if (progress.commentsPending !== undefined) {
        counts.comments = progress.counts.comments;
        for (const platform of platforms) byPlatform[platform].comments = progress.byPlatform[platform].comments;
      }
      run.opportunity = { ...progress, counts, byPlatform,
        ...(total.assessmentDetails ? { assessmentDetails: total.assessmentDetails } : {}),
        phase: progress.phase === 'PARTIAL' && !counts.pending ? 'SETTLED' : progress.phase };
    } finally { db.close(); }
  } catch { /* An older or missing store still has the saved aggregate. */ }
}

/** Exports of a saved run use the same resolution as its current view and retain the old decisions. */
export function presentSavedAssessmentExport(value: unknown, saved: OpportunityProgress | undefined): unknown {
  if (!value || typeof value !== 'object') return value;
  const exported = value as Partial<OpportunityExportData> & { progress?: OpportunityProgress };
  const progress = exported.progress;
  if (!progress?.counts || !progress.byPlatform || !Array.isArray(exported.conversations) || !Array.isArray(exported.decisions)) return value;
  const resolved: OpportunityExportData['decisions'] = [], delta = { facebook: 0, threads: 0 };
  const conversations = progress.filterMode === 'QUALITY' ? exported.conversations.map(row => {
    if (row.stale || row.snapshot.id !== row.decision.snapshot_id) return row;
    const decision = presentCompletedQualityReview(row.decision);
    if (decision === row.decision) return row;
    resolved.push(decision);
    delta[row.snapshot.platform]++;
    return { ...row, decision };
  }) : exported.conversations;
  const revise = (counts: OpportunityCounts, n: number): OpportunityCounts => ({ ...counts,
    notSuitable: (counts.notSuitable ?? counts.notYet + counts.unrelated) + n, unrelated: counts.unrelated + n,
    pending: Math.max(0, counts.pending - n) });
  const counts = revise(progress.counts, resolved.length);
  const byPlatform = { facebook: revise(progress.byPlatform.facebook, delta.facebook), threads: revise(progress.byPlatform.threads, delta.threads) };
  const details = saved?.assessmentDetails && saved.campaignId === progress.campaignId && saved.filterMode === progress.filterMode
    && saved.counts.raw === counts.raw && saved.counts.pending === counts.pending && saved.counts.unrelated === counts.unrelated
    ? saved.assessmentDetails : undefined;
  if (!resolved.length && !details) return value;
  return { ...exported, conversations, decisions: [...exported.decisions, ...resolved], progress: { ...progress, counts, byPlatform,
    ...(details ? { assessmentDetails: details } : {}), phase: progress.phase === 'PARTIAL' && !counts.pending ? 'SETTLED' : progress.phase } };
}
