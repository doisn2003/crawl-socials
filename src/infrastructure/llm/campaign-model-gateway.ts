import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelGatewayError } from '../../application/ports/model-gateway.js';
import type { ModelGateway, ModelLedgerSummary, ModelPrice } from '../../application/ports/model-gateway.js';
import { createGeminiGateway, GEMINI_FLASH_LITE_PRICE, GEMINI_25_FLASH_LITE_PRICE } from './gemini-gateway.js';
import type { GeminiGatewayOptions } from './gemini-gateway.js';
import { createSharedModelBudget } from './shared-model-budget.js';
import { REBUILD_MODEL } from './durable-spend.js';

export const CAMPAIGN_PRIMARY_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'] as const;
export type CampaignPrimaryModel = typeof CAMPAIGN_PRIMARY_MODELS[number];
export const GEMINI_35_FLASH_LITE_PRICE: ModelPrice = Object.freeze({ input_per_million: 0.30,
  output_per_million: 2.50, cached_input_per_million: 0.03, observed_at: '2026-10-30',
  source: 'https://ai.google.dev/gemini-api/docs/pricing' });

interface RoutingChange {
  at: string;
  from_model: CampaignPrimaryModel | null;
  to_model: CampaignPrimaryModel;
  reason: string;
  measured_cost_before_usd: number;
  unmetered_upper_before_usd: number;
}
export interface CampaignModelRouting {
  schema_version: 1;
  active_model: CampaignPrimaryModel;
  selected_at: string;
  selection_reason: string;
  history: RoutingChange[];
}
export interface CampaignModelGatewayOptions extends Omit<GeminiGatewayOptions, 'model' | 'price'> {
  /** The opportunity directory containing model/, not the legacy model directory itself. */
  directory: string;
  primaryModel?: CampaignPrimaryModel;
  schedulerForModel?: (model: CampaignPrimaryModel) => import('./request-scheduler.js').RequestScheduler;
  /** Safe audit code only; never pass raw provider messages or credentials. */
  selectionReason?: string;
}
const isModel = (value: unknown): value is CampaignPrimaryModel => CAMPAIGN_PRIMARY_MODELS.includes(value as CampaignPrimaryModel);
const isReason = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/u.test(value);

function readRouting(file: string): CampaignModelRouting | null {
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as CampaignModelRouting;
    if (data.schema_version !== 1 || !isModel(data.active_model) || !isReason(data.selection_reason)
      || !Number.isFinite(Date.parse(data.selected_at)) || !Array.isArray(data.history) || !data.history.length) throw Error();
    for (const event of data.history) if (!event || !isModel(event.to_model) || (event.from_model !== null && !isModel(event.from_model))
      || !isReason(event.reason) || !Number.isFinite(Date.parse(event.at))
      || !Number.isFinite(event.measured_cost_before_usd) || event.measured_cost_before_usd < 0
      || !Number.isFinite(event.unmetered_upper_before_usd) || event.unmetered_upper_before_usd < 0) throw Error();
    const last = data.history.at(-1)!;
    if (last.to_model !== data.active_model || last.at !== data.selected_at || last.reason !== data.selection_reason) throw Error();
    return data;
  } catch { throw new ModelGatewayError('MODEL_ROUTING_INVALID'); }
}

function saveRouting(file: string, routing: CampaignModelRouting): void {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx');
  try { writeFileSync(fd, JSON.stringify(routing, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, file);
}

/** One explicitly selected primary model; never retries against a different model automatically.
 * Reconstruct both durable ledgers before returning a usable gateway. The supplied directory
 * must have one campaign writer; callers close/pause the previous pipeline before switching.
 */
export function createCampaignModelGateway(options: CampaignModelGatewayOptions): ModelGateway {
  if (options.primaryModel !== undefined && !isModel(options.primaryModel)) throw new ModelGatewayError('MODEL_ROUTING_MODEL_INVALID');
  if (options.selectionReason !== undefined && !isReason(options.selectionReason)) throw new ModelGatewayError('MODEL_ROUTING_REASON_INVALID');
  const directory = resolve(options.directory), legacyDirectory = join(directory, 'model');
  const legacyExisted = existsSync(join(legacyDirectory, 'model-ledger.jsonl'));
  const routingFile = join(directory, 'model-routing.json'), prior = readRouting(routingFile);
  const inferred = prior?.active_model ?? REBUILD_MODEL;
  const active = options.primaryModel ?? inferred;
  const pool = options.sharedBudget ?? createSharedModelBudget(options.budgetUsd);
  if (Math.abs(pool.limitUsd - options.budgetUsd) > 1e-9) throw new ModelGatewayError('MODEL_BUDGET_LIMIT_MISMATCH');
  const { primaryModel: _selection, selectionReason: _reason, directory: _directory, schedulerForModel, ...transportOptions } = options;
  const gateways = new Map<CampaignPrimaryModel, ModelGateway>();
  for (const model of CAMPAIGN_PRIMARY_MODELS) {
    gateways.set(model, createGeminiGateway({ ...transportOptions, budgetUsd: options.budgetUsd, sharedBudget: pool, model,
      ...(schedulerForModel ? { scheduler: schedulerForModel(model) } : {}),
      directory: model === 'gemini-3.1-flash-lite' ? legacyDirectory : join(directory, 'model-' + model),
      price: model === 'gemini-3.1-flash-lite' ? GEMINI_FLASH_LITE_PRICE : model === 'gemini-2.5-flash-lite' ? GEMINI_25_FLASH_LITE_PRICE : GEMINI_35_FLASH_LITE_PRICE }));
  }
  const components = () => [...gateways.values()].map(gateway => gateway.summary());
  const summary = (): ModelLedgerSummary => {
    const parts = components();
    return { model: active, budget_usd: options.budgetUsd,
      measured_cost_usd: parts.reduce((sum, part) => sum + part.measured_cost_usd, 0),
      unmetered_cost_upper_usd: parts.reduce((sum, part) => sum + part.unmetered_cost_upper_usd, 0),
      reserved_usd: parts.reduce((sum, part) => sum + part.reserved_usd, 0), remaining_usd: pool.remaining(),
      billable_attempts: parts.reduce((sum, part) => sum + part.billable_attempts, 0),
      scheduling: gateways.get(active)!.summary().scheduling,
      cache_hits: parts.reduce((sum, part) => sum + part.cache_hits, 0),
      cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE', components: parts };
  };
  if (!prior || active !== prior.active_model) {
    const reason = options.selectionReason ?? (options.primaryModel !== undefined ? 'EXPLICIT_PRIMARY_MODEL_SELECTION'
      : legacyExisted ? 'LEGACY_LEDGER_PRESERVED' : 'NEW_CAMPAIGN_DEFAULT');
    const at = new Date().toISOString(), before = summary();
    const change: RoutingChange = { at, from_model: prior?.active_model ?? (legacyExisted ? 'gemini-3.1-flash-lite' : null),
      to_model: active, reason, measured_cost_before_usd: before.measured_cost_usd,
      unmetered_upper_before_usd: before.unmetered_cost_upper_usd };
    mkdirSync(directory, { recursive: true });
    saveRouting(routingFile, { schema_version: 1, active_model: active, selected_at: at, selection_reason: reason,
      history: [...(prior?.history ?? []), change] });
  }
  const selected = gateways.get(active)!;
  return { summary, generateJson: request => selected.generateJson(request) };
}
