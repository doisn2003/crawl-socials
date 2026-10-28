import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySearchTimestampHref, inspectCurrentGroupPostRoute } from '../src/main/facebook-public-candidate-fields.js';

const search = 'https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';
const observed = 'https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234&__cft__[0]=SYNTHETIC_TRACKING';

// Reader-parser parity only. A parsed route does not itself authorize navigation;
// the controller must require the fixed DOM binding and its revalidation.
test('review observed URL parser: observed GROUP_QUERY tracking is compatible with reader identity without numeric coercion', () => {
  assert.equal(classifySearchTimestampHref(observed, search), 'OBSERVED_POST');
  const hint = inspectCurrentGroupPostRoute(observed);
  assert.ok(hint);
  assert.equal(hint.group_id, '123'); assert.equal(hint.post_id, '90071992547409931234');
  assert.equal(hint.verification, 'UNVERIFIED');
  assert.equal(hint.observed_route, 'https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234');
  assert.equal(JSON.stringify(hint).includes('SYNTHETIC_TRACKING'), false);
});

test('review observed URL parser: ambiguous identity, query aliases, credentials, fragments and unsupported routes stay rejected', () => {
  const bad = [
    observed + '&multi_permalinks=789',
    observed + '&multi%5Fpermalinks=789',
    observed + '&__cft__[0]=SECOND',
    observed + '&__cft__%5B0%5D=SECOND',
    observed + '&action=delete',
    observed + '#fragment',
    observed.replace('www.facebook.com', 'www.facebook.com.attacker.test'),
    observed.replace('https://', 'http://'),
    observed.replace('https://', 'https://user:secret@'),
    observed.replace('/groups/123/', '/groups/123/posts/456/'),
    observed.replace('multi_permalinks=90071992547409931234', 'multi_permalinks=456,789'),
    observed.replace('multi_permalinks=90071992547409931234', 'multi_permalinks=%34%35%36'),
    observed.replace('/groups/123/', '/groups/123/../456/'),
    observed + '&__tn__=' + 'x'.repeat(2048),
  ];
  for (const value of bad) assert.equal(inspectCurrentGroupPostRoute(value), null);
});
