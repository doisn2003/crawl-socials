export type Platform = 'facebook' | 'threads';
export interface OpportunityConfig {
  filterMode?: import('./filter-policy.js').FilterMode;
  /** Explicit collection setting; absent on historical configurations. */
  languageScope?: 'VIETNAMESE' | 'PROMPT';
  enabled: boolean; prompt: string; brandContext: string;
  totalTarget: number; threadsShare?: 0.7 | 0.8; rawCap: number; budgetUsd: number; commentsEnabled: boolean;
}
export interface UserSpendLimits { totalUsd: number; dailyUsd: number; }
export interface UserConfig { filterPercent?: number; spendLimits?: UserSpendLimits; performance?: import('./throughput.js').PerformanceMode; keywords: string[]; minimumPosts: number; schemaVersion?: 2; opportunity?: OpportunityConfig; }
export interface Account {
  id: string; label: string; platform: Platform; authenticated: boolean;
  open: boolean; persistenceError: string | null;
}
export interface PlatformRun {
  platform: Platform; profileId: string | null;
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED';
  count: number; reason: string | null;
  workers?: Array<{ worker: number; query: string; state: string; reason: string | null }>;
}
export interface PostPreview { platform: Platform; post_id: string; text: string; query: string; link: string; }
export interface OpportunityCounts { raw: number; comments: number; suitable: number; notSuitable?: number; /** Legacy count fields retained for historical runs. */ notYet: number; unrelated: number; pending: number; failed: number; }
export interface OpportunityAssessmentDetails {
  queued: number; language: number; incomplete: number; conflict: number; stale: number; failed: number; unrecorded: number;
  qualityConflict: number; qualityUnconfirmed: number;
}
export interface OpportunityPreview {
  platform: Platform; rootId: string; /** UNASSESSED is an operational status, never a filter verdict. */
  classification: 'SUITABLE' | 'NOT_SUITABLE' | 'NOT_YET' | 'UNRELATED' | 'UNASSESSED';
  text: string; link: string; reason: string; evidence: string[]; observedAt: string; coverage: string;
  reasonCode?: string;
  opportunityTypes?: string[]; publishedAt?: string | null;
  conditions?: { label: string; status: 'PASS' | 'FAIL' | 'UNKNOWN'; evidence: string[] }[];
}
export interface OpportunityProgress {
  filterMode?: import('./filter-policy.js').FilterMode;
  resultPolicy?: 'GLOBAL_FIRST_QUALIFIED';
  targetCount?: number; extraCount?: number; previouslyDelivered?: number;
  shortfallWarning?: string | null;
  campaignId: string; totalTarget: number; threadsShare: number;
  counts: OpportunityCounts; byPlatform: Record<Platform, OpportunityCounts>;
  assessmentDetails?: OpportunityAssessmentDetails;
  costUsd: number; costUpperUsd: number; usageUnknown: number; budgetUsd: number;
  phase: string; lastError: string | null; preview: OpportunityPreview[];
  evaluationPolicy?: 'GOAL_EVIDENCE' | 'LEGACY';
  modelScheduling?: import('./throughput.js').RequestScheduleStatus | undefined;
  classificationWorkers?: number;
  watchPending?: number; watchNextAt?: string | null; watchActive?: boolean;
  assessmentPending?: number; assessmentNextAt?: string | null; assessmentActive?: boolean;
}
export interface RunState {
  id: string; state: 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'STOPPED' | 'FAILED' | 'INTERRUPTED';
  startedAt: string; finishedAt: string | null; minimumPosts: number; keywords: string[];
  outputDirectory: string; platforms: PlatformRun[]; preview: PostPreview[]; opportunity?: OpportunityProgress;
  discoverySourceRunId?: string;
  collectionLayout?: 'PROFILE_QUERY_V2';
  discoverySourceRunId?: string;
  collectionLayout?: 'PROFILE_QUERY_V2';
  mode?: 'DISCOVERY' | 'RETAINED';
  retained?: RetainedRunProgress;
}
export interface RetainedRunProgress {
  sourceRunId: string; inputHash: string; importedObservations: number; totalObservations: number;
  assessmentAsOf?: string;
  status: 'IMPORTING' | 'IMPORTED' | 'PAUSED' | 'FAILED';
}
export interface RetainedSourceSummary {
  runId: string; prompt: string; updatedAt: string; bytes: number; format: 'OBSERVATION_JOURNAL' | 'LEGACY_JSONL';
  sourceRootId?: string; sourceLabel?: string;
}
export interface RetainedSourceCatalog {
  sources: RetainedSourceSummary[];
  issues: Array<{ sourceRootId: string | null; label: string; code: string }>;
}
export interface ProductionState {
  spending?: { measuredUsd: number; heldUsd: number; remainingUsd: number; dailyRemainingUsd: number; calls: number };
  version: string; config: UserConfig; accounts: Account[]; run: RunState | null;
  campaignDraft?: CampaignDraftView;
  campaignDialogue?: import('./semantic-intent.js').CampaignDialogueView;
  campaignDraftPreparing?: { runId: string; cost: CampaignDraftCost };
  campaignDraftError?: { code: string; runId: string; cost: CampaignDraftCost };
  campaignPresets?: CampaignPresetView[];
}
export interface GeminiKeyStatus { source: 'SAVED' | 'ENVIRONMENT' | 'NONE'; readError: boolean; }
export interface ProductionApi {
  discoveryWatch: import('./discovery-watch.js').DiscoveryWatchApi;
  geminiKey: { status(): Promise<GeminiKeyStatus>; save(input: { key: string }): Promise<GeminiKeyStatus>; remove(): Promise<GeminiKeyStatus>; };
  getState(): Promise<ProductionState>;
  saveConfig(input: UserConfig): Promise<UserConfig>;
  login(input: { platform: Platform; profileId?: string; createNew?: boolean }): Promise<void>;
  prepareCampaign(): Promise<ProductionState>;
  continueCampaign(request: import('./semantic-intent.js').ContinueCampaignRequest): Promise<ProductionState>;
  updateCampaign(input: UpdateCampaignDraftRequest): Promise<ProductionState>;
  saveCampaignPreset(input: SaveCampaignPresetRequest): Promise<ProductionState>;
  applyCampaignPreset(input: ApplyCampaignPresetRequest): Promise<ProductionState>;
  listRetainedSources(): Promise<RetainedSourceCatalog>;
  chooseRetainedSourceRoot(): Promise<RetainedSourceCatalog | null>;
  startRetained(input: { sourceRunId: string; sourceRootId?: string; draft: CampaignDraftReference }): Promise<ProductionState>;
  start(input: { profiles: { platform: Platform; profileId: string }[]; draft?: CampaignDraftReference }): Promise<ProductionState>;
  stop(): Promise<ProductionState>;
  resume(): Promise<ProductionState>;
  exportResults(input: { format: 'json' | 'xlsx'; group?: 'SUITABLE' | 'NOT_SUITABLE' | 'NOT_YET' | 'UNRELATED' }): Promise<{ canceled: boolean; path: string | null }>;
  openOutput(): Promise<void>;
  openPost(input: { url: string }): Promise<void>;
}
import type { ApplyCampaignPresetRequest, CampaignDraftCost, CampaignDraftReference, CampaignDraftView,
  CampaignPresetView, SaveCampaignPresetRequest, UpdateCampaignDraftRequest } from './campaign-drafts.js';
