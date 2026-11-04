import { withFilterPolicy } from './filter-policy.js';
import { vietnameseOnly } from '../domain/content-language.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentHash } from '../domain/conversation.js';
import { campaignVersion, GROUNDED_CONSTRAINT_PLANNER_POLICY, TEMPORAL_OPPORTUNITY_FILTER_VERSION, validateCampaignPlan } from '../domain/campaign-plan.js';
import type { CampaignPlan, CampaignPlannerPolicy } from '../domain/campaign-plan.js';
import { parseOpportunityConfig } from '../infrastructure/config/user-config.js';
import { createCampaignModelGateway } from '../infrastructure/llm/campaign-model-gateway.js';
import { classifierRecipe } from './classification-service.js';
import { compileCampaign, plannerRecipeHash } from './compile-campaign.js';
import { pinPlannerRecipe } from './planner-recipe-pin.js';
import { SEMANTIC_PLANNER_POLICY, INTENT_OPPORTUNITY_FILTER_VERSION } from '../domain/campaign-plan.js';
import { compileSemanticTurn } from './semantic-campaign.js';
import { GOAL_FILTER_VERSION } from '../domain/goal-filter.js';
import { reviseAnswers, reviseIntent } from '../domain/semantic-keywords.mjs';
import type { CampaignDialogueView, ContinueCampaignRequest, IntentInput } from '../shared/semantic-intent.js';
import type { ModelGateway } from './ports/model-gateway.js';
import type { OpportunityConfig } from '../shared/production-api.js';
import type { ApplyCampaignPresetRequest, CampaignCriteria, CampaignCriteriaOverride, CampaignCriteriaPatch,
  CampaignDraftCost, CampaignDraftSource, CampaignDraftView, CampaignPresetRuntime, CampaignPresetView,
  SaveCampaignPresetRequest, UpdateCampaignDraftRequest } from '../shared/campaign-drafts.js';

type Recipe = ReturnType<typeof classifierRecipe>;
interface DraftRecord {
  schemaVersion: 1; runId: string; config: OpportunityConfig; campaign: CampaignPlan;
  recipe: Recipe; recipeHash: string; source: CampaignDraftSource;
  createdAt: string; updatedAt: string; userOverrides: CampaignCriteriaOverride[];
}
interface DraftPointer { schemaVersion: 1; runId: string; revision: string; status: 'DRAFT' | 'STARTED'; startedAt?: string }
interface PresetRecord {
  schemaVersion: 1; presetId: string; name: string; createdAt: string; campaign: CampaignPlan;
  config: OpportunityConfig; recipe: Recipe; recipeHash: string;
  sourceRunId: string; sourceCampaignVersion: string; sourceHash: string;
}
interface Located { directory: string; runId: string }
interface RevisionInput extends Located { expectedRevision: string }
interface StartInput extends RevisionInput { expectedConfigHash: string }
interface DraftAllocation {
  schemaVersion: 1; runId: string; config: OpportunityConfig; configHash: string; createdAt: string;
  plannerPolicy?: CampaignPlannerPolicy; plannerRecipeHash?: string;
}
export interface ResolvedCampaignDraft extends CampaignDraftView { outputDirectory: string }
const runPattern = /^crawl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const presetPattern = /^preset-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const criteriaKeys = ['topic', 'audience', 'needs', 'participation_intents', 'research_intents', 'inclusions', 'exclusions',
  'brand_context', 'required_geographies', 'preferred_geographies', 'languages', 'source_priority', 'queries', 'assumptions', 'max_age_days', 'watch'] as const;
const listKeys = ['audience', 'needs', 'participation_intents', 'research_intents', 'inclusions', 'exclusions',
  'required_geographies', 'preferred_geographies', 'languages', 'assumptions'] as const;
const queryFamilies = ['REQUEST', 'EXPERIENCE', 'COMPARISON', 'PROBLEM', 'USE_CASE', 'BROAD'];
const sourceKinds = ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'];
const now = () => new Date().toISOString();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : 'DRAFT_PREPARATION_FAILED';
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) throw Error('DRAFT_CRITERIA_INVALID');
  const result = value.normalize('NFC').trim(); if (!allowEmpty && !result) throw Error('DRAFT_CRITERIA_INVALID'); return result;
}
function texts(value: unknown, maximum = 20): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error('DRAFT_CRITERIA_INVALID');
  return [...new Set(value.map(item => text(item, 600)))];
}
function paths(input: Located) {
  if (!runPattern.test(input.runId)) throw Error('DRAFT_ID_INVALID');
  const output = join(input.directory, 'collections', input.runId), opportunity = join(output, 'opportunity');
  return { output, opportunity, pointer: join(opportunity, 'draft.json'), revisions: join(opportunity, 'draft-revisions') };
}
function presetFile(directory: string, id: string, version: string) {
  if (!presetPattern.test(id) || !hashPattern.test(version)) throw Error('PRESET_ID_INVALID');
  return join(directory, 'filter-presets', id, `${version}.json`);
}
function atomic(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flush: true, flag: 'wx', mode: 0o600 }); renameSync(temporary, file); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function immutable(file: string, value: unknown) {
  if (existsSync(file)) { if (contentHash(read(file)) !== contentHash(value)) throw Error('DRAFT_IMMUTABLE_MISMATCH'); return; }
  atomic(file, value);
}
function read(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw Error('DRAFT_READ_FAILED'); }
}
function criteria(campaign: CampaignPlan): CampaignCriteria {
  return structuredClone(Object.fromEntries(criteriaKeys.map(key => [key, campaign[key]]))) as unknown as CampaignCriteria;
}
/** Explicit user edits are accepted as authority; generated-query lexical restrictions do not erase them. */
export function validateCriteriaPatch(value: unknown): CampaignCriteriaPatch {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).some(key => !criteriaKeys.includes(key as typeof criteriaKeys[number]))) throw Error('DRAFT_CRITERIA_INVALID');
  const output: Record<string, unknown> = {};
  for (const key of listKeys) if (key in value) output[key] = texts(value[key]);
  if ('topic' in value) output.topic = text(value.topic, 300);
  if ('brand_context' in value) output.brand_context = value.brand_context === null ? null : text(value.brand_context, 10000, true) || null;
  if ('max_age_days' in value) {
    if (value.max_age_days !== null && (typeof value.max_age_days !== 'number' || !Number.isFinite(value.max_age_days) || value.max_age_days <= 0 || value.max_age_days > 36500)) throw Error('DRAFT_CRITERIA_INVALID');
    output.max_age_days = value.max_age_days;
  }
  if ('source_priority' in value) {
    if (!Array.isArray(value.source_priority) || !value.source_priority.length || value.source_priority.length > 4 || value.source_priority.some(v => !sourceKinds.includes(v)) || new Set(value.source_priority).size !== value.source_priority.length) throw Error('DRAFT_CRITERIA_INVALID');
    output.source_priority = [...value.source_priority];
  }
  if ('queries' in value) {
    if (!Array.isArray(value.queries) || !value.queries.length || value.queries.length > 100) throw Error('DRAFT_CRITERIA_INVALID');
    output.queries = value.queries.map(query => {
      if (!object(query) || !exactKeys(query, ['text', 'family', 'platforms']) || typeof query.family !== 'string' || !queryFamilies.includes(query.family)
        || !Array.isArray(query.platforms) || !query.platforms.length || query.platforms.length > 2 || query.platforms.some(p => p !== 'threads' && p !== 'facebook')
        || new Set(query.platforms).size !== query.platforms.length) throw Error('DRAFT_CRITERIA_INVALID');
      const queryText = text(query.text, 200); if (/[\r\n]/u.test(queryText)) throw Error('DRAFT_CRITERIA_INVALID');
      return { text: queryText, family: query.family, platforms: [...query.platforms] };
    });
  }
  if ('watch' in value) {
    const watch = value.watch;
    if (!object(watch) || !exactKeys(watch, ['enabled', 'revisit_hours', 'ttl_hours', 'max_attempts']) || typeof watch.enabled !== 'boolean'
      || !Array.isArray(watch.revisit_hours) || watch.revisit_hours.length > 12 || (watch.enabled && !watch.revisit_hours.length)
      || typeof watch.ttl_hours !== 'number' || !Number.isFinite(watch.ttl_hours) || watch.ttl_hours <= 0 || watch.ttl_hours > 720
      || !Number.isInteger(watch.max_attempts) || Number(watch.max_attempts) < 0 || Number(watch.max_attempts) > 12
      || (watch.enabled && Number(watch.max_attempts) < 1)
      || watch.revisit_hours.some((h, i, all) => typeof h !== 'number' || !Number.isFinite(h) || h <= 0 || h > Number(watch.ttl_hours) || (i > 0 && h <= Number(all[i - 1])))) throw Error('DRAFT_CRITERIA_INVALID');
    output.watch = structuredClone(watch);
  }
  return output as CampaignCriteriaPatch;
}
function validateCampaign(campaign: CampaignPlan, config: OpportunityConfig) {
  validateCampaignPlan(campaign); validateCriteriaPatch(criteria(campaign));
  if (config.languageScope === 'VIETNAMESE' && config.filterMode !== 'OFF' && !vietnameseOnly(campaign)) throw Error('DRAFT_LANGUAGE_SCOPE_MISMATCH');
  if (contentHash(parseOpportunityConfig(config)) !== contentHash(config) || !config.enabled || campaign.prompt !== config.prompt
    || (campaign.brand_context ?? '') !== config.brandContext || campaign.suitable_target !== config.totalTarget
    || campaign.desired_platform_weights.threads !== (config.threadsShare ?? 0.5) || Math.abs(campaign.desired_platform_weights.facebook - (1 - (config.threadsShare ?? 0.5))) > 1e-9
    || campaign.budget.raw_cap !== config.rawCap || campaign.budget.model_usd !== config.budgetUsd) throw Error('DRAFT_CONFIG_MISMATCH');
  const { version, created_at: _created, ...base } = campaign;
  if (campaignVersion(base) !== version) throw Error('DRAFT_CAMPAIGN_HASH_MISMATCH');
}
function assertRecipe(campaign: CampaignPlan, recipe: Recipe, recipeHash: string) {
  if (recipe.filter_version !== campaign.filter_version || contentHash(recipe) !== recipeHash) throw Error('DRAFT_RECIPE_MISMATCH');
  let supported: Recipe; try { supported = classifierRecipe(campaign.filter_version); } catch { throw Error('DRAFT_RECIPE_UNSUPPORTED'); }
  if (contentHash(supported) !== recipeHash) throw Error('DRAFT_RECIPE_UNSUPPORTED');
}
function load(input: Located, requireSupported = true): { record: DraftRecord; pointer: DraftPointer } {
  const location = paths(input), pointer = read(location.pointer) as DraftPointer;
  if (!pointer || pointer.schemaVersion !== 1 || pointer.runId !== input.runId || !hashPattern.test(pointer.revision) || !['DRAFT', 'STARTED'].includes(pointer.status)) throw Error('DRAFT_POINTER_INVALID');
  const record = read(join(location.revisions, `${pointer.revision}.json`)) as DraftRecord;
  if (!record || record.schemaVersion !== 1 || record.runId !== input.runId || record.campaign?.campaign_id !== input.runId
    || contentHash(record) !== pointer.revision || !Array.isArray(record.userOverrides)) throw Error('DRAFT_REVISION_INVALID');
  validateCampaign(record.campaign, record.config);
  if (record.recipe?.filter_version !== record.campaign.filter_version || contentHash(record.recipe) !== record.recipeHash) throw Error('DRAFT_RECIPE_MISMATCH');
  if (requireSupported) assertRecipe(record.campaign, record.recipe, record.recipeHash);
  return { record, pointer };
}
function cost(gateway: ModelGateway): CampaignDraftCost {
  const summary = gateway.summary(); return { capturedAt: now(), model: summary.model, budgetUsd: summary.budget_usd, measuredUsd: summary.measured_cost_usd,
    unknownUpperUsd: summary.unmetered_cost_upper_usd, reservedUsd: summary.reserved_usd, remainingUsd: summary.remaining_usd,
    billableAttempts: summary.billable_attempts, cacheHits: summary.cache_hits, basis: summary.cost_basis };
}
function gatewayFor(input: Located, config: OpportunityConfig) {
  return createCampaignModelGateway({ directory: paths(input).opportunity, budgetUsd: config.budgetUsd });
}
function view(record: DraftRecord, pointer: DraftPointer, receipt: CampaignDraftCost): CampaignDraftView {
  let supported = true; try { assertRecipe(record.campaign, record.recipe, record.recipeHash); } catch { supported = false; }
  return structuredClone({ runId: record.runId, revision: pointer.revision, status: pointer.status, supported, config: record.config,
    criteriaCapabilities: { extendedClassificationCriteria: supported && [TEMPORAL_OPPORTUNITY_FILTER_VERSION, INTENT_OPPORTUNITY_FILTER_VERSION, GOAL_FILTER_VERSION, 'coverage-standard-v1', 'coverage-quality-v1'].includes(record.campaign.filter_version) },
    configHash: contentHash(record.config), campaign: record.campaign, criteria: criteria(record.campaign), recipeHash: record.recipeHash,
    source: record.source, sourceHash: contentHash(record.source), cost: receipt, createdAt: record.createdAt,
    updatedAt: record.updatedAt, userOverrides: record.userOverrides });
}
function save(input: Located, record: DraftRecord, status: DraftPointer['status'] = 'DRAFT'): DraftPointer {
  const location = paths(input), revision = contentHash(record);
  immutable(join(location.revisions, `${revision}.json`), record);
  const pointer: DraftPointer = { schemaVersion: 1, runId: input.runId, revision, status };
  atomic(location.pointer, pointer); return pointer;
}
function allocated(directory: string, config: OpportunityConfig, plannerPolicy?: CampaignPlannerPolicy) {
  const runId = `crawl-${randomUUID()}`, input = { directory, runId };
  immutable(join(paths(input).opportunity, 'draft-allocation.json'), { schemaVersion: 1, runId, config, configHash: contentHash(config), createdAt: now(),
    ...(plannerPolicy ? { plannerPolicy, plannerRecipeHash: plannerRecipeHash(plannerPolicy) } : {}) });
  return input;
}
function readAllocation(input: Located): DraftAllocation {
  const allocation = read(join(paths(input).opportunity, 'draft-allocation.json')) as DraftAllocation;
  if (!allocation || allocation.schemaVersion !== 1 || allocation.runId !== input.runId || !Number.isFinite(Date.parse(allocation.createdAt))
    || !object(allocation.config) || contentHash(parseOpportunityConfig(allocation.config)) !== allocation.configHash
    || Object.hasOwn(allocation, 'plannerPolicy') !== Object.hasOwn(allocation, 'plannerRecipeHash')
    || (Object.hasOwn(allocation, 'plannerPolicy') && (typeof allocation.plannerPolicy !== 'string' || !hashPattern.test(allocation.plannerRecipeHash!)))) throw Error('DRAFT_ALLOCATION_INVALID');
  return allocation;
}
export class CampaignDraftPreparationError extends Error {
  constructor(readonly code: string, readonly runId: string, readonly cost: CampaignDraftCost) { super(code); this.name = 'CampaignDraftPreparationError'; }
}
export async function prepareDraft(input: { directory: string; config: OpportunityConfig; resumeRunId?: string; gateway?: ModelGateway;
  gatewayFactory?: (options: { directory: string; budgetUsd: number }) => ModelGateway;
  /** Durable service pointer is published before any model request, including after a retry. */
  onAllocated?: (value: { runId: string; configHash: string }) => void; signal?: AbortSignal }): Promise<CampaignDraftView> {
  const config = parseOpportunityConfig(input.config); if (!config.enabled) throw Error('DRAFT_OPPORTUNITY_REQUIRED');
  const location = input.resumeRunId ? { directory: input.directory, runId: input.resumeRunId } : allocated(input.directory, config, GROUNDED_CONSTRAINT_PLANNER_POLICY);
  const allocation = readAllocation(location);
  if (allocation.configHash !== contentHash(config)) throw Error('DRAFT_CONFIG_MISMATCH');
  // A pre-policy allocation is historical evidence of a legacy attempt; never apply a new default to it.
  const pinInput: Parameters<typeof pinPlannerRecipe>[0] = { directory: paths(location).opportunity, defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY,
    requiredPolicy: allocation.plannerPolicy ?? 'legacy-short-v1' as const,
    ...(allocation.plannerRecipeHash ? { requiredHash: allocation.plannerRecipeHash } : {}) };
  if (input.resumeRunId) {
    if (existsSync(paths(location).pointer)) {
      const existing = readDraft(location); if (existing.configHash !== contentHash(config)) throw Error('DRAFT_CONFIG_MISMATCH');
      return existing;
    }
    if (existsSync(join(paths(location).opportunity, 'campaign.json'))) throw Error('DRAFT_ALREADY_CONSUMED');
  }
  // A completed draft needs no planner replay. Only a new/retried model attempt requires
  // the pinned planner to remain installed; historical prepared campaigns stay reusable.
  const planner = pinPlannerRecipe(pinInput);
  const gateway = input.gateway ?? (input.gatewayFactory ? input.gatewayFactory({ directory: paths(location).opportunity, budgetUsd: config.budgetUsd }) : gatewayFor(location, config));
  try {
    atomic(join(paths(location).opportunity, 'draft-cost.json'), cost(gateway));
    input.onAllocated?.({ runId: location.runId, configHash: contentHash(config) });
    const { campaign: compiled, model_result } = await compileCampaign({ campaign_id: location.runId, prompt: config.prompt, brand_context: config.brandContext,
      ...(config.languageScope === 'VIETNAMESE' ? { languages: ['vi'] } : {}),
      suitable_target: config.totalTarget, desired_platform_weights: { threads: config.threadsShare ?? 0.5, facebook: 1 - (config.threadsShare ?? 0.5) },
      raw_cap: config.rawCap, model_usd: config.budgetUsd, planner_policy: planner.planner_policy }, gateway, input.signal ? { signal: input.signal } : {});
    const campaign = withFilterPolicy(compiled, config.filterMode);
    validateCampaign(campaign, config);
    const recipe = classifierRecipe(campaign.filter_version), at = now();
    const record: DraftRecord = { schemaVersion: 1, runId: location.runId, config, campaign, recipe, recipeHash: contentHash(recipe),
      source: { kind: 'PLANNER', sourceCampaignVersion: campaign.version, plannerRequestHash: model_result.request_hash, plannerInvocationId: model_result.invocation_id,
        plannerPolicy: planner.planner_policy, plannerRecipeHash: planner.recipe_sha256 },
      createdAt: at, updatedAt: at, userOverrides: [] };
    const receipt = cost(gateway); atomic(join(paths(location).opportunity, 'draft-cost.json'), receipt);
    return view(record, save(location, record), receipt);
  } catch (error) {
    const receipt = { schemaVersion: 1, runId: location.runId, code: safeCode(error), at: now(), cost: cost(gateway) };
    atomic(join(paths(location).opportunity, 'draft-cost.json'), receipt.cost);
    atomic(join(paths(location).opportunity, 'draft-failure.json'), receipt);
    throw new CampaignDraftPreparationError(receipt.code, location.runId, receipt.cost);
  }
}
export function readDraftCost(input: Located): CampaignDraftCost {
  const allocation = readAllocation(input);
  const config = parseOpportunityConfig(allocation.config);
  if (allocation.runId !== input.runId || contentHash(config) !== allocation.configHash) throw Error('DRAFT_ALLOCATION_INVALID');
  const receipt = read(join(paths(input).opportunity, 'draft-cost.json')) as CampaignDraftCost;
  if (!receipt || !Number.isFinite(Date.parse(receipt.capturedAt)) || receipt.budgetUsd !== config.budgetUsd
    || ['measuredUsd', 'unknownUpperUsd', 'reservedUsd', 'remainingUsd', 'billableAttempts', 'cacheHits'].some(key =>
      typeof receipt[key as keyof CampaignDraftCost] !== 'number' || !Number.isFinite(receipt[key as keyof CampaignDraftCost]) || Number(receipt[key as keyof CampaignDraftCost]) < 0)) throw Error('DRAFT_COST_INVALID');
  return structuredClone(receipt);
}
export function readDraft(input: Located): CampaignDraftView {
  const { record, pointer } = load(input, false); return view(record, pointer, readDraftCost(input));
}
export function updateDraft(input: { directory: string } & UpdateCampaignDraftRequest): CampaignDraftView {
  const { record, pointer } = load(input);
  if (pointer.status !== 'DRAFT') throw Error('DRAFT_ALREADY_STARTED');
  if (pointer.revision !== input.expectedRevision) throw Error('DRAFT_REVISION_CONFLICT');
  // Pipeline construction may commit its immutable baseline before a later startup step fails.
  // Keep that exact plan retryable; never create a draft revision that can no longer be started.
  if (existsSync(join(paths(input).opportunity, 'campaign.json'))) throw Error('DRAFT_PLAN_COMMITTED');
  const patch = validateCriteriaPatch(input.criteriaPatch), campaign = { ...record.campaign, ...patch };
  const { version: _version, created_at: _created, ...base } = campaign; campaign.version = campaignVersion(base);
  const config = { ...record.config, brandContext: campaign.brand_context ?? '',
    ...(patch.languages && record.config.languageScope ? { languageScope: patch.languages.length === 1 && patch.languages[0] === 'vi' ? 'VIETNAMESE' as const : 'PROMPT' as const } : {}) };
  validateCampaign(campaign, config);
  const updated: DraftRecord = { ...record, config, campaign, updatedAt: now(),
    userOverrides: [...record.userOverrides, { at: now(), previousRevision: pointer.revision, patch }] };
  if (updated.userOverrides.length > 100) throw Error('DRAFT_EDIT_LIMIT');
  return view(updated, save(input, updated), readDraftCost(input));
}
export function resolveDraftForStart(input: StartInput): ResolvedCampaignDraft {
  if (existsSync(join(paths(input).opportunity, 'intent-pending.json'))) throw Error('CAMPAIGN_INTENT_UNRESOLVED');
  const dialogue = readDialogue(input);
  if (dialogue && dialogue.plan.state !== 'READY') throw Error('CAMPAIGN_INTENT_UNRESOLVED');
  const { record, pointer } = load(input);
  if (pointer.revision !== input.expectedRevision) throw Error('DRAFT_REVISION_CONFLICT');
  if (contentHash(record.config) !== input.expectedConfigHash) throw Error('DRAFT_CONFIG_MISMATCH');
  const campaignFile = join(paths(input).opportunity, 'campaign.json');
  if (existsSync(campaignFile) && contentHash(read(campaignFile)) !== contentHash(record.campaign)) throw Error('DRAFT_ALREADY_CONSUMED');
  return { ...view(record, pointer, readDraftCost(input)), outputDirectory: paths(input).output };
}

type PrepareInput = Parameters<typeof prepareDraft>[0];
type DialogueRecord = Omit<CampaignDialogueView, 'revision' | 'cost'>;
function dialogueFile(input: Located) { return join(paths(input).opportunity, 'intent-dialogue.json'); }
export function readDialogue(input: Located): CampaignDialogueView | null {
  const file = dialogueFile(input); if (!existsSync(file)) return null;
  const pointer = read(file) as { revision: string };
  if (!hashPattern.test(pointer.revision)) throw Error('DRAFT_REVISION_INVALID');
  const record = read(join(paths(input).opportunity, 'intent-revisions', pointer.revision + '.json')) as DialogueRecord;
  if (contentHash(record) !== pointer.revision || record.runId !== input.runId || contentHash(record.config) !== record.configHash) throw Error('DRAFT_REVISION_INVALID');
  return { ...record, revision: pointer.revision, cost: readDraftCost(input) };
}
function saveDialogue(input: Located, record: DialogueRecord): CampaignDialogueView {
  const revision = contentHash(record);
  immutable(join(paths(input).opportunity, 'intent-revisions', revision + '.json'), record);
  atomic(dialogueFile(input), { revision }); return { ...record, revision, cost: readDraftCost(input) };
}
/** New desktop campaigns use the approved dialogue. Historical allocations retain their exact recipe. */
export async function prepareSemanticDraft(input: PrepareInput): Promise<CampaignDraftView | CampaignDialogueView> {
  const config = parseOpportunityConfig(input.config); if (!config.enabled) throw Error('DRAFT_OPPORTUNITY_REQUIRED');
  const location = input.resumeRunId ? { directory: input.directory, runId: input.resumeRunId } : allocated(input.directory, config, SEMANTIC_PLANNER_POLICY);
  const allocation = readAllocation(location);
  if (allocation.configHash !== contentHash(config)) throw Error('DRAFT_CONFIG_MISMATCH');
  if (allocation.plannerPolicy !== SEMANTIC_PLANNER_POLICY) return prepareDraft({ ...input, resumeRunId: location.runId });
  const files = paths(location), pendingFile = join(files.opportunity, 'intent-pending.json');
  if (existsSync(join(files.opportunity, 'campaign.json')) || (existsSync(files.pointer) && load(location).pointer.status === 'STARTED')) throw Error('DRAFT_ALREADY_CONSUMED');
  const previous = readDialogue(location);
  if (previous && !existsSync(pendingFile)) return previous.plan.state === 'READY' ? readDraft(location) : previous;
  const planner = pinPlannerRecipe({ directory: files.opportunity, defaultPolicy: SEMANTIC_PLANNER_POLICY,
    requiredPolicy: SEMANTIC_PLANNER_POLICY, requiredHash: allocation.plannerRecipeHash! });
  const intent: IntentInput = existsSync(pendingFile) ? (read(pendingFile) as { input: IntentInput }).input
    : { stage: 'S2', prompt: config.prompt, context: config.brandContext, seeds: [], revision: 1, answers: [], edits: [] };
  const gateway = input.gateway ?? (input.gatewayFactory ? input.gatewayFactory({ directory: files.opportunity, budgetUsd: config.budgetUsd }) : gatewayFor(location, config));
  const generationFile = join(files.opportunity, 'intent-generation.json');
  const oldGeneration = existsSync(generationFile) ? read(generationFile) as { inputHash: string; id: string; status: string; code?: string } : null;
  const generation = { inputHash: contentHash(intent), id: oldGeneration?.inputHash === contentHash(intent)
    && !(oldGeneration.status === 'FAILED' && oldGeneration.code === 'CAMPAIGN_SEMANTIC_VALIDATION_FAILED') ? oldGeneration.id : randomUUID() };
  try {
    // An interrupted request replays its cache. An explicit retry after invalid model output
    // gets a new generation, otherwise both invalid cached responses would fail forever.
    atomic(generationFile, { ...generation, status: 'STARTED' });
    atomic(join(files.opportunity, 'draft-cost.json'), cost(gateway));
    input.onAllocated?.({ runId: location.runId, configHash: contentHash(config) });
    const result = await compileSemanticTurn({ campaign_id: location.runId, prompt: config.prompt, brand_context: config.brandContext,
      ...(config.languageScope === 'VIETNAMESE' ? { languages: ['vi'] } : {}),
      suitable_target: config.totalTarget, desired_platform_weights: { threads: config.threadsShare ?? 0.5, facebook: 1 - (config.threadsShare ?? 0.5) },
      raw_cap: config.rawCap, model_usd: config.budgetUsd }, intent, gateway, {
      cacheNamespace: 'semantic-dialogue:' + generation.id,
      ...(input.signal ? { signal: input.signal } : {}),
      onAttempt: attempt => { immutable(join(files.opportunity, 'intent-attempts', randomUUID() + '.json'), { revision: intent.revision, generationId: generation.id, ...attempt });
        atomic(join(files.opportunity, 'draft-cost.json'), cost(gateway)); },
    });
    const receipt = cost(gateway), at = now(); atomic(join(files.opportunity, 'draft-cost.json'), receipt);
    let draft: CampaignDraftView | null = null;
    if (result.campaign) {
      const campaign = withFilterPolicy(result.campaign, config.filterMode); validateCampaign(campaign, config);
      const recipe = classifierRecipe(campaign.filter_version);
      const record: DraftRecord = { schemaVersion: 1, runId: location.runId, config, campaign, recipe, recipeHash: contentHash(recipe),
        source: { kind: 'PLANNER', sourceCampaignVersion: campaign.version, plannerRequestHash: result.model_result.request_hash,
          plannerInvocationId: result.model_result.invocation_id, plannerPolicy: planner.planner_policy, plannerRecipeHash: planner.recipe_sha256,
          ...(result.recovery ? { plannerRecovery: result.recovery } : {}) },
        createdAt: previous?.createdAt ?? at, updatedAt: at, userOverrides: [] };
      draft = view(record, save(location, record), receipt);
    }
    const dialogue = saveDialogue(location, { runId: location.runId, config, configHash: contentHash(config), input: intent,
      plan: result.plan, createdAt: previous?.createdAt ?? at, updatedAt: at });
    if (existsSync(pendingFile)) unlinkSync(pendingFile);
    atomic(generationFile, { ...generation, status: 'SUCCEEDED' });
    return draft ?? dialogue;
  } catch (error) {
    const receipt = cost(gateway), errorCode = safeCode(error);
    atomic(generationFile, { ...generation, status: 'FAILED', code: errorCode });
    atomic(join(files.opportunity, 'draft-cost.json'), receipt);
    atomic(join(files.opportunity, 'draft-failure.json'), { code: errorCode, at: now(), cost: receipt });
    throw new CampaignDraftPreparationError(errorCode, location.runId, receipt);
  }
}
export async function continueSemanticDraft(input: { directory: string; request: ContinueCampaignRequest } & Pick<PrepareInput, 'gateway' | 'gatewayFactory' | 'onAllocated' | 'signal'>) {
  const request = input.request;
  if (!object(request) || Object.keys(request).some(key => !['runId', 'expectedRevision', 'answers', 'editAnswerId', 'edits'].includes(key))
    || (!!request.answers === !!request.edits) || (request.editAnswerId !== undefined && !request.answers)) throw Error('DRAFT_INPUT_INVALID');
  const location = { directory: input.directory, runId: request.runId }, files = paths(location), previous = readDialogue(location);
  if (!previous || previous.revision !== request.expectedRevision) throw Error('DRAFT_REVISION_CONFLICT');
  if (existsSync(files.pointer) && contentHash(load(location).record.config) !== previous.configHash) throw Error('DRAFT_CONFIG_MISMATCH');
  if (existsSync(join(files.opportunity, 'campaign.json')) || (existsSync(files.pointer) && load(location).pointer.status !== 'DRAFT')) throw Error('DRAFT_ALREADY_STARTED');
  if (existsSync(join(files.opportunity, 'intent-pending.json'))) throw Error('DRAFT_PREPARATION_INCOMPLETE');
  if (previous.input.revision >= 100) throw Error('DRAFT_EDIT_LIMIT');
  let revised: IntentInput;
  try {
    if (request.edits) {
      if (request.edits.some(edit => typeof edit.value !== 'string' || edit.value.length > 600)) throw Error('CAMPAIGN_ANSWER_INVALID');
      revised = reviseIntent(previous.input, request.edits, request.runId, previous.input.revision);
    }
    else {
      const oldAnswer = request.editAnswerId ? previous.input.answers.find(answer => answer.answer_id === request.editAnswerId) : null;
      if (request.editAnswerId && !oldAnswer) throw Error('DRAFT_INPUT_INVALID');
      const questions = oldAnswer ? [oldAnswer.question_snapshot] : previous.plan.questions;
      revised = reviseAnswers(previous.input, { ...previous.plan, questions }, request.answers!, request.runId, previous.input.revision, previous.plan);
    }
  } catch { throw Error('CAMPAIGN_ANSWER_INVALID'); }
  // Persist the submitted revision before billing. Retry/restart replays exactly these answers.
  atomic(join(files.opportunity, 'intent-pending.json'), { input: revised, baseRevision: previous.revision });
  return prepareSemanticDraft({ ...input, config: previous.config, resumeRunId: request.runId });
}
/** The service calls this only after validated startup succeeds; retrying the same run is idempotent. */
export function markDraftStarted(input: StartInput): CampaignDraftView {
  resolveDraftForStart(input); const { record, pointer } = load(input);
  if (pointer.status !== 'STARTED') atomic(paths(input).pointer, { ...pointer, status: 'STARTED', startedAt: now() });
  return view(record, { ...pointer, status: 'STARTED' }, readDraftCost(input));
}
function runtime(config: OpportunityConfig): CampaignPresetRuntime {
  return { totalTarget: config.totalTarget, ...(config.filterMode ? { filterMode: config.filterMode } : { threadsShare: config.threadsShare! }), rawCap: config.rawCap, budgetUsd: config.budgetUsd, commentsEnabled: config.commentsEnabled };
}
function presetView(record: PresetRecord): CampaignPresetView {
  let supported = true; try { assertRecipe(record.campaign, record.recipe, record.recipeHash); } catch { supported = false; }
  return structuredClone({ presetId: record.presetId, version: contentHash(record), name: record.name, createdAt: record.createdAt,
    prompt: record.campaign.prompt, brandContext: record.campaign.brand_context ?? '', criteria: criteria(record.campaign), runtimeDefaults: runtime(record.config),
    filterVersion: record.campaign.filter_version, recipeHash: record.recipeHash, sourceRunId: record.sourceRunId,
    sourceCampaignVersion: record.sourceCampaignVersion, sourceHash: record.sourceHash, supported });
}
function readPreset(directory: string, id: string, version: string): PresetRecord {
  const record = read(presetFile(directory, id, version)) as PresetRecord;
  if (!record || record.schemaVersion !== 1 || record.presetId !== id || contentHash(record) !== version || !runPattern.test(record.sourceRunId)
    || text(record.name, 80) !== record.name || contentHash(record.recipe) !== record.recipeHash || record.recipe.filter_version !== record.campaign.filter_version) throw Error('PRESET_INVALID');
  validateCampaign(record.campaign, record.config); return record;
}
export function savePreset(input: { directory: string } & SaveCampaignPresetRequest): CampaignPresetView {
  const name = text(input.name, 80); let campaign: CampaignPlan, config: OpportunityConfig, recipe: Recipe, recipeHash: string, sourceHash: string;
  if (!object(input.source)) throw Error('PRESET_SOURCE_INVALID');
  const location = { directory: input.directory, runId: input.source.runId };
  if (input.source.kind === 'DRAFT') {
    const loaded = load(location);
    if (input.source.revision !== loaded.pointer.revision) throw Error('DRAFT_REVISION_CONFLICT');
    ({ campaign, config, recipe, recipeHash } = loaded.record); sourceHash = loaded.pointer.revision;
  } else if (input.source.kind === 'RUN') {
    const files = paths(location);
    if (existsSync(join(files.opportunity, 'active-evaluation.json'))) throw Error('PRESET_EXPERIMENTAL_FILTER_UNSUPPORTED');
    campaign = read(join(files.opportunity, 'campaign.json')) as CampaignPlan;
    config = parseOpportunityConfig(read(join(files.output, 'opportunity-config.json')));
    const stored = read(join(files.opportunity, 'filter-recipe.json')) as { recipe: Recipe; recipe_sha256: string };
    recipe = stored.recipe; recipeHash = stored.recipe_sha256; validateCampaign(campaign, config);
    if (campaign.campaign_id !== input.source.runId) throw Error('PRESET_SOURCE_INVALID');
    assertRecipe(campaign, recipe, recipeHash); sourceHash = contentHash({ campaign, config, recipeHash });
  } else throw Error('PRESET_SOURCE_INVALID');
  const record: PresetRecord = { schemaVersion: 1, presetId: `preset-${randomUUID()}`, name, createdAt: now(), campaign, config, recipe, recipeHash,
    sourceRunId: input.source.runId, sourceCampaignVersion: campaign.version, sourceHash };
  const version = contentHash(record), file = presetFile(input.directory, record.presetId, version);
  immutable(file, record); atomic(join(dirname(file), 'preset.json'), { schemaVersion: 1, presetId: record.presetId, version });
  return presetView(record);
}
export function listPresets(input: { directory: string }): CampaignPresetView[] {
  const root = join(input.directory, 'filter-presets'); if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && presetPattern.test(entry.name)
    && existsSync(join(root, entry.name, 'preset.json'))).map(entry => {
    const pointer = read(join(root, entry.name, 'preset.json')) as { schemaVersion: number; presetId: string; version: string };
    if (pointer.schemaVersion !== 1 || pointer.presetId !== entry.name) throw Error('PRESET_INVALID');
    return presetView(readPreset(input.directory, entry.name, pointer.version));
  }).sort((a, b) => a.name.localeCompare(b.name) || a.presetId.localeCompare(b.presetId));
}
export function applyPreset(input: { directory: string } & ApplyCampaignPresetRequest): CampaignDraftView {
  const preset = readPreset(input.directory, input.presetId, input.presetVersion); assertRecipe(preset.campaign, preset.recipe, preset.recipeHash);
  if (!object(input.runtime) || !exactKeys(input.runtime, ['totalTarget', input.runtime.filterMode ? 'filterMode' : 'threadsShare', 'rawCap', 'budgetUsd', 'commentsEnabled',
    ...(input.runtime.languageScope === undefined ? [] : ['languageScope'])])) throw Error('PRESET_RUNTIME_INVALID');
  const config = parseOpportunityConfig({ ...input.runtime, enabled: true, prompt: preset.campaign.prompt, brandContext: preset.campaign.brand_context ?? '' });
  const location = allocated(input.directory, config), at = now();
  let campaign = { ...structuredClone(preset.campaign), campaign_id: location.runId, created_at: at, suitable_target: config.totalTarget,
    desired_platform_weights: { threads: config.threadsShare ?? 0.5, facebook: 1 - (config.threadsShare ?? 0.5) },
    budget: { ...preset.campaign.budget, raw_cap: config.rawCap, model_usd: config.budgetUsd } };
  if (config.languageScope === 'VIETNAMESE') {
    campaign.languages = ['vi'];
  }
  campaign = withFilterPolicy(campaign, config.filterMode);
  const { version: _version, created_at: _created, ...base } = campaign; campaign.version = campaignVersion(base); validateCampaign(campaign, config);
  const record: DraftRecord = { schemaVersion: 1, runId: location.runId, config, campaign, recipe: classifierRecipe(campaign.filter_version), recipeHash: contentHash(classifierRecipe(campaign.filter_version)),
    source: { kind: 'PRESET', presetId: preset.presetId, presetVersion: input.presetVersion, sourceRunId: preset.sourceRunId, sourceCampaignVersion: preset.campaign.version },
    createdAt: at, updatedAt: at, userOverrides: [] };
  const receipt: CampaignDraftCost = { capturedAt: at, model: 'NOT_SELECTED', budgetUsd: config.budgetUsd, measuredUsd: 0,
    unknownUpperUsd: 0, reservedUsd: 0, remainingUsd: config.budgetUsd, billableAttempts: 0, cacheHits: 0, basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' };
  atomic(join(paths(location).opportunity, 'draft-cost.json'), receipt);
  return view(record, save(location, record), receipt);
}
