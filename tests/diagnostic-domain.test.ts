import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticRegistrableDomain, DIAGNOSTIC_DOMAIN_POLICY } from '../src/infrastructure/browser/diagnostic-domain.js';
import { createPolicyDiagnostics, diagnosticLocation } from '../src/infrastructure/browser/policy-diagnostics.js';
import { createBrowserPolicy } from '../src/infrastructure/browser/navigation-policy.js';

test('ICANN registrable-domain handling includes multi-label suffixes, wildcards and exceptions', () => {
  for (const [host, expected] of [['api.wikipedia.org', 'wikipedia.org'], ['deep.bbc.co.uk', 'bbc.co.uk'],
    ['www.city.kawasaki.jp', 'city.kawasaki.jp'], ['www.ck', 'www.ck'], ['www.public.ck', 'www.public.ck']]) {
    assert.equal(diagnosticRegistrableDomain(host!), expected);
  }
});
test('PRIVATE tenant, account, bucket and dynamic labels are never retained', () => {
  for (const [host, expected] of [['private-marker.github.io', 'github.io'],
    ['account-123456.s3.amazonaws.com', 'amazonaws.com'], ['user-id.pages.dev', 'pages.dev'],
    ['session-987654.appspot.com', 'appspot.com'], ['private-marker.fbsbx.com', 'fbsbx.com']]) {
    assert.equal(diagnosticRegistrableDomain(host!), expected);
  }
});
test('IP, private/special-use names, unknown TLD, IDN, bare suffix and ID-like registrant are withheld', () => {
  for (const host of ['127.0.0.1', '[::1]', '10.1.2.3', 'localhost', 'printer.local', 'foo.invalid', 'foo.test',
    'foo.example', 'www.example.com', 'foo.onion', 'home.arpa', 'service.internal', 'co.uk', 'com',
    'xn--bcher-kva.de', 'site.xn--p1ai', 'www.12345678.ck', 'account-123456.com', '0123456789abcdef.com', 'session-abcdefabcdef.com', 'facebook.com.']) {
    assert.equal(diagnosticRegistrableDomain(host), null, host);
  }
});
test('unknown blocked origin gets only public base domain, never full host, path, query or credentials', () => {
  const location = diagnosticLocation('https://private-marker.api.wikipedia.org/account-123456?token=private-marker#private-marker');
  assert.equal(location.origin, 'REDACTED_OTHER'); assert.equal(location.registrableDomain, 'wikipedia.org');
  assert.equal(location.family, 'OTHER'); assert.equal(JSON.stringify(location).includes('private-marker'), false);
  assert.equal(diagnosticLocation('https://name:private-marker@www.wikipedia.org/').registrableDomain, null);
  assert.equal(diagnosticLocation('blob:https://www.wikipedia.org/private-marker').registrableDomain, null);
  const journal = createPolicyDiagnostics(); journal.record('REQUEST_BLOCKED', { url: 'https://private-marker.api.wikipedia.org/?token=private-marker', resourceType: 'xhr' });
  assert.equal(journal.snapshot().version, 2); assert.equal(journal.snapshot().domainPolicy, DIAGNOSTIC_DOMAIN_POLICY);
  assert.equal(journal.snapshot().priorityEvents[0]!.location.registrableDomain, 'wikipedia.org');
  assert.equal(JSON.stringify(journal.snapshot()).includes('private-marker'), false);
  const captcha = diagnosticLocation('https://www.google.com/recaptcha/api.js?token=private-marker');
  assert.equal(captcha.pathCategory, 'RECAPTCHA'); assert.equal(JSON.stringify(captcha).includes('private-marker'), false);
  assert.equal(diagnosticLocation('https://www.google.com/search?token=private-marker').pathCategory, 'OTHER_REDACTED');
});
test('domain parser does not grant access or infer which dependency the live snapshot hid', () => {
  const policy = createBrowserPolicy({ manualLoginEnabled: true });
  assert.equal(diagnosticLocation('https://private-marker.fbsbx.com/frame').registrableDomain, 'fbsbx.com');
  assert.equal(policy.navigationAllowed('https://private-marker.fbsbx.com/frame'), false);
  assert.equal(policy.resourceAllowed('https://api.wikipedia.org/xhr'), false);
  assert.equal(policy.resourceAllowed('https://www.facebook.com/'), true);
});
