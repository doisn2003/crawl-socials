import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createBootstrapService } from '../src/application/bootstrap-service.js';
import { createCampaignValidator } from '../src/infrastructure/config/campaign-validator.js';
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const validator = createCampaignValidator(read('.brain/specs/campaign.schema.json') as object);
const campaign = read('.brain/specs/campaign.coffee.json');
const offlineFixture = read('tests/fixtures/campaign.offline.json');
const create = () => createBootstrapService({ validator, campaign, offlineFixture, version: 'test' });

test('preview preserves all three source requirements and Hanoi is a preference', () => {
  const info = create().getInfo();
  assert.equal(info.benchmarkReady, false);
  assert.deepEqual(info.campaign.preferredPlaces, ['Hà Nội']);
  assert.deepEqual(info.campaign.sources, [
    { type: 'PAGE', minimum: 1 }, { type: 'PUBLIC_GROUP', minimum: 1 }, { type: 'PUBLIC_PERSONAL', minimum: 1 },
  ]);
  assert.equal(info.campaign.target, 1000);
  assert.equal(info.campaign.maxHours, 24);
});
test('fixture can never increase valid live-post count', () => {
  assert.deepEqual(create().runOfflineCheck(), {
    captureMode: 'FIXTURE', configurationValid: true, benchmarkEligible: false, verifiedValidUniquePosts: 0,
  });
});
test('application refuses to treat confirmed campaign as the offline fixture', () => {
  const service = createBootstrapService({ validator, campaign, offlineFixture: campaign, version: 'test' });
  assert.throws(() => service.runOfflineCheck(), /OFFLINE_FIXTURE_REQUIRED/);
});
test('invalid configuration fails with a fixed error, without leaking arbitrary content', () => {
  assert.throws(() => validator.parse({ access_token: 'synthetic-only' }), error => {
    assert.equal((error as Error).message, 'CAMPAIGN_SCHEMA_INVALID'); return true;
  });
});
test('preview is detached from caller and renderer mutations', () => {
  const input = structuredClone(campaign) as { workload: { keywords: string[] } };
  const service = createBootstrapService({ validator, campaign: input, offlineFixture, version: 'test' });
  const original = service.getInfo().campaign.keywords;
  input.workload.keywords.length = 0;
  service.getInfo().campaign.keywords.length = 0;
  assert.deepEqual(service.getInfo().campaign.keywords, original);
});
test('R01: RANGE rejects reversed and equal bounds; accepts nonempty UTC interval', () => {
  for (const to of ['2020-01-01T00:00:00Z', '2026-10-27T00:00:00Z']) {
    const input = structuredClone(campaign) as { historical_window: unknown };
    input.historical_window = { mode: 'RANGE', from_utc: '2026-10-27T00:00:00Z', to_utc: to };
    assert.throws(() => validator.parse(input), error => {
      assert.equal((error as Error).message, 'CAMPAIGN_RANGE_INVALID'); return true;
    });
  }
  const valid = structuredClone(campaign) as { historical_window: unknown };
  valid.historical_window = { mode: 'RANGE', from_utc: '2026-10-27T00:00:00Z', to_utc: '2026-10-27T00:00:00.001Z' };
  assert.doesNotThrow(() => validator.parse(valid));
});
