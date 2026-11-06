import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { WebContents } from 'electron';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { createAsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';
import type { AsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';
import type { ConversationJob, ConversationJobType, ConversationStats } from '../infrastructure/storage/conversation-store.js';
import { createCampaignModelGateway } from '../infrastructure/llm/campaign-model-gateway.js';
import { compileCampaign } from './compile-campaign.js';
import { pinPlannerRecipe } from './planner-recipe-pin.js';
import { pinRankingRecipe } from './ranking-recipe-pin.js';
import { classifierRecipe, classifyConversations, opportunityRank } from './classification-service.js';
import { verifyTentativeOpportunities } from './opportunity-verifier.js';
import { readActiveEvaluation, resumeEvaluationMigration, evaluationContext } from './evaluation-upgrade.js';
import { enqueueFocusedVerification, processFocusedVerificationBatch } from './focused-verification-backfill.js';
import { keepJobLeases } from './job-lease-keeper.js';
import { readEffectiveLimits } from './runtime-limits.js';
import { pinStoragePolicy, measureStorageUsage, evaluateStoragePressure, type StorageLimits, type StorageUsage } from './storage-backpressure.js';
import type { ModelGateway } from './ports/model-gateway.js';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import { GROUNDED_CONSTRAINT_PLANNER_POLICY, TEMPORAL_OPPORTUNITY_FILTER_VERSION, validateCampaignPlan } from '../domain/campaign-plan.js';
import type { ConversationObservation, ConversationSnapshot, EvaluationContext, SourceKind } from '../domain/conversation.js';
import { contentHash } from '../domain/conversation.js';
import type { OpportunityConfig, OpportunityCounts, OpportunityProgress, Platform } from '../shared/production-api.js';
import { allocatePlatformTargets } from '../shared/platform-targets.js';
import { isAssessmentTime, type ConversationDecisionInput } from '../domain/conversation-decision.js';
import { GOAL_FILTER_VERSION } from '../domain/goal-filter.js';
import { vietnameseOnly } from '../domain/content-language.js';
import { manualCollectionPlan, unassessedGateway, withFilterPolicy } from './filter-policy.js';
import { postOnlyEvidenceView } from '../domain/post-only-evidence.js';
import { createCoverageExpansion, initialDiscoveryQueries, type CoverageExpansionRequest } from './coverage-queries.js';
import { recoverPostAssessmentJobs } from './post-assessment-recovery.js';

export interface ConversationCollectInput {
  window: WebContents; platform: Platform; root: { id: string; url: string }; runId: string;
  onObservations(observations: ConversationObservation[]): Promise<void>;
  shouldStop(): boolean; maxComments: number; maxSteps: number; maxMs: number;
  beforeNextPage?(): Promise<void>;
}
export interface ReplyRootResolveInput {
  window: WebContents; candidate: { id: string; url: string; root_id?: string }; runId: string;
  onObservations(observations: ConversationObservation[]): Promise<void>;
  shouldStop(): boolean; maxMs: number;
}
export interface ReplyRootResolveReceipt {
  status: 'RESOLVED' | 'UNRESOLVED' | 'INACCESSIBLE' | 'RETRYABLE_ERROR';
  root: { id: string; url: string } | null;
  coverage?: { stop_reason?: string };
}
export interface OpportunityPipelineInput {
  directory: string; runId: string; config: OpportunityConfig; platforms: Platform[];
  seedQueries?: string[]; campaign?: CampaignPlan; gateway?: ModelGateway; verifierGateway?: ModelGateway; store?: AsyncConversationStore;
  onProgress?(progress: OpportunityProgress): void;
  collectConversation(input: ConversationCollectInput): Promise<unknown>;
  resolveThreadsReplyRoot?(input: ReplyRootResolveInput): Promise<ReplyRootResolveReceipt>;
  withRevisitWindow?(platform: Platform, work: (window: WebContents) => Promise<void>): Promise<void>;
  now?: () => Date;
  /** Rebuild the bound retained input before inference; this mode never opens a browser. */
  processingMode?: 'RETAINED';
  assessmentTime?: string;
  /** Trusted initial operational policy; existing per-run pins always win. */
  storageLimits?: StorageLimits;
  /** Initial uncompiled campaigns only; a committed campaign keeps its own deadline on Resume. */
  maxRunMinutes?: number;
  classificationWorkers?: number;
  assessmentCacheDirectory?: string;
  excludedRootKeys?: string[];
}
type Row = Record<string, unknown>;
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'PIPELINE_FAILED';
const counts = (s: ConversationStats): OpportunityCounts => ({ raw: s.raw_unique_posts, comments: s.observed_comments, suitable: s.suitable,
  notSuitable: s.not_yet + s.unrelated, notYet: s.not_yet, unrelated: s.unrelated, pending: s.pending, failed: s.failed });
const emptyCounts = (): OpportunityCounts => ({ raw: 0, comments: 0, suitable: 0, notYet: 0, unrelated: 0, pending: 0, failed: 0 });
const nullableText = (v: unknown): string | null => typeof v === 'string' && v ? v : null;
const fatalModelCode = (code: string) => code === 'GEMINI_API_KEY_MISSING' || /^MODEL_(?:BUDGET|GLOBAL_BUDGET|SPEND|CALL_LIMIT|NOT_AUTHORIZED|AUTHENTICATION|BILLING|PERMISSION|NOT_AVAILABLE|KEY|QUOTA|DAILY_QUOTA|REQUEST_INVALID)/.test(code);
const retryableModelCode = (code: string) => /^MODEL_(?:HTTP_(?:429|5\d\d)|NETWORK_USAGE_UNKNOWN|ATTEMPTS_EXHAUSTED)/.test(code);
function goalConditions(decision:ConversationDecisionInput) {
  const conditions:NonNullable<OpportunityProgress['preview'][number]['conditions']> = decision.goal_assessment?.checks.map(check=>({
    label:decision.goal_assessment!.contract.criteria.find(c=>c.id===check.criterion_id)?.description??check.criterion_id,
    status:check.status,evidence:check.evidence.map(p=>p.quote)
  }))??[];
  const preferredPlatforms=decision.goal_assessment?.contract.platform_preferences;
  if(preferredPlatforms?.length)conditions.push({label:'Ưu tiên nền tảng (không bắt buộc): '+preferredPlatforms.map(p=>p.platform==='threads'?'Threads':'Facebook').join(' → '),
    status:Number(decision.attributes?.goal_platform_preference)>0?'PASS':'FAIL',
    evidence:['Nguồn đã thu: '+String(decision.attributes?.goal_platform??'UNKNOWN')]});
  if(decision.goal_scope_review)conditions.push({label:'Đúng ngữ cảnh của mục tiêu: '+decision.goal_scope_review.explanation,
    status:decision.goal_scope_review.verdict==='IN_SCOPE'?'PASS':decision.goal_scope_review.verdict==='OUT_OF_SCOPE'?'FAIL':'UNKNOWN',
    evidence:decision.goal_scope_review.evidence.map(p=>p.quote)});
  return conditions;
}

/** Runs inference beside discovery; browser enrichment uses the collector's explicit profile yield. */
export async function createOpportunityPipeline(input: OpportunityPipelineInput) {
  const off = input.config.filterMode === 'OFF', rebuild = input.config.filterMode !== undefined;
  if (input.maxRunMinutes !== undefined && (!Number.isInteger(input.maxRunMinutes) || input.maxRunMinutes < 1 || input.maxRunMinutes > 1440)) throw Error('CAMPAIGN_RUN_MINUTES_INVALID');
  const workerCount = input.classificationWorkers ?? 1;
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 8) throw Error('CLASSIFICATION_WORKERS_INVALID');
  const now = input.now ?? (() => new Date());
  const retained = input.processingMode === 'RETAINED';
  if (retained && !isAssessmentTime(input.assessmentTime)) throw Error('RETAINED_ASSESSMENT_TIME_INVALID');
  let importing = retained;
  const directory = join(input.directory, 'opportunity'), campaignFile = join(directory, 'campaign.json');
  const campaignExisted = existsSync(campaignFile);
  // Resolve before gateway construction: an interrupted paid planner attempt keeps its recipe.
  const plannerPin = !off && !input.campaign && !campaignExisted ? pinPlannerRecipe({ directory,
    defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY,
    existingAttempt: ['model', 'model-gemini-3.5-flash-lite'].some(folder => {
      const ledger = join(directory, folder, 'model-ledger.jsonl'); return existsSync(ledger) && statSync(ledger).size > 0;
    }) }) : null;
  const gateway = off ? unassessedGateway : input.gateway ?? createCampaignModelGateway({ directory, budgetUsd: input.config.budgetUsd });
  const modelCost = () => {
    const summaries = [...new Set([gateway, ...(!focusedEnabled && input.verifierGateway ? [input.verifierGateway] : [])])].map(g => g.summary());
    const measured = summaries.reduce((sum, s) => sum + s.measured_cost_usd, 0), unknown = summaries.reduce((sum, s) => sum + s.unmetered_cost_upper_usd, 0), reserved = summaries.reduce((sum, s) => sum + s.reserved_usd, 0);
    return { ...summaries[0]!, model: summaries.map(s => s.model).join(' + '), budget_usd: input.config.budgetUsd,
      measured_cost_usd: measured, unmetered_cost_upper_usd: unknown, reserved_usd: reserved, remaining_usd: Math.max(0, input.config.budgetUsd - measured - unknown - reserved),
      billable_attempts: summaries.reduce((sum, s) => sum + s.billable_attempts, 0), cache_hits: summaries.reduce((sum, s) => sum + s.cache_hits, 0), models: summaries.flatMap(s => s.components ?? [s]) };
  };
  const controller = new AbortController();
  let baselineCampaign: CampaignPlan;
  if (input.campaign) baselineCampaign = input.campaign;
  else if (existsSync(campaignFile)) baselineCampaign = JSON.parse(readFileSync(campaignFile, 'utf8')) as CampaignPlan;
  else if (off) baselineCampaign = manualCollectionPlan(input.runId, input.config, input.seedQueries ?? []);
  else baselineCampaign = (await compileCampaign({ prompt: input.config.prompt, brand_context: input.config.brandContext || null,
    ...(input.config.languageScope === 'VIETNAMESE' ? { languages: ['vi'] } : {}),
    planner_policy: plannerPin!.planner_policy,
    campaign_id: input.runId, suitable_target: input.config.totalTarget,
    desired_platform_weights: { threads: input.config.threadsShare ?? 0.5, facebook: 1 - (input.config.threadsShare ?? 0.5) },
    raw_cap: input.config.rawCap, model_usd: input.config.budgetUsd,
    ...(input.maxRunMinutes === undefined ? {} : { max_run_minutes: input.maxRunMinutes }),
    ...(input.seedQueries?.length ? { seed_queries: input.seedQueries } : {}) }, gateway,
  { signal: controller.signal })).campaign;
  if (!campaignExisted && baselineCampaign.filter_mode !== input.config.filterMode) baselineCampaign = withFilterPolicy(baselineCampaign, input.config.filterMode);
  if (campaignExisted && baselineCampaign.filter_mode !== input.config.filterMode) throw Error('FILTER_MODE_REVISION_REQUIRED');
  if (!off && input.config.languageScope === 'VIETNAMESE' && !vietnameseOnly(baselineCampaign)) throw Error('LANGUAGE_SCOPE_REVISION_REQUIRED');
  validateCampaignPlan(baselineCampaign);
  let recipe: ReturnType<typeof classifierRecipe>;
  try { recipe = classifierRecipe(baselineCampaign.filter_version); } catch { throw Error('CAMPAIGN_FILTER_UPGRADE_REQUIRED'); }
  if (campaignExisted && contentHash(JSON.parse(readFileSync(campaignFile, 'utf8'))) !== contentHash(baselineCampaign)) throw Error('CAMPAIGN_IMMUTABLE_MISMATCH');
  const recipeHash = contentHash(recipe), recipeFile = join(directory, 'filter-recipe.json');
  if (existsSync(recipeFile)) {
    const saved = JSON.parse(readFileSync(recipeFile, 'utf8')) as { recipe: unknown; recipe_sha256: string };
    if (saved.recipe_sha256 !== recipeHash || contentHash(saved.recipe) !== recipeHash) throw Error('FILTER_RECIPE_MISMATCH');
  } else atomicJson(recipeFile, { recipe, recipe_sha256: recipeHash, recorded_at: new Date().toISOString(), backfilled_on_resume: campaignExisted });
  const rankingPin = pinRankingRecipe({ directory, campaign: baselineCampaign, campaignExisted });
  const rankingOptions = rankingPin.recipe.source_priority === null ? {} : { source_priority: rankingPin.recipe.source_priority };
  const storagePolicy = pinStoragePolicy({ directory, campaignSha256: contentHash(baselineCampaign), existingRun: campaignExisted,
    ...(input.storageLimits ? { limits: input.storageLimits } : {}) });
  if (!campaignExisted) atomicJson(campaignFile, baselineCampaign);
  const activeEvaluation = readActiveEvaluation(directory, baselineCampaign), focusedEnabled = activeEvaluation !== null;
  const campaign = activeEvaluation?.campaign ?? baselineCampaign;
  const temporalEnabled = [TEMPORAL_OPPORTUNITY_FILTER_VERSION, GOAL_FILTER_VERSION].includes(campaign.filter_version);
  const platformTargets = rebuild ? { facebook: Infinity, threads: Infinity } : allocatePlatformTargets(campaign.suitable_target, campaign.desired_platform_weights, input.platforms);
  const runtimeLimits = readEffectiveLimits(directory, baselineCampaign);
  const baseStore = input.store ?? await createAsyncConversationStore(join(directory, 'store'));
  const leases = keepJobLeases(baseStore, { onError: error => { haltModel(safeCode(error)); controller.abort(); } });
  const store = leases.store;
  try { if (activeEvaluation?.state === 'MIGRATING') await resumeEvaluationMigration(directory, store); }
  catch (error) { await leases.close(); if (!input.store) await store.close(); throw error; }
  const context: EvaluationContext = evaluationContext(campaign);
  const excludedRoots = new Set(input.excludedRootKeys ?? []);
  const postOnly = campaign.filter_version.startsWith('opportunity-posts-');
  const commentsEnabled = !postOnly && input.config.commentsEnabled;
  const previouslyDelivered = new Set<string>();
  function noteDelivered(platform: Platform, rootId: string | null) {
    const key = platform + ':' + rootId;
    if (rootId && excludedRoots.has(key)) previouslyDelivered.add(key);
  }
  if (excludedRoots.size) for (const snapshot of await store.snapshots()) noteDelivered(snapshot.platform, snapshot.root_post_id);
  function visibleCounts(stats: ConversationStats, platform?: Platform): OpportunityCounts {
    const value = counts(stats);
    const excluded = [...previouslyDelivered].filter(key => !platform || key.startsWith(platform + ':')).length;
    return { ...value, pending: Math.max(0, value.pending - excluded) };
  }
  async function selectTarget() {
    const selected = await store.selectTarget(context, campaign.suitable_target, off);
    const eligible = [...selected.target, ...selected.extra].filter(r => !excludedRoots.has(r.platform + ':' + r.rootId));
    return { target: eligible.slice(0, campaign.suitable_target), extra: eligible.slice(campaign.suitable_target) };
  }
  const expandCoverage = createCoverageExpansion(directory, campaign, gateway, controller.signal, () => ({
    allowModel: !off && !modelHalted && !stopped,
    accepted: progress.targetCount ?? progress.counts.suitable,
    raw: progress.counts.raw, pending: progress.counts.pending, queryYield: queryScores,
  }));
  let queryScores: Awaited<ReturnType<AsyncConversationStore['queryYield']>> = [];
  let stopped = false, closed = false, modelHalted = false, pumpWork: Promise<void> | null = null, publishWork: Promise<void> | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null, lastError: string | null = null, discoveryEnded = false, publishDirty = false;
  let modelPauseReason: string | null = null;
  function haltModel(reason: string) { modelHalted = true; modelPauseReason ??= reason; lastError = reason; }
  let watchEnabled = false, watchTimer: ReturnType<typeof setTimeout> | null = null, watchWork: Promise<void> | null = null, watchRetryAt = 0;
  let assessmentTimer: ReturnType<typeof setTimeout> | null = null, assessmentWork: Promise<void> | null = null, assessmentGeneration = 0, assessmentActive = false;
  let storageStopReason: string | null = null, storageUsage: StorageUsage | null = null, storageWork: Promise<void> | null = null;
  const activeEnrich = new Set<string>();
  const enrichmentBlocked = new Set<Platform>();
  let progress: OpportunityProgress = { campaignId: campaign.campaign_id, totalTarget: campaign.suitable_target,
    ...(rebuild ? { filterMode: input.config.filterMode!, resultPolicy: 'GLOBAL_FIRST_QUALIFIED' as const } : {}),
    evaluationPolicy: campaign.filter_version === GOAL_FILTER_VERSION ? 'GOAL_EVIDENCE' : 'LEGACY',
    threadsShare: campaign.desired_platform_weights.threads, counts: emptyCounts(), byPlatform: { facebook: emptyCounts(), threads: emptyCounts() },
    costUsd: 0, costUpperUsd: 0, usageUnknown: 0, budgetUsd: input.config.budgetUsd, phase: 'COLLECTING', lastError: null, preview: [] };

  async function publish() {
    if (closed) return;
    publishDirty = true;
    if (publishWork) return publishWork;
    publishWork = (async () => {
      do {
      publishDirty = false;
      const [total, facebook, threads] = await Promise.all([store.stats(context), store.stats(context, 'facebook'), store.stats(context, 'threads')]);
      const preview: OpportunityProgress['preview'] = [];
      for (const classification of ['SUITABLE', 'NOT_SUITABLE'] as const) {
        const results = await store.results(context, { classification, ranked: true, ...rankingOptions, limit: 20 });
        results.sort((a, b) => { const aa = opportunityRank(a.decision, a.snapshot, rankingOptions.source_priority), bb = opportunityRank(b.decision, b.snapshot, rankingOptions.source_priority); for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return bb[i]! - aa[i]!; return 0; });
        for (const { snapshot, decision } of results.slice(0, 20)) {
          const target = [snapshot.post, ...snapshot.comments].find(e => e?.entity_id === (decision.action_target?.entity_id ?? decision.goal_assessment?.candidate_entity_id)) ?? snapshot.post;
          if (excludedRoots.has(snapshot.platform + ':' + snapshot.root_post_id)) continue;
          preview.push({ platform: snapshot.platform, rootId: snapshot.root_post_id,
          classification, text: (target?.text ?? '').slice(0, 900), link: target?.permalink ?? snapshot.post?.permalink ?? '',
          reason: String(decision.attributes?.need_summary ?? decision.reason_code),
          opportunityTypes: String(decision.attributes?.opportunity_types ?? '').split(',').filter(Boolean), publishedAt: snapshot.post?.published_at ?? null,
          ...(decision.goal_assessment ? { conditions: goalConditions(decision) } : {}),
          evidence: snapshot.spans.filter(s => decision.evidence_ids.includes(s.id)).map(s => s.text.slice(0, 600)),
          observedAt: snapshot.observed_at, coverage: snapshot.coverage.status });
        }
      }
      const money = modelCost();
      const selected = rebuild ? await selectTarget() : null;
      if (off && selected) {
        const snapshots = await Promise.all(selected.target.slice(0, 20).map(row => store.snapshot(row.platform as Platform, row.rootId)));
        for (const snapshot of snapshots) if (snapshot?.post) preview.push({
          platform: snapshot.platform, rootId: snapshot.root_post_id, classification: 'UNASSESSED',
          text: snapshot.post.text.slice(0, 900), link: snapshot.post.permalink ?? '', reason: 'Chưa đánh giá · Không dùng AI',
          evidence: [], publishedAt: snapshot.post.published_at, observedAt: snapshot.observed_at, coverage: snapshot.coverage.status,
        });
      }
      if (rebuild && !off) queryScores = await store.queryYield(context);
      const watch = await store.watchSummary(input.platforms);
      const assessment = temporalEnabled ? await store.assessmentSummary(context, { now: now().toISOString() }) : null;
      const hasClassificationWork = discoveryEnded && !stopped && !modelHalted && (await classificationBacklog()).length > 0;
      const assessed = total.raw_unique_posts - total.pending;
      const projected = assessed > 0 ? Math.floor(total.suitable / assessed * runtimeLimits.effective_raw_cap) : 0;
      progress = { ...progress, counts: visibleCounts(total), byPlatform: { facebook: visibleCounts(facebook, 'facebook'), threads: visibleCounts(threads, 'threads') }, previouslyDelivered: previouslyDelivered.size,
        ...(selected ? { targetCount: selected.target.length, extraCount: selected.extra.length } : {}),
        ...(rebuild ? { shortfallWarning: !off && assessed >= 20 && projected < campaign.suitable_target
          ? `Theo tỷ lệ được model nhận hiện tại, trần bài thô có thể chỉ cho khoảng ${projected}/${campaign.suitable_target} bài. Đây chưa phải độ chính xác đã đo. Xem query chưa chạy, bài đang chờ hoặc mở rộng phạm vi trước khi tăng tiền.` : null } : {}),
        classificationWorkers: workerCount, modelScheduling: gateway.summary().scheduling,
        costUsd: money.measured_cost_usd, costUpperUsd: money.measured_cost_usd + money.unmetered_cost_upper_usd + money.reserved_usd,
        usageUnknown: money.unmetered_cost_upper_usd > 0 ? 1 : 0, lastError: storageStopReason ?? modelPauseReason ?? lastError, preview,
        watchPending: watch.pending, watchNextAt: watch.next_at, watchActive: watchEnabled,
        ...(assessment ? { assessmentPending: assessment.pending, assessmentNextAt: modelHalted ? assessment.next_future_at : assessment.next_at, assessmentActive } : {}),
        phase: stopped ? 'PAUSED' : modelHalted ? 'MODEL_PAUSED' : watchEnabled || assessmentActive ? 'WATCHING' : discoveryEnded ? off ? 'SETTLED' : hasClassificationWork ? 'PROCESSING' : visibleCounts(total).pending ? 'PARTIAL' : 'SETTLED' : 'COLLECTING' };
      atomicJson(join(directory, 'progress.json'), progress); input.onProgress?.(structuredClone(progress));
      } while (publishDirty && !closed);
    })().finally(() => { publishWork = null; });
    return publishWork;
  }
  function schedule(delayMs = 1500) {
    if (off || retained || stopped || closed || modelHalted || pendingTimer || pumpWork) return;
    pendingTimer = setTimeout(() => { pendingTimer = null; void pump().catch(error => { haltModel(safeCode(error)); void publish(); }); }, delayMs);
  }
  async function classificationBacklog() {
    return (await store.jobs(['PENDING', 'RETRY', 'RUNNING'], context)).filter(job => job.type === 'CLASSIFY' || (focusedEnabled && job.type === 'VERIFY'));
  }
  async function scheduleRemaining() {
    if (stopped || closed || modelHalted) return;
    const waiting = (await classificationBacklog()).filter(job => job.state !== 'RUNNING');
    if (waiting.length) schedule(Math.min(30000, Math.max(0, Math.min(...waiting.map(job => Date.parse(job.not_before))) - Date.now())));
  }
  async function markWatch(snapshot: ConversationSnapshot, reason: string) {
    if (retained) return;
    if (!campaign.watch.enabled || !commentsEnabled || enrichmentBlocked.has(snapshot.platform) || !['RELATED_CHECKIN', 'RELATED_NO_OPENING', 'RELATED_PROMOTION', 'GOAL_EVIDENCE_REQUIRED', 'GOAL_TIME_EVIDENCE_REQUIRED'].includes(reason)) return;
    const first = Date.parse(snapshot.observed_at);
    for (const [index, hours] of campaign.watch.revisit_hours.slice(0, campaign.watch.max_attempts).entries()) {
      await store.enqueue({ type: 'REVISIT', idempotency_key: `${context.campaign_id}:${context.campaign_version}:${context.filter_version}:${snapshot.platform}:${snapshot.root_post_id}:revisit:${index}`,
        payload: { ...context, platform: snapshot.platform, root_post_id: snapshot.root_post_id, expires_at: new Date(first + campaign.watch.ttl_hours * 3600000).toISOString() },
        not_before: new Date(first + hours * 3600000).toISOString(), priority: 5, max_attempts: 1 });
    }
  }
  async function pump() {
    if (pumpWork) return pumpWork;
    if (off || importing || stopped || closed || modelHalted) return;
    pumpWork = (async () => {
      const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, (_, workerIndex) => (async () => {
      while (!stopped && !modelHalted) {
        if (focusedEnabled) {
          const verified = await processFocusedVerificationBatch({ store, campaign, gateway, signal: controller.signal, batchSize: 8 });
          for (const decision of verified.decisions) if (decision.classification === 'NOT_YET') {
            const snapshot = await store.getSnapshot(decision.snapshot_id);
            if (snapshot) await markWatch(snapshot, decision.reason_code === 'FOCUSED_THIN_CHECKIN' ? 'RELATED_CHECKIN'
              : decision.reason_code === 'FOCUSED_PROVIDER_SELF_PROMOTION' ? 'RELATED_NO_OPENING' : decision.reason_code);
          }
          const fatal = verified.failures.find(failure => fatalModelCode(failure.code));
          if (fatal) haltModel(fatal.code);
          if (verified.claimed) await publish();
          if (stopped || modelHalted) break;
        }
        const jobs: ConversationJob[] = [], snapshots: ConversationSnapshot[] = [];
        for (let i = 0; i < 8; i++) {
          const job = await store.claim('classifier-' + workerIndex, { types: ['CLASSIFY'], context, lease_ms: 600000 }); if (!job) break;
          const snapshot = await store.getSnapshot(String(job.payload.snapshot_id));
          const latest = snapshot && await store.snapshot(snapshot.platform, snapshot.root_post_id);
          if (!snapshot || !latest || latest.id !== snapshot.id) { await store.complete(job.id, job.lease_token!); continue; }
          if (excludedRoots.has(snapshot.platform + ':' + snapshot.root_post_id)) { previouslyDelivered.add(snapshot.platform + ':' + snapshot.root_post_id); await store.complete(job.id, job.lease_token!); continue; }
          if (temporalEnabled && typeof job.payload.evaluated_at !== 'string') {
            // Freeze request time durably before inference, including the first evaluation.
            await store.requestAssessment(context, snapshot.id, { evaluated_at: retained ? input.assessmentTime! : now().toISOString() });
            await store.complete(job.id, job.lease_token!); continue;
          }
          jobs.push(job); snapshots.push(postOnly ? postOnlyEvidenceView(snapshot) : snapshot);
        }
        if (!snapshots.length) {
          const readyVerification = focusedEnabled && (await store.jobs(['PENDING', 'RETRY'], context)).some(job => job.type === 'VERIFY' && Date.parse(job.not_before) <= Date.now());
          if (readyVerification) continue;
          break;
        }
        const result = await classifyConversations(campaign, snapshots, gateway, { signal: controller.signal, maxBatchSize: 8,
          ...(input.assessmentCacheDirectory ? { assessmentCacheDirectory: input.assessmentCacheDirectory } : {}),
          ...(retained && !temporalEnabled ? { evaluatedAt: input.assessmentTime! } : {}),
          ...(temporalEnabled ? { evaluationTimes: Object.fromEntries(jobs.map(job => [String(job.payload.snapshot_id), String(job.payload.evaluated_at)])) } : {}) });
        if (!focusedEnabled && input.verifierGateway && result.decisions.some(d => d.classification === 'SUITABLE')) {
          for (const proposed of result.decisions.filter(d => d.classification === 'SUITABLE')) await store.recordDecision({ ...proposed, classification: null, assessment_status: 'PENDING',
            reason_code: 'AWAITING_VERIFIER', attributes: { ...proposed.attributes, proposed_classification: 'SUITABLE', verification_status: 'REQUIRED' } });
          const review = await verifyTentativeOpportunities(campaign, snapshots, result.decisions, input.verifierGateway, { signal: controller.signal });
          result.decisions = review.decisions; result.failures.push(...review.failures);
        }
        for (const decision of result.decisions) {
          const snapshot = snapshots.find(s => s.id === decision.snapshot_id)!;
          if (focusedEnabled && decision.classification === 'SUITABLE') {
            await enqueueFocusedVerification(store, campaign, snapshot, decision);
            continue;
          }
          await store.recordDecision(decision);
          if (decision.classification === 'NOT_YET' || decision.assessment_status === 'PENDING') await markWatch(snapshot, String(decision.attributes?.case_code ?? decision.reason_code));
        }
        const fatal = result.failures.find(f => fatalModelCode(f.code));
        for (const job of jobs) {
          const decision = result.decisions.find(item => item.snapshot_id === job.payload.snapshot_id);
          const failure = result.failures.find(item => item.snapshot_id === job.payload.snapshot_id);
          if (decision?.assessment_status === 'ASSESSED') await store.complete(job.id, job.lease_token!);
          // Stop pauses interrupted leases after the pump settles; do not mark aborted requests complete.
          else if (stopped || controller.signal.aborted) continue;
          else if (failure && (fatalModelCode(failure.code) || retryableModelCode(failure.code))) {
            await store.retry(job.id, job.lease_token!, failure.code, fatal ? 0 : Math.min(30000, 1000 * 2 ** (job.attempts - 1)));
            if (job.attempts >= job.max_attempts && decision) await store.recordDecision({ ...decision, assessment_status: 'FAILED' });
          } else await store.complete(job.id, job.lease_token!); // Missing context waits for new evidence, not an identical model call.
        }
        if (fatal) haltModel(fatal.code);
        await publish();
      }
      })().catch(error => { haltModel(safeCode(error)); throw error; })));
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    })().finally(async () => { pumpWork = null; await scheduleRemaining(); await armAssessments(); if (temporalEnabled) await publish(); });
    return pumpWork;
  }
  async function ingest(observations: ConversationObservation[]) {
    for (const observation of observations) {
      if (!commentsEnabled && (observation.entity_type === 'COMMENT' || observation.entity_type === 'CANDIDATE')) continue;
      await store.ingest(observation, context);
      if (observation.entity_type === 'POST') noteDelivered(observation.platform, observation.root_post_id);
      if (observation.coverage?.stop_reason === 'ACCOUNT_BARRIER') await blockEnrichment(observation.platform);
    }
    schedule();
  }
  async function blockEnrichment(platform: Platform) {
    enrichmentBlocked.add(platform); lastError = `COMMENTS_ACCOUNT_BARRIER_${platform.toUpperCase()}`;
    await store.pause({ types: ['ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'REVISIT'], platform });
  }
  async function enqueueRootResolution(observation: ConversationObservation) {
    if (!input.resolveThreadsReplyRoot || !commentsEnabled || observation.platform !== 'threads' || !observation.entity_id || !observation.permalink) return;
    let url: URL; try { url = new URL(observation.permalink); } catch { return; }
    if (url.protocol !== 'https:' || !['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(url.hostname)
      || url.username || url.password || url.port || !/^\d+$/.test(observation.entity_id) || !/^\/@[^/]+\/post\/[^/]+\/?$/.test(url.pathname)) return;
    await store.enqueue({ type: 'ROOT_RESOLVE', idempotency_key: `${context.campaign_id}:threads:${observation.entity_id}:resolve-root`,
      payload: { ...context, platform: 'threads', candidate_id: observation.entity_id, candidate_url: observation.permalink,
        ...(observation.root_post_id ? { expected_root_id: observation.root_post_id } : {}), query: observation.provenance.query ?? '' },
      priority: 30, max_attempts: 2 });
  }
  async function ingestRows(platform: Platform, rows: Row[], provenance: Row) {
    for (const row of rows) {
      const id = nullableText(row.post_id), isReply = row.entity_type === 'COMMENT' || row.is_reply === true;
      if (!commentsEnabled && isReply) continue;
      const rootId = isReply ? nullableText(row.root_post_id) : id;
      const observedAt = nullableText(row.collected_at) ?? nullableText(provenance.observed_at) ?? new Date().toISOString();
      const existing = rootId ? await store.snapshot(platform, rootId) : null;
      const countMetadata = row.comments_count ?? row.replies;
      const advertised = typeof countMetadata === 'number' && Number.isFinite(countMetadata) && countMetadata >= 0 ? countMetadata : null;
      const source = ['PROFILE', 'GROUP', 'PAGE'].includes(String(row.source_type)) ? row.source_type as SourceKind : 'UNKNOWN';
      const url = nullableText(row.observed_post_url) ?? nullableText(row.post_url);
      const observation: ConversationObservation = { platform, entity_type: !rootId ? 'CANDIDATE' : isReply ? 'COMMENT' : 'POST',
        entity_id: id, root_post_id: rootId, parent_id: nullableText(row.parent_id), text: typeof row.text === 'string' ? row.text : '',
        observed_at: observedAt, ...(row.published_at !== undefined ? { published_at: nullableText(row.published_at) } : {}), ...(url ? { permalink: url } : {}),
        ...(nullableText(row.author_name) ?? nullableText(row.author_username) ? { author: { name: nullableText(row.author_name) ?? nullableText(row.author_username) } } : {}),
        ...(source !== 'UNKNOWN' || row.source_name !== undefined || row.source_url !== undefined ? { source: { kind: source,
          ...(row.source_name !== undefined ? { name: nullableText(row.source_name) } : {}), ...(row.source_url !== undefined ? { url: nullableText(row.source_url) } : {}) } } : {}),
        ...(Array.isArray(row.media_refs) ? { media: row.media_refs as NonNullable<ConversationObservation['media']> } : {}),
        provenance: { run_id: input.runId, method: String(provenance.method ?? 'SEARCH'), query: String(row.query ?? ''), ...(url ? { url } : {}) },
        ...(!existing ? { coverage: { status: 'NOT_ATTEMPTED' as const, advertised_count: advertised } } : {}) };
      const saved = await store.ingest(observation, context);
      if (saved.snapshot?.post) noteDelivered(platform, saved.snapshot.root_post_id);
      if (isReply && (!saved.snapshot?.post || !rootId)) await enqueueRootResolution(observation);
      if (commentsEnabled && !enrichmentBlocked.has(platform) && saved.snapshot && url && !isReply && saved.snapshot.coverage.status === 'NOT_ATTEMPTED') {
        if (advertised === null || advertised > 0 || !observation.text.trim()) await store.enqueue({ type: 'ENRICH_CONVERSATION',
          idempotency_key: `${context.campaign_id}:${platform}:${rootId}:initial-comments`,
          payload: { platform, root_post_id: rootId, query: String(row.query ?? provenance.query ?? '').trim() },
          priority: !observation.text.trim() ? 80 : advertised === null ? 5 : 20, max_attempts: 2 });
      }
    }
    schedule(); await publish();
  }
  async function enrich(platform: Platform, window: WebContents, externalStop: () => boolean, limit = 3, types: ConversationJobType[] = ['ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'REVISIT'], preferredQuery?: string) {
    if (retained || stopped || closed || storageStopReason || !commentsEnabled || enrichmentBlocked.has(platform)) return;
    const buckets = types.includes('ENRICH_CONVERSATION') ? await store.enrichmentQueries(platform) : [];
    let nextBucket = 0, preferCurrent = Boolean(preferredQuery?.trim()) && types.includes('ENRICH_CONVERSATION');
    let resolveSlots = types.includes('ROOT_RESOLVE') && platform === 'threads' && input.resolveThreadsReplyRoot ? (types.length === 1 ? limit : 1) : 0;
    const claimNext = async () => {
      if (resolveSlots > 0) {
        resolveSlots--;
        const attempts = (await store.jobs()).filter(job => job.type === 'ROOT_RESOLVE').reduce((total, job) => total + job.attempts, 0);
        // A campaign-wide browser budget survives Stop/Resume; unattempted locators remain queued/raw.
        if (attempts < 50) {
          const options = { types: ['ROOT_RESOLVE'] as ConversationJobType[], platform, lease_ms: 180000 };
          const job = preferredQuery?.trim() ? await store.claim(`root-${platform}`, { ...options, query: preferredQuery }) : null;
          const fallback = job ?? await store.claim(`root-${platform}`, options);
          if (fallback) return fallback;
        }
      }
      if (preferCurrent) {
        const current = await store.claim(`comments-${platform}`, { types: ['ENRICH_CONVERSATION'], platform, query: preferredQuery!, lease_ms: 180000 });
        if (current) return current;
        preferCurrent = false;
      }
      // A bounded final drain gives each pending query a turn, instead of spending
      // every capture on the first query's backlog. Empty/legacy buckets also participate.
      while (buckets.length) {
        nextBucket %= buckets.length;
        const job = await store.claim(`comments-${platform}`, { types: ['ENRICH_CONVERSATION'], platform, query: buckets[nextBucket]!, lease_ms: 180000 });
        if (job) { nextBucket = (nextBucket + 1) % buckets.length; return job; }
        buckets.splice(nextBucket, 1);
      }
      const otherTypes = types.filter(type => type !== 'ROOT_RESOLVE');
      return otherTypes.length ? store.claim(`comments-${platform}`, { types: otherTypes, platform, lease_ms: 180000 }) : null;
    };
    for (let i = 0; i < limit && !stopped && !externalStop() && !enrichmentBlocked.has(platform); i++) {
      await backpressure();
      // Browser collection is independent of paid classification in rebuild runs.
      // Keep the existing capture/time/storage limits even while AI is paused.
      if (storageStopReason || stopped || externalStop() || controller.signal.aborted
        || (modelHalted && (!rebuild || !modelPauseReason || !fatalModelCode(modelPauseReason)))) break;
      const job = await claimNext(); if (!job) break;
      if (job.type === 'ROOT_RESOLVE') {
        try {
          const candidateId = String(job.payload.candidate_id);
          const currentCandidate = (await store.rootCandidates()).find(candidate => candidate.entity_id === candidateId);
          // An unknown reply may have acquired native root evidence after this idempotent job was queued.
          const expectedRootId = currentCandidate?.root_post_id ?? nullableText(job.payload.expected_root_id);
          const receipt = await input.resolveThreadsReplyRoot!({ window, candidate: { id: candidateId, url: String(job.payload.candidate_url),
            ...(expectedRootId ? { root_id: expectedRootId } : {}) }, runId: input.runId, shouldStop: () => stopped || externalStop(),
            onObservations: async observations => {
              if (expectedRootId && observations.some(observation => observation.root_post_id && observation.root_post_id !== expectedRootId)) throw Error('ROOT_RESOLUTION_IDENTITY_CONFLICT');
              await ingest(observations);
            }, maxMs: 20000 });
          // A claimed success is not an audit success until both the real root and selected reply relation exist.
          if (receipt.status === 'RESOLVED') {
            const resolved = receipt.root ? await store.snapshot(platform, receipt.root.id) : null;
            if (!receipt.root || receipt.root.id === candidateId || (expectedRootId && receipt.root.id !== expectedRootId) || !resolved?.post ||
              resolved.post.permalink !== receipt.root.url || !resolved.comments.some(comment => comment.entity_id === candidateId && comment.root_post_id === receipt.root!.id)) {
              await ingest([{ platform, entity_type: 'CAPTURE', entity_id: null, root_post_id: null, parent_id: null, text: '', observed_at: new Date().toISOString(),
                coverage: { status: 'RETRYABLE_ERROR', stop_reason: 'ROOT_RESOLUTION_EVIDENCE_MISSING' },
                provenance: { run_id: input.runId, method: 'ROOT_RESOLUTION_EVIDENCE_MISSING', url: String(job.payload.candidate_url), locator: candidateId } }]);
              throw Error('ROOT_RESOLUTION_EVIDENCE_MISSING');
            }
          }
          await ingest([{ platform, entity_type: 'CAPTURE', entity_id: null, root_post_id: null, parent_id: null, text: '', observed_at: new Date().toISOString(),
            coverage: { status: receipt.status === 'INACCESSIBLE' ? 'INACCESSIBLE' : receipt.status === 'RETRYABLE_ERROR' ? 'RETRYABLE_ERROR' : 'PARTIAL', stop_reason: `ROOT_${receipt.status}` },
            provenance: { run_id: input.runId, method: `ROOT_RESOLUTION_${receipt.status}`, url: String(job.payload.candidate_url), locator: String(job.payload.candidate_id) } }]);
          if (receipt.status === 'INACCESSIBLE') { await blockEnrichment(platform); }
          else if (stopped || externalStop() || receipt.status === 'RETRYABLE_ERROR') await store.retry(job.id, job.lease_token!, 'ROOT_RESOLUTION_RETRY', 30000);
          else {
            if (receipt.status === 'RESOLVED' && receipt.root) {
              await store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: `${context.campaign_id}:${platform}:${receipt.root.id}:initial-comments`,
                payload: { platform, root_post_id: receipt.root.id, query: String(job.payload.query ?? '') }, priority: 40, max_attempts: 2 });
            }
            await store.complete(job.id, job.lease_token!);
          }
        } catch (error) { lastError = safeCode(error); await store.retry(job.id, job.lease_token!, lastError, 30000); }
        await publish(); continue;
      }
      const rootId = String(job.payload.root_post_id), key = `${platform}:${rootId}`;
      const snapshot = await store.snapshot(platform, rootId);
      if (!snapshot?.post?.permalink || activeEnrich.has(key) || (typeof job.payload.expires_at === 'string' && Date.parse(job.payload.expires_at) < Date.now())) {
        await store.complete(job.id, job.lease_token!); continue;
      }
      activeEnrich.add(key);
      try {
        const receipt = await input.collectConversation({ window, platform, root: { id: rootId, url: snapshot.post.permalink }, runId: input.runId,
          shouldStop: () => stopped || externalStop(), onObservations: ingest, beforeNextPage: async () => {
            await backpressure(); if (storageStopReason) throw Error(storageStopReason);
          }, maxComments: campaign.budget.comments_per_capture,
          maxSteps: campaign.budget.comment_pages, maxMs: 30000 });
        const coverage = receipt && typeof receipt === 'object' ? (receipt as { coverage?: { status?: string; stop_reason?: string } }).coverage : undefined;
        if (coverage?.stop_reason === 'ACCOUNT_BARRIER') {
          const latest = await store.snapshot(platform, rootId);
          if (latest?.coverage.stop_reason !== 'ACCOUNT_BARRIER') await ingest([{ platform, entity_type: 'CAPTURE', entity_id: null, root_post_id: rootId, parent_id: null, text: '',
            observed_at: new Date().toISOString(), coverage: { status: 'INACCESSIBLE', stop_reason: 'ACCOUNT_BARRIER' },
            provenance: { run_id: input.runId, method: 'CONVERSATION_RECEIPT', url: snapshot.post.permalink } }]);
          await blockEnrichment(platform);
        }
        else if (storageStopReason || coverage?.status === 'RETRYABLE_ERROR' || stopped || externalStop()) await store.retry(job.id, job.lease_token!,
          storageStopReason ?? (stopped || externalStop() ? 'ENRICHMENT_INTERRUPTED' : 'ENRICHMENT_RETRYABLE_CAPTURE'), 30000);
        else await store.complete(job.id, job.lease_token!);
      } catch (error) { lastError = safeCode(error); await store.retry(job.id, job.lease_token!, lastError, 30000); }
      finally { activeEnrich.delete(key); }
      await publish();
    }
  }
  function clearAssessmentTimer() { assessmentGeneration++; if (assessmentTimer) { clearTimeout(assessmentTimer); assessmentTimer = null; } }
  async function requestDueAssessments() {
    if (retained || !temporalEnabled || stopped || closed || modelHalted) return;
    const evaluatedAt = now().toISOString();
    for (const due of await store.assessmentsDue(context, { now: evaluatedAt })) {
      if (stopped || closed || modelHalted) break;
      try { await store.requestAssessment(context, due.snapshot.id, { evaluated_at: evaluatedAt }); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'ASSESSMENT_SNAPSHOT_STALE') throw error; }
    }
  }
  async function armAssessments() {
    if (retained || !temporalEnabled || stopped || closed || assessmentWork) return;
    clearAssessmentTimer(); const generation = assessmentGeneration;
    const summary = await store.assessmentSummary(context, { now: now().toISOString() });
    const nextAt = modelHalted ? summary.next_future_at : summary.next_at;
    const hasWork = !modelHalted && (await classificationBacklog()).some(job => typeof job.payload.evaluated_at === 'string');
    if (generation !== assessmentGeneration || stopped || closed) return;
    assessmentActive = discoveryEnded && Boolean(nextAt || hasWork);
    if (!nextAt) return;
    const delay = Math.min(60000, Math.max(0, Date.parse(nextAt) - now().getTime()));
    assessmentTimer = setTimeout(() => {
      assessmentTimer = null;
      if (stopped || closed) return;
      assessmentWork = (async () => {
        await requestDueAssessments();
        await publish();
        if (!modelHalted) schedule(0);
      })().catch(error => { haltModel(safeCode(error)); })
        .finally(async () => { assessmentWork = null; await armAssessments(); await publish(); });
      void assessmentWork.catch(error => { lastError = safeCode(error); assessmentActive = false; clearAssessmentTimer(); });
    }, delay);
  }
  function clearWatchTimer() { if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; } }
  async function armWatch(finishing = false) {
    if (!watchEnabled || stopped || closed || storageStopReason || modelHalted || watchTimer || (watchWork && !finishing)) return;
    await store.coalesceRevisits({ platforms: input.platforms });
    const watch = await store.watchSummary(input.platforms);
    if (!watch.pending) { watchEnabled = false; await publish(); return; }
    if (!watch.next_at || stopped || closed || !watchEnabled) return;
    const delay = Math.min(60000, Math.max(0, Date.parse(watch.next_at) - Date.now(), watchRetryAt - Date.now()));
    watchTimer = setTimeout(() => {
      watchTimer = null;
      if (!watchEnabled || stopped || closed || modelHalted) return;
      watchWork = (async () => {
        await store.coalesceRevisits({ platforms: input.platforms });
        const due = (await store.jobs(['PENDING', 'RETRY'])).filter(job => job.type === 'REVISIT' && input.platforms.includes(job.payload.platform as Platform) && Date.parse(job.not_before) <= Date.now());
        due.sort((a, b) => a.not_before.localeCompare(b.not_before));
        const platform = due[0]?.payload.platform as Platform | undefined;
        if (platform && input.withRevisitWindow) {
          await input.withRevisitWindow(platform, async window => { await enrich(platform, window, () => stopped || !watchEnabled, 5, ['REVISIT']); });
          watchRetryAt = 0;
          await pump();
        }
      })().catch(error => { lastError = safeCode(error); watchRetryAt = Date.now() + 30000; })
        .finally(async () => { try { if (modelHalted) watchEnabled = false; await publish(); await armWatch(true); } finally { watchWork = null; } });
      void watchWork.catch(error => { lastError = safeCode(error); watchEnabled = false; clearWatchTimer(); });
    }, delay);
  }
  async function startWatching(): Promise<boolean> {
    if (retained || storageStopReason) return false;
    if (!discoveryEnded) throw Error('WATCH_DISCOVERY_ACTIVE');
    if (stopped || closed) return false;
    await requestDueAssessments(); if (!modelHalted) schedule(0); await armAssessments();
    if (watchEnabled) { await publish(); return true; }
    if (modelHalted || !campaign.watch.enabled || !commentsEnabled || !input.withRevisitWindow) { await publish(); return assessmentActive; }
    await store.coalesceRevisits({ platforms: input.platforms });
    if (!(await store.watchSummary(input.platforms)).pending) { await publish(); return assessmentActive; }
    if (stopped || closed || modelHalted) return false;
    watchEnabled = true; await publish(); await armWatch(); return watchEnabled;
  }
  function targetReached() {
    if (rebuild) return (progress.targetCount ?? 0) >= campaign.suitable_target;
    const total = progress.counts.suitable;
    return total >= campaign.suitable_target && input.platforms.every(platform => progress.byPlatform[platform].suitable >= platformTargets[platform]);
  }
  function discoveryStopReason(platform: Platform): string | null {
    if (stopped) return 'USER_STOP';
    if (enrichmentBlocked.has(platform)) return 'ACCOUNT_BARRIER';
    if (storageStopReason) return storageStopReason;
    if (modelHalted && !rebuild) return 'MODEL_PAUSED';
    if (progress.counts.raw >= runtimeLimits.effective_raw_cap) return 'RAW_BUDGET_REACHED';
    if (targetReached() || progress.byPlatform[platform].suitable >= platformTargets[platform]) return 'INTENT_TARGET_REACHED';
    return null;
  }
  async function backpressure(): Promise<void> {
    if (retained || stopped || closed || storageStopReason) return;
    if (storageWork) return storageWork;
    storageWork = (async () => {
      while (!stopped && !closed && !storageStopReason) {
        try {
          const backlog = await store.backlogBytes(context, { includeVerification: focusedEnabled });
          if (backlog.missing_snapshots) throw Error('STORAGE_BACKLOG_SNAPSHOT_MISSING');
          storageUsage = await measureStorageUsage({ directory: input.directory, pendingBytes: backlog.total_bytes, limits: storagePolicy.limits });
          const pressure = evaluateStoragePressure(storagePolicy.limits, storageUsage);
          if (pressure.state === 'STOP') storageStopReason = pressure.reason;
          else if (rebuild && pressure.state === 'BACKLOG') storageStopReason = pressure.reason;
          else if (!rebuild && (pressure.state === 'BACKLOG' || backlog.jobs > 128) && !modelHalted) { schedule(0); await sleep(250); continue; }
        } catch (error) {
          const reason = safeCode(error); storageStopReason = reason.startsWith('STORAGE_') ? reason : 'STORAGE_MEASUREMENT_FAILED';
        }
        if (storageStopReason) { lastError = storageStopReason; watchEnabled = false; clearWatchTimer(); await publish(); }
        break;
      }
    })().finally(() => { storageWork = null; });
    return storageWork;
  }
  await store.resume({ context });
  if (campaignExisted && postOnly && !off && !retained) await recoverPostAssessmentJobs(store, context, excludedRoots);
  if (!retained) await store.resume({ types: ['ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'REVISIT'] });
  if (!retained && input.resolveThreadsReplyRoot && commentsEnabled) for (const candidate of await store.rootCandidates()) await enqueueRootResolution(candidate);
  await requestDueAssessments(); await armAssessments(); await publish(); schedule();
  return {
    campaign, baselineCampaign, context, store, gateway, runtimeLimits, ingest, ingestRows, enrich, startWatching, isWatching: () => watchEnabled || assessmentActive,
    progress: (): OpportunityProgress => structuredClone({ ...progress, modelScheduling: gateway.summary().scheduling }), refreshProgress: publish,
    queries: (platform: Platform) => initialDiscoveryQueries(campaign, platform),
    queryPriority: (platform: Platform, query: string) => { const score = queryScores.find(s => s.platform === platform && s.query === query); return score ? score.accepted / Math.max(1, score.observed) : 0; },
    async expandQueries(request?: CoverageExpansionRequest) {
      if (!rebuild || (off && !campaign.discovery_plan) || stopped || (modelHalted && !campaign.discovery_plan) || targetReached()) return [];
      try {
        const expanded = await expandCoverage(request);
        if (expanded.length && ['QUERY_COVERAGE_INCOMPLETE', 'QUERY_EXPANSION_INVALID', 'QUERY_EXPANSION_UNGROUNDED'].includes(lastError ?? '')) {
          lastError = null; await publish();
        }
        return expanded;
      }
      catch (error) {
        lastError = safeCode(error); if (fatalModelCode(lastError)) haltModel(lastError); await publish();
        // A malformed/underfilled wave is not evidence that useful search directions ended.
        if (['QUERY_COVERAGE_INCOMPLETE', 'QUERY_EXPANSION_INVALID', 'QUERY_EXPANSION_UNGROUNDED'].includes(lastError)) throw error;
        return [];
      }
    },
    targetReached, discoveryStopReason,
    discoveryShouldStop: (platform: Platform) => discoveryStopReason(platform) !== null,
    backpressure,
    async drain() {
      importing = false;
      discoveryEnded = true;
      if (off) { await store.pause({ context }); await publish(); return; }
      await requestDueAssessments();
      while (!stopped && !modelHalted) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        await pump();
        if (!(await classificationBacklog()).length) break;
        await sleep(100);
      }
      await armAssessments(); await publish();
    },
    async stop() { stopped = true; watchEnabled = false; assessmentActive = false; clearWatchTimer(); clearAssessmentTimer(); controller.abort(); if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; } try { await Promise.allSettled([pumpWork, watchWork, assessmentWork]); } finally {
      await leases.close(); await store.pause({ context }); await store.pause({ types: ['ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'REVISIT'] }); await publish(); } },
    async results() {
      await publish();
      const exported = await store.exportSnapshot(context, rankingOptions), preview: OpportunityProgress['preview'] = off ? structuredClone(progress.preview) : [];
      for (const classification of ['SUITABLE', 'NOT_SUITABLE'] as const) {
        for (const { snapshot, decision } of exported.conversations.filter(result => classification === 'SUITABLE'
          ? result.decision.classification === 'SUITABLE' : result.decision.classification !== null && result.decision.classification !== 'SUITABLE').slice(0, 20)) {
          const target = [snapshot.post, ...snapshot.comments].find(e => e?.entity_id === (decision.action_target?.entity_id ?? decision.goal_assessment?.candidate_entity_id)) ?? snapshot.post;
          if (excludedRoots.has(snapshot.platform + ':' + snapshot.root_post_id)) continue;
          preview.push({ platform: snapshot.platform, rootId: snapshot.root_post_id, classification, text: (target?.text ?? '').slice(0, 900), link: target?.permalink ?? snapshot.post?.permalink ?? '',
            reason: String(decision.attributes?.need_summary ?? decision.reason_code),
          opportunityTypes: String(decision.attributes?.opportunity_types ?? '').split(',').filter(Boolean), publishedAt: snapshot.post?.published_at ?? null, evidence: snapshot.spans.filter(span => decision.evidence_ids.includes(span.id)).map(span => span.text.slice(0, 600)),
            ...(decision.goal_assessment ? { conditions: goalConditions(decision) } : {}),
            observedAt: snapshot.observed_at, coverage: snapshot.coverage.status });
        }
      }
      const exportedProgress: OpportunityProgress = { ...structuredClone(progress), counts: visibleCounts(exported.stats), byPlatform: { facebook: visibleCounts(exported.by_platform.facebook, 'facebook'), threads: visibleCounts(exported.by_platform.threads, 'threads') }, previouslyDelivered: previouslyDelivered.size,
        watchPending: exported.watch.pending, watchNextAt: exported.watch.next_at, preview };
      const resolutionJobs = (await store.jobs()).filter(job => job.type === 'ROOT_RESOLVE');
      return { campaign, evaluation: activeEvaluation ? { source_context: activeEvaluation.manifest.source_context,
        context, recipe_sha256: activeEvaluation.manifest.recipe_sha256, policy: 'PRIMARY_PLUS_FOCUSED_VERIFIER' } : null,
        ranking: structuredClone(rankingPin), runtime_limits: runtimeLimits, storage: { policy: structuredClone(storagePolicy), usage: storageUsage ? { ...storageUsage } : null, stop_reason: storageStopReason },
        root_resolution: { attempt_limit: 50, attempts: resolutionJobs.reduce((sum, job) => sum + job.attempts, 0),
        jobs: resolutionJobs.length, succeeded_jobs: resolutionJobs.filter(job => job.state === 'SUCCEEDED').length,
        remaining_jobs: resolutionJobs.filter(job => ['PENDING', 'RETRY', 'PAUSED', 'RUNNING'].includes(job.state)).length },
        ...(rebuild ? { selection: await selectTarget() } : {}),
        progress: exportedProgress, conversations: exported.conversations, snapshots: exported.snapshots, decisions: exported.decisions,
        decision_snapshots: exported.decision_snapshots, watermark: exported.watermark, cost: modelCost(), cost_captured_at: new Date().toISOString() };
    },
    async close() {
      if (closed) return; stopped = true; watchEnabled = false; assessmentActive = false; clearWatchTimer(); clearAssessmentTimer(); controller.abort(); if (pendingTimer) clearTimeout(pendingTimer);
      try { await Promise.allSettled([pumpWork, watchWork, assessmentWork, storageWork]); await publishWork; }
      finally { try { await store.pause({ context }); await store.pause({ types: ['ENRICH_CONVERSATION', 'ROOT_RESOLVE', 'REVISIT'] }); }
        finally { try { await leases.close(); await store.close(); } finally { closed = true; } } }
    },
  };
}
export type OpportunityPipeline = Awaited<ReturnType<typeof createOpportunityPipeline>>;
