import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createUserConfigStore, parseUserConfig } from '../src/infrastructure/config/user-config.js';

function temporary(work: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'csd-user-config-'));
  try { work(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('csd-user-config-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('new user configuration has no seeded keywords and saves an intentionally empty list', () => temporary(directory => {
  const store = createUserConfigStore(directory);
  assert.deepEqual(store.read(), { keywords: [], minimumPosts: 1000 });
  assert.equal(existsSync(join(directory, 'user-config.json')), false);
  assert.deepEqual(store.save({ keywords: [], minimumPosts: 17 }), { keywords: [], minimumPosts: 17 });
  assert.deepEqual(createUserConfigStore(directory).read(), { keywords: [], minimumPosts: 17 });
}));

test('legacy call caps migrate to money-only user settings without changing money or unrelated configuration', () => temporary(directory => {
  const store = createUserConfigStore(directory);
  const old = { keywords: ['người học tiếng Anh'], minimumPosts: 1000, spendLimits: { totalUsd: 3, dailyUsd: 2, maxCalls: 3 } };
  const expected = { ...old, spendLimits: { totalUsd: 3, dailyUsd: 2 } };
  const file = join(directory, 'user-config.json'); writeFileSync(file, JSON.stringify(old));
  assert.deepEqual(store.read(), expected);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).spendLimits.maxCalls, 3, 'reading does not rewrite original settings');
  assert.deepEqual(store.save(expected), expected);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), expected);
  for (const limits of [null, { totalUsd: 3 }, { totalUsd: -1, dailyUsd: 3 }, { totalUsd: 3, dailyUsd: 3, unknown: 1 }]) {
    assert.throws(() => store.save({ ...old, spendLimits: limits }), /CONFIG_INVALID/);
  }
}));

test('saved keywords trim, normalize Unicode and deduplicate without replacing the user topic', () => temporary(directory => {
  const store = createUserConfigStore(directory);
  const expected = { keywords: ['cà phê', 'quán nhỏ'], minimumPosts: 51 };
  assert.deepEqual(store.save({ keywords: ['  cà phê  ', 'cà phê', 'quán nhỏ'], minimumPosts: 51 }), expected);
  assert.deepEqual(createUserConfigStore(directory).read(), expected);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'user-config.json'), 'utf8')), expected);
}));

test('configuration rejects malformed values and unsupported targets before touching the saved file', () => temporary(directory => {
  const store = createUserConfigStore(directory);
  const original = { keywords: ['người dùng chọn'], minimumPosts: 10 };
  store.save(original);
  const invalid: unknown[] = [
    null, [], { keywords: [], minimumPosts: '10' }, { keywords: [], minimumPosts: 0 },
    { keywords: [], minimumPosts: 3001 }, { keywords: [], minimumPosts: 1.5 },
    { keywords: [], minimumPosts: 10, trial: true }, { keywords: [''], minimumPosts: 10 },
    { keywords: ['   '], minimumPosts: 10 }, { keywords: ['line\nbreak'], minimumPosts: 10 },
    { keywords: [17], minimumPosts: 10 }, { keywords: ['x'.repeat(201)], minimumPosts: 10 },
    { keywords: Array.from({ length: 101 }, (_, index) => String(index)), minimumPosts: 10 },
  ];
  for (const value of invalid) assert.throws(() => store.save(value), /CONFIG_INVALID/);
  assert.deepEqual(store.read(), original);
  assert.deepEqual(parseUserConfig({ keywords: ['x'], minimumPosts: 3000 }), { keywords: ['x'], minimumPosts: 3000 });
}));

test('write failure preserves the last saved config; corrupt files fail visibly instead of resetting user input', () => temporary(directory => {
  const file = join(directory, 'user-config.json'), store = createUserConfigStore(directory);
  store.save({ keywords: ['đã lưu'], minimumPosts: 4 });
  mkdirSync(file + '.next');
  assert.throws(() => store.save({ keywords: ['chưa lưu'], minimumPosts: 5 }));
  assert.deepEqual(store.read(), { keywords: ['đã lưu'], minimumPosts: 4 });
  writeFileSync(file, '{broken');
  assert.throws(() => store.read(), /CONFIG_READ_FAILED/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
}));
