import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertStarterUpdateConfig, readStarterFeed, starterReleaseAsset, starterUpdateUrl } from '../src/infrastructure/managed/starter-release.js';

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

test('the Windows download path serves the active release and older blockmaps by numeric version', () => {
  const version = '0.10.0';
  assert.deepEqual(starterReleaseAsset(version, ''), { version, filename: 'FindLink-Starter-0.10.0-Setup.exe' });
  assert.deepEqual(starterReleaseAsset(version, 'latest.yml'), { version, filename: 'latest.yml' });
  assert.deepEqual(starterReleaseAsset(version, filename + '.blockmap'), { version: '0.5.1', filename: filename + '.blockmap' });
  for (const invalid of ['FindLink-Starter-0.10.1-Setup.exe', 'FindLink-Starter-00.1.1-Setup.exe',
    'FindLink-Starter-QA-0.10.0-Setup.exe', 'FindLink-Starter-0.0.0-Setup.exe%2F..', 'https://other.example/latest.yml']) {
    assert.equal(starterReleaseAsset(version, invalid), null);
  }
});
