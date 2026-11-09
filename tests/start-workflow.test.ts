import assert from 'node:assert/strict';
import test from 'node:test';
import { planAndStart } from '../src/renderer/start-workflow.js';
import { filterModeAtPercent, restoreFilterPercent } from '../src/shared/filter-policy.js';
import { parseUserConfig } from '../src/infrastructure/config/user-config.js';
import type { ProductionState } from '../src/shared/production-api.js';
import type { CampaignDraftReference } from '../src/shared/campaign-drafts.js';

const reference: CampaignDraftReference = { runId: 'draft', revision: 'revision', configHash: 'hash' };
function harness() {
  let ref: CampaignDraftReference | undefined;
  const phases: string[] = [], starts: any[] = []; let prepares = 0;
  const state = { config: { keywords: [], minimumPosts: 10 }, accounts: [], run: null, version: 'fixture' } as ProductionState;
  const host = { profiles: [{ platform: 'facebook' as const, profileId: 'account' }], useAi: true,
    draftReference: () => ref, prepared: () => { ref = reference; }, phase: (phase: 'PLANNING' | 'STARTING') => { phases.push(phase); },
    api: { prepareCampaign: async () => { prepares++; return state; }, start: async (input: any) => { starts.push(input); return state; } },
  };
  return { host, state, phases, starts, get prepares() { return prepares; }, ready: () => { ref = reference; } };
}
test('a single action awaits preparation then starts once with the newly prepared revision', async () => {
  const h = harness(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const prepare = h.host.api.prepareCampaign;
  h.host.api.prepareCampaign = async () => { await held; return prepare(); };
  const pending = planAndStart(h.host); assert.deepEqual(h.phases, ['PLANNING']); assert.equal(h.starts.length, 0);
  release(); assert.equal((await pending).kind, 'STARTED');
  assert.equal(h.prepares, 1); assert.deepEqual(h.phases, ['PLANNING', 'STARTING']);
  assert.deepEqual(h.starts, [{ profiles: h.host.profiles, draft: reference }]);
});
test('OFF bypasses planning and starts without an AI draft', async () => {
  const h = harness(); h.host.useAi = false; await planAndStart(h.host);
  assert.equal(h.prepares, 0); assert.deepEqual(h.starts, [{ profiles: h.host.profiles }]);
});
test('a matching prepared plan starts without another planner request', async () => {
  const h = harness(); h.ready(); await planAndStart(h.host);
  assert.equal(h.prepares, 0); assert.equal(h.starts.length, 1);
});
test('required clarification pauses collection and can resume with the confirmed plan', async () => {
  const h = harness();
  h.host.api.prepareCampaign = async () => ({ ...h.state, campaignDialogue: { plan: { state: 'NEEDS_CLARIFICATION' } } } as ProductionState);
  assert.equal((await planAndStart(h.host)).kind, 'CLARIFICATION'); assert.equal(h.starts.length, 0);
  h.ready(); assert.equal((await planAndStart(h.host)).kind, 'STARTED'); assert.equal(h.starts.length, 1);
});
test('planner budget errors, unavailable drafts and transport errors never start a collector', async () => {
  const h = harness();
  h.host.api.prepareCampaign = async () => ({ ...h.state, campaignDraftError: { code: 'MODEL_BUDGET_EXHAUSTED' } } as ProductionState);
  await assert.rejects(planAndStart(h.host), /MODEL_BUDGET_EXHAUSTED/); assert.equal(h.starts.length, 0);
  const other = harness(); other.host.prepared = () => {};
  await assert.rejects(planAndStart(other.host), /CAMPAIGN_INTENT_UNRESOLVED/); assert.equal(other.starts.length, 0);
  other.host.api.prepareCampaign = async () => { throw Error('MODEL_NETWORK_USAGE_UNKNOWN'); };
  await assert.rejects(planAndStart(other.host), /MODEL_NETWORK_USAGE_UNKNOWN/); assert.equal(other.starts.length, 0);
});
test('all 101 percentage positions map to the agreed bands and persist with existing spending limits', () => {
  for (let percent = 0; percent <= 100; percent++) {
    const mode = percent <= 10 ? 'OFF' : percent <= 49 ? 'CONSISTENT' : percent <= 90 ? 'STANDARD' : 'QUALITY';
    assert.equal(filterModeAtPercent(percent), mode);
    const saved = parseUserConfig({ keywords: [], minimumPosts: 10, filterPercent: percent, spendLimits: { totalUsd: 2, dailyUsd: 1 } });
    assert.equal(saved.filterPercent, percent); assert.deepEqual(saved.spendLimits, { totalUsd: 2, dailyUsd: 1 });
    assert.equal(restoreFilterPercent(saved.filterPercent, mode), percent);
  }
  for (const filterPercent of [-1, 101, 21.5, '21', null]) assert.throws(() => parseUserConfig({ keywords: [], minimumPosts: 10, filterPercent }), /CONFIG_INVALID/);
});

test('slider restores named modes and preserves old Portable 5.3 choices at changed boundaries', () => {
  assert.equal(restoreFilterPercent(undefined), 25);
  assert.equal(restoreFilterPercent(undefined, 'QUALITY'), 100);
  assert.equal(restoreFilterPercent(17), 0);
  assert.equal(restoreFilterPercent(32), 50);
  assert.equal(restoreFilterPercent(88), 100);
  assert.equal(restoreFilterPercent(88, 'STANDARD'), 88);
  assert.equal(restoreFilterPercent(58, 'CONSISTENT'), 25);
});
