import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { PolicyDiagnostics } from '../infrastructure/browser/policy-diagnostics.js';

export async function runPolicyDiagnosticSmoke(host: BrowserHost, diagnostics: PolicyDiagnostics, origin: string) {
  const checks: string[] = [];
  const profile = await host.create('Policy diagnostic fixture');
  await host.openFixture(profile.id, origin + '/two_step_verification/?token=synthetic-private-not-for-log');
  const contents = host.ownedContents(profile.id)!;
  await contents.executeJavaScript('window.runFixtures()');
  for (let i = 0; i < 100; i++) {
    const events = diagnostics.snapshot().events;
    if (events.some(event => event.kind === 'RESOURCE_COMPLETED' && event.statusCode === 503)
      && events.some(event => event.kind === 'RESOURCE_FAILED')) break;
    await sleep(10);
  }
  let events = diagnostics.snapshot().events;
  assert.ok(events.some(event => event.kind === 'NAVIGATION_COMMITTED' && event.location.pathCategory === 'TWO_STEP_VERIFICATION'));
  assert.ok(events.some(event => event.kind === 'REQUEST_BLOCKED' && event.location.origin === 'https://connect.facebook.net' && event.resourceType === 'script'));
  assert.ok(events.some(event => event.kind === 'RESOURCE_COMPLETED' && event.statusCode === 503));
  assert.ok(events.some(event => event.kind === 'RESOURCE_FAILED'));
  assert.ok(events.some(event => event.kind === 'POPUP_DENIED'));
  checks.push('ALLOWED_ROUTE_CATEGORY_BLOCKED_SCRIPT_HTTP_STATUS_NETWORK_FAILURE_POPUP_DISTINCT');
  // This is a synthetic location change in an isolated loopback view, never the live source view.
  await contents.executeJavaScript("location.href='https://www.facebook.com/two_step_verification/?token=synthetic-private-not-for-log';void 0");
  await sleep(30);
  assert.ok(diagnostics.snapshot().events.some(event => event.kind === 'NAVIGATION_BLOCKED'));
  checks.push('UNCONTROLLED_NAVIGATION_DENIAL_RECORDED_WITHOUT_URL_OR_QUERY');
  await assert.rejects(host.openFixture(profile.id, origin + '/slow?token=synthetic-private-not-for-log'), /BROWSER_LOAD_FAILED/);
  assert.ok(diagnostics.snapshot().priorityEvents.some(event => event.kind === 'HOST_NAVIGATION_TIMEOUT'));
  checks.push('REAL_INITIAL_LOAD_TIMEOUT_RECORDED_SEPARATELY_FROM_HTTP_AND_NETWORK');
  assert.equal(contents.debugger.isAttached(), false);
  await host.close(profile.id); diagnostics.publish();
  const snapshot = diagnostics.snapshot();
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes('synthetic-private'), false); assert.equal(encoded.includes('token='), false);
  assert.equal(snapshot.observerEnabled, false); assert.equal(snapshot.postsCollected, 0);
  checks.push('METADATA_ONLY_NO_DEBUGGER_OBSERVER_POSTS_OR_PRIVATE_MARKERS');
  return { result: 'PASS', mode: 'FIXTURE', task: 'MANUAL_SESSION_POLICY_DIAGNOSTICS', checks, diagnostics: snapshot,
    limitations: ['Loopback fixture only; not observed live Facebook network', 'Fixture denies every external origin; no claim those resources are needed by Facebook',
      'Current real session/window not read, reloaded, closed or restarted by this harness'] };
}
