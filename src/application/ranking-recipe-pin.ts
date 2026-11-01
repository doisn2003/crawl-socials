import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import { contentHash, type SourceKind } from '../domain/conversation.js';
import { sourcePriorityScores } from '../domain/source-priority.js';
import { atomicJson } from '../infrastructure/config/user-config.js';

export interface RankingRecipePin {
  recipe: { schema_version: 1; policy: 'legacy-source-priority-v1' | 'campaign-source-priority-v1'; source_priority: SourceKind[] | null };
  recipe_sha256: string;
}

/** Called before saving a new campaign. Existing runs without a pin retain their exact
 * legacy source order; reopening a run must not silently reorder previously delivered rows. */
export function pinRankingRecipe(input: { directory: string; campaign: CampaignPlan; campaignExisted: boolean }): RankingRecipePin {
  const file = join(input.directory, 'ranking-recipe.json');
  let pin: RankingRecipePin;
  if (existsSync(file)) {
    try {
      pin = JSON.parse(readFileSync(file, 'utf8')) as RankingRecipePin;
      if (!pin || Object.keys(pin).sort().join() !== 'recipe,recipe_sha256' || !pin.recipe
        || Object.keys(pin.recipe).sort().join() !== 'policy,schema_version,source_priority'
        || pin.recipe.schema_version !== 1 || contentHash(pin.recipe) !== pin.recipe_sha256) throw Error();
      if (pin.recipe.policy === 'legacy-source-priority-v1') {
        if (pin.recipe.source_priority !== null) throw Error();
      } else if (pin.recipe.policy === 'campaign-source-priority-v1') sourcePriorityScores(pin.recipe.source_priority ?? []);
      else throw Error();
    } catch { throw Error('RANKING_RECIPE_PIN_INVALID'); }
    if (pin.recipe.policy === 'campaign-source-priority-v1'
      && contentHash(pin.recipe.source_priority) !== contentHash(input.campaign.source_priority)) throw Error('RANKING_SOURCE_PRIORITY_MISMATCH');
  } else {
    if (!input.campaignExisted) sourcePriorityScores(input.campaign.source_priority);
    const recipe: RankingRecipePin['recipe'] = { schema_version: 1,
      policy: input.campaignExisted ? 'legacy-source-priority-v1' : 'campaign-source-priority-v1',
      source_priority: input.campaignExisted ? null : [...input.campaign.source_priority] };
    pin = { recipe, recipe_sha256: contentHash(recipe) };
    atomicJson(file, pin);
  }
  return structuredClone(pin);
}
