import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { FACEBOOK_DOM_SCRIPT } from '../src/main/facebook-dom-diagnostic-script.js';
import { createFacebookDomDiagnostic, validateDomResult } from '../src/main/facebook-dom-diagnostic.js';

// Minimal read-only DOM surface for the fixed script, not a browser/parser mock.
interface NodeStub {
  nodeType: number; tagName?: string; nodeValue?: string; parentElement: NodeStub | null;
  hidden?: boolean; children: NodeStub[]; childElementCount?: number;
  getAttribute?: (name: string) => string | null; hasAttribute?: (name: string) => boolean; getClientRects?: () => unknown[];
}
const text = (value: string): NodeStub => ({ nodeType: 3, nodeValue: value, parentElement: null, children: [] });
function element(tag: string, attributes: Record<string,string> = {}, children: NodeStub[] = []): NodeStub {
  const node: NodeStub = { nodeType: 1, tagName: tag, parentElement: null, hidden: 'hidden' in attributes, children,
    childElementCount: children.filter(child => child.nodeType === 1).length,
    getAttribute: name => attributes[name] ?? null, hasAttribute: name => name in attributes, getClientRects: () => [1] };
  for (const child of children) child.parentElement = node;
  return node;
}
const posts = 'https://www.facebook.com/search/posts/?q=cafe%20H%C3%A0%20N%E1%BB%99i&token=secret-token';
const top = posts.replace('/posts/', '/top/');
function inspect(nodes: NodeStub[], url = posts, elapsed = () => 0) {
  const body = element('BODY', {}, nodes), flattened: NodeStub[] = [];
  const walk = (node: NodeStub) => { for (const child of node.children) { flattened.push(child); walk(child); } };
  walk(body);
  // Only the fixed script's tag/attribute/:not(descendant) selector subset.
  // This evaluates exclusion syntax, rather than deciding which roots the product ought to choose.
  const simple = (node: NodeStub, selector: string): boolean => {
    const m = /^([a-z]+)?(?:\[([a-z-]+)(?:(\*?=)"([^"]*)")?\])?$/.exec(selector);
    if (!m) throw new Error('Unsupported test selector: ' + selector);
    return node.nodeType === 1 && (!m[1] || node.tagName === m[1].toUpperCase()) &&
      (!m[2] || (m[3] === '*=' ? (node.getAttribute?.(m[2]) ?? '').includes(m[4]!) :
        m[3] === '=' ? node.getAttribute?.(m[2]) === m[4] : node.hasAttribute?.(m[2]) === true));
  };
  const matches = (node: NodeStub, selector: string) => {
    const base = selector.split(':not(')[0]!; if (!simple(node, base)) return false;
    for (const m of selector.matchAll(/:not\(([^)]+)\)/g)) {
      const exclusion = m[1]!;
      if (exclusion.endsWith(' *')) {
        for (let p = node.parentElement; p; p = p.parentElement) if (simple(p, exclusion.slice(0,-2))) return false;
      } else if (simple(node, exclusion)) return false;
    }
    return true;
  };
  return validateDomResult(runInNewContext(FACEBOOK_DOM_SCRIPT, { URL, location: { href: url },
    performance: { now: elapsed }, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: { body, querySelector: (selector: string) => flattened.find(node => selector.split(',').some(part => matches(node, part))) ?? null,
      createTreeWalker: (root: NodeStub, _mask: number, filter: { acceptNode: (node: NodeStub) => number }) => {
        const queue = [...root.children]; return { nextNode() {
          while (queue.length) { const node = queue.shift()!; if (filter.acceptNode(node) === 2) continue;
            queue.unshift(...node.children); return node; } return null;
        } };
      },
    },
  }, { timeout: 2000 }));
}

test('review: exact Posts and Top have separate labels; other search kinds stay unsupported', () => {
  for (const kind of ['people', 'groups', 'pages', 'videos', 'top/other', 'posts/other']) {
    const result = inspect([element('ARTICLE')], posts.replace('/posts/', '/' + kind + '/'));
    assert.equal(result.status, 'UNSUPPORTED_ROUTE', kind);
    assert.equal(result.visited, 0); assert.equal(result.cards.length, 0);
  }
  for (const [url, route] of [[posts, 'SEARCH_POSTS'], [top, 'SEARCH_TOP_MIXED']]) {
    const result = inspect([element('ARTICLE')], url);
    assert.equal(result.status, 'HEURISTIC_MATCH'); assert.equal(result.route, route);
  }
});

test('review: raw names, text, HTML, query and link tokens cannot enter structural output', () => {
  for (const url of [posts, top]) {
  const result = inspect([element('ARTICLE', {}, [text('secret-person-name secret-post-text <b>secret-html</b>'),
    element('A', { href: '/groups/secret-group/permalink/secret-post/?token=secret-link' }, [text('secret-link-label')]),
    element('SPAN', { 'aria-label': 'Công khai' }), element('SPAN', { title: 'Nhóm riêng tư' }),
    element('TIME'), element('BUTTON', {}, [text('Xem thêm')])])], url);
  assert.equal(result.status, 'HEURISTIC_MATCH'); assert.equal(result.cards[0]?.links.post, 1);
  assert.equal(result.cards[0]?.publicLabelHints, 1); assert.equal(result.cards[0]?.restrictedLabelHints, 1);
  assert.equal(result.cards[0]?.seeMoreHint, true); assert.equal(result.cards[0]?.timeHint, true);
  assert.equal(/secret|cafe|hà nội|https:|<b>/.test(JSON.stringify(result)), false);
  }
});

test('review: Top mixed structures remain metadata-only, unverified and benchmark ineligible', async () => {
  const saved: unknown[] = [];
  const engine = createFacebookDomDiagnostic({ mode: 'FIXTURE',
    sink: () => ({ directory: 'in-memory-fixture', write: (_name, value) => {
      saved.push(value); return createHash('sha256').update(JSON.stringify(value)).digest('hex');
    } }),
    resolve: () => ({ webContentsId: 1, viewGeneration: 1, url: () => top, watchLoss: () => () => {},
      execute: async code => { assert.equal(code, FACEBOOK_DOM_SCRIPT); return inspect([
        element('ARTICLE', {}, [text('secret-person secret-post'), element('SPAN', { 'aria-label': 'Công khai' })]),
        element('DIV', {}, [text('secret-page-card secret-ad-card')]),
      ], top); },
    }),
  });
  const { report } = await engine.start('secret-profile');
  assert.equal(report.status, 'HEURISTIC_MATCH'); assert.equal(report.result?.route, 'SEARCH_TOP_MIXED');
  assert.equal(report.result?.cards[0]?.publicLabelHints, 1);
  assert.equal(report.capture_mode, 'FIXTURE'); assert.equal(report.diagnostic_only, true);
  assert.equal(report.benchmark_eligible, false); assert.equal(report.platform_permission, 'UNKNOWN');
  assert.equal(report.verified_valid_count, 0); assert.equal(report.candidates_collected, 0);
  assert.equal(report.version, 2); assert.equal(report.result?.version, 2);
  assert.ok(report.missing_fields.includes('PUBLICITY_UNVERIFIED'));
  assert.ok(report.missing_fields.includes('SOURCE_TYPE_UNVERIFIED'));
  assert.equal(saved.length, 2); assert.equal(/secret|cafe|https:/.test(JSON.stringify(saved)), false);
});

test('review: empty DOM and bounded partial scan remain explicit, no source exhaustion claim', () => {
  const empty = inspect([element('MAIN', {}, [text('No article')])]);
  assert.equal(empty.status, 'NO_MATCH'); assert.equal(empty.nodeLimit, false);
  const capped = inspect(Array.from({ length: 2600 }, () => element('DIV')));
  assert.equal(capped.visited, 2500); assert.equal(capped.nodeLimit, true); assert.equal(capped.cards.length, 0);
  const sampled = inspect(Array.from({ length: 8 }, () => element('ARTICLE')));
  assert.equal(sampled.articleRoots, 8); assert.equal(sampled.cards.length, 5);
  let calls = 0; const timed = inspect([element('ARTICLE')], posts, () => calls++ === 0 ? 0 : 1001);
  assert.equal(timed.timeLimit, true); assert.equal(timed.visited, 0);
});

test('review: visible auth/challenge/access-denied clears structural samples', () => {
  const cases: [NodeStub, string][] = [
    [element('INPUT', { type: 'password' }), 'AUTH_REQUIRED'],
    [element('INPUT', { autocomplete: 'one-time-code' }), 'AUTH_REQUIRED'],
    [element('IFRAME', { src: 'https://www.google.com/recaptcha/enterprise/anchor?token=secret' }), 'CHALLENGE'],
    [element('DIV', { role: 'dialog' }, [text('Confirm your identity')]), 'CHALLENGE'],
    [element('FORM', {}, [text('Bạn không có quyền truy cập')]), 'ACCESS_DENIED'],
  ];
  for (const [node, expected] of cases) {
    const result = inspect([element('ARTICLE'), node]);
    assert.equal(result.status, expected); assert.equal(result.cards.length, 0);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('review: author content mentioning verification is not itself an auth barrier', () => {
  const result = inspect([element('ARTICLE', {}, [text('Confirm your identity'), text('Access denied')])]);
  assert.equal(result.status, 'HEURISTIC_MATCH'); assert.equal(result.cards.length, 1);
});

test('review v2: semantic root bypasses chrome cap without claiming verified results or uniqueness', () => {
  const root = element('MAIN', { role: 'main', 'aria-label': 'secret-results-name' }, [
    element('DIV', { 'data-pagelet': 'secret-pagelet' }, [element('A', { href: '/secret-person/posts/secret-post?token=secret' })]),
    element('DIV', { role: 'feed' }),
  ]);
  const result = inspect([...Array.from({ length: 2600 }, () => element('SPAN')), root], top);
  assert.equal(result.version, 2); assert.equal(result.root.kind, 'MAIN_TAG');
  assert.equal(result.root.candidates, 2); assert.equal(result.root.enumeration, 'FIRST_PER_SELECTOR');
  assert.equal(result.root.verified, false); assert.equal(result.scan, 'COMPLETE');
  assert.equal(result.visited, 4); assert.equal(result.status, 'POST_LINK_STRUCTURE'); assert.equal(result.cards.length, 0);
  assert.equal(result.postLinkSamples[0]?.ancestors.at(-1)?.atRoot, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  const firstOnly = inspect([element('MAIN'), element('MAIN', {}, [element('ARTICLE')])]);
  assert.equal(firstOnly.root.candidates, 1); assert.equal(firstOnly.root.verified, false); assert.equal(firstOnly.status, 'NO_MATCH');
});

test('review v2: root and walk exclude navigation/sidebar/dialog metadata', () => {
  for (const tag of ['NAV', 'ASIDE']) {
    const bad = element(tag, { role: 'main' }, [element('ARTICLE')]);
    const result = inspect([bad, element('DIV', { role: 'main' }, [element('A', { href: '/x/posts/y' })])]);
    assert.equal(result.status, 'POST_LINK_STRUCTURE', tag); assert.equal(result.articleRoots, 0);
    assert.equal(result.postLinkSamples[0]?.ancestors.at(-1)?.tag, 'DIV');
  }
  const nested = inspect([element('MAIN', {}, [
    element('NAV', {}, [element('ARTICLE')]), element('ASIDE', {}, [element('ARTICLE')]),
    element('DIALOG', {}, [element('ARTICLE'), element('A', { href: '/dialog/posts/secret' })]),
    element('DIV', { hidden: '' }, [element('ARTICLE')]), element('A', { href: '/ok/posts/shape' }),
  ])]);
  assert.equal(nested.articleRoots, 0); assert.equal(nested.links.post, 1); assert.equal(nested.pruned, 3);
});

test('review v2: shared ancestor/node budgets, enum privacy and schema reject raw/old values', () => {
  const chain = () => {
    let node = element('A', { href: '/same/posts/id?token=secret' });
    for (let i = 0; i < 10; i++) node = element('DIV', { role: 'secret-role', 'aria-label': 'secret-name', 'data-pagelet': 'secret-value' }, [node]);
    return node;
  };
  const result = inspect([element('MAIN', {}, Array.from({ length: 7 }, chain))]);
  assert.equal(result.links.post, 7); assert.equal(result.postLinkSamples.length, 5); assert.equal(result.ancestorSteps, 40);
  assert.ok(result.postLinkSamples.every(sample => sample.depthLimit && sample.ancestors.length === 8));
  assert.ok(result.postLinkSamples[0]?.ancestors.every(node => node.role === 'OTHER' && node.label && node.pagelet));
  assert.equal(JSON.stringify(result).includes('secret'), false);
  for (const bad of [{ ...result, version: 1 }, { ...result, ancestorSteps: 41 },
    { ...result, root: { ...result.root, verified: true } },
    { ...result, postLinkSamples: [{ ...result.postLinkSamples[0], href: 'secret' }] },
  ]) assert.throws(() => validateDomResult(bad), /INVALID_RESULT/);
});
