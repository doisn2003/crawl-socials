import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPolicyDiagnostics, diagnosticLocation } from '../src/infrastructure/browser/policy-diagnostics.js';
import { createPolicyDiagnosticFile } from '../src/infrastructure/browser/policy-diagnostics-file.js';
import { createBrowserPolicy } from '../src/infrastructure/browser/navigation-policy.js';

test('session diagnostics keep allowlisted origin/path categories, never dynamic URL data or fields', () => {
  const journal = createPolicyDiagnostics();
  const urls = ['https://www.facebook.com/two_step_verification/private-account-id/?token=private-marker#private-marker',
    'https://private-marker.facebook.com/private-marker?token=private-marker', 'https://private-marker.example/private-marker',
    'https://user:private-marker@www.facebook.com/login/', 'blob:https://www.facebook.com/private-marker',
    'data:text/html,private-marker', 'javascript:private-marker', 'https://www.facebook.com:444/private-marker',
    'https://connect.facebook.net/private-marker?token=private-marker'];
  for (const url of urls) journal.record('REQUEST_BLOCKED', { url, resourceType: 'script', networkError: 'private-marker' });
  const text = JSON.stringify(journal.snapshot());
  assert.equal(text.includes('private-marker'), false); assert.equal(text.includes('private-account-id'), false);
  assert.equal(text.includes('token='), false); assert.equal(text.includes('"url"'), false);
  assert.equal(journal.snapshot().events[0]!.location.pathCategory, 'TWO_STEP_VERIFICATION');
  assert.equal(journal.snapshot().events[0]!.location.origin, 'https://www.facebook.com');
  assert.equal(journal.snapshot().events[1]!.location.origin, 'REDACTED_FACEBOOK');
  assert.equal(journal.snapshot().events.at(-1)!.location.origin, 'https://connect.facebook.net');
  assert.equal(diagnosticLocation('wss://edge.facebook.com/private-marker?token=private-marker').scheme, 'WSS');
  assert.equal(diagnosticLocation('https://facebook.com.attacker.test/private-marker').family, 'OTHER');
});
test('bounded ring retains priority denies, detached snapshots and safe status/error enums', () => {
  const journal = createPolicyDiagnostics({ maxEvents: 4 });
  journal.record('REQUEST_BLOCKED', { url: 'https://connect.facebook.net/private', resourceType: 'script' });
  for (let i = 0; i < 20; i++) journal.record('RESOURCE_COMPLETED', { url: 'https://www.facebook.com/', statusCode: 200 });
  const first = journal.snapshot(); assert.equal(first.events.length, 4); assert.equal(first.droppedOldEvents, 17);
  assert.equal(first.priorityEvents.length, 1); assert.equal(first.counts.REQUEST_BLOCKED, 1);
  first.priorityEvents[0]!.location.origin = 'mutated'; first.counts.REQUEST_BLOCKED = 999;
  assert.equal(journal.snapshot().priorityEvents[0]!.location.origin, 'https://connect.facebook.net');
  assert.equal(journal.snapshot().counts.REQUEST_BLOCKED, 1);
  journal.record('RESOURCE_FAILED', { statusCode: NaN, errorCode: -105, networkError: 'net::ERR_NAME_NOT_RESOLVED', resourceType: ['script'] });
  const last = journal.snapshot().events.at(-1)!;
  assert.equal(last.statusCode, null); assert.equal(last.errorCode, -105); assert.equal(last.resourceType, 'other');
  assert.equal(last.networkError, 'net::ERR_NAME_NOT_RESOLVED');
  assert.equal(journal.snapshot().observerEnabled, false); assert.equal(journal.snapshot().postsCollected, 0);
});
test('journal publish failure cannot escape to the browser request callback', () => {
  const journal = createPolicyDiagnostics({ publish() { throw new Error('private-marker'); } });
  journal.record('HOST_NAVIGATION_TIMEOUT', { url: 'https://www.facebook.com/login/?private-marker' });
  assert.doesNotThrow(() => journal.publish()); assert.equal(journal.snapshot().publishFailures, 1);
  assert.equal(JSON.stringify(journal.snapshot()).includes('private-marker'), false);
});
test('diagnostic file is bounded metadata and refuses symlink output without leaking target data', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-policy-test-'));
  try {
    const journal = createPolicyDiagnosticFile(root);
    for (let i = 0; i < 1000; i++) journal.record('REQUEST_BLOCKED', { url: 'https://www.facebook.com/private-marker?token=private-marker' });
    journal.publish(); const file = join(root, 'browser-policy-diagnostics-v2.json');
    const bytes = readFileSync(file); assert.ok(bytes.length <= 128 * 1024);
    assert.equal(bytes.includes(Buffer.from('private-marker')), false);
    const data = JSON.parse(bytes.toString('utf8'));
    assert.equal(data.retentionCleanup, 'MANUAL_REQUIRED_NO_SCHEDULER'); assert.equal(data.events.length, 128);
    assert.equal(data.priorityEvents.length, 32);
    rmSync(file); const target = join(root, 'target.txt'); writeFileSync(target, 'sentinel');
    // Hardlink/symlink output protection does not depend on access to any real profile.
    if (process.platform === 'win32') linkSync(target, file); else symlinkSync(target, file);
    journal.publish();
    assert.equal(readFileSync(target, 'utf8'), 'sentinel'); assert.equal(journal.snapshot().publishFailures, 1);
  } finally { assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'csd-policy-test-'))); rmSync(root, { recursive: true, force: true }); }
});
test('no access-policy expansion: verification path allowed, external families/schemes remain denied', () => {
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  assert.equal(policy.navigationAllowed('https://www.facebook.com/two_step_verification/'), true);
  assert.equal(policy.resourceAllowed('https://static.xx.fbcdn.net/rsrc.php/a.js'), true);
  assert.equal(policy.navigationAllowed('https://static.xx.fbcdn.net/frame'), false);
  for (const url of ['https://connect.facebook.net/a.js', 'https://www.gstatic.com/a.js', 'blob:https://www.facebook.com/id',
    'data:text/html,x', 'about:srcdoc', 'wss://edge.facebook.com/']) assert.equal(policy.resourceAllowed(url), false);
  assert.equal(policy.resourceAllowed('about:blank'), true);
});
