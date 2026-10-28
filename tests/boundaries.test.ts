import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runtimePaths, isInside } from '../src/infrastructure/config/runtime-paths.js';
import { allowDesktopRequest } from '../src/main/ipc-policy.js';
const request = { senderId: 1, expectedSenderId: 1, isMainFrame: true,
  frameUrl: 'file:///C:/csd/dist/renderer/index.html', expectedUrl: 'file:///C:/csd/dist/renderer/index.html', args: [] as unknown[] };

test('runtime data uses CSD namespace and never the unrelated sibling application', () => {
  const base = resolve('synthetic-appdata');
  const paths = runtimePaths(base);
  assert.equal(paths.userData, join(base, 'csd-desktop'));
  for (const value of Object.values(paths)) {
    assert.ok(isInside(join(base, 'csd-desktop'), value));
    assert.equal(isInside(join(base, 'hotmatch-desktop'), value), false);
  }
  assert.equal(isInside(base, join(base, '..', 'other')), false);
  assert.equal(isInside(base, base + '-sibling'), false);
});
test('only exact local UI main frame with empty payload can invoke bridge', () => {
  assert.equal(allowDesktopRequest(request), true);
  assert.equal(allowDesktopRequest({ ...request, senderId: 2 }), false);
  assert.equal(allowDesktopRequest({ ...request, isMainFrame: false }), false);
  assert.equal(allowDesktopRequest({ ...request, frameUrl: 'https://www.facebook.com/' }), false);
  assert.equal(allowDesktopRequest({ ...request, frameUrl: request.frameUrl + '?spoof=1' }), false);
  assert.equal(allowDesktopRequest({ ...request, args: [{ action: 'arbitrary' }] }), false);
});
test('smoke override refuses an arbitrary existing directory', () => {
  const unrelated = mkdtempSync(join(tmpdir(), 'unrelated-app-'));
  try { assert.throws(() => runtimePaths(resolve('synthetic-appdata'), unrelated), /SMOKE_ROOT_DENIED/); }
  finally { rmdirSync(unrelated); }
});
