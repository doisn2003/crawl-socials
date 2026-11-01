import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CampaignPlannerPolicy } from '../domain/campaign-plan.js';
import { plannerRecipeHash } from './compile-campaign.js';

export interface PlannerRecipePin { schema_version: 1; planner_policy: CampaignPlannerPolicy; recipe_sha256: string }
/** Resolve before any model request. The caller supplies prior-attempt evidence before creating gateways.
 * One campaign writer is required, as with the campaign's model ledger. */
export function pinPlannerRecipe(input: {
  directory: string; defaultPolicy: CampaignPlannerPolicy; existingAttempt?: boolean;
  requiredPolicy?: CampaignPlannerPolicy; requiredHash?: string; persist?: boolean;
}): PlannerRecipePin {
  const file = join(input.directory, 'planner-recipe.json');
  let pin: PlannerRecipePin;
  if (existsSync(file)) {
    try {
      pin = JSON.parse(readFileSync(file, 'utf8')) as PlannerRecipePin;
      if (!pin || Object.keys(pin).sort().join() !== 'planner_policy,recipe_sha256,schema_version' || pin.schema_version !== 1
        || typeof pin.planner_policy !== 'string' || !/^[0-9a-f]{64}$/u.test(pin.recipe_sha256)) throw Error();
    } catch { throw Error('PLANNER_RECIPE_PIN_INVALID'); }
  } else {
    const policy = input.requiredPolicy ?? (input.existingAttempt ? 'legacy-short-v1' : input.defaultPolicy);
    let hash: string; try { hash = plannerRecipeHash(policy); } catch { throw Error('PLANNER_POLICY_UNSUPPORTED'); }
    pin = { schema_version: 1, planner_policy: policy, recipe_sha256: hash };
  }
  if (input.requiredPolicy !== undefined && pin.planner_policy !== input.requiredPolicy) throw Error('PLANNER_POLICY_MISMATCH');
  if (input.requiredHash !== undefined && (!/^[0-9a-f]{64}$/u.test(input.requiredHash) || input.requiredHash !== pin.recipe_sha256)) throw Error('PLANNER_RECIPE_MISMATCH');
  let supported: string; try { supported = plannerRecipeHash(pin.planner_policy); } catch { throw Error('PLANNER_POLICY_UNSUPPORTED'); }
  if (supported !== pin.recipe_sha256) throw Error('PLANNER_RECIPE_MISMATCH');
  if (!existsSync(file) && input.persist !== false) {
    mkdirSync(input.directory, { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(pin, null, 2) + '\n', { encoding: 'utf8', flush: true, flag: 'wx', mode: 0o600 }); renameSync(temporary, file); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  return Object.freeze({ ...pin });
}
