import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserConfigStore, parseUserConfig } from '../src/infrastructure/config/user-config.js';

const opportunity = { enabled: true, prompt: 'Tìm cuộc thảo luận về quán cafe', brandContext: '', totalTarget: 1000,
  threadsShare: 0.8, rawCap: 3000, budgetUsd: 3, commentsEnabled: true };
test('opportunity migration preserves legacy raw target and backs up original configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csd-opportunity-config-'));
  try {
    const store = createUserConfigStore(dir), legacy = { keywords: ['cafe'], minimumPosts: 123 };
    store.save(legacy);
    const upgraded = store.save({ ...legacy, schemaVersion: 2, opportunity });
    assert.equal(upgraded.minimumPosts, 123);
    assert.equal(upgraded.opportunity?.totalTarget, 1000);
    assert.equal(upgraded.opportunity?.threadsShare, 0.8);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'user-config.json.v1.backup'), 'utf8')), legacy);
    assert.deepEqual(createUserConfigStore(dir).read(), upgraded);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('opportunity budget, ratio and total caps validate before saving', () => {
  const base = { keywords: [], minimumPosts: 1000, schemaVersion: 2, opportunity };
  assert.equal(parseUserConfig(base).opportunity?.totalTarget, 1000);
  for (const patch of [{ totalTarget: 0 }, { threadsShare: 1 }, { rawCap: 999 }, { budgetUsd: NaN }, { budgetUsd: 0 },
    { prompt: '' }, { commentsEnabled: 'yes' }, { unknown: true }]) {
    assert.throws(() => parseUserConfig({ ...base, opportunity: { ...opportunity, ...patch } }), /CONFIG_INVALID/);
  }
});
