import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import { contentHash } from '../domain/conversation.js';

export interface ObservedLimitCounts { raw: number; suitable: number; pending: number }
export interface RawCapOverride {
  schema_version: 1; id: string; at: string; campaign_id: string; campaign_version: string; filter_version: string;
  campaign_sha256: string; from_raw_cap: number; to_raw_cap: number; model_budget_usd: number; reason: string;
  observed_counts: ObservedLimitCounts;
}
export interface EffectiveRuntimeLimits {
  original_raw_cap: number; effective_raw_cap: number; model_budget_usd: number; campaign_sha256: string;
  override_count: number; latest_override_id: string | null; overrides: RawCapOverride[];
}
const filename = 'runtime-limit-overrides.jsonl';
const validCap = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 100000;
function validateCounts(value: ObservedLimitCounts): void {
  if (!value || ![value.raw, value.suitable, value.pending].every(n => Number.isSafeInteger(n) && n >= 0)
    || value.suitable + value.pending > value.raw) throw Error('RUNTIME_LIMIT_COUNTS_INVALID');
}

/** directory is the opportunity folder; read-only, with no journal repair or model-budget reset. */
export function readEffectiveLimits(directory: string, campaign: CampaignPlan): EffectiveRuntimeLimits {
  if (!validCap(campaign.budget.raw_cap) || !Number.isFinite(campaign.budget.model_usd) || (campaign.filter_mode === 'OFF' ? campaign.budget.model_usd !== 0 : campaign.budget.model_usd <= 0)) throw Error('RUNTIME_LIMIT_BASE_INVALID');
  const original = campaign.budget.raw_cap, campaignHash = contentHash(campaign), file = join(directory, filename);
  let effective = original, previousTime = -Infinity;
  const overrides: RawCapOverride[] = [], ids = new Set<string>();
  const bytes = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (bytes && !bytes.endsWith('\n')) throw Error('RUNTIME_LIMIT_JOURNAL_INCOMPLETE');
  for (const line of bytes.split('\n').filter(line => line.trim())) {
    let event: RawCapOverride;
    try { event = JSON.parse(line) as RawCapOverride; } catch { throw Error('RUNTIME_LIMIT_JOURNAL_INVALID'); }
    if (!event || event.schema_version !== 1 || typeof event.id !== 'string' || !/^[0-9a-f-]{36}$/u.test(event.id) || ids.has(event.id)
      || !Number.isFinite(Date.parse(event.at)) || Date.parse(event.at) < previousTime || !/^[A-Z][A-Z0-9_]{2,100}$/u.test(event.reason)) throw Error('RUNTIME_LIMIT_EVENT_INVALID');
    if (event.campaign_id !== campaign.campaign_id || event.campaign_version !== campaign.version || event.filter_version !== campaign.filter_version
      || event.campaign_sha256 !== campaignHash || event.model_budget_usd !== campaign.budget.model_usd) throw Error('RUNTIME_LIMIT_CAMPAIGN_MISMATCH');
    if (event.from_raw_cap !== effective || !validCap(event.to_raw_cap) || event.to_raw_cap <= effective) throw Error('RUNTIME_LIMIT_CHAIN_INVALID');
    validateCounts(event.observed_counts);
    ids.add(event.id); effective = event.to_raw_cap; previousTime = Date.parse(event.at); overrides.push(event);
  }
  return { original_raw_cap: original, effective_raw_cap: effective, model_budget_usd: campaign.budget.model_usd,
    campaign_sha256: campaignHash, override_count: overrides.length, latest_override_id: overrides.at(-1)?.id ?? null, overrides };
}

/** Caller must stop the campaign before changing limits. The immutable plan stays untouched. */
export function recordRawCapExtension(input: { directory: string; campaign: CampaignPlan; expectedFromCap: number; toRawCap: number;
  reason: string; observedCounts: ObservedLimitCounts; now?: Date }): EffectiveRuntimeLimits {
  if (!validCap(input.expectedFromCap) || !validCap(input.toRawCap) || input.toRawCap <= input.expectedFromCap) throw Error('RUNTIME_LIMIT_EXTENSION_INVALID');
  if (!/^[A-Z][A-Z0-9_]{2,100}$/u.test(input.reason)) throw Error('RUNTIME_LIMIT_REASON_INVALID');
  validateCounts(input.observedCounts);
  const at = (input.now ?? new Date()).toISOString();
  mkdirSync(input.directory, { recursive: true });
  const lock = join(input.directory, '.runtime-limit-overrides.lock');
  let lockFd: number;
  try { lockFd = openSync(lock, 'wx'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('RUNTIME_LIMITS_BUSY'); throw error; }
  try {
    const current = readEffectiveLimits(input.directory, input.campaign);
    if (current.effective_raw_cap !== input.expectedFromCap) throw Error('RUNTIME_LIMIT_EXPECTED_CAP_MISMATCH');
    if (current.overrides.length && Date.parse(at) < Date.parse(current.overrides.at(-1)!.at)) throw Error('RUNTIME_LIMIT_TIME_INVALID');
    const event: RawCapOverride = { schema_version: 1, id: randomUUID(), at, campaign_id: input.campaign.campaign_id, campaign_version: input.campaign.version,
      filter_version: input.campaign.filter_version, campaign_sha256: current.campaign_sha256, from_raw_cap: current.effective_raw_cap,
      to_raw_cap: input.toRawCap, model_budget_usd: current.model_budget_usd, reason: input.reason,
      observed_counts: { raw: input.observedCounts.raw, suitable: input.observedCounts.suitable, pending: input.observedCounts.pending } };
    const fd = openSync(join(input.directory, filename), 'a');
    try { writeFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    return readEffectiveLimits(input.directory, input.campaign);
  } finally { closeSync(lockFd); unlinkSync(lock); }
}
