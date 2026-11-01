import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOpportunityRunnerOptions, selectOpportunityRunnerProfiles } from '../scripts/opportunity-runner-options.mjs';

const fb = 'csd-11111111-1111-4111-8111-111111111111';
const alt = 'csd-22222222-2222-4222-8222-222222222222';
const th = 'csd-33333333-3333-4333-8333-333333333333';
const accounts = [
  { platform: 'facebook', id: alt, authenticated: true, persistenceError: null },
  { platform: 'facebook', id: fb, authenticated: true, persistenceError: null },
  { platform: 'threads', id: th, authenticated: true, persistenceError: null },
];

test('CLI optional initial minutes accept bounded integers without changing the UI opportunity schema', () => {
  assert.deepEqual(parseOpportunityRunnerOptions(null), {});
  assert.deepEqual(parseOpportunityRunnerOptions({ opportunity: {}, maxRunMinutes: 37 }), { maxRunMinutes: 37 });
  for (const value of [1, 240]) assert.equal(parseOpportunityRunnerOptions({ maxRunMinutes: value }).maxRunMinutes, value);
  for (const value of [0, -1, 241, 1.5, NaN, Infinity, '15', null]) assert.throws(() => parseOpportunityRunnerOptions({ maxRunMinutes: value }), /CAMPAIGN_RUN_MINUTES_INVALID/);
});

test('explicit profiles choose exact accounts and never fall back when authentication or persistence is unavailable', () => {
  const selected = [{ platform: 'threads', profileId: th }, { platform: 'facebook', profileId: fb }];
  assert.deepEqual(selectOpportunityRunnerProfiles(accounts, { facebook: fb, threads: th }), selected);
  for (const unavailable of [{ authenticated: false }, { persistenceError: 'SESSION_RECOVERY_REQUIRED' }]) {
    const changed = accounts.map(account => account.id === fb ? { ...account, ...unavailable } : account);
    assert.throws(() => selectOpportunityRunnerProfiles(changed, { facebook: fb }), /FACEBOOK_LOGIN_REQUIRED/);
  }
  assert.throws(() => selectOpportunityRunnerProfiles(accounts.filter(account => account.id !== fb), { facebook: fb }), /FACEBOOK_LOGIN_REQUIRED/);
  assert.throws(() => selectOpportunityRunnerProfiles(accounts, { threads: fb }), /THREADS_LOGIN_REQUIRED/);
  assert.deepEqual(selectOpportunityRunnerProfiles(accounts), [{ platform: 'threads', profileId: th }, { platform: 'facebook', profileId: alt }]);
  assert.deepEqual(selectOpportunityRunnerProfiles(accounts, { facebook: fb }), selected);
});

test('CLI profile selection rejects malformed maps before account access and copies caller-owned controls', () => {
  for (const profiles of [null, [], {}, { other: fb }, { facebook: 'anything' }, { facebook: 1 }, { threads: th, other: fb }]) {
    assert.throws(() => parseOpportunityRunnerOptions({ profiles }), /CAMPAIGN_PROFILE_SELECTION_INVALID/);
  }
  const input = { maxRunMinutes: 15, profiles: { facebook: fb } }, parsed = parseOpportunityRunnerOptions(input);
  input.profiles.facebook = alt;
  assert.equal(parsed.profiles.facebook, fb);
});
