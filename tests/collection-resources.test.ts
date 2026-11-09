import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionResourceNotice, memoryPauseMessage, type CollectionResources } from '../src/shared/collection-resources.js';
import type { PlatformRun, RunState } from '../src/shared/production-api.js';

test('memory waiting is distinct from active collection and old status is ignored after pause', () => {
  const resources: CollectionResources = { active: 0, queued: 63, automaticLimit: 1, activeProfiles: 0,
    freeBytes: 800e6, totalBytes: 12e9, cpuBusy: .1, pressureSince: null,
    admission: 'WAITING_MEMORY', memoryWaitMs: 5000, sampledAt: 1234 };
  const source: PlatformRun = { platform: 'facebook', profileId: 'fixture', state: 'RUNNING', count: 0, reason: null, resources };
  const run: Pick<RunState, 'state' | 'platforms'> = { state: 'RUNNING', platforms: [source] };
  assert.match(collectionResourceNotice(run)!, /chờ RAM/);
  resources.active = 1; assert.equal(collectionResourceNotice(run), null);
  resources.admission = 'SERIAL_MEMORY'; assert.match(collectionResourceNotice(run)!, /lần lượt/);
  run.state = 'STOPPED'; assert.equal(collectionResourceNotice(run), null);
  assert.match(memoryPauseMessage, /Tiếp tục lượt này/);
  assert.equal(collectionResourceNotice(null), null);
});
