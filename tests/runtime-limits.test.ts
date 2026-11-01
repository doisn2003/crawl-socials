import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { readEffectiveLimits, recordRawCapExtension } from '../src/application/runtime-limits.js';

const campaign = () => literalCampaign({ campaign_id: 'limits-test', prompt: 'Tìm quán cafe', seed_queries: ['quán cafe'], raw_cap: 3000, model_usd: 3 });
const args = (directory: string, plan = campaign()) => ({ directory, campaign: plan, expectedFromCap: 3000, toRawCap: 3500,
  reason: 'TOTAL_GOAL_SHORTFALL', observedCounts: { raw: 3000, suitable: 920, pending: 0 }, now: new Date('2026-10-30T15:00:00Z') });

test('raw cap extends through an audited chain while the original campaign and model budget remain unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-runtime-limits-')), plan = campaign();
  try {
    const original = JSON.stringify(plan); writeFileSync(join(dir, 'campaign.json'), original);
    const initial = readEffectiveLimits(dir, plan); assert.equal(initial.effective_raw_cap, 3000); assert.equal(initial.override_count, 0);
    assert.equal(existsSync(join(dir, 'runtime-limit-overrides.jsonl')), false);
    const first = recordRawCapExtension(args(dir, plan)); const firstBytes = readFileSync(join(dir, 'runtime-limit-overrides.jsonl'), 'utf8');
    assert.equal(first.original_raw_cap, 3000); assert.equal(first.effective_raw_cap, 3500); assert.equal(first.model_budget_usd, 3);
    const second = recordRawCapExtension({ ...args(dir, plan), expectedFromCap: 3500, toRawCap: 4000, now: new Date('2026-10-30T16:00:00Z') });
    assert.equal(second.override_count, 2); assert.equal(second.effective_raw_cap, 4000); assert.equal(second.campaign_sha256, initial.campaign_sha256);
    assert.ok(readFileSync(join(dir, 'runtime-limit-overrides.jsonl'), 'utf8').startsWith(firstBytes));
    assert.equal(readFileSync(join(dir, 'campaign.json'), 'utf8'), original); assert.equal(JSON.stringify(plan), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stale expected cap, nonmonotonic or oversized changes and invalid observed counts cannot append', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-runtime-limits-')), plan = campaign();
  try {
    recordRawCapExtension(args(dir, plan)); const before = readFileSync(join(dir, 'runtime-limit-overrides.jsonl'), 'utf8');
    assert.throws(() => recordRawCapExtension(args(dir, plan)), /EXPECTED_CAP_MISMATCH/);
    assert.throws(() => recordRawCapExtension({ ...args(dir, plan), toRawCap: 100001 }), /EXTENSION_INVALID/);
    assert.throws(() => recordRawCapExtension({ ...args(dir, plan), toRawCap: 2999 }), /EXTENSION_INVALID/);
    assert.throws(() => recordRawCapExtension({ ...args(dir, plan), observedCounts: { raw: 10, suitable: 9, pending: 2 } }), /COUNTS_INVALID/);
    assert.equal(readFileSync(join(dir, 'runtime-limit-overrides.jsonl'), 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reader rejects changed campaign, broken chains and partial records without repairing history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-runtime-limits-')), plan = campaign();
  try {
    recordRawCapExtension(args(dir, plan)); const file = join(dir, 'runtime-limit-overrides.jsonl'), original = readFileSync(file, 'utf8');
    assert.throws(() => readEffectiveLimits(dir, { ...plan, prompt: 'changed' }), /CAMPAIGN_MISMATCH/);
    const altered = JSON.parse(original); altered.from_raw_cap = 2000; writeFileSync(file, JSON.stringify(altered) + '\n');
    assert.throws(() => readEffectiveLimits(dir, plan), /CHAIN_INVALID/);
    writeFileSync(file, original + '{partial'); const partial = readFileSync(file, 'utf8');
    assert.throws(() => readEffectiveLimits(dir, plan), /JOURNAL_INCOMPLETE/); assert.equal(readFileSync(file, 'utf8'), partial);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exclusive override lock refuses another writer and never deletes their lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-runtime-limits-'));
  try {
    const file = join(dir, '.runtime-limit-overrides.lock'); writeFileSync(file, 'another owner');
    assert.throws(() => recordRawCapExtension(args(dir)), /RUNTIME_LIMITS_BUSY/); assert.equal(readFileSync(file, 'utf8'), 'another owner');
    assert.equal(existsSync(join(dir, 'runtime-limit-overrides.jsonl')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
