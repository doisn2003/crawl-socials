import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, createUserConfigStore } from '../infrastructure/config/user-config.js';
import { throughput } from '../shared/throughput.js';
import { isBrowserProfileId } from '../domain/browser-profile.js';
import type { BrowserProfile } from '../domain/browser-profile.js';
import type { Account, OpportunityConfig, OpportunityCounts, OpportunityProgress, Platform, ProductionState, RetainedSourceCatalog, RunState, UserConfig } from '../shared/production-api.js';
import { createOpportunityPipeline } from './opportunity-pipeline.js';
import type { ConversationCollectInput, OpportunityPipeline, ReplyRootResolveInput, ReplyRootResolveReceipt } from './opportunity-pipeline.js';
import type { WebContents } from 'electron';
import { prepareDiscoveryAttempt } from './discovery-attempt.js';
import { readActiveEvaluation } from './evaluation-upgrade.js';
import type { ActiveEvaluation } from './evaluation-upgrade.js';
import { contentHash } from '../domain/conversation.js';
import { applyPreset, CampaignDraftPreparationError, listPresets, markDraftStarted, prepareDraft, readDraft, readDraftCost,
  resolveDraftForStart, savePreset, updateDraft } from './campaign-drafts.js';
import type { ResolvedCampaignDraft } from './campaign-drafts.js';
import { prepareSemanticDraft, continueSemanticDraft, readDialogue } from './campaign-drafts.js';
import type { ContinueCampaignRequest } from '../shared/semantic-intent.js';
import type { ApplyCampaignPresetRequest, CampaignDraftReference, SaveCampaignPresetRequest, UpdateCampaignDraftRequest } from '../shared/campaign-drafts.js';
import { listRetainedSources as catalogRetainedSources } from './retained-source-catalog.js';
import { listRegisteredRetainedSourceRoots, registerRetainedSourceRoot, resolveRetainedSourceRoot } from './retained-source-roots.js';
import { importRetainedData, prepareRetainedImport, readRetainedImport } from './retained-data-service.js';
import type { RetainedImportState } from './retained-data-service.js';

export interface ProductionHost {
  list(): Promise<(BrowserProfile & { open: boolean; persistenceError: string | null })[]>;
  sessionStatus(id: string): Promise<boolean>;
  create(label: string, platform: Platform): Promise<BrowserProfile>;
  openLogin(id: string): Promise<void>;
}
export interface CollectorInput {
  platform: Platform; profileId: string; config: Record<string, unknown>;
  shouldStop(): boolean;
  collectionLimitReason?(): string | null;
  onProgress(value: { total?: number; event?: string; query?: string; workers?: import('../shared/production-api.js').PlatformRun['workers'] }): void;
  resume?: boolean;
  onRecords?(rows: Record<string, unknown>[], provenance: Record<string, unknown>): Promise<void>;
  onQueryEnd?(value: { window: WebContents; platform: Platform; query?: string; shouldStop(): boolean }): Promise<void>;
  beforeNextPage?(): Promise<void>;
  expandQueries?(): Promise<string[]>;
  queryPriority?(query: string): number;
}
export interface CollectorReceipt { stop_reason: string; summary: { unique: number }; session_flush?: string; }
type Row = Record<string, unknown>;
const active = (run: RunState | null) => run?.state === 'RUNNING' || run?.state === 'STOPPING' || run?.opportunity?.watchActive === true || run?.opportunity?.assessmentActive === true;
const platformValue = (value: unknown): value is Platform => value === 'facebook' || value === 'threads';
const code = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'COLLECTION_FAILED';
const storageStopped = (reason: string | null | undefined): boolean => typeof reason === 'string' && reason.startsWith('STORAGE_');

export function createProductionService(input: {
  directory: string; version: string; host: ProductionHost;
  spendingStatus?(): NonNullable<ProductionState['spending']>;
  collect(value: CollectorInput): Promise<CollectorReceipt>;
  collectConversation?(value: ConversationCollectInput): Promise<unknown>;
  resolveThreadsReplyRoot?(value: ReplyRootResolveInput): Promise<ReplyRootResolveReceipt>;
  createOpportunity?: typeof createOpportunityPipeline;
  prepareCampaignDraft?: typeof prepareSemanticDraft;
  continueCampaignDraft?: typeof continueSemanticDraft;
  importRetainedData?: typeof importRetainedData;
  withConversationWindow?(profileId: string, work: (window: WebContents) => Promise<void>): Promise<void>;
  watchAfterDiscovery?: boolean;
}) {
  const configStore = createUserConfigStore(input.directory), latestFile = join(input.directory, 'latest-run.json');
  const activeDraftFile = join(input.directory, 'active-campaign-draft.json');
  type ActiveDraftPointer = { schemaVersion: 1; state: 'READY' | 'CLARIFYING' | 'FAILED' | 'PREPARING'; runId: string; configHash: string; errorCode?: string };
  function readDraftPointer(): ActiveDraftPointer | null {
    if (!existsSync(activeDraftFile)) return null;
    const pointer = JSON.parse(readFileSync(activeDraftFile, 'utf8')) as ActiveDraftPointer | { schemaVersion: 1; state: 'EMPTY' };
    if (pointer.state === 'EMPTY') { if (pointer.schemaVersion !== 1) throw Error('CAMPAIGN_DRAFT_STATE_INVALID'); return null; }
    if (pointer.schemaVersion !== 1 || !['READY', 'CLARIFYING', 'FAILED', 'PREPARING'].includes(pointer.state) || !/^crawl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(pointer.runId)
      || !/^[0-9a-f]{64}$/u.test(pointer.configHash) || (pointer.state === 'FAILED' && (typeof pointer.errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,100}$/u.test(pointer.errorCode)))) throw Error('CAMPAIGN_DRAFT_STATE_INVALID');
    return pointer;
  }
  function campaignState(): Pick<ProductionState, 'campaignDraft' | 'campaignDialogue' | 'campaignDraftPreparing' | 'campaignDraftError' | 'campaignPresets'> {
    const pointer = readDraftPointer(), presets = listPresets({ directory: input.directory });
    const draft = pointer?.state === 'READY' ? readDraft({ directory: input.directory, runId: pointer.runId }) : null;
    const dialogue = pointer && (pointer.state === 'CLARIFYING' || (pointer.state === 'READY' && draft?.status === 'DRAFT'))
      ? readDialogue({ directory: input.directory, runId: pointer.runId }) : null;
    return { ...(dialogue ? { campaignDialogue: dialogue } : {}), ...(presets.length ? { campaignPresets: presets } : {}), ...(pointer?.state === 'READY'
      ? draft?.status === 'DRAFT' ? { campaignDraft: draft } : {}
      : pointer?.state === 'PREPARING' && preparingDraft ? { campaignDraftPreparing: { runId: pointer.runId, cost: readDraftCost({ directory: input.directory, runId: pointer.runId }) } }
      : pointer?.state === 'FAILED' || pointer?.state === 'PREPARING' ? { campaignDraftError: {
        code: pointer.state === 'PREPARING' ? 'DRAFT_PREPARATION_INTERRUPTED' : pointer.errorCode!, runId: pointer.runId,
        cost: readDraftCost({ directory: input.directory, runId: pointer.runId }) } } : {}) };
  }
  let run: RunState | null = null, starting = false, preparingDraft = false, stopped = false, executing = false, work: Promise<void> | null = null;
  let pipeline: OpportunityPipeline | null = null;
  type OpportunityExport = Awaited<ReturnType<OpportunityPipeline['results']>> & { retained_input?: unknown };
  const exports = new WeakMap<OpportunityPipeline, Promise<OpportunityExport>>();
  let closingPipeline: Promise<void> | null = null;
  function assertActiveExport(outputDirectory: string, exported: unknown): ActiveEvaluation | null {
    const evaluation = readActiveEvaluation(join(outputDirectory, 'opportunity'));
    if (!evaluation) return null;
    const value = exported && typeof exported === 'object' ? exported as { campaign?: unknown; conversations?: Array<{ decision?: Record<string, unknown> }> } : null;
    if (evaluation.state !== 'READY_FOR_VERIFICATION' || !value?.campaign || contentHash(value.campaign) !== contentHash(evaluation.campaign) ||
      !Array.isArray(value.conversations) || value.conversations.some(({ decision }) => !decision || decision.campaign_id !== evaluation.context.campaign_id ||
        decision.campaign_version !== evaluation.context.campaign_version || decision.filter_version !== evaluation.context.filter_version)) throw Error('RESULTS_STALE_EVALUATION_CONTEXT');
    return evaluation;
  }
  function cachedOpportunity(current: RunState): unknown {
    const file = join(current.outputDirectory, 'opportunity-results.json');
    const exported: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    assertActiveExport(current.outputDirectory, exported);
    return exported;
  }
  function pendingEvaluationProgress(current: RunState, error: string): OpportunityProgress {
    const previous = current.opportunity;
    const pending = (value?: OpportunityCounts): OpportunityCounts => ({ raw: value?.raw ?? 0, comments: value?.comments ?? 0,
      suitable: 0, notYet: 0, unrelated: 0, pending: value?.raw ?? 0, failed: 0 });
    return { campaignId: previous?.campaignId ?? '', totalTarget: previous?.totalTarget ?? current.minimumPosts,
      threadsShare: previous?.threadsShare ?? 0.8, counts: pending(previous?.counts),
      byPlatform: { facebook: pending(previous?.byPlatform.facebook), threads: pending(previous?.byPlatform.threads) },
      costUsd: previous?.costUsd ?? 0, costUpperUsd: previous?.costUpperUsd ?? 0, usageUnknown: previous?.usageUnknown ?? 0,
      budgetUsd: previous?.budgetUsd ?? 0, phase: 'EVALUATION_REFRESH_REQUIRED', lastError: error, preview: [], watchActive: false, watchPending: 0, watchNextAt: null };
  }
  function presentedRun(): RunState | null {
    if (!run) return null;
    const value = structuredClone(run);
    if (pipeline && value.opportunity) value.opportunity.modelScheduling = pipeline.progress().modelScheduling;
    if (!existsSync(join(run.outputDirectory, 'opportunity', 'active-evaluation.json'))) return value;
    try {
      if (pipeline) {
        assertActiveExport(run.outputDirectory, { campaign: pipeline.campaign, conversations: [] });
        value.opportunity = pipeline.progress();
      } else {
        const exported = cachedOpportunity(run) as { progress?: OpportunityProgress };
        if (!exported?.progress) throw Error('RESULTS_STALE_EVALUATION_CONTEXT');
        value.opportunity = structuredClone(exported.progress);
      }
    } catch (error) {
      value.opportunity = pendingEvaluationProgress(value, code(error)); value.preview = [];
      if (value.state === 'COMPLETED') value.state = 'STOPPED';
      for (const platform of value.platforms) if (platform.state === 'COMPLETED') { platform.state = 'STOPPED'; platform.reason = 'EVALUATION_REFRESH_REQUIRED'; }
    }
    if (value.state === 'COMPLETED' && value.opportunity && (value.opportunity.targetCount ?? value.opportunity.counts.suitable) < value.opportunity.totalTarget) value.state = 'STOPPED';
    return value;
  }
  // Serialize capture + publication, so an older slow export cannot overwrite the final one.
  function exportPipeline(target: OpportunityPipeline, outputDirectory: string): Promise<OpportunityExport> {
    const task = (exports.get(target) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const exported: OpportunityExport = await target.results();
      if (run?.mode === 'RETAINED' && run.id === target.campaign.campaign_id) {
        exported.retained_input = (await readRetainedImport({ dataDirectory: input.directory, targetRunId: run.id })).exportMetadata;
      }
      assertActiveExport(outputDirectory, exported);
      atomicJson(join(outputDirectory, 'opportunity-results.json'), exported);
      return exported;
    });
    exports.set(target, task);
    const clear = () => { if (exports.get(target) === task) exports.delete(target); };
    void task.then(clear, clear);
    return task;
  }
  function closePipeline(): Promise<void> {
    const target = pipeline;
    if (!target) return closingPipeline ?? Promise.resolve();
    pipeline = null; // New exports cannot acquire a pipeline that is retiring.
    const previous = closingPipeline;
    const task = (async () => {
      await previous?.catch(() => {});
      await exports.get(target)?.catch(() => {});
      await target.close();
    })();
    closingPipeline = task;
    const clear = () => { if (closingPipeline === task) closingPipeline = null; };
    void task.then(clear, clear);
    return task;
  }
  const blockedProfiles = new Set<string>();
  const saveRun = () => { if (run) atomicJson(latestFile, run); };
  if (existsSync(latestFile)) {
    const saved = JSON.parse(readFileSync(latestFile, 'utf8')) as RunState;
    if (!/^crawl-[0-9a-f-]{36}$/.test(saved.id) || saved.outputDirectory !== join(input.directory, 'collections', saved.id) ||
        !Array.isArray(saved.platforms) || saved.platforms.length > 2 || saved.platforms.some(p => !platformValue(p.platform)
          || (saved.mode === 'RETAINED' ? p.profileId !== null : !isBrowserProfileId(p.profileId)))
        || (saved.mode !== undefined && saved.mode !== 'DISCOVERY' && saved.mode !== 'RETAINED')
        || (saved.mode === 'RETAINED' && (!saved.retained || !/^crawl-[0-9a-f-]{36}$/u.test(saved.retained.sourceRunId)
          || !/^[0-9a-f]{64}$/u.test(saved.retained.inputHash)))) throw Error('RUN_STATE_INVALID');
    run = saved;
    if (active(run)) {
      run.state = 'INTERRUPTED'; run.finishedAt = new Date().toISOString();
      if (run.opportunity) { run.opportunity.watchActive = false; run.opportunity.assessmentActive = false; run.opportunity.phase = 'PAUSED'; }
      if (run.retained?.status === 'IMPORTING') run.retained.status = 'PAUSED';
      for (const item of run.platforms) if (item.state === 'RUNNING' || item.state === 'QUEUED') { item.state = 'STOPPED'; item.reason = 'APP_INTERRUPTED'; }
      rebuildResults(); saveRun();
    }
  }
  function rows(platform: Platform): Row[] {
    if (!run || run.mode === 'RETAINED') return [];
    const folder = join(run.outputDirectory, platform), json = join(folder, 'posts.json'), jsonl = join(folder, 'posts.jsonl');
    // JSONL is the durable source after an interrupted run; skip only an incomplete final line.
    if (existsSync(jsonl)) {
      const text = readFileSync(jsonl, 'utf8'), lines = text.split('\n'), result: Row[] = [];
      for (const [i, line] of lines.entries()) {
        if (!line.trim()) continue;
        try { result.push(JSON.parse(line) as Row); }
        catch { if (i !== lines.length - 1 || text.endsWith('\n')) throw Error('COLLECTION_DATA_INVALID'); }
      }
      // Normal completed exports may contain source-audit enrichment; use them only when current.
      if (existsSync(json)) {
        const exported: unknown = JSON.parse(readFileSync(json, 'utf8'));
        if (Array.isArray(exported) && exported.length === result.length) return exported as Row[];
      }
      return result;
    }
    if (!existsSync(json)) return [];
    const data: unknown = JSON.parse(readFileSync(json, 'utf8'));
    if (!Array.isArray(data)) throw Error('COLLECTION_DATA_INVALID');
    return data as Row[];
  }
  function rebuildResults() {
    if (!run || run.mode === 'RETAINED') return;
    run.preview = [];
    const data = { facebook: rows('facebook'), threads: rows('threads') };
    for (const item of run.platforms) {
      item.count = data[item.platform].length;
      for (const row of data[item.platform].slice(0, 3)) run.preview.push({
        platform: item.platform, post_id: String(row.post_id || ''), text: String(row.text || '').slice(0, 800),
        query: String(row.query || ''), link: String(row.observed_post_url || row.post_url || ''),
      });
    }
    atomicJson(join(run.outputDirectory, 'results.json'), { run: { id: run.id, startedAt: run.startedAt, minimumPosts: run.minimumPosts, keywords: run.keywords }, ...data });
  }
  let accountCache: Account[] = [];
  async function accounts(): Promise<Account[]> {
    const list = await input.host.list();
    accountCache = await Promise.all(list.map(async profile => {
      let authenticated = false, persistenceError = profile.persistenceError;
      try { authenticated = await input.host.sessionStatus(profile.id); }
      catch (error) { persistenceError = code(error); }
      return { id: profile.id, label: profile.label, platform: profile.platform || 'facebook', open: profile.open,
        authenticated: authenticated && !persistenceError && !blockedProfiles.has(profile.id), persistenceError };
    }));
    return structuredClone(accountCache);
  }
  async function getState(): Promise<ProductionState> {
    const accountState = run?.mode === 'RETAINED' ? structuredClone(accountCache) : await accounts();
    // Read the correlated config/draft/run state together after the asynchronous account lookup.
    return { version: input.version, config: configStore.read(), accounts: accountState, run: presentedRun(), ...campaignState(), ...(input.spendingStatus ? { spending: input.spendingStatus() } : {}) };
  }
  function bindRetainedProgress(current: RunState, value: RetainedImportState) {
    current.retained = { sourceRunId: value.manifest.source.source_run_id, inputHash: value.manifest.input_sha256,
      assessmentAsOf: value.manifest.captured_at,
      importedObservations: value.checkpoint.imported_observations, totalObservations: value.checkpoint.total_observations, status: value.checkpoint.status };
  }
  async function createRetainedPipeline(current: RunState, config: OpportunityConfig, imported: RetainedImportState, draft?: ResolvedCampaignDraft) {
    return (input.createOpportunity ?? createOpportunityPipeline)({ directory: current.outputDirectory, runId: current.id, config,
      ...(draft ? { campaign: draft.campaign } : {}), platforms: current.platforms.map(item => item.platform),
      processingMode: 'RETAINED', assessmentTime: imported.manifest.captured_at,
      collectConversation: async () => { throw Error('RETAINED_BROWSER_DISABLED'); },
      onProgress: value => {
        current.opportunity = value;
        for (const item of current.platforms) item.count = value.byPlatform[item.platform].raw;
        saveRun();
      } });
  }
  async function executeRetained() {
    if (!run || !pipeline || run.mode !== 'RETAINED') throw Error('RETAINED_RUN_INVALID');
    const current = run, target = pipeline;
    executing = true;
    try {
      for (const item of current.platforms) item.state = 'RUNNING'; saveRun();
      let lastPublished = 0;
      const imported = await (input.importRetainedData ?? importRetainedData)({ dataDirectory: input.directory, targetRunId: current.id,
        targetContext: target.context, store: target.store, shouldStop: () => stopped,
        onProgress: async checkpoint => {
          if (current.retained) Object.assign(current.retained, { importedObservations: checkpoint.imported_observations,
            totalObservations: checkpoint.total_observations, status: checkpoint.status });
          if (Date.now() - lastPublished >= 500 || checkpoint.status !== 'IMPORTING') {
            await target.refreshProgress(); saveRun(); lastPublished = Date.now();
          }
        } });
      bindRetainedProgress(current, imported);
      // No model request may see a partially reconstructed source conversation.
      if (!stopped && imported.checkpoint.status === 'IMPORTED') await target.drain();
      else await target.stop();
      await target.refreshProgress(); current.opportunity = target.progress();
      await exportPipeline(target, current.outputDirectory);
      const complete = !stopped && target.targetReached() && current.opportunity.phase === 'SETTLED';
      current.state = complete ? 'COMPLETED' : 'STOPPED';
      for (const item of current.platforms) {
        item.count = current.opportunity.byPlatform[item.platform].raw;
        item.state = complete ? 'COMPLETED' : 'STOPPED';
        item.reason = stopped ? 'USER_STOP' : current.opportunity.phase === 'MODEL_PAUSED' ? 'MODEL_PAUSED' : 'RETAINED_INPUT_COMPLETE';
      }
    } catch (error) {
      current.state = stopped ? 'STOPPED' : 'FAILED';
      try { bindRetainedProgress(current, await readRetainedImport({ dataDirectory: input.directory, targetRunId: current.id })); } catch { /* Preserve latest known import cursor. */ }
      for (const item of current.platforms) { item.state = stopped ? 'STOPPED' : 'FAILED'; item.reason = code(error); }
      // Partial raw remains exportable, but a failed prefix never enters inference.
      await exportPipeline(target, current.outputDirectory).catch(() => {});
    } finally {
      current.finishedAt = new Date().toISOString();
      try { saveRun(); } finally { try { await closePipeline(); } finally { executing = false; } }
    }
  }
  async function resumeRetained(): Promise<ProductionState> {
    if (!run || run.mode !== 'RETAINED') throw Error('RESUME_UNAVAILABLE');
    const current = run, previous = structuredClone(current);
    starting = true; stopped = false; let launched = false;
    try {
      await closePipeline();
      const imported = await readRetainedImport({ dataDirectory: input.directory, targetRunId: current.id });
      const config = JSON.parse(readFileSync(join(current.outputDirectory, 'opportunity-config.json'), 'utf8')) as OpportunityConfig;
      pipeline = await createRetainedPipeline(current, config, imported);
      if (contentHash(pipeline.context) !== contentHash(imported.manifest.target_context)) throw Error('RETAINED_TARGET_CONTEXT_INVALID');
      bindRetainedProgress(current, imported); current.state = 'RUNNING'; current.finishedAt = null;
      for (const item of current.platforms) { item.state = 'QUEUED'; item.reason = null; }
      saveRun(); work = executeRetained(); launched = true; void work.catch(() => {});
      return await getState();
    } catch (error) {
      if (!launched) { await closePipeline(); run = previous; saveRun(); }
      throw error;
    } finally { starting = false; }
  }
  async function execute(resume = false) {
    if (!run) return;
    executing = true;
    const currentRun = run;
    let storageHalted = false;
    try {
      // Start every selected source before awaiting completion. A source failure must
      // never release the run lock while another collector is still using its profile.
      const outcomes = await Promise.allSettled(currentRun.platforms.map(async item => {
        try {
          if (stopped) throw Error('USER_STOP');
          // Resume the saved AI backlog without reopening search windows when
          // discovery has already reached its global raw/accepted target.
          const existingLimit = resume ? pipeline?.discoveryStopReason(item.platform) : null;
          if (existingLimit) {
            item.count = rows(item.platform).length; item.state = 'STOPPED'; item.reason = existingLimit; saveRun(); return;
          }
          item.state = 'RUNNING'; saveRun();
          const output = join(currentRun.outputDirectory, item.platform);
          const queries = pipeline ? pipeline.queries(item.platform) : [...currentRun.keywords];
          // Each source may use the remaining global discovery allowance. Output mix is enforced
          // by qualified conversation counts, never by an assumed source-specific raw yield.
          const rawTarget = pipeline ? pipeline.runtimeLimits?.effective_raw_cap ?? pipeline.campaign.budget.raw_cap : currentRun.minimumPosts;
          const configFile = join(output, 'config.json');
          let config: Record<string, unknown> = resume && existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown> :
            { runId: currentRun.id + '-' + item.platform, output, queries,
            parallelWorkers: throughput(configStore.read().performance).windowsPerPlatform,
            ...(pipeline?.campaign.result_policy === 'GLOBAL_FIRST_QUALIFIED' ? { queryTaskPolicy: 'PER_QUERY_V1', windowMode: configStore.read().performance === 'FAST' ? 'ALL' : 'AUTO' } : {}),
            maxScrollsPerQuery: pipeline ? 20 : item.platform === 'facebook' ? 50 : 100, maxMinutes: pipeline?.campaign.budget.max_run_minutes ?? 240, settleMs: 3000,
            ...(pipeline ? { includeContextCandidates: true } : {}),
            ...(item.platform === 'facebook' ? { targetNewRecords: rawTarget } : { targetTotal: pipeline ? 10000 : rawTarget, modes: ['top', 'recent'], ...(pipeline ? { interleaveModes: true } : {}) }) };
          let collectorResume = resume;
          if (pipeline && resume) {
            const attempt = prepareDiscoveryAttempt({ config, platform: item.platform, cumulativeRawCount: rows(item.platform).length,
              allocationTotal: item.platform === 'threads' ? Number(config.targetTotal) : rawTarget });
            if (attempt.kind === 'ALLOCATION_COMPLETE') { item.count = rows(item.platform).length; item.state = 'STOPPED'; item.reason = 'RAW_BUDGET_REACHED'; saveRun(); return; }
            config = attempt.config; collectorResume = attempt.resume;
            if (attempt.attempt && attempt.recordPath) atomicJson(attempt.recordPath, attempt.attempt);
          }
          mkdirSync(output, { recursive: true }); atomicJson(join(output, 'config.json'), config);
          if (!item.profileId || !(await input.host.sessionStatus(item.profileId))) throw Error('LOGIN_REQUIRED');
          if (stopped) throw Error('USER_STOP');
          let lastSaved = 0;
          const receipt = await input.collect({ platform: item.platform, profileId: item.profileId, config, resume: collectorResume,
            shouldStop: () => stopped,
            ...(pipeline ? {
              collectionLimitReason: () => pipeline!.discoveryStopReason(item.platform),
              onRecords: (records: Row[], provenance: Row) => pipeline!.ingestRows(item.platform, records, provenance),
              onQueryEnd: (value: { window: WebContents; query?: string; shouldStop(): boolean }) => pipeline!.enrich(item.platform, value.window, () => stopped || value.shouldStop(), 3, undefined, value.query),
              beforeNextPage: () => pipeline!.backpressure(),
              expandQueries: () => pipeline!.expandQueries(),
              queryPriority: query => pipeline!.queryPriority(item.platform, query),
            } : {}),
            onProgress: value => {
              if (value.workers) item.workers = value.workers;
              if (Number.isSafeInteger(value.total) && Number(value.total) >= 0) item.count = Number(value.total);
              if (Date.now() - lastSaved > 1500) { saveRun(); lastSaved = Date.now(); }
            } });
          item.count = rows(item.platform).length; item.reason = receipt.stop_reason;
          const regular = ['TARGET_REACHED', 'INTENT_TARGET_REACHED', 'RAW_BUDGET_REACHED', 'MODEL_PAUSED', 'QUERY_BUDGET_COMPLETE', 'REPLAY_BUDGET_REACHED', 'SOURCE_EXHAUSTED', 'NO_PROGRESS', 'USER_STOP', 'RUN_DEADLINE', 'WINDOW_CLOSED'];
          item.state = !regular.includes(item.reason) && !storageStopped(item.reason) ? 'FAILED' : !pipeline && !storageStopped(item.reason) && item.count >= currentRun.minimumPosts ? 'COMPLETED' : 'STOPPED';
          if (receipt.session_flush && receipt.session_flush !== 'OK') { item.state = 'FAILED'; item.reason = 'SESSION_SAVE_FAILED'; }
          if (item.profileId && /ACCOUNT_BARRIER|LOGIN_REQUIRED/.test(item.reason)) blockedProfiles.add(item.profileId);
        } catch (error) {
          item.reason = code(error);
          item.state = ['USER_STOP', 'RUN_DEADLINE', 'WINDOW_CLOSED'].includes(item.reason) || storageStopped(item.reason) ? 'STOPPED' : 'FAILED';
          if (item.profileId && /ACCOUNT_BARRIER|LOGIN_REQUIRED/.test(item.reason)) blockedProfiles.add(item.profileId);
        }
        // Read only this finished source; the other source may still be writing.
        const data = rows(item.platform);
        item.count = data.length;
        for (const row of data.slice(0, 3)) currentRun.preview.push({
          platform: item.platform, post_id: String(row.post_id || ''), text: String(row.text || '').slice(0, 800),
          query: String(row.query || ''), link: String(row.observed_post_url || row.post_url || ''),
        });
        saveRun();
      }));
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === 'rejected') {
          const item = currentRun.platforms[index]!;
          item.reason = code(outcome.reason); item.state = storageStopped(item.reason) ? 'STOPPED' : 'FAILED';
        }
      }
      if (pipeline) {
        const storageLimited = currentRun.platforms.some(item => storageStopped(item.reason)) || storageStopped(pipeline.progress().lastError);
        // Search may hit its limit in the middle of a query. Give queued comment work a bounded final turn.
        // User Stop, closed windows, account barriers and deadlines never reopen a profile here.
        if (!stopped && !storageLimited && input.withConversationWindow) {
          const allowed = new Set(['TARGET_REACHED', 'INTENT_TARGET_REACHED', 'RAW_BUDGET_REACHED', 'QUERY_BUDGET_COMPLETE', 'REPLAY_BUDGET_REACHED', 'SOURCE_EXHAUSTED', 'NO_PROGRESS']);
          await Promise.allSettled(currentRun.platforms.filter(item => allowed.has(item.reason ?? '')).map(async item => {
            try {
              if (!item.profileId) throw Error('PROFILE_NOT_FOUND');
              await input.withConversationWindow!(item.profileId, window => pipeline!.enrich(item.platform, window, () => stopped, 12));
            } catch (error) { item.reason = code(error); item.state = 'FAILED'; }
          }));
        }
        await pipeline.drain();
        currentRun.opportunity = pipeline.progress();
        await exportPipeline(pipeline, currentRun.outputDirectory);
        const complete = !storageLimited && !storageStopped(pipeline.progress().lastError) && pipeline.targetReached();
        for (const item of currentRun.platforms) if (item.state !== 'FAILED') item.state = complete ? 'COMPLETED' : 'STOPPED';
        run.state = complete ? 'COMPLETED' : run.platforms.some(p => p.state === 'FAILED') ? 'FAILED' : 'STOPPED';
      } else run.state = run.platforms.some(p => p.state === 'FAILED') ? 'FAILED' :
        run.platforms.every(p => p.state === 'COMPLETED') ? 'COMPLETED' : 'STOPPED';
      rebuildResults();
    } catch (error) {
      const reason = code(error); storageHalted = storageStopped(reason);
      for (const item of run.platforms) if (storageHalted ? item.state !== 'FAILED' : item.state === 'RUNNING' || item.state === 'QUEUED') {
        item.state = storageHalted ? 'STOPPED' : 'FAILED'; item.reason = reason;
      }
      run.state = storageHalted && !run.platforms.some(item => item.state === 'FAILED') ? 'STOPPED' : 'FAILED';
    } finally {
      run.finishedAt = new Date().toISOString();
      let watching = false;
      try {
        if (pipeline && !stopped && !storageHalted && !run.platforms.some(item => storageStopped(item.reason)) && !storageStopped(pipeline.progress().lastError)
          && input.watchAfterDiscovery !== false) watching = await pipeline.startWatching();
      } catch (error) {
        if (run.opportunity) { run.opportunity.watchActive = false; run.opportunity.assessmentActive = false; run.opportunity.lastError = 'WATCH_' + code(error); }
      }
      try { saveRun(); }
      finally { try { if (!watching) await closePipeline(); } finally { executing = false; } }
    }
  }
  async function listRetainedSources(): Promise<RetainedSourceCatalog> {
    const catalog: RetainedSourceCatalog = { sources: [], issues: [] };
    try { catalog.sources.push(...await catalogRetainedSources(input.directory)); }
    catch (error) { catalog.issues.push({ sourceRootId: null, label: 'Dữ liệu trên máy này', code: code(error) }); }
    let roots: Awaited<ReturnType<typeof listRegisteredRetainedSourceRoots>>;
    try { roots = await listRegisteredRetainedSourceRoots({ directory: input.directory }); }
    catch (error) { catalog.issues.push({ sourceRootId: null, label: 'Danh sách thư mục đã chọn', code: code(error) }); return catalog; }
    for (const root of roots) {
      try {
        const sourceDirectory = await resolveRetainedSourceRoot({ directory: input.directory, sourceRootId: root.id });
        const sources = await catalogRetainedSources(sourceDirectory);
        catalog.sources.push(...sources.map(source => ({ ...source, sourceRootId: root.id, sourceLabel: root.label })));
      } catch (error) { catalog.issues.push({ sourceRootId: root.id, label: root.label, code: code(error) }); }
    }
    catalog.sources.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId) || (a.sourceRootId ?? '').localeCompare(b.sourceRootId ?? ''));
    return catalog;
  }
  return {
    getState,
    listRetainedSources,
    /** Only main's native picker/explicit trusted caller may supply a filesystem path. */
    async registerRetainedSourceRoot(selectedPath: string): Promise<RetainedSourceCatalog> {
      if (active(run) || starting || executing || preparingDraft) throw Error('COLLECTION_BUSY');
      await registerRetainedSourceRoot({ directory: input.directory, selectedPath });
      return listRetainedSources();
    },
    async startRetained(value: unknown): Promise<ProductionState> {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true;
      const previous = run; let launched = false;
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || !['draft,sourceRunId', 'draft,sourceRootId,sourceRunId'].includes(Object.keys(value).sort().join())) throw Error('RETAINED_INPUT_INVALID');
        const request = value as { sourceRunId: string; sourceRootId?: string; draft: CampaignDraftReference }, ref = request.draft;
        if (typeof request.sourceRunId !== 'string' || !ref || typeof ref !== 'object' || Array.isArray(ref)
          || Object.keys(ref).sort().join() !== 'configHash,revision,runId'
          || (Object.hasOwn(request, 'sourceRootId') && typeof request.sourceRootId !== 'string')) throw Error('RETAINED_INPUT_INVALID');
        const config = configStore.read();
        if (!config.opportunity?.enabled || contentHash(config.opportunity) !== ref.configHash) throw Error('DRAFT_CONFIG_MISMATCH');
        const draft = resolveDraftForStart({ directory: input.directory, runId: ref.runId, expectedRevision: ref.revision, expectedConfigHash: ref.configHash });
        if (draft.status !== 'DRAFT') throw Error('DRAFT_ALREADY_STARTED');
        const sourceLocation = request.sourceRootId === undefined ? {} : { sourceRootId: request.sourceRootId,
          sourceDataDirectory: await resolveRetainedSourceRoot({ directory: input.directory, sourceRootId: request.sourceRootId }) };
        await closePipeline();
        const imported = await prepareRetainedImport({ dataDirectory: input.directory, sourceRunId: request.sourceRunId, targetRunId: draft.runId,
          ...sourceLocation,
          targetContext: { campaign_id: draft.campaign.campaign_id, campaign_version: draft.campaign.version, filter_version: draft.campaign.filter_version },
          maxRoots: draft.campaign.budget.raw_cap, platformWeights: draft.campaign.desired_platform_weights });
        if (!imported.manifest.source.platforms.length) throw Error('RETAINED_NO_ROOTS');
        run = { id: draft.runId, mode: 'RETAINED', state: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null,
          minimumPosts: config.minimumPosts, keywords: draft.campaign.queries.map(query => query.text), outputDirectory: draft.outputDirectory,
          platforms: imported.manifest.source.platforms.map(platform => ({ platform, profileId: null, state: 'QUEUED', count: 0, reason: null })), preview: [] };
        bindRetainedProgress(run, imported); stopped = false; saveRun();
        atomicJson(join(run.outputDirectory, 'opportunity-config.json'), config.opportunity);
        pipeline = await createRetainedPipeline(run, config.opportunity, imported, draft);
        markDraftStarted({ directory: input.directory, runId: draft.runId, expectedRevision: draft.revision, expectedConfigHash: draft.configHash });
        work = executeRetained(); launched = true; void work.catch(() => {});
        return await getState();
      } catch (error) {
        if (!launched) {
          const failed = run; await closePipeline(); run = previous;
          if (run) saveRun();
          else if (failed && failed !== previous) {
            run = failed; run.state = 'FAILED'; run.finishedAt = new Date().toISOString();
            for (const item of run.platforms) { item.state = 'FAILED'; item.reason = code(error); } saveRun();
          }
        }
        throw error;
      } finally { starting = false; }
    },
    progress() {
      const current = presentedRun();
      return current ? { id: current.id, state: current.state, minimumPosts: current.minimumPosts,
        platforms: current.platforms.map(p => ({ platform: p.platform, state: p.state, count: p.count, reason: p.reason })),
        ...(current.opportunity ? { opportunity: current.opportunity } : {}) } : null;
    },
    saveConfig(value: unknown): UserConfig {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      return configStore.save(value);
    },
    async prepareCampaign(): Promise<ProductionState> {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true; preparingDraft = true;
      try {
        const config = configStore.read().opportunity; if (!config?.enabled) throw Error('DRAFT_OPPORTUNITY_REQUIRED');
        if (config.filterMode === 'OFF') throw Error('OFF_MODEL_CALL_FORBIDDEN');
        const configHash = contentHash(config), pointer = readDraftPointer();
        if (pointer?.state === 'CLARIFYING' && pointer.configHash === configHash) return await getState();
        if (pointer?.state === 'READY' && pointer.configHash === configHash) {
          const existing = readDraft({ directory: input.directory, runId: pointer.runId });
          if (existing.status === 'DRAFT' && existing.configHash === configHash) return await getState();
        }
        try {
          const draft = await (input.prepareCampaignDraft ?? prepareSemanticDraft)({ directory: input.directory, config,
            ...((pointer?.state === 'FAILED' || pointer?.state === 'PREPARING') && pointer.configHash === configHash ? { resumeRunId: pointer.runId } : {}),
            onAllocated: allocation => atomicJson(activeDraftFile, { schemaVersion: 1, state: 'PREPARING', ...allocation }) });
          atomicJson(activeDraftFile, { schemaVersion: 1, state: 'plan' in draft ? 'CLARIFYING' : 'READY', runId: draft.runId, configHash: draft.configHash });
        } catch (error) {
          if (!(error instanceof CampaignDraftPreparationError)) throw error;
          atomicJson(activeDraftFile, { schemaVersion: 1, state: 'FAILED', runId: error.runId, configHash, errorCode: error.code });
        }
        return await getState();
      } finally { starting = false; preparingDraft = false; }
    },
    async continueCampaign(value: unknown): Promise<ProductionState> {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true; preparingDraft = true;
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('DRAFT_INPUT_INVALID');
        const request = value as ContinueCampaignRequest, pointer = readDraftPointer(), config = configStore.read().opportunity;
        if (!pointer || !['READY', 'CLARIFYING'].includes(pointer.state) || pointer.runId !== request.runId) throw Error('DRAFT_NOT_ACTIVE');
        if (!config || contentHash(config) !== pointer.configHash) throw Error('DRAFT_CONFIG_MISMATCH');
        try {
          const result = await (input.continueCampaignDraft ?? continueSemanticDraft)({ directory: input.directory, request,
            onAllocated: allocation => atomicJson(activeDraftFile, { schemaVersion: 1, state: 'PREPARING', ...allocation }) });
          atomicJson(activeDraftFile, { schemaVersion: 1, state: 'plan' in result ? 'CLARIFYING' : 'READY', runId: result.runId, configHash: result.configHash });
        } catch (error) {
          if (!(error instanceof CampaignDraftPreparationError)) throw error;
          atomicJson(activeDraftFile, { schemaVersion: 1, state: 'FAILED', runId: error.runId, configHash: pointer.configHash, errorCode: error.code });
        }
        return await getState();
      } finally { starting = false; preparingDraft = false; }
    },
    async updateCampaign(value: unknown): Promise<ProductionState> {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true;
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'criteriaPatch,expectedRevision,runId') throw Error('DRAFT_INPUT_INVALID');
        const request = value as UpdateCampaignDraftRequest, pointer = readDraftPointer(), config = configStore.read();
        if (!pointer || pointer.state !== 'READY' || pointer.runId !== request.runId) throw Error('DRAFT_NOT_ACTIVE');
        if (!config.opportunity || contentHash(config.opportunity) !== pointer.configHash) throw Error('DRAFT_CONFIG_MISMATCH');
        const draft = updateDraft({ directory: input.directory, ...request });
        configStore.save({ ...config, schemaVersion: 2, opportunity: draft.config });
        atomicJson(activeDraftFile, { schemaVersion: 1, state: 'READY', runId: draft.runId, configHash: draft.configHash });
        return await getState();
      } finally { starting = false; }
    },
    async saveCampaignPreset(value: unknown): Promise<ProductionState> {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true;
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'name,source') throw Error('PRESET_INPUT_INVALID');
        savePreset({ directory: input.directory, ...value as SaveCampaignPresetRequest });
        return await getState();
      } finally { starting = false; }
    },
    async applyCampaignPreset(value: unknown): Promise<ProductionState> {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true;
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'presetId,presetVersion,runtime') throw Error('PRESET_INPUT_INVALID');
        const draft = applyPreset({ directory: input.directory, ...value as ApplyCampaignPresetRequest }), config = configStore.read();
        configStore.save({ ...config, schemaVersion: 2, opportunity: draft.config });
        atomicJson(activeDraftFile, { schemaVersion: 1, state: 'READY', runId: draft.runId, configHash: draft.configHash });
        return await getState();
      } finally { starting = false; }
    },
    async login(value: unknown) {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true;
      try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('LOGIN_INPUT_INVALID');
      const v = value as Record<string, unknown>;
      if (!platformValue(v.platform) || !['platform', 'platform,profileId'].includes(Object.keys(v).sort().join()) ||
          (v.profileId !== undefined && !isBrowserProfileId(v.profileId))) throw Error('LOGIN_INPUT_INVALID');
      const list = await input.host.list();
      let profile = v.profileId ? list.find(p => p.id === v.profileId) : list.find(p => (p.platform || 'facebook') === v.platform);
      if (v.profileId && (!profile || (profile.platform || 'facebook') !== v.platform)) throw Error('PROFILE_NOT_FOUND');
      if (!profile) {
        const created = await input.host.create(v.platform === 'facebook' ? 'CSD Facebook' : 'CSD Threads', v.platform);
        profile = { ...created, open: false, persistenceError: null };
      }
      blockedProfiles.delete(profile.id); await input.host.openLogin(profile.id); await accounts();
      } finally { starting = false; }
    },
    async start(value: unknown) {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      starting = true;
      const previousRun = run; let launched = false;
      try {
        await closePipeline();
        const config = configStore.read(); if (!config.keywords.length && !config.opportunity?.enabled) throw Error('KEYWORDS_REQUIRED');
        if (!value || typeof value !== 'object' || Array.isArray(value) || !['profiles', 'draft,profiles'].includes(Object.keys(value).sort().join())) throw Error('COLLECTION_INPUT_INVALID');
        const request = value as { profiles: unknown; draft?: CampaignDraftReference };
        let selectedDraft: ResolvedCampaignDraft | null = null;
        const pointer = readDraftPointer();
        let draftReference = request.draft;
        if (config.opportunity?.enabled && pointer?.configHash === contentHash(config.opportunity)
          && pointer.state === 'CLARIFYING') throw Error('CAMPAIGN_INTENT_UNRESOLVED');
        if (config.opportunity?.enabled && pointer?.configHash === contentHash(config.opportunity)
          && (pointer.state === 'FAILED' || pointer.state === 'PREPARING')) throw Error('DRAFT_PREPARATION_INCOMPLETE');
        if (draftReference !== undefined && (!draftReference || typeof draftReference !== 'object' || Array.isArray(draftReference)
          || Object.keys(draftReference).sort().join() !== 'configHash,revision,runId')) throw Error('DRAFT_INPUT_INVALID');
        if (!draftReference && config.opportunity?.enabled && pointer?.configHash === contentHash(config.opportunity)) {
          if (pointer.state === 'FAILED' || pointer.state === 'PREPARING') throw Error('DRAFT_PREPARATION_INCOMPLETE');
          const prepared = readDraft({ directory: input.directory, runId: pointer.runId });
          if (prepared.status === 'DRAFT') draftReference = { runId: prepared.runId, revision: prepared.revision, configHash: prepared.configHash };
        }
        if (draftReference) {
          if (!config.opportunity?.enabled || contentHash(config.opportunity) !== draftReference.configHash) throw Error('DRAFT_CONFIG_MISMATCH');
          selectedDraft = resolveDraftForStart({ directory: input.directory, runId: draftReference.runId,
            expectedRevision: draftReference.revision, expectedConfigHash: contentHash(config.opportunity) });
          if (selectedDraft.status !== 'DRAFT') throw Error('DRAFT_ALREADY_STARTED');
        }
        if (config.opportunity?.enabled && config.opportunity.filterMode !== 'OFF' && !selectedDraft) throw Error('DRAFT_REQUIRED');
        const selections = (value as { profiles: unknown }).profiles;
        if (!Array.isArray(selections) || selections.length < 1 || selections.length > 2) throw Error('COLLECTION_INPUT_INVALID');
        const available = await accounts(), platforms = new Set<Platform>();
        for (const item of selections) {
          if (!item || typeof item !== 'object' || Object.keys(item).sort().join() !== 'platform,profileId' ||
              !platformValue(item.platform) || !isBrowserProfileId(item.profileId) || platforms.has(item.platform)) throw Error('COLLECTION_INPUT_INVALID');
          const account = available.find(p => p.id === item.profileId && p.platform === item.platform);
          if (!account?.authenticated || account.persistenceError) throw Error('LOGIN_REQUIRED');
          platforms.add(item.platform);
        }
        const id = selectedDraft?.runId ?? 'crawl-' + randomUUID();
        run = { id, state: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null,
          minimumPosts: config.minimumPosts, keywords: config.keywords, outputDirectory: selectedDraft?.outputDirectory ?? join(input.directory, 'collections', id),
          platforms: selections.map(item => ({ platform: item.platform as Platform, profileId: item.profileId as string, state: 'QUEUED', count: 0, reason: null })), preview: [] };
        stopped = false; mkdirSync(run.outputDirectory, { recursive: true }); saveRun();
        if (config.opportunity?.enabled) {
          if (!input.collectConversation) throw Error('CONVERSATION_COLLECTOR_UNAVAILABLE');
          const current = run;
          atomicJson(join(run.outputDirectory, 'opportunity-config.json'), config.opportunity);
          pipeline = await (input.createOpportunity ?? createOpportunityPipeline)({ directory: run.outputDirectory, runId: id, config: config.opportunity, seedQueries: config.keywords,
            ...(selectedDraft ? { campaign: selectedDraft.campaign } : {}),
            platforms: run.platforms.map(p => p.platform), collectConversation: input.collectConversation,
            ...(input.resolveThreadsReplyRoot ? { resolveThreadsReplyRoot: input.resolveThreadsReplyRoot } : {}),
            ...(input.withConversationWindow ? { withRevisitWindow: (platform: Platform, job: (window: WebContents) => Promise<void>) => {
              const account = current.platforms.find(p => p.platform === platform); if (!account?.profileId) throw Error('PROFILE_NOT_FOUND');
              return input.withConversationWindow!(account.profileId, job);
            } } : {}),
            onProgress: value => { current.opportunity = value; saveRun(); } });
          run.keywords = [...new Set(pipeline.campaign.queries.map(q => q.text))]; saveRun();
        }
        if (selectedDraft) {
          markDraftStarted({ directory: input.directory, runId: selectedDraft.runId, expectedRevision: selectedDraft.revision, expectedConfigHash: selectedDraft.configHash });
          // STARTED is the consumption marker. Leaving the service pointer in place is harmless:
          // getters hide consumed drafts, and no fallible cleanup write can abort a committed start.
        }
        work = execute(); void work.catch(() => {});
        launched = true;
        return await getState();
      } catch (error) {
        if (!launched) {
          const failedRun = run;
          await closePipeline();
          run = previousRun;
          if (run) saveRun();
          else if (failedRun && existsSync(latestFile)) {
            const saved = JSON.parse(readFileSync(latestFile, 'utf8')) as RunState;
            if (saved.id === failedRun.id) {
              failedRun.state = 'FAILED'; failedRun.finishedAt = new Date().toISOString();
              for (const item of failedRun.platforms) { item.state = 'FAILED'; item.reason = code(error); }
              run = failedRun; saveRun();
            }
          }
        }
        throw error;
      } finally { starting = false; }
    },
    async stop() {
      const wasWatching = run?.opportunity?.watchActive || run?.opportunity?.assessmentActive;
      stopped = true; if (active(run)) { run!.state = 'STOPPING'; saveRun(); }
      await pipeline?.stop();
      if (wasWatching && run) {
        if (pipeline) await exportPipeline(pipeline, run.outputDirectory);
        run.state = 'STOPPED'; run.finishedAt = new Date().toISOString(); saveRun();
      }
      return getState();
    },
    async resume() {
      if (active(run) || starting || executing) throw Error('COLLECTION_BUSY');
      if (run?.mode === 'RETAINED') return resumeRetained();
      if (!run?.opportunity || !input.collectConversation) throw Error('RESUME_UNAVAILABLE');
      const current = run, file = join(current.outputDirectory, 'opportunity-config.json');
      if (!existsSync(file)) throw Error('RESUME_UNAVAILABLE');
      starting = true; stopped = false; let launched = false;
      const previousState = structuredClone(current);
      try {
        await closePipeline();
        const config = JSON.parse(readFileSync(file, 'utf8')) as OpportunityConfig;
        pipeline = await (input.createOpportunity ?? createOpportunityPipeline)({ directory: current.outputDirectory, runId: current.id, config,
          platforms: current.platforms.map(p => p.platform), collectConversation: input.collectConversation,
          ...(input.resolveThreadsReplyRoot ? { resolveThreadsReplyRoot: input.resolveThreadsReplyRoot } : {}),
          ...(input.withConversationWindow ? { withRevisitWindow: (platform: Platform, job: (window: WebContents) => Promise<void>) => {
            const account = current.platforms.find(p => p.platform === platform); if (!account?.profileId) throw Error('PROFILE_NOT_FOUND');
            return input.withConversationWindow!(account.profileId, job);
          } } : {}),
          onProgress: value => { current.opportunity = value; saveRun(); } });
        current.state = 'RUNNING'; current.finishedAt = null;
        for (const item of current.platforms) { item.state = 'QUEUED'; item.reason = null; }
        saveRun(); work = execute(true); launched = true; void work.catch(() => {});
        return await getState();
      } catch (error) {
        if (!launched) { try { await closePipeline(); } finally { run = previousState; saveRun(); } }
        throw error;
      }
      finally { starting = false; }
    },
    results() {
      if (!run || active(run) || starting || executing) throw Error('RESULTS_UNAVAILABLE');
      const opportunity = cachedOpportunity(run);
      return { run: presentedRun()!, facebook: rows('facebook'), threads: rows('threads'), ...(opportunity ? { opportunity } : {}) };
    },
    async snapshotResults() {
      if (!run || starting || (active(run) && !pipeline)) throw Error('RESULTS_UNAVAILABLE');
      const currentRun = structuredClone(run), currentPipeline = pipeline;
      const raw = { facebook: rows('facebook'), threads: rows('threads') };
      if (currentPipeline) {
        const exported = await exportPipeline(currentPipeline, currentRun.outputDirectory);
        currentRun.opportunity = exported.progress;
        return { run: currentRun, ...raw, opportunity: exported };
      }
      const opportunity = cachedOpportunity(currentRun);
      return { run: presentedRun()!, ...raw, ...(opportunity ? { opportunity } : {}) };
    },
    outputDirectory() { if (!run) throw Error('RESULTS_UNAVAILABLE'); return run.outputDirectory; },
    async shutdown() { stopped = true; await pipeline?.stop(); await work?.catch(() => {}); await closePipeline(); },
    async settled() { await work; },
  };
}
