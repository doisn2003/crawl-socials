import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAuthenticationCookies } from '../src/infrastructure/browser/authenticated-session.js';

test('authentication requires both current-origin cookies and rejects expiry, empty values and unrelated hosts', () => {
  const facebook = ['c_user', 'xs'].map(name => ({ name, value: 'local-test', domain: '.facebook.com', expirationDate: 2000 }));
  const threads = ['sessionid', 'ds_user_id'].map(name => ({ name, value: 'local-test', domain: '.threads.com' }));
  assert.equal(hasAuthenticationCookies('facebook', facebook, 1000), true);
  assert.equal(hasAuthenticationCookies('threads', threads, 1000), true);
  assert.equal(hasAuthenticationCookies('facebook', facebook, 3000), false);
  assert.equal(hasAuthenticationCookies('facebook', facebook.slice(0, 1), 1000), false);
  assert.equal(hasAuthenticationCookies('threads', threads.map(c => ({ ...c, value: '' }))), false);
  for (const domain of ['.threads.net', '.instagram.com', '.api.threads.com', '.threads.com.evil.invalid']) {
    assert.equal(hasAuthenticationCookies('threads', threads.map(c => ({ ...c, domain }))), false);
  }
  assert.equal(hasAuthenticationCookies('threads', [threads[0]!, { ...threads[1]!, domain: '.threads.net' }]), false);
});
