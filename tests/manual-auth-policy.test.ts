import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPolicy, ownedRequestContext } from '../src/infrastructure/browser/navigation-policy.js';
const topLevelUrl = 'https://www.facebook.com/two_step_verification/';
test('manual owned Facebook context permits Instagram xhr and fbsbx frame/resources only', () => {
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  assert.equal(policy.resourceAllowed('https://i.instagram.com/auth', { topLevelUrl, resourceType: 'xhr' }), true);
  for (const resourceType of ['subFrame', 'script', 'stylesheet', 'image', 'font', 'xhr', 'media']) {
    assert.equal(policy.resourceAllowed('https://auth.fbsbx.com/dependency', { topLevelUrl, resourceType }), true);
  }
  assert.equal(policy.navigationAllowed('https://auth.fbsbx.com/frame', { topLevelUrl, resourceType: 'subFrame' }), true);
  assert.equal(policy.navigationAllowed('https://www.instagram.com/', { topLevelUrl, resourceType: 'mainFrame' }), false);
  assert.equal(policy.navigationAllowed('https://auth.fbsbx.com/', { topLevelUrl, resourceType: 'mainFrame' }), false);
  assert.equal(policy.resourceAllowed('https://i.instagram.com/', { topLevelUrl, resourceType: 'mainFrame' }), false);
  for (const resourceType of ['script', 'image', 'subFrame', 'other', 'webSocket']) {
    assert.equal(policy.resourceAllowed('https://i.instagram.com/auth', { topLevelUrl, resourceType }), false);
  }
});
test('dependency grants require manual login and HTTPS Facebook top context; no lookalikes, unsafe schemes or credentials', () => {
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  for (const source of ['about:blank', 'https://auth.fbsbx.com/', 'https://www.instagram.com/', 'https://facebook.com.attacker.test/',
    'http://www.facebook.com/', 'https://user:pass@www.facebook.com/', 'https://www.facebook.com:444/']) {
    assert.equal(policy.resourceAllowed('https://i.instagram.com/auth', { topLevelUrl: source, resourceType: 'xhr' }), false);
    assert.equal(policy.navigationAllowed('https://auth.fbsbx.com/frame', { topLevelUrl: source, resourceType: 'subFrame' }), false);
  }
  for (const target of ['http://i.instagram.com/auth', 'https://instagram.com.attacker.test/auth', 'https://evilinstagram.com/auth',
    'https://name:pass@i.instagram.com/auth', 'https://i.instagram.com:444/auth', 'https://unrelated.com/auth']) {
    assert.equal(policy.resourceAllowed(target, { topLevelUrl, resourceType: 'xhr' }), false);
  }
  assert.equal(policy.resourceAllowed('https://i.instagram.com/auth'), false);
  for (const target of ['http://auth.fbsbx.com/frame', 'https://fbsbx.com.attacker.test/frame', 'https://evilfbsbx.com/frame']) {
    assert.equal(policy.navigationAllowed(target, { topLevelUrl, resourceType: 'subFrame' }), false);
    assert.equal(policy.resourceAllowed(target, { topLevelUrl, resourceType: 'subFrame' }), false);
  }
  assert.equal(createBrowserPolicy({ manualLoginEnabled: false }).resourceAllowed('https://i.instagram.com/auth', { topLevelUrl, resourceType: 'xhr' }), false);
  assert.equal(createBrowserPolicy({ manualLoginEnabled: true, fixtureOrigin: 'http://127.0.0.1:1234' })
    .resourceAllowed('https://i.instagram.com/auth', { topLevelUrl, resourceType: 'xhr' }), false);
});
test('native ownership resolver withholds context for foreign/closed/stale WebContents', () => {
  const native = { id: 7, isDestroyed: () => false, getURL: () => topLevelUrl };
  assert.deepEqual(ownedRequestContext(native, 7, 'xhr'), { topLevelUrl, resourceType: 'xhr' });
  assert.equal(ownedRequestContext(native, 8, 'xhr'), undefined);
  assert.equal(ownedRequestContext(native, undefined, 'xhr'), undefined);
  assert.equal(ownedRequestContext({ ...native, isDestroyed: () => true }, 7, 'xhr'), undefined);
  assert.equal(ownedRequestContext({ ...native, getURL: () => { throw new Error(); } }, 7, 'xhr'), undefined);
  assert.equal(ownedRequestContext(null, 7, 'xhr'), undefined);
});
test('reCAPTCHA rendering is confined to official HTTPS hosts/prefix and owned manual Facebook context', () => {
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  for (const resourceType of ['script', 'subFrame', 'xhr', 'image', 'media']) {
    assert.equal(policy.resourceAllowed('https://www.google.com/recaptcha/api2/dependency?private-marker', { topLevelUrl, resourceType }), true);
  }
  assert.equal(policy.resourceAllowed('https://www.google.com/recaptcha/enterprise.js', { topLevelUrl, resourceType: 'script' }), true);
  assert.equal(policy.resourceAllowed('https://www.gstatic.com/recaptcha/releases/script.js', { topLevelUrl, resourceType: 'script' }), true);
  for (const host of ['www.google.com', 'recaptcha.google.com']) {
    assert.equal(policy.navigationAllowed('https://' + host + '/recaptcha/api2/anchor', { topLevelUrl, resourceType: 'subFrame' }), true);
    assert.equal(policy.navigationAllowed('https://' + host + '/recaptcha/api2/anchor', { topLevelUrl, resourceType: 'mainFrame' }), false);
  }
  assert.equal(policy.resourceAllowed('https://www.gstatic.com/recaptcha/frame', { topLevelUrl, resourceType: 'subFrame' }), false);
  assert.equal(policy.resourceAllowed('https://www.google.com/recaptcha/api.js'), false);
  assert.equal(createBrowserPolicy({ manualLoginEnabled: false }).resourceAllowed('https://www.google.com/recaptcha/api.js', { topLevelUrl, resourceType: 'script' }), false);
  assert.equal(policy.resourceAllowed('https://www.google.com/recaptcha/api.js', { topLevelUrl: 'about:blank', resourceType: 'script' }), false);
});
test('reCAPTCHA exception denies general Google, lookalikes, traversal, unsafe scheme and top navigation', () => {
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  for (const target of ['https://www.google.com/search', 'https://www.gstatic.com/other.js', 'https://www.google.com/recaptcha-evil/api.js',
    'https://www.google.com/recaptcha/../search', 'https://www.google.com/recaptcha/%2e%2e/search',
    'https://www.google.com.attacker.test/recaptcha/api.js', 'https://other.google.com/recaptcha/api.js',
    'http://www.google.com/recaptcha/api.js', 'https://name:pass@www.google.com/recaptcha/api.js', 'https://www.google.com:444/recaptcha/api.js']) {
    assert.equal(policy.resourceAllowed(target, { topLevelUrl, resourceType: 'script' }), false, target);
  }
  assert.equal(policy.resourceAllowed('https://www.google.com/recaptcha/api.js', { topLevelUrl, resourceType: 'mainFrame' }), false);
  assert.equal(policy.navigationAllowed('https://www.google.com/recaptcha/api2/anchor', { topLevelUrl: 'https://auth.fbsbx.com/', resourceType: 'subFrame' }), false);
});
