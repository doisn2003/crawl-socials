import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { GROUNDED_CONSTRAINT_PLANNER_POLICY } from '../src/domain/campaign-plan.js';
import { plannerRecipeHash } from '../src/application/compile-campaign.js';
import { pinPlannerRecipe } from '../src/application/planner-recipe-pin.js';

function temporary(work: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-planner-pin-'));
  try { work(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-planner-pin-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
test('new requests pin grounded while proven previous attempts default to the legacy recipe', () => temporary(directory => {
  const fresh = pinPlannerRecipe({ directory, defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY });
  assert.equal(fresh.planner_policy, GROUNDED_CONSTRAINT_PLANNER_POLICY); assert.equal(fresh.recipe_sha256, plannerRecipeHash(fresh.planner_policy));
  const original = readFileSync(join(directory, 'planner-recipe.json'), 'utf8');
  assert.deepEqual(pinPlannerRecipe({ directory, defaultPolicy: 'legacy-short-v1', existingAttempt: true }), fresh);
  assert.equal(readFileSync(join(directory, 'planner-recipe.json'), 'utf8'), original);
  const legacy = pinPlannerRecipe({ directory: join(directory, 'old'), defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY, existingAttempt: true });
  assert.equal(legacy.planner_policy, 'legacy-short-v1');
}));
test('allocation policy and hash mismatches cannot overwrite an existing pin', () => temporary(directory => {
  pinPlannerRecipe({ directory, defaultPolicy: 'legacy-short-v1' });
  const file = join(directory, 'planner-recipe.json'), before = readFileSync(file, 'utf8');
  assert.throws(() => pinPlannerRecipe({ directory, defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY, requiredPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY }), /POLICY_MISMATCH/);
  assert.throws(() => pinPlannerRecipe({ directory, defaultPolicy: 'legacy-short-v1', requiredHash: 'a'.repeat(64) }), /RECIPE_MISMATCH/);
  assert.equal(readFileSync(file, 'utf8'), before);
}));
test('read-only resolution does not create files and corrupt or unsupported pins fail closed', () => temporary(directory => {
  pinPlannerRecipe({ directory, defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY, persist: false });
  const file = join(directory, 'planner-recipe.json'); assert.equal(existsSync(file), false);
  writeFileSync(file, '{'); assert.throws(() => pinPlannerRecipe({ directory, defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY }), /PIN_INVALID/);
  writeFileSync(file, JSON.stringify({ schema_version: 1, planner_policy: 'missing-policy', recipe_sha256: 'a'.repeat(64) }));
  assert.throws(() => pinPlannerRecipe({ directory, defaultPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY }), /POLICY_UNSUPPORTED/);
}));
