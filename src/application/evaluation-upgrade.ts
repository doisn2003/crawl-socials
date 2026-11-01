import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicJson } from '../infrastructure/config/user-config.js';
import type { AsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import { campaignVersion, OPPORTUNITY_FILTER_VERSION, validateCampaignPlan } from '../domain/campaign-plan.js';
import { contentHash, contextKey, stableJson } from '../domain/conversation.js';
import type { EvaluationContext } from '../domain/conversation.js';
import type { ConversationDecision, ConversationDecisionInput } from '../domain/conversation-decision.js';
import { classifierRecipe } from './classification-service.js';
import { FOCUSED_VERIFIER_RECIPE } from './opportunity-verifier-v2.js';

export const evaluationContext = (campaign: CampaignPlan): EvaluationContext => ({ campaign_id: campaign.campaign_id,
  campaign_version: campaign.version, filter_version: campaign.filter_version });
/** Policy is content-addressed: changing either prompt/schema or this composition changes the context. */
export function combinedEvaluationRecipe() {
  return { schema_version: 1, primary: structuredClone(classifierRecipe()), verifier: structuredClone(FOCUSED_VERIFIER_RECIPE),
    policy: { negative_reuse: 'SAME_CURRENT_SNAPSHOT_ASSESSED_NOT_YET_OR_UNRELATED',
      suitable_publication: 'PRIMARY_SUITABLE_AND_FOCUSED_KEEP', unresolved: 'NULL_PENDING_NOT_NEGATIVE',
      job_type: 'VERIFY', ledger_scope: 'SAME_OPPORTUNITY_DIRECTORY_ALL_PRIOR_MODEL_LEDGERS',
      migration: 'NEW_CONTEXT_FAIL_CLOSED_PRESERVE_BASELINE_FILES_AND_HISTORY' } } as const;
}
export const combinedFilterVersion = (): string => `${OPPORTUNITY_FILTER_VERSION}+focused-${contentHash(combinedEvaluationRecipe()).slice(0, 16)}`;
export interface EvaluationUpgradeManifest {
  schema_version: 1; recipe_sha256: string; baseline_campaign_sha256: string; baseline_recipe_sha256: string;
  campaign_sha256: string; plan_sha256: string; source_context: EvaluationContext; context: EvaluationContext;
  created_at: string; reason: string; model_ledger_directory: string;
}
interface MigrationEntry { snapshot_id: string; decision: ConversationDecision | null }
interface MigrationPlan { source_context: EvaluationContext; watermark: unknown; entries: MigrationEntry[] }
interface ActivePointer { schema_version: 1; recipe_sha256: string; manifest_sha256: string; state: 'MIGRATING' | 'READY_FOR_VERIFICATION' }
export interface ActiveEvaluation {
  directory: string; campaign: CampaignPlan; context: EvaluationContext; manifest: EvaluationUpgradeManifest;
  state: ActivePointer['state']; status: ActivePointer['state']; recipe: ReturnType<typeof combinedEvaluationRecipe>;
}
type UpgradeStore = Pick<AsyncConversationStore, 'exportSnapshot' | 'results' | 'getSnapshot' | 'snapshot' | 'recordDecision' | 'enqueue'>;
const json = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
function immutable(file: string, value: unknown): void {
  if (existsSync(file)) { if (contentHash(json(file)) !== contentHash(value)) throw Error('EVALUATION_IMMUTABLE_FILE_MISMATCH'); return; }
  // Single store writer: a crash can leave only .next, never a truncated immutable final.
  atomicJson(file, value);
}
function baseline(directory: string): { campaign: CampaignPlan; recipe: { recipe: unknown; recipe_sha256: string } } {
  const campaign = json<CampaignPlan>(join(directory, 'campaign.json')), recipe = json<{ recipe: unknown; recipe_sha256: string }>(join(directory, 'filter-recipe.json'));
  validateCampaignPlan(campaign);
  if (campaign.filter_version !== OPPORTUNITY_FILTER_VERSION || recipe.recipe_sha256 !== contentHash(classifierRecipe())
    || contentHash(recipe.recipe) !== recipe.recipe_sha256) throw Error('BASELINE_RECIPE_MISMATCH');
  return { campaign, recipe };
}
/** No fallback to baseline on a corrupt/unsupported active pointer. */
export function readActiveEvaluation(directory: string, baselineCampaign?: CampaignPlan): ActiveEvaluation | null {
  const file = join(directory, 'active-evaluation.json'); if (!existsSync(file)) return null;
  const pointer = json<ActivePointer>(file), expected = combinedEvaluationRecipe(), hash = contentHash(expected);
  if (pointer.schema_version !== 1 || pointer.recipe_sha256 !== hash || !['MIGRATING', 'READY_FOR_VERIFICATION'].includes(pointer.state)) throw Error('ACTIVE_EVALUATION_POLICY_MISMATCH');
  const folder = join(directory, 'evaluations', hash), manifest = json<EvaluationUpgradeManifest>(join(folder, 'manifest.json')),
    campaign = json<CampaignPlan>(join(folder, 'campaign.json')), recipe = json<ReturnType<typeof combinedEvaluationRecipe>>(join(folder, 'filter-recipe.json')),
    plan = json<MigrationPlan>(join(folder, 'migration-plan.json')), source = baseline(directory);
  validateCampaignPlan(campaign);
  if (contentHash(manifest) !== pointer.manifest_sha256 || manifest.recipe_sha256 !== hash || contentHash(recipe) !== hash
    || contentHash(campaign) !== manifest.campaign_sha256 || contentHash(plan) !== manifest.plan_sha256
    || contentHash(source.campaign) !== manifest.baseline_campaign_sha256 || source.recipe.recipe_sha256 !== manifest.baseline_recipe_sha256
    || contextKey(evaluationContext(campaign)) !== contextKey(manifest.context)
    || contextKey(evaluationContext(source.campaign)) !== contextKey(manifest.source_context)
    || manifest.model_ledger_directory !== resolve(directory) || campaign.filter_version !== combinedFilterVersion()
    || (baselineCampaign && contentHash(baselineCampaign) !== manifest.baseline_campaign_sha256)) throw Error('ACTIVE_EVALUATION_INTEGRITY_MISMATCH');
  return { directory: folder, campaign, context: manifest.context, manifest, state: pointer.state, status: pointer.state, recipe };
}
export function verificationJobKey(context: EvaluationContext, snapshotId: string): string {
  return `verify:${contentHash(context)}:${snapshotId}`;
}
export function asDecisionInput(decision: ConversationDecisionInput): ConversationDecisionInput {
  return { campaign_id: decision.campaign_id, campaign_version: decision.campaign_version, filter_version: decision.filter_version,
    snapshot_id: decision.snapshot_id, classification: decision.classification, assessment_status: decision.assessment_status,
    reason_code: decision.reason_code, evidence_ids: [...decision.evidence_ids], model: decision.model,
    ...(decision.intents ? { intents: [...decision.intents] } : {}), action_target: decision.action_target ?? null,
    attributes: { ...decision.attributes } };
}
/** The caller must have stopped the previous writer. This function never calls a model. */
export async function prepareCombinedEvaluationUpgrade(input: {
  directory: string; baselineCampaign: CampaignPlan; store: UpgradeStore; reason: string;
}): Promise<ActiveEvaluation> {
  if (!/^[A-Z][A-Z0-9_]{2,100}$/u.test(input.reason)) throw Error('EVALUATION_UPGRADE_REASON_INVALID');
  const source = baseline(input.directory);
  if (contentHash(source.campaign) !== contentHash(input.baselineCampaign)) throw Error('EVALUATION_BASELINE_CAMPAIGN_MISMATCH');
  let active = readActiveEvaluation(input.directory);
  if (!active) {
    const recipe = combinedEvaluationRecipe(), hash = contentHash(recipe), directory = join(input.directory, 'evaluations', hash);
    mkdirSync(directory, { recursive: true });
    // Reuse an interrupted immutable preparation, never rebuild it from later observations.
    if (!existsSync(join(directory, 'manifest.json'))) {
      const preparationFile = join(directory, 'preparation.json');
      if (!existsSync(preparationFile)) {
      const exported = await input.store.exportSnapshot(evaluationContext(source.campaign));
      const bySnapshot = new Map(exported.conversations.filter(row => !row.stale).map(row => [row.snapshot.id, row.decision]));
      const plan: MigrationPlan = { source_context: evaluationContext(source.campaign), watermark: exported.watermark,
        entries: exported.snapshots.map(snapshot => ({ snapshot_id: snapshot.id, decision: bySnapshot.get(snapshot.id) ?? null })) };
      const { version: _version, created_at: _created, ...base } = source.campaign;
      const definition = { ...base, filter_version: combinedFilterVersion() };
      const campaign: CampaignPlan = { ...definition, version: campaignVersion(definition), created_at: new Date().toISOString() };
      const manifest: EvaluationUpgradeManifest = { schema_version: 1, recipe_sha256: hash, baseline_campaign_sha256: contentHash(source.campaign),
        baseline_recipe_sha256: source.recipe.recipe_sha256, campaign_sha256: contentHash(campaign), plan_sha256: contentHash(plan),
        source_context: evaluationContext(source.campaign), context: evaluationContext(campaign), created_at: campaign.created_at,
        reason: input.reason, model_ledger_directory: resolve(input.directory) };
      atomicJson(preparationFile, { campaign, recipe, plan, manifest });
      }
      const prepared = json<{ campaign: CampaignPlan; recipe: ReturnType<typeof combinedEvaluationRecipe>; plan: MigrationPlan; manifest: EvaluationUpgradeManifest }>(preparationFile);
      immutable(join(directory, 'campaign.json'), prepared.campaign); immutable(join(directory, 'filter-recipe.json'), prepared.recipe);
      immutable(join(directory, 'migration-plan.json'), prepared.plan); immutable(join(directory, 'manifest.json'), prepared.manifest);
    }
    const manifest = json<EvaluationUpgradeManifest>(join(directory, 'manifest.json'));
    // Switch before seeding: interruption can show pending/missing rows, never old-context positives.
    atomicJson(join(input.directory, 'active-evaluation.json'), { schema_version: 1, recipe_sha256: hash,
      manifest_sha256: contentHash(manifest), state: 'MIGRATING' } satisfies ActivePointer);
    active = readActiveEvaluation(input.directory)!;
  }
  await resumeEvaluationMigration(input.directory, input.store);
  return readActiveEvaluation(input.directory)!;
}
export async function resumeEvaluationMigration(directory: string, store: UpgradeStore): Promise<void> {
  const active = readActiveEvaluation(directory); if (!active) throw Error('ACTIVE_EVALUATION_REQUIRED');
  if (active.state === 'READY_FOR_VERIFICATION') return;
  const plan = json<MigrationPlan>(join(active.directory, 'migration-plan.json'));
  const current = new Map((await store.results(active.context)).map(row => [row.snapshot.id, row.decision]));
  for (const entry of plan.entries) {
    const original = await store.getSnapshot(entry.snapshot_id); if (!original) throw Error('MIGRATION_SNAPSHOT_MISSING');
    const snapshot = await store.snapshot(original.platform, original.root_post_id); if (!snapshot) throw Error('MIGRATION_ROOT_MISSING');
    const existing = current.get(snapshot.id); if (existing?.assessment_status === 'ASSESSED') continue;
    const source = snapshot.id === entry.snapshot_id ? entry.decision : null;
    const provenance = { source_context_sha256: contentHash(active.manifest.source_context), source_decision_id: source?.id ?? null,
      source_snapshot_id: entry.snapshot_id, combined_recipe_sha256: active.manifest.recipe_sha256 };
    const input: ConversationDecisionInput = source ? { ...asDecisionInput(source), ...active.context,
      attributes: { ...source.attributes, ...provenance, primary_model: source.model, migration_status: 'COPIED_PRIMARY' } }
      : { ...active.context, snapshot_id: snapshot.id, classification: null, assessment_status: 'PENDING', reason_code: 'UPGRADE_REQUIRES_CLASSIFICATION',
        evidence_ids: [], model: 'MIGRATION', attributes: provenance };
    const reusableNegative = source?.assessment_status === 'ASSESSED' && source.classification !== 'SUITABLE';
    if (reusableNegative) { await store.recordDecision(input); continue; }
    const proposal = source?.assessment_status === 'ASSESSED' && source.classification === 'SUITABLE' ? input : null;
    if (!existing) await store.recordDecision({ ...input, classification: null, assessment_status: 'PENDING',
      reason_code: proposal ? 'AWAITING_FOCUSED_VERIFIER' : input.reason_code,
      attributes: { ...input.attributes, verification_status: proposal ? 'REQUIRED' : 'PRIMARY_REQUIRED' } });
    if (proposal) await store.enqueue({ type: 'VERIFY', idempotency_key: verificationJobKey(active.context, snapshot.id),
      payload: { ...active.context, platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_id: snapshot.id,
        recipe_sha256: active.manifest.recipe_sha256, proposal }, priority: 20, max_attempts: 3 });
    else await store.enqueue({ type: 'CLASSIFY', idempotency_key: stableJson(['CLASSIFY', contextKey(active.context), snapshot.id]),
      payload: { ...active.context, platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_id: snapshot.id }, priority: 10, max_attempts: 3 });
  }
  atomicJson(join(directory, 'active-evaluation.json'), { schema_version: 1, recipe_sha256: active.manifest.recipe_sha256,
    manifest_sha256: contentHash(active.manifest), state: 'READY_FOR_VERIFICATION' } satisfies ActivePointer);
}
