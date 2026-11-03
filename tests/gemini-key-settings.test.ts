import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createGeminiKeySettings } from '../src/application/gemini-key-settings.js';
import { createEncryptedSecretStore } from '../src/infrastructure/secrets/encrypted-secret-store.js';

test('saved key is encrypted, survives restart, overrides environment and never appears in status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csd-key-test-')), encryptionKey = randomBytes(32);
  const store = () => createEncryptedSecretStore(dir, {
    available: async () => true,
    async encrypt(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    async decrypt(bytes) { const d = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(12, 28)); return { result: Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString(), shouldReEncrypt: false }; },
  });
  const key = 'test-credential-' + randomBytes(20).toString('hex');
  try {
    let settings = await createGeminiKeySettings(store(), () => 'environment-fixture');
    assert.equal(settings.status().source, 'ENVIRONMENT');
    await settings.save({ key: ' ' + key + ' ' });
    assert.equal(settings.current(), key);
    assert.equal(JSON.stringify(settings.status()).includes(key), false);
    const files = await readdir(dir); assert.equal(files.length, 1);
    assert.equal((await readFile(join(dir, files[0]!))).includes(Buffer.from(key)), false);
    settings = await createGeminiKeySettings(store(), () => 'environment-fixture');
    assert.equal(settings.current(), key); assert.equal(settings.status().source, 'SAVED');
    await settings.remove(); assert.equal(settings.current(), 'environment-fixture'); assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad payloads fail before persistence; store failures never echo secrets or replace the last usable key', async () => {
  let value: string | null = 'previous-valid-credential', fail = false;
  const settings = await createGeminiKeySettings({ get: async () => value,
    set: async (_id, key) => { if (fail) throw Error(key); value = key; },
    delete: async () => { throw Error('private-provider-error'); } }, () => null);
  for (const input of [null, [], { key: 'short' }, { key: 'twenty spaces are forbidden' }, { key: 'x'.repeat(513) }, { key: 'x'.repeat(30), extra: true }]) {
    await assert.rejects(settings.save(input), /^Error: GEMINI_KEY_INPUT_INVALID$/);
  }
  fail = true;
  await assert.rejects(settings.save({ key: 'replacement-valid-credential' }), /^Error: GEMINI_KEY_SAVE_FAILED$/);
  assert.equal(settings.current(), 'previous-valid-credential');
  await assert.rejects(settings.remove(), /^Error: GEMINI_KEY_DELETE_FAILED$/);
  assert.equal(settings.current(), 'previous-valid-credential');
});

test('unreadable machine-encrypted key leaves application usable and can be replaced locally', async () => {
  const settings = await createGeminiKeySettings({ get: async () => { throw Error('cannot decrypt'); }, set: async () => {}, delete: async () => {} }, () => null);
  assert.deepEqual(settings.status(), { source: 'NONE', readError: true });
  await settings.save({ key: 'replacement-valid-credential' });
  assert.deepEqual(settings.status(), { source: 'SAVED', readError: false });
});

test('desktop prefers the environment credential without deleting a saved fallback or exposing either', async () => {
  let environment: string | null = 'environment-fixture';
  const settings = await createGeminiKeySettings({ get: async () => 'saved-fixture',
    set: async () => { throw Error('must not overwrite'); }, delete: async () => { throw Error('must not delete'); } },
  () => environment, { preferEnvironment: true });
  assert.equal(settings.current(), 'environment-fixture');
  assert.deepEqual(settings.status(), { source: 'ENVIRONMENT', readError: false });
  environment = null;
  assert.equal(settings.current(), 'saved-fixture');
  assert.deepEqual(settings.status(), { source: 'SAVED', readError: false });
});
