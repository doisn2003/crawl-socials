import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertStarterUpdateConfig, readStarterFeed, starterUpdateUrl } from '../src/infrastructure/managed/starter-release.js';

const url = 'https://findlink.example/downloads/windows/';
const publisher = 'FindLink Publisher';
const filename = 'FindLink-Starter-0.5.1-Setup.exe';
const sha512 = createHash('sha512').update('installer fixture').digest('base64');
const info = { version: '0.5.1', files: [{ url: filename, size: 17, sha512 }], path: filename, sha512 };

test('packaged update configuration requires the pinned publisher and HTTPS feed', () => {
  const input = 'provider: generic\nchannel: latest\nurl: ' + url + '\npublisherName:\n  - ' + publisher;
  assert.doesNotThrow(() => assertStarterUpdateConfig(input, { url, publisher }));
  assert.equal(starterUpdateUrl(url.slice(0, -1)).href, url);
  assert.throws(() => assertStarterUpdateConfig(input.split('\npublisherName')[0]!, { url, publisher }), /UPDATE_PUBLISHER_INVALID/);
  assert.throws(() => assertStarterUpdateConfig(input + '\n  - Another Publisher', { url, publisher }), /UPDATE_PUBLISHER_INVALID/);
  assert.throws(() => assertStarterUpdateConfig(input, { url, publisher: 'Other Publisher' }), /UPDATE_PUBLISHER_INVALID/);
  assert.throws(() => assertStarterUpdateConfig(input, { url: 'https://other.example/', publisher }), /UPDATE_CONFIG_INVALID/);
  assert.throws(() => starterUpdateUrl('http://findlink.example/'), /UPDATE_FEED_INVALID/);
  assert.throws(() => starterUpdateUrl(url + '?key=fixture'), /UPDATE_FEED_INVALID/);
});

test('the Starter feed identifies exactly one versioned public installer', () => {
  assert.deepEqual(readStarterFeed(JSON.stringify(info), '0.5.1'), { version: '0.5.1', filename, size: 17, sha512 });
  assert.throws(() => readStarterFeed(JSON.stringify(info), '0.5.2'), /RELEASE_UPDATE_VERSION_INVALID/);
  for (const file of [
    { ...info.files[0], url: 'https://other.example/setup.exe' },
    { ...info.files[0], url: '../' + filename },
    { ...info.files[0], url: 'FindLink-Starter-QA-0.5.1-Setup.exe' },
    { ...info.files[0], sha512: 'invalid' },
    { ...info.files[0], size: 0 },
  ]) assert.throws(() => readStarterFeed(JSON.stringify({ ...info, files: [file] })), /RELEASE_UPDATE_METADATA_INVALID/);
  assert.throws(() => readStarterFeed(JSON.stringify({ ...info, files: [...info.files, ...info.files] })), /RELEASE_UPDATE_METADATA_INVALID/);
  assert.throws(() => readStarterFeed(JSON.stringify({ ...info, sha512: 'stale' })), /RELEASE_UPDATE_METADATA_INVALID/);
});
