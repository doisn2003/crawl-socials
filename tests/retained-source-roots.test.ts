import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { contentHash } from '../src/domain/conversation.js';
import { listRegisteredRetainedSourceRoots, registerRetainedSourceRoot, resolveRetainedSourceRoot } from '../src/application/retained-source-roots.js';

async function temporary(work: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-source-roots-'));
  try { await work(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-source-roots-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
function source(directory: string, name = 'source') {
  const path = join(directory, name); mkdirSync(join(path, 'collections'), { recursive: true }); return path;
}
const registryFile = (directory: string) => join(directory, 'retained-source-roots.json');

test('explicit registration pins a canonical source behind an opaque ID, and duplicate selection reuses it', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination'), selectedPath = source(fixture);
  assert.deepEqual(await listRegisteredRetainedSourceRoots({ directory }), []);
  const entry = await registerRetainedSourceRoot({ directory, selectedPath });
  assert.match(entry.id, /^source-root-[0-9a-f-]{36}$/u); assert.equal(entry.canonicalPath, await realpath(selectedPath));
  assert.equal(entry.label, 'source'); assert.ok(Number.isFinite(Date.parse(entry.selectedAt)));
  assert.deepEqual(Object.keys(entry).sort(), ['canonicalPath', 'id', 'label', 'selectedAt']);
  const before = readFileSync(registryFile(directory));
  assert.deepEqual(await registerRetainedSourceRoot({ directory, selectedPath: join(selectedPath, '.') }), entry);
  assert.deepEqual(readFileSync(registryFile(directory)), before);
  assert.deepEqual(await listRegisteredRetainedSourceRoots({ directory }), [entry]);
  assert.equal(await resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), entry.canonicalPath);
  await assert.rejects(resolveRetainedSourceRoot({ directory, sourceRootId: '../source' }), /SOURCE_ROOT_ID_INVALID/);
  await assert.rejects(resolveRetainedSourceRoot({ directory, sourceRootId: 'source-root-00000000-0000-4000-8000-000000000000' }), /SOURCE_ROOT_NOT_FOUND/);
}));

test('explicitly chosen virtualized Windows-style application data is accepted without an inferred product allowlist', async () => temporary(async fixture => {
  const directory = join(fixture, 'ordinary-data');
  const selectedPath = source(fixture, join('Virtualized', 'Users', 'Admin', 'AppData', 'Roaming', 'csd-desktop'));
  const entry = await registerRetainedSourceRoot({ directory, selectedPath });
  assert.equal(await resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), await realpath(selectedPath));
}));

test('registration rejects missing, non-directory, collectionless and escaped-collections roots', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination'), file = join(fixture, 'file'), empty = join(fixture, 'empty');
  writeFileSync(file, 'not a directory'); mkdirSync(empty);
  await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath: join(fixture, 'missing') }), /SOURCE_ROOT_MISSING/);
  await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath: file }), /SOURCE_ROOT_NOT_DIRECTORY/);
  await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath: empty }), /SOURCE_ROOT_COLLECTIONS_REQUIRED/);
  await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath: 'relative-path' }), /SOURCE_ROOT_PATH_INVALID/);
  const outside = source(fixture, 'external'), junction = join(empty, 'collections');
  symlinkSync(join(outside, 'collections'), junction, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath: empty }), /SOURCE_ROOT_COLLECTIONS_INVALID/); }
  finally { unlinkSync(junction); }
  assert.deepEqual(await listRegisteredRetainedSourceRoots({ directory }), []);
}));

test('a chosen symlink is canonicalized, then a later retarget cannot redirect its registered ID', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination'), first = source(fixture, 'first'), second = source(fixture, 'second'), alias = join(fixture, 'selected-link');
  symlinkSync(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const entry = await registerRetainedSourceRoot({ directory, selectedPath: alias });
    assert.equal(entry.canonicalPath, await realpath(first));
    unlinkSync(alias); symlinkSync(second, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), /SOURCE_ROOT_CHANGED/);
    assert.equal((await listRegisteredRetainedSourceRoots({ directory }))[0]!.canonicalPath, entry.canonicalPath);
    const secondEntry = await registerRetainedSourceRoot({ directory, selectedPath: alias }); assert.notEqual(secondEntry.id, entry.id);
    // An explicit reselection of the original directory renews its route, never its identity.
    const firstAgain = await registerRetainedSourceRoot({ directory, selectedPath: first }); assert.deepEqual(firstAgain, entry);
    assert.equal(await resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), entry.canonicalPath);
  } finally { unlinkSync(alias); }
}));

test('replacing a registered directory at the same pathname is rejected despite having a collections folder', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination'), selectedPath = source(fixture), moved = join(fixture, 'original-moved');
  const entry = await registerRetainedSourceRoot({ directory, selectedPath });
  assert.equal(dirname(resolve(selectedPath)), resolve(fixture)); assert.equal(dirname(resolve(moved)), resolve(fixture));
  renameSync(selectedPath, moved); mkdirSync(join(selectedPath, 'collections'), { recursive: true });
  await assert.rejects(resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), /SOURCE_ROOT_CHANGED/);
  await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath }), /SOURCE_ROOT_CHANGED/);
  assert.equal((await listRegisteredRetainedSourceRoots({ directory }))[0]!.id, entry.id);
}));

test('registry hash mismatch, malformed records and oversized files fail closed without rewriting data', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination'), selectedPath = source(fixture), entry = await registerRetainedSourceRoot({ directory, selectedPath });
  const file = registryFile(directory), original = readFileSync(file, 'utf8'), wrapper = JSON.parse(original);
  const variants: string[] = ['{broken', 'x'.repeat(256 * 1024 + 1)];
  const changed = structuredClone(wrapper); changed.registry.entries[0].canonicalPath = join(fixture, 'other'); variants.push(JSON.stringify(changed));
  const duplicate = structuredClone(wrapper); duplicate.registry.entries.push(structuredClone(duplicate.registry.entries[0])); duplicate.sha256 = contentHash(duplicate.registry); variants.push(JSON.stringify(duplicate));
  const invalidId = structuredClone(wrapper); invalidId.registry.entries[0].id = '../outside'; invalidId.sha256 = contentHash(invalidId.registry); variants.push(JSON.stringify(invalidId));
  for (const bytes of variants) {
    writeFileSync(file, bytes);
    await assert.rejects(listRegisteredRetainedSourceRoots({ directory }), /SOURCE_ROOT_REGISTRY_INVALID/);
    await assert.rejects(resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), /SOURCE_ROOT_REGISTRY_INVALID/);
    await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath }), /SOURCE_ROOT_REGISTRY_INVALID/);
    assert.equal(readFileSync(file, 'utf8'), bytes);
  }
  writeFileSync(file, original); assert.equal(await resolveRetainedSourceRoot({ directory, sourceRootId: entry.id }), entry.canonicalPath);
}));

test('registry caps registered roots at 32 while a duplicate remains usable at the cap', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination');
  for (let index = 0; index < 32; index++) await registerRetainedSourceRoot({ directory, selectedPath: source(fixture, `source-${index}`) });
  const before = readFileSync(registryFile(directory));
  await assert.rejects(registerRetainedSourceRoot({ directory, selectedPath: source(fixture, 'over-cap') }), /SOURCE_ROOT_LIMIT/);
  assert.deepEqual(readFileSync(registryFile(directory)), before);
  const entries = await listRegisteredRetainedSourceRoots({ directory }); assert.equal(entries.length, 32);
  assert.equal((await registerRetainedSourceRoot({ directory, selectedPath: join(fixture, 'source-0') })).id, entries[0]!.id);
}));

test('simultaneous registrations serialize without losing distinct roots or duplicating one selected source', async () => temporary(async fixture => {
  const directory = join(fixture, 'destination'), first = source(fixture, 'first'), second = source(fixture, 'second');
  const entries = await Promise.all([registerRetainedSourceRoot({ directory, selectedPath: first }),
    registerRetainedSourceRoot({ directory, selectedPath: second }), registerRetainedSourceRoot({ directory, selectedPath: first })]);
  assert.equal(entries[0]!.id, entries[2]!.id); assert.notEqual(entries[0]!.id, entries[1]!.id);
  assert.equal((await listRegisteredRetainedSourceRoots({ directory })).length, 2);
}));
