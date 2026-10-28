import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createBrowserProfiles } from '../src/infrastructure/browser/profile-repository.js';
import { createBrowserPolicy } from '../src/infrastructure/browser/navigation-policy.js';
import { createSessionSnapshotJournal } from '../src/infrastructure/browser/session-snapshot-journal.js';
import { createEncryptedSecretStore } from '../src/infrastructure/secrets/encrypted-secret-store.js';
import { parseBrowserCommand } from '../src/main/browser-ipc-policy.js';
const id = 'csd-11111111-1111-4111-8111-111111111111';
async function temporary(work: (root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'csd-unit-'));
  try { await work(root); }
  finally { const target = resolve(root); assert.ok(dirname(target) === base && basename(target).startsWith('csd-unit-')); await rm(target, { recursive: true, force: true }); }
}
test('profile repository serializes concurrent creation, keeps IDs, and does not silently replace corrupt metadata', async () => temporary(async root => {
  const store = createBrowserProfiles(root);
  const created = await Promise.all([store.create('Phiên A'), store.create('Phiên B')]);
  assert.notEqual(created[0]!.id, created[1]!.id);
  const next = createBrowserProfiles(root); assert.deepEqual(await next.list(), created);
  assert.equal(created[0]!.accountBinding.status, 'UNVERIFIED');
  await writeFile(join(root, 'browser-profiles.json'), 'broken');
  await assert.rejects(store.create('New'), /PROFILE_STORE_INVALID/);
  assert.equal(await readFile(join(root, 'browser-profiles.json'), 'utf8'), 'broken');
}));
test('browser IPC accepts only exact payloads; no URL, cookie or script parameters', () => {
  assert.deepEqual(parseBrowserCommand('open', [{ profileId: id }]), { action: 'open', profileId: id });
  for (const args of [[{ profileId: id, url: 'https://facebook.com' }], [{ profileId: '../outside' }], [{ profileId: id, executeJavaScript: 'x' }], [id]]) {
    assert.throws(() => parseBrowserCommand('open', args), /BROWSER_INPUT_INVALID/);
  }
  assert.throws(() => parseBrowserCommand('list', [{ cookies: [] }]), /BROWSER_INPUT_INVALID/);
  assert.throws(() => parseBrowserCommand('create', [{ label: ' \n' }]));
});
test('browser URL policy rejects lookalikes, credentials, local files and unsafe schemes; fixture is exact loopback origin', () => {
  const offline = createBrowserPolicy({ manualLoginEnabled: false });
  assert.equal(offline.navigationAllowed('https://www.facebook.com/login/'), false);
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  assert.equal(policy.navigationAllowed('https://www.facebook.com/login/'), true);
  assert.equal(policy.resourceAllowed('https://static.fbcdn.net/a.js'), true);
  for (const url of ['https://facebook.com.evil.test/', 'https://user:pass@facebook.com/', 'file:///C:/secret', 'javascript:alert(1)', 'data:text/html,x', 'http://facebook.com/', 'https://facebook.com:444/', 'https://static.fbcdn.net/']) assert.equal(policy.navigationAllowed(url), false, url);
  const fixture = createBrowserPolicy({ manualLoginEnabled: false, fixtureOrigin: 'http://127.0.0.1:12345' });
  assert.equal(fixture.resourceAllowed('http://127.0.0.1:12345/state'), true);
  assert.equal(fixture.resourceAllowed('http://127.0.0.1:12346/state'), false);
  assert.throws(() => createBrowserPolicy({ manualLoginEnabled: true, fixtureOrigin: 'http://example.com' }), /FIXTURE_ORIGIN_INVALID/);
});
test('secret store encrypts before disk, rotates, rejects corrupted ciphertext and fails closed without crypto', async () => temporary(async root => {
  const key = randomBytes(32); let rotate = true;
  const store = createEncryptedSecretStore(join(root, 'vault'), {
    available: async () => true,
    encrypt: async value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: async bytes => { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); const result = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); const shouldReEncrypt = rotate; rotate = false; return { result, shouldReEncrypt }; },
  });
  await store.set('session:test', 'synthetic-secret');
  const name = (await readdir(join(root, 'vault')))[0]!;
  const before = await readFile(join(root, 'vault', name)); assert.equal(before.includes('synthetic-secret'), false);
  assert.equal(await store.get('session:test'), 'synthetic-secret');
  assert.notDeepEqual(await readFile(join(root, 'vault', name)), before);
  await writeFile(join(root, 'vault', name), 'corrupt');
  await assert.rejects(store.get('session:test'), /SECRET_READ_FAILED/);
  await assert.rejects(store.get('../outside'), /SECRET_KEY_INVALID/);
  const disabled = createEncryptedSecretStore(join(root, 'disabled'), { available: async () => false, encrypt: async () => { throw new Error(); }, decrypt: async () => { throw new Error(); } });
  await assert.rejects(disabled.set('session:test', 'synthetic-secret'), /SECRET_PROTECTION_UNAVAILABLE/);
  assert.equal((await readdir(root)).includes('disabled'), false);
}));
test('snapshot invalidation and incomplete-restore markers survive a new host owner', async () => temporary(async root => {
  const journal = createSessionSnapshotJournal(root); journal.markDirty(id); journal.beginRestore(id);
  const next = createSessionSnapshotJournal(root); assert.equal(next.dirty(id), true); assert.equal(next.recoveryRequired(id), true);
  next.finishRestore(id); assert.equal(next.recoveryRequired(id), false); assert.equal(next.dirty(id), true);
  next.clearDirty(id); assert.equal(next.dirty(id), false);
}));
