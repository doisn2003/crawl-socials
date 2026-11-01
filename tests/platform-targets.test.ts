import assert from 'node:assert/strict';
import test from 'node:test';
import { allocatePlatformTargets } from '../src/shared/platform-targets.js';
import type { Platform } from '../src/shared/production-api.js';

test('mixed 80:20 and 70:30 targets preserve the total, including odd totals and a single output', () => {
  const platforms = ['facebook', 'threads'] as const;
  assert.deepEqual(allocatePlatformTargets(1000, { threads: 0.8, facebook: 0.2 }, platforms), { threads: 800, facebook: 200 });
  assert.deepEqual(allocatePlatformTargets(1001, { threads: 0.8, facebook: 0.2 }, platforms), { threads: 801, facebook: 200 });
  assert.deepEqual(allocatePlatformTargets(1000, { threads: 0.7, facebook: 0.3 }, platforms), { threads: 700, facebook: 300 });
  assert.deepEqual(allocatePlatformTargets(1001, { threads: 0.7, facebook: 0.3 }, platforms), { threads: 701, facebook: 300 });
  assert.deepEqual(allocatePlatformTargets(1, { threads: 0.8, facebook: 0.2 }, platforms), { threads: 1, facebook: 0 });
  assert.deepEqual(allocatePlatformTargets(1, { threads: 0.5, facebook: 0.5 }, platforms), { threads: 1, facebook: 0 });
});

test('a single selected platform receives the entire target even if its configured mixed weight is zero', () => {
  assert.deepEqual(allocatePlatformTargets(1001, { threads: 0.8, facebook: 0.2 }, ['facebook']), { threads: 0, facebook: 1001 });
  assert.deepEqual(allocatePlatformTargets(1001, { threads: 0, facebook: 1 }, ['threads']), { threads: 1001, facebook: 0 });
});

test('allocation is order-independent, non-mutating, finite and exact through the largest safe integer', () => {
  for (const total of [1, 3, 5, 1001, 3001, Number.MAX_SAFE_INTEGER]) {
    for (const share of [0, 0.5, 0.7, 0.8, 1]) {
      const weights = Object.freeze({ threads: share, facebook: 1 - share });
      const platforms = Object.freeze(['threads', 'facebook'] as const);
      const allocation = allocatePlatformTargets(total, weights, platforms);
      assert.ok(Number.isSafeInteger(allocation.threads) && allocation.threads >= 0);
      assert.ok(Number.isSafeInteger(allocation.facebook) && allocation.facebook >= 0);
      assert.equal(allocation.threads + allocation.facebook, total);
      assert.deepEqual(allocation, allocatePlatformTargets(total, weights, ['facebook', 'threads']));
    }
  }
});

test('invalid totals, malformed weights and unsupported or duplicate selections fail closed', () => {
  const weights = { threads: 0.8, facebook: 0.2 };
  for (const total of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1000', null, undefined]) {
    assert.throws(() => allocatePlatformTargets(total as number, weights, ['threads', 'facebook']), /PLATFORM_TARGETS_INVALID/);
  }
  for (const invalid of [null, undefined, [], {}, { threads: 0.8 }, { threads: NaN, facebook: 0.2 },
    { threads: 0.8, facebook: Infinity }, { threads: -0.1, facebook: 1.1 }, { threads: 1.1, facebook: -0.1 },
    { threads: 0.8, facebook: 0.3 }, { threads: '0.8', facebook: 0.2 }, { threads: 0, facebook: 0 }]) {
    assert.throws(() => allocatePlatformTargets(1000, invalid as Record<Platform, number>, ['threads', 'facebook']), /PLATFORM_TARGETS_INVALID/);
  }
  for (const invalid of [null, undefined, [], ['threads', 'threads'], ['facebook', 'facebook'], ['unknown'], ['threads', 'facebook', 'threads'], 'threads']) {
    assert.throws(() => allocatePlatformTargets(1000, weights, invalid as Platform[]), /PLATFORM_TARGETS_INVALID/);
  }
});
