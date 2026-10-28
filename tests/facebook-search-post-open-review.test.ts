import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT, FACEBOOK_SEARCH_POST_CLICK_SCRIPT, FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT, FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT } from '../src/main/facebook-public-candidate-script.js';
import { createFacebookSearchPostOpen, validateSearchPostOpenScan } from '../src/main/facebook-search-post-open.js';
import type { PostNavigationEvent, PostRouteTarget } from '../src/main/facebook-post-route-verification.js';
import type { CurrentPostObservation, createPublicCandidateSink } from '../src/main/facebook-public-candidate.js';
import { inspectCurrentGroupPostRoute, classifySearchTimestampHref } from '../src/main/facebook-public-candidate-fields.js';

// Synthetic DOM only. These tests execute both complete fixed scripts in one isolated VM.
const box = { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
const search = 'https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';
class Element {
  nodeType = 1; nodeValue = ''; parentElement: Element | null = null; children: Element[] = [];
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  hidden = false; clicks = 0;
  onClick: (() => void) | undefined;
  constructor(public tagName: string, public attrs: Record<string,string> = {}) {}
  getAttribute(key: string) { return this.attrs[key] ?? null; }
  hasAttribute(key: string) { return Object.hasOwn(this.attrs, key); }
  get localName() { return this.tagName.toLowerCase(); }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value, namespaceURI: null })); }
  get childNodes() { return this.children; }
  get firstChild(): Element | null { return this.children[0] ?? null; }
  get nextSibling(): Element | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.children.map(child => child.textContent).join(''); }
  getClientRects() { return this.hidden ? [] : [box]; }
  getBoundingClientRect() { return box; }
  get clientLeft() { return 0; } get clientTop() { return 0; }
  get clientWidth() { return box.width; } get clientHeight() { return box.height; }
  get childElementCount() { return this.children.filter(node => node.nodeType === 1).length; }
  get firstElementChild(): Element | null { return this.children.find(node => node.nodeType === 1) ?? null; }
  get nextElementSibling(): Element | null {
    const siblings = this.parentElement?.children.filter(node => node.nodeType === 1) ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get isConnected(): boolean { return this.tagName === 'BODY' || !!this.parentElement?.isConnected; }
  contains(other: Element): boolean { return this === other || this.children.some(child => child.contains(other)); }
  querySelector(selector: string): Element | null { return all(this).find(node => matches(node, selector)) ?? null; }
  click() { this.clicks++; this.onClick?.(); }
}
function all(root: Element): Element[] { return root.children.flatMap(child => [child, ...all(child)]); }
function simple(node: Element, selector: string): boolean {
  const match = /^([a-z][a-z0-9]*)?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(selector);
  assert.ok(match, 'unsupported fixture selector: ' + selector);
  return node.nodeType === 1 && (!match[1] || node.tagName === match[1].toUpperCase()) &&
    (!match[2] || (match[3] === undefined ? node.hasAttribute(match[2]) : node.getAttribute(match[2]) === match[3]));
}
function matches(node: Element, selector: string): boolean {
  return selector.split(',').some(part => {
    if (!simple(node, part.split(':not(')[0]!)) return false;
    for (const match of part.matchAll(/:not\(([^)]+)\)/g)) {
      const value = match[1]!;
      if (value.endsWith(' *')) { for (let p = node.parentElement; p; p = p.parentElement) if (simple(p, value.slice(0, -2))) return false; }
      else if (simple(node, value)) return false;
    }
    return true;
  });
}
function element(tag: string, attrs: Record<string,string> = {}, children: Element[] = []) {
  const node = new Element(tag, attrs); node.children = children;
  for (const child of children) child.parentElement = node;
  return node;
}
function text(value: string) { const node = new Element('#text'); node.nodeType = 3; node.nodeValue = value; return node; }
function svgElement(tag: string, attrs: Record<string,string> = {}, children: Element[] = []) {
  const node = element(tag, attrs, children); node.namespaceURI = 'http://www.w3.org/2000/svg'; return node;
}
function svgClock() { return svgElement('SVG', { width: '100', height: '20', viewBox: '0 0 100 20' }, [svgElement('TEXT', { x: '0', y: '15' }, [svgElement('TSPAN', {}, [text('opaque-clock')])])]); }
function setChildren(parent: Element, children: Element[]) { parent.children = children; for (const child of children) child.parentElement = parent; }
function fixture(attrs: Record<string,string> = {}, targetText = 'obfuscated-clock', second = false) {
  const target = element('A', { href: '/search/top/?__cft__[0]=fixture&__tn__=fixture', ...attrs }, [text(targetText)]);
  const header = element('HEADER', {}, [element('H3', {}, [text('SYNTHETIC_GROUP_HEADING')]), target,
    ...(second ? [element('A', { href: '/search/top/?__tn__=second' }, [text('another-clock')])] : []),
    element('SPAN', { 'aria-label': 'Đã chia sẻ với Nhóm công khai' })]);
  const root = element('DIV', {}, [header, element('DIV', { 'data-ad-preview': 'message' }, [text('SYNTHETIC_CAFE_BODY')])]);
  const body = element('BODY', {}, [element('MAIN', {}, [element('DIV', { role: 'feed' }, [root])])]);
  const document = {
    body, querySelector: (selector: string) => body.querySelector(selector),
    evaluate(expression: string, context: unknown, _resolver: unknown, type: number) {
      assert.equal(context, document); assert.equal(type, 7);
      assert.equal(expression, '(//input[@type="password" or @autocomplete="one-time-code" or @name="approvals_code"] | //iframe[contains(@src,"/recaptcha/")] | //dialog | //*[@role="dialog" or @role="alert"])[position() <= 17]');
      return { snapshotLength: 0, snapshotItem: () => null };
    },
    createRange() { let selected: Element | null = null; return { selectNodeContents(node: Element) { selected = node; }, detach() {}, getClientRects() { return selected?.nodeValue ? [box] : []; } }; },
    createTreeWalker(rootNode: Element, _mask: number, filter: { acceptNode(node: Element): number }) {
      const queue = [...rootNode.children]; return { nextNode() { while (queue.length) { const node = queue.shift()!; if (filter.acceptNode(node) === 2) continue; queue.unshift(...node.children); return node; } return null; } };
    }
  };
  class Observer { constructor(_callback: () => void) {} observe() {} disconnect() {} takeRecords() { return []; } }
  const context = createContext({ URL, location: { href: search }, document, HTMLElement: Element, MutationObserver: Observer,
    innerWidth: 1000, innerHeight: 800, performance: { now: () => 0 },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', clip: 'auto', clipPath: 'none', transform: 'none', position: 'static', fill: 'rgb(0, 0, 0)', fillOpacity: '1', stroke: 'none', filter: 'none', maskImage: 'none', backgroundImage: 'none' }),
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 } });
  return { target, header, root, context };
}
function runPair(f = fixture()) {
  const discovery = runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
  const click = runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT, f.context, { timeout: 2000 });
  return { discovery, click, clicks: f.target.clicks };
}
function v23DiscoveryProjection(f: ReturnType<typeof fixture>) {
  const baseline = JSON.parse(readFileSync('tests/fixtures/facebook-search-open-v23-scripts.json', 'utf8')) as { discovery: string };
  assert.equal(createHash('sha256').update(baseline.discovery).digest('hex'), 'ba67d8fb3c204b7708b815cdd85b9dfd2e96f6077599856bfa147c7f2cb14f7c');
  return discoveryProjection(runInContext(baseline.discovery, f.context, { timeout: 2000 }));
}
function discoveryProjection(scan: any) {
  return JSON.parse(JSON.stringify({ status: scan.status, node: scan.nodeLimit, time: scan.timeLimit, targets: scan.searchOpen.targets,
    openingStatus: scan.searchOpen.status, counters: scan.searchOpen.eligibility.counters,
    firstStages: scan.searchOpen.eligibility.shapes.map((shape: any) => ({ stage: shape.stage, kind: shape.subtree_kind, preflightKind: shape.pf_subtree_kind })) }));
}

test('review search open: unique structural placeholder may be selected without classified temporal text', () => {
  const { discovery, click, clicks } = runPair();
  assert.equal(discovery.searchOpen.status, 'TARGETS_READY');
  assert.equal(discovery.searchOpen.targets[0].timestamp_proof, 'UNIQUE_HEADER_PLACEHOLDER');
  assert.equal(click.searchOpen.status, 'CLICK_DISPATCHED'); assert.equal(clicks, 1);
});

test('review search open: explicit menu placeholder cannot become a timestamp through uniqueness', () => {
  const { discovery, clicks } = runPair(fixture({ 'aria-haspopup': 'true' }, 'Options'));
  assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0);
});

test('review search open: explicit author relationship outside heading is not timestamp proof', () => {
  const { discovery, clicks } = runPair(fixture({ rel: 'author' }, 'SYNTHETIC_AUTHOR'));
  assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0);
});

test('review search open: two structural placeholders remain ambiguous and create no click', () => {
  const { discovery, clicks } = runPair(fixture({}, 'obfuscated-clock', true));
  assert.equal(discovery.searchOpen.status, 'AMBIGUOUS_TIMESTAMP'); assert.equal(clicks, 0);
});

test('review observed header: unique observed post has its own structural proof without a date claim', () => {
  const f = fixture({ href: '/groups/123/posts/456/' });
  const { discovery, click, clicks } = runPair(f);
  assert.equal(discovery.searchOpen.status, 'TARGETS_READY');
  assert.equal(discovery.searchOpen.targets[0].href_kind, 'OBSERVED_POST');
  assert.equal(discovery.searchOpen.targets[0].timestamp_proof, 'UNIQUE_HEADER_POST_LINK');
  assert.equal(click.searchOpen.status, 'CLICK_DISPATCHED'); assert.equal(clicks, 1);
});

test('review observed header: inline SVG text can belong to one observed post link', () => {
  const f = fixture({ href: '/groups/123/posts/456/' }); setChildren(f.target, [svgClock()]);
  const { discovery, click, clicks } = runPair(f);
  assert.equal(discovery.searchOpen.status, 'TARGETS_READY');
  assert.equal(discovery.searchOpen.targets[0].timestamp_proof, 'UNIQUE_HEADER_POST_LINK');
  assert.equal(click.searchOpen.status, 'CLICK_DISPATCHED'); assert.equal(clicks, 1);
});

test('review observed header: observed post plus another eligible header link is ambiguous', () => {
  for (const secondHref of ['/groups/123/posts/789/', '/search/top/?__tn__=other']) {
    const f = fixture({ href: '/groups/123/posts/456/' }, 'opaque-clock', true);
    f.header.children[2]!.attrs.href = secondHref;
    const { discovery, clicks } = runPair(f);
    if (secondHref.includes('/posts/')) {
      assert.equal(discovery.rejected.AMBIGUOUS_BOUNDARY, 1);
      assert.equal(discovery.searchOpen.qualified_headers, 0);
    } else assert.equal(discovery.searchOpen.status, 'AMBIGUOUS_TIMESTAMP', secondHref);
    assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0);
  }
});

test('review observed SVG ink: fully transparent computed fill cannot prove visible text', () => {
  for (const fill of ['rgba(0, 0, 0, 0)', 'rgba(255, 255, 255, 0)']) {
    const f = fixture({ href: '/groups/123/posts/456/' }); setChildren(f.target, [svgClock()]);
    const normalStyle = f.context.getComputedStyle;
    f.context.getComputedStyle = (node: Element) => ({ ...normalStyle(node), ...(['TEXT', 'TSPAN'].includes(node.tagName) ? { fill } : {}) });
    const { discovery, clicks } = runPair(f);
    assert.equal(discovery.searchOpen.targets.length, 0, 'positive geometry is insufficient when computed glyph fill is transparent');
    assert.equal(clicks, 0);
  }
});

test('review observed target policy: oversized named target never becomes absent through bounded attr helper', () => {
  for (const length of [160, 161]) {
    const f = fixture({ href: '/groups/123/posts/456/', target: 'x'.repeat(length) }); setChildren(f.target, [svgClock()]);
    const { discovery, clicks } = runPair(f);
    assert.equal(discovery.searchOpen.targets.length, 0, 'target length ' + length);
    assert.equal(clicks, 0);
  }
});

test('review observed header: media, SVG external content and controls cannot borrow structural proof', () => {
  const forbidden = [
    element('IMG', { src: 'https://fixture.invalid/image' }),
    svgElement('SVG', {}, [svgElement('FOREIGNOBJECT', {}, [element('DIV', {}, [text('opaque-clock')])])]),
    svgElement('SVG', {}, [svgElement('USE', { href: 'https://fixture.invalid/asset.svg#clock' })]),
    svgElement('SVG', {}, [svgElement('IMAGE', { href: 'https://fixture.invalid/image' })]),
    svgElement('SVG', {}, [svgElement('A', { href: '/groups/123/posts/789/' }, [svgElement('TEXT', {}, [text('opaque-clock')])])]),
    svgElement('SVG', {}, [svgElement('PATH', { d: 'M0 0L1 1' })]),
    element('BUTTON', {}, [text('opaque-clock')]),
    element('SPAN', { role: 'button' }, [text('opaque-clock')]),
    element('H3', {}, [text('opaque-clock')]),
    element('SVG', {}, [element('TEXT', {}, [text('opaque-clock')])]),
  ];
  for (const node of forbidden) {
    const f = fixture({ href: '/groups/123/posts/456/' }); setChildren(f.target, [node]);
    const { discovery, clicks } = runPair(f);
    assert.equal(discovery.searchOpen.targets.length, 0, node.tagName + ':' + node.namespaceURI); assert.equal(clicks, 0);
  }
});

test('review subtree metadata baseline: unsupported wrapper tag preserves the actual and earlier new-window decisions', () => {
  for (const blank of [false, true]) {
    const f = fixture({ href: '/groups/123/posts/456/', ...(blank ? { target: '_blank' } : {}) });
    setChildren(f.target, [element('DIV', {}, [element('SPAN', { 'data-private-name': 'SYNTHETIC_PRIVATE_VALUE' }, [svgClock()])])]);
    const before = v23DiscoveryProjection(f);
    const { discovery, clicks } = runPair(f), shape = discovery.searchOpen.eligibility.shapes.find((s: { href_kind: string }) => s.href_kind === 'OBSERVED_POST');
    assert.deepEqual(discoveryProjection(discovery), before);
    assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0);
    assert.equal(shape.stage, blank ? 'NEW_WINDOW' : 'MEDIA_OR_HEADING');
    assert.equal(shape.subtree_kind, blank ? 'NOT_CHECKED' : 'UNSUPPORTED');
    assert.equal(shape.pf_subtree_kind, 'UNSUPPORTED');
    for (const prefix of ['subtree', 'pf_subtree']) {
      const checked = !blank || prefix === 'pf_subtree';
      assert.deepEqual(['reason', 'tag', 'attr', 'depth'].map(key => shape[prefix + '_' + key]), checked ? ['HTML_TAG', 'DIV', 'NONE', 'D1'] : ['NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED']);
    }
    assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_PRIVATE'), false);
    assert.equal(JSON.stringify(discovery.searchOpen).includes('data-private-name'), false);
  }
});

test('review subtree metadata baseline: unsupported wrapper attributes remain rejected without retaining names or values', () => {
  for (const attrs of [{ 'aria-hidden': 'false' }, { 'data-private-name': 'SYNTHETIC_PRIVATE_VALUE' }]) {
    const f = fixture({ href: '/groups/123/posts/456/' }); setChildren(f.target, [element('SPAN', attrs, [svgClock()])]);
    const before = v23DiscoveryProjection(f);
    const { discovery, clicks } = runPair(f), shape = discovery.searchOpen.eligibility.shapes.find((s: { href_kind: string }) => s.href_kind === 'OBSERVED_POST');
    assert.deepEqual(discoveryProjection(discovery), before);
    assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0);
    assert.equal(shape.stage, 'MEDIA_OR_HEADING'); assert.equal(shape.pf_subtree_kind, 'UNSUPPORTED');
    for (const prefix of ['subtree', 'pf_subtree']) assert.deepEqual(['reason', 'tag', 'attr', 'depth'].map(key => shape[prefix + '_' + key]), ['ATTR_NOT_ALLOWED', 'SPAN', 'aria-hidden' in attrs ? 'ARIA_HIDDEN' : 'DATA_ATTR', 'D1']);
    assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_PRIVATE'), false);
    assert.equal(JSON.stringify(discovery.searchOpen).includes('data-private-name'), false);
  }
});

test('review subtree metadata: an exception stays incomplete with bounded location and no exception text', () => {
  const f = fixture({ href: '/groups/123/posts/456/' });
  const broken = element('SPAN', {}, [svgClock()]);
  Object.defineProperty(broken, 'attributes', { get() { throw new Error('SYNTHETIC_PRIVATE_EXCEPTION'); } });
  setChildren(f.target, [element('SPAN', {}, [broken])]);
  const before = v23DiscoveryProjection(f), { discovery, clicks } = runPair(f);
  assert.deepEqual(discoveryProjection(discovery), before); assert.equal(clicks, 0);
  const shape = discovery.searchOpen.eligibility.shapes.find((s: { href_kind: string }) => s.href_kind === 'OBSERVED_POST');
  assert.equal(shape.subtree_kind, 'INCOMPLETE'); assert.equal(shape.preflight, 'INCOMPLETE');
  for (const prefix of ['subtree', 'pf_subtree']) assert.deepEqual(['reason', 'tag', 'attr', 'depth'].map(key => shape[prefix + '_' + key]), ['EXCEPTION', 'SPAN', 'NONE', 'D2']);
  assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_PRIVATE_EXCEPTION'), false);
  validateSearchPostOpenScan(discovery, 'DISCOVER');
});

test('review passive ARIA: bounded labelledby metadata does not supply text proof or trigger ID lookup', () => {
  for (const value of ['SYNTHETIC_PRIVATE_ID', '2 giờ', 'menu share']) for (const useSvg of [false, true]) {
    const f = fixture({ href: '/groups/123/posts/456/' });
    setChildren(f.target, [element('SPAN', { 'aria-labelledby': value }, useSvg ? [svgClock()] : [text('opaque-clock')])]);
    let lookups = 0; f.context.document.getElementById = () => { lookups++; throw new Error('IDREF_LOOKUP_FORBIDDEN'); };
    const query = f.context.document.querySelector;
    f.context.document.querySelector = (selector: string) => { if (selector.includes('#') || selector.includes('[id')) { lookups++; throw new Error('IDREF_QUERY_FORBIDDEN'); } return query(selector); };
    const { discovery, clicks } = runPair(f);
    assert.equal(discovery.searchOpen.status, 'TARGETS_READY'); assert.equal(clicks, 1); assert.equal(lookups, 0);
    assert.equal(discovery.searchOpen.targets[0].timestamp_proof, 'UNIQUE_HEADER_POST_LINK');
    assert.equal(discovery.samples[0].published_at, null);
    assert.equal(JSON.stringify(discovery.searchOpen).includes(value), false);
  }
});

test('review passive ARIA: accepted metadata cannot bypass unsafe descendants or hidden ink', () => {
  for (const kind of ['image', 'control', 'unknown', 'foreign', 'transparent', 'hidden']) {
    const f = fixture({ href: '/groups/123/posts/456/' });
    const child = kind === 'image' ? element('IMG') : kind === 'control' ? element('BUTTON', {}, [text('opaque-clock')]) :
      kind === 'unknown' ? element('PRIVATE-WRAPPER', {}, [text('opaque-clock')]) :
      kind === 'foreign' ? svgElement('SVG', {}, [svgElement('FOREIGNOBJECT', {}, [element('SPAN', {}, [text('opaque-clock')])])]) : svgClock();
    setChildren(f.target, [element('SPAN', { 'aria-labelledby': 'SYNTHETIC_PRIVATE_ID' }, [child])]);
    if (kind === 'transparent' || kind === 'hidden') {
      const normalStyle = f.context.getComputedStyle;
      f.context.getComputedStyle = (node: Element) => ({ ...normalStyle(node), ...(['TEXT', 'TSPAN'].includes(node.tagName) ? kind === 'transparent' ? { fill: 'rgba(0, 0, 0, 0)' } : { visibility: 'hidden' } : {}) });
    }
    const { discovery, clicks } = runPair(f);
    assert.equal(discovery.searchOpen.targets.length, 0, kind); assert.equal(clicks, 0, kind);
    assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_PRIVATE'), false);
  }
});

test('review passive ARIA: exception is confined to bounded HTML SPAN without widening other attributes or target policy', () => {
  for (const kind of ['length160', 'length161', 'other-aria', 'style', 'wrong-namespace', 'svg', 'br', 'blank']) {
    const f = fixture({ href: '/groups/123/posts/456/', ...(kind === 'blank' ? { target: '_blank' } : {}) });
    const attrs: Record<string,string> = { 'aria-labelledby': 'x'.repeat(kind === 'length161' ? 161 : kind === 'length160' ? 160 : 10) };
    if (kind === 'other-aria') attrs['aria-describedby'] = 'SYNTHETIC_PRIVATE_ID';
    if (kind === 'style') attrs.style = 'color: black';
    const wrapper = kind === 'svg' ? svgClock() : element(kind === 'br' ? 'BR' : 'SPAN', attrs, [text('opaque-clock')]);
    if (kind === 'svg') Object.assign(wrapper.attrs, attrs);
    if (kind === 'wrong-namespace') wrapper.namespaceURI = 'http://www.w3.org/2000/svg';
    setChildren(f.target, [wrapper]);
    const { discovery, clicks } = runPair(f); assert.equal(clicks, kind === 'length160' ? 1 : 0, kind);
    const shape = discovery.searchOpen.eligibility.shapes.find((s: { href_kind: string }) => s.href_kind === 'OBSERVED_POST');
    if (kind === 'length161') { assert.equal(shape.subtree_kind, 'INCOMPLETE'); assert.equal(shape.subtree_reason, 'ATTR_VALUE_LIMIT'); assert.equal(shape.subtree_attr, 'ARIA_LABELLEDBY'); }
    if (kind === 'blank') { assert.equal(shape.stage, 'NEW_WINDOW'); assert.equal(shape.subtree_kind, 'NOT_CHECKED'); assert.equal(shape.pf_subtree_kind, 'NONE'); }
    assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_PRIVATE'), false);
  }
});

test('review search target: uncertainty on a group-only link does not invalidate an independently visible timestamp', () => {
  const f = fixture();
  const unrelated = element('A', { href: '/groups/123/' }, [text('SYNTHETIC_GROUP_TITLE')]);
  unrelated.getClientRects = () => Array.from({ length: 9 }, () => ({ ...box }));
  unrelated.parentElement = f.header; f.header.children.splice(1, 0, unrelated);
  const { discovery, clicks } = runPair(f);
  assert.equal(discovery.searchOpen.targets.length, 1); assert.equal(clicks, 1);
  const d = discovery.searchOpen.eligibility;
  assert.equal(d.counters.href_rejected, 1); assert.equal(d.counters.target_visibility_unknown, 0); assert.equal(d.counters.headers_visibility_unknown, 0);
  const rejected = d.shapes.find((shape: { stage: string }) => shape.stage === 'HREF');
  assert.equal(rejected.visible_signal, 'NOT_CHECKED'); assert.equal(rejected.header_invalidation, 'NONE');
});

test('review search target: uncertain geometry on the actual timestamp still prevents an action', () => {
  const f = fixture(); f.target.getClientRects = () => Array.from({ length: 9 }, () => ({ ...box }));
  const { discovery, clicks } = runPair(f);
  assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0);
  const d = discovery.searchOpen.eligibility;
  assert.equal(d.counters.target_visibility_unknown, 1); assert.equal(d.counters.headers_visibility_unknown, 1);
  assert.equal(d.shapes[0].stage, 'TARGET_VISIBILITY'); assert.equal(d.shapes[0].header_invalidation, 'TARGET_VISIBILITY');
});

test('review search diagnostics: first decisive action rejection precedes unrelated geometry and retains no values', () => {
  const f = fixture({ 'aria-haspopup': 'true', rel: 'author', title: 'SYNTHETIC_SECRET_LABEL' });
  f.target.getClientRects = () => Array.from({ length: 9 }, () => ({ ...box }));
  const { discovery, clicks } = runPair(f), d = discovery.searchOpen.eligibility;
  assert.equal(clicks, 0); assert.equal(d.counters.popup, 1); assert.equal(d.counters.author, 0); assert.equal(d.counters.target_visibility_unknown, 0);
  assert.equal(d.shapes.length, 1); assert.equal(d.shapes[0].stage, 'POPUP'); assert.equal(d.shapes[0].visible_signal, 'NOT_CHECKED'); assert.equal(d.shapes[0].header_invalidation, 'NONE');
  const serialized = JSON.stringify(discovery.searchOpen);
  for (const raw of ['SYNTHETIC_SECRET_LABEL', 'SYNTHETIC_GROUP_HEADING', 'SYNTHETIC_CAFE_BODY', 'obfuscated-clock', '/search/top/', '__tn__']) assert.equal(serialized.includes(raw), false);
  assert.equal(discovery.searchOpen.version, 5); validateSearchPostOpenScan(discovery, 'DISCOVER');
});

test('review search diagnostics: shape cap retains all record counters and the independently eligible action', () => {
  const f = fixture(), choices: Record<string,string>[] = [
    { href: '/groups/123/' }, { rel: 'author' }, { 'aria-haspopup': 'true' }, { target: '_blank' }, { download: '' }, { 'aria-label': 'Save' }
  ];
  const rejected = choices.map(attrs => element('A', { href: '/search/top/?__tn__=SYNTHETIC_SECRET', ...attrs }, [text('OPAQUE_SYNTHETIC_LABEL')]));
  for (const node of rejected) node.parentElement = f.header;
  f.header.children.splice(1, 0, ...rejected);
  const { discovery, clicks } = runPair(f), d = discovery.searchOpen.eligibility;
  assert.equal(clicks, 1); assert.equal(d.counters.records_seen, 7); assert.equal(d.counters.eligible_records, 1); assert.equal(d.counters.headers_bound, 1);
  for (const key of ['href_rejected', 'author', 'popup', 'new_window', 'download', 'action_label']) assert.equal(d.counters[key], 1, key);
  assert.equal(d.shapes.length, 5); assert.equal(d.shapes_truncated, true); assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_SECRET'), false);
  validateSearchPostOpenScan(discovery, 'DISCOVER');
});

test('review search diagnostics: strict generated metadata validation rejects raw fields, coercion and oversize', () => {
  const original = runPair().discovery;
  validateSearchPostOpenScan(original, 'DISCOVER');
  const mutations = [
    (d: any) => { d.shapes[0].href = 'SYNTHETIC_SECRET'; },
    (d: any) => { d.shapes[0].stage = ['ELIGIBLE']; },
    (d: any) => { d.shapes[0].header_invalidation = { value: 'NONE' }; },
    (d: any) => { d.counters.records_seen = [1]; },
    (d: any) => { d.counters.records_seen = 2501; },
    (d: any) => { d.counters.headers_seen = 6; },
    (d: any) => { d.shapes = Array.from({ length: 6 }, () => ({ ...d.shapes[0] })); },
    (d: any) => { d.shapes[0].count = 0; },
    (d: any) => { d.shapes_truncated = 'false'; },
    (d: any) => { d.shapes[0].target_kind = ['BLANK']; },
    (d: any) => { d.shapes[0].pf_visibility = { value: 'PASS' }; },
    (d: any) => { d.shapes[0].preflight = 'SYNTHETIC_SECRET'; },
    (d: any) => { d.shapes[0].subtree_kind = ['SVG_TEXT_ONLY']; },
    (d: any) => { d.shapes[0].pf_subtree_kind = 'SYNTHETIC_SECRET'; },
    (d: any) => { d.shapes[0].subtree_reason = ['HTML_TAG']; },
    (d: any) => { d.shapes[0].pf_subtree_tag = 'SYNTHETIC_PRIVATE_TAG'; },
    (d: any) => { d.shapes[0].subtree_attr = 'data-private-name'; },
    (d: any) => { d.shapes[0].pf_subtree_depth = 'D99'; },
    (d: any) => { d.shapes[0].raw_target = 'SYNTHETIC_PRIVATE_WINDOW'; }
  ];
  for (const mutate of mutations) { const changed = JSON.parse(JSON.stringify(original)); mutate(changed.searchOpen.eligibility); assert.throws(() => validateSearchPostOpenScan(changed, 'DISCOVER'), /INVALID_RESULT/); }
});

test('review placeholder fragment: observed family on same-origin same-path remains a bound element click', () => {
  for (const suffix of ['#?abc', '#?xyz']) {
    const href = '/search/top?__cft__[0]=SYNTHETIC_TRACKING&__tn__=fixture' + suffix;
    assert.equal(classifySearchTimestampHref(href, search), 'SEARCH_PLACEHOLDER');
    const { discovery, clicks } = runPair(fixture({ href }));
    assert.equal(discovery.searchOpen.targets.length, 1); assert.equal(clicks, 1);
    assert.equal(discovery.searchOpen.targets[0].href_kind, 'SEARCH_PLACEHOLDER');
    assert.equal(JSON.stringify(discovery.searchOpen).includes(suffix), false);
  }
});

test('review placeholder fragment: unsupported family, origin/path/query and post-route fragments remain rejected', () => {
  const base = '/search/top?__tn__=fixture';
  for (const suffix of ['#target', '#?ab', '#?abcd', '#?ABC', '#?ab1', '#%3Fabc', '#??abc', '#?abc/extra']) assert.equal(classifySearchTimestampHref(base + suffix, search), null, suffix);
  for (const href of ['https://m.facebook.com/search/top?__tn__=fixture#?abc', '/search/posts?__tn__=fixture#?abc', '/search/top?unknown=fixture#?abc', '/search/top?q=unrelated#?abc', '/groups/123/?multi_permalinks=456#?abc', '/groups/123/posts/456/#?abc']) assert.equal(classifySearchTimestampHref(href, search), null, href);
});

test('review placeholder fragment: changing only fragment after discovery invalidates the exact href binding', () => {
  const href = '/search/top?__tn__=fixture#?abc', f = fixture({ href });
  const discovery = runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(discovery.searchOpen.status, 'TARGETS_READY');
  f.target.attrs.href = href.replace('#?abc', '#?xyz');
  const clicked = runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(clicked.searchOpen.status, 'STALE_TARGET'); assert.equal(f.target.clicks, 0);
});

test('review preflight equivalence: blocked new-window geometry cannot poison a separately eligible timestamp', () => {
  const f = fixture(), blocked = element('A', { href: '/search/top?__tn__=fixture#?abc', target: '_blank' }, [text('OPAQUE_BLOCKED_LINK')]);
  blocked.getClientRects = () => Array.from({ length: 9 }, () => ({ ...box }));
  blocked.parentElement = f.header; f.header.children.splice(1, 0, blocked);
  const { discovery, clicks } = runPair(f), counters = discovery.searchOpen.eligibility.counters;
  assert.equal(discovery.searchOpen.targets.length, 1); assert.equal(clicks, 1); assert.equal(blocked.clicks, 0);
  assert.equal(counters.new_window, 1); assert.equal(counters.target_visibility_unknown, 0); assert.equal(counters.headers_visibility_unknown, 0);
  assert.equal(blocked.attrs.target, '_blank');
  const shape = discovery.searchOpen.eligibility.shapes.find((s: { stage: string }) => s.stage === 'NEW_WINDOW');
  assert.equal(shape.target_kind, 'BLANK'); assert.equal(shape.preflight, 'COMPLETE');
  assert.equal(shape.pf_visibility, 'UNKNOWN'); assert.equal(shape.pf_viewport, 'RECT_LIMIT'); assert.equal(shape.header_invalidation, 'NONE');
});

test('review preflight equivalence: inspecting a blocked link cannot clear actionable timestamp uncertainty', () => {
  const f = fixture(); f.target.getClientRects = () => Array.from({ length: 9 }, () => ({ ...box }));
  const blocked = element('A', { href: '/search/top?__tn__=fixture#?abc', target: '_blank' }, [text('OPAQUE_BLOCKED_LINK')]);
  blocked.parentElement = f.header; f.header.children.splice(2, 0, blocked);
  const { discovery, clicks } = runPair(f), counters = discovery.searchOpen.eligibility.counters;
  assert.equal(discovery.searchOpen.targets.length, 0); assert.equal(clicks, 0); assert.equal(blocked.clicks, 0);
  assert.equal(counters.target_visibility_unknown, 1); assert.equal(counters.headers_visibility_unknown, 1); assert.equal(counters.new_window, 1);
  const shape = discovery.searchOpen.eligibility.shapes.find((s: { stage: string }) => s.stage === 'NEW_WINDOW');
  assert.equal(shape.preflight, 'COMPLETE'); assert.equal(shape.pf_visibility, 'PASS'); assert.equal(shape.pf_viewport, 'PASS');
});

test('review preflight equivalence: rejected target kinds retain first NEW_WINDOW and never rewrite attributes', () => {
  for (const target of ['_blank', '_parent', '_top', 'SYNTHETIC_PRIVATE_WINDOW']) {
    const f = fixture({ target, rel: 'author', 'aria-haspopup': 'true' });
    f.target.getClientRects = () => Array.from({ length: 9 }, () => ({ ...box }));
    const { discovery, clicks } = runPair(f), d = discovery.searchOpen.eligibility;
    assert.equal(clicks, 0); assert.equal(f.target.attrs.target, target); assert.equal(d.counters.new_window, 1);
    assert.equal(d.counters.popup, 0); assert.equal(d.counters.author, 0); assert.equal(d.counters.target_visibility_unknown, 0);
    assert.equal(d.shapes[0].stage, 'NEW_WINDOW'); assert.equal(JSON.stringify(discovery.searchOpen).includes('SYNTHETIC_PRIVATE_WINDOW'), false);
    const shape = d.shapes[0];
    assert.equal(shape.target_kind, ({ _blank: 'BLANK', _parent: 'PARENT', _top: 'TOP' } as Record<string,string>)[target] ?? 'NAMED');
    assert.equal(shape.preflight, 'COMPLETE'); assert.equal(shape.pf_popup, 'FAIL'); assert.equal(shape.pf_author, 'FAIL');
    assert.equal(shape.pf_header, 'BLOCKED_ANCESTOR'); assert.equal(shape.pf_ancestor, 'POPUP');
    assert.equal(shape.pf_visibility, 'UNKNOWN'); assert.equal(shape.pf_viewport, 'RECT_LIMIT');
  }
});

test('review preflight hard budget: elapsed deadline before dispatch prevents a click', () => {
  const f = fixture();
  const discovery = runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(discovery.searchOpen.status, 'TARGETS_READY');
  let now = 0, targetReads = 0;
  f.context.performance = { now: () => now };
  const original = f.target.getAttribute.bind(f.target);
  f.target.getAttribute = key => {
    // First read is original eligibility; second is the optional preflight attribute read.
    if (key === 'target' && ++targetReads === 2) now = 1000;
    return original(key);
  };
  const clicked = runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(now, 1000); assert.equal(targetReads, 2);
  assert.equal(f.target.clicks, 0, 'hard 1s deadline must prohibit a new click after preflight exhausts time');
  assert.notEqual(clicked.searchOpen.status, 'CLICK_DISPATCHED');
  assert.equal(clicked.timeLimit, true); assert.equal(clicked.searchOpen.status, 'SCAN_INCOMPLETE');
  assert.equal(clicked.searchOpen.eligibility.shapes[0].preflight, 'INCOMPLETE');
});

test('review preflight hard budget: node budget exhausted by telemetry prevents a new click', () => {
  const f = fixture(), body = f.root.children[1]!;
  for (let index = 0; index < 812; index++) { const padding = element('SPAN'); padding.parentElement = body; body.children.push(padding); }
  const discovery = runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(discovery.visited, 2500);
  const clicked = runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(clicked.visited, 2500);
  assert.equal(f.target.clicks, 0, 'exhausted shared work budget must prohibit a new click after preflight');
  assert.notEqual(clicked.searchOpen.status, 'CLICK_DISPATCHED');
  assert.equal(clicked.nodeLimit, true); assert.equal(clicked.searchOpen.status, 'SCAN_INCOMPLETE');
});

const postRoute = 'https://www.facebook.com/groups/987/?multi_permalinks=90071992547409931234';
const exactObservedRoute = postRoute + '&__cft__[0]=SYNTHETIC_TRACKING';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type ReadResult = Awaited<ReturnType<Parameters<typeof createFacebookSearchPostOpen>[0]['read']>>;
function controllerFixture(observedMode = false) {
  const f = fixture(observedMode ? { href: exactObservedRoute } : {}), events = new Set<(event: PostNavigationEvent) => void>(), written = new Map<string, Map<string,unknown>>();
  if (observedMode) setChildren(f.target, [element('SPAN', { 'aria-labelledby': 'SYNTHETIC_PRIVATE_ID', style: 'color: red' }, [text('opaque-clock')])]);
  const navigationUrls: string[] = [];
  let url = search, generation = 0, view = 3, reads = 0, stops = 0, executes = 0;
  const emit = (event: PostNavigationEvent) => { for (const callback of [...events]) callback(event); };
  const setUrl = (value: string) => { url = value; (f.context.location as { href: string }).href = value; };
  f.target.onClick = () => { setUrl(postRoute); emit({ kind: 'SAME_DOCUMENT', url: postRoute, mainFrame: true, source: 'DID_NAVIGATE_IN_PAGE' }); };
  const observation = (): CurrentPostObservation => ({ profile_id: 'review-profile', web_contents_id: 21, view_generation: 3,
    run_id: 'candidate-' + randomUUID(), capture_mode: 'FIXTURE', candidate_file_sha256: digest(randomUUID()), summary_sha256: digest(randomUUID()),
    context_hint: inspectCurrentGroupPostRoute(postRoute)!, text: 'SYNTHETIC_CAFE_POST_BODY', text_status: 'VISIBLE_SNIPPET' });
  const result = (r: CurrentPostObservation): ReadResult => ({ summary: { status: 'SAMPLES_READY', run_id: r.run_id, candidate_file_sha256: r.candidate_file_sha256 },
    directory: 'REVIEW_MEMORY_ONLY', sha256: r.summary_sha256 } as unknown as ReadResult);
  let execute = async (code: string) => runInContext(code, f.context, { timeout: 2000 });
  let navigate = async (value: string) => { emit({ kind: 'START', url: value, mainFrame: true }); generation++; setUrl(value); emit({ kind: 'COMMIT', url: value, mainFrame: true }); };
  let reading = async () => { const r = observation(); engine.observe(r); return result(r); };
  const target: PostRouteTarget = { webContentsId: 21, viewGeneration: 3, url: () => url, documentGeneration: () => generation,
    execute: async code => { executes++; return execute(code); }, navigateObservedRoute: async value => { if (!observedMode) throw Error('UNEXPECTED_LOAD_URL'); navigationUrls.push(value); await navigate(value); },
    watchLoss: () => () => {}, watchNavigation(callback) { events.add(callback); return () => { events.delete(callback); }; } };
  const sink: ReturnType<typeof createPublicCandidateSink> = id => { const files = new Map<string,unknown>(); written.set(id, files);
    return { directory: 'REVIEW_MEMORY_ONLY', write(name, value) { assert.equal(files.has(name), false); const raw = JSON.stringify(value); files.set(name, JSON.parse(raw)); return digest(raw); } }; };
  const engine = createFacebookSearchPostOpen({ resolve: id => id === 'review-profile' ? { ...target, viewGeneration: view } : null,
    read: async () => { reads++; return reading(); }, stopRead: () => { stops++; }, sink, mode: 'FIXTURE', ...(observedMode ? { strategy: 'OBSERVED_URL' as const } : {}) });
  return { f, engine, emit, setUrl, observation, result, written, navigationUrls,
    executeFixed(code: string) { return runInContext(code, f.context, { timeout: 2000 }); },
    onExecute(fn: (code: string) => Promise<unknown>) { execute = fn; }, onRead(fn: () => Promise<ReadResult>) { reading = fn; },
    onNavigate(fn: (value: string) => Promise<void>) { navigate = fn; },
    replaceView() { view++; }, commit() { generation++; }, get reads() { return reads; }, get stops() { return stops; },
    get executes() { return executes; }, get listeners() { return events.size; } };
}
async function withController(work: (h: ReturnType<typeof controllerFixture>) => Promise<void>, observedMode = false) {
  const h = controllerFixture(observedMode); try { await work(h); } finally { h.engine.dispose(); assert.equal(h.listeners, 0); }
}

test('review observed URL: decorated header revalidates its exact bound URL once without clicking or leaking it', () => {
  const f = fixture({ href: exactObservedRoute });
  setChildren(f.target, [element('SPAN', { style: 'color: red', 'aria-labelledby': 'SYNTHETIC_PRIVATE_ID' }, [text('opaque-clock')])]);
  const discovery = runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
  assert.equal(discovery.searchOpen.status, 'TARGETS_READY'); assert.equal(discovery.searchOpen.observed_url, null);
  const shape = discovery.searchOpen.eligibility.shapes.find((s: { stage: string }) => s.stage === 'ELIGIBLE');
  assert.equal(shape.subtree_kind, 'NOT_CHECKED'); assert.equal(shape.pf_subtree_reason, 'ATTR_NOT_ALLOWED'); assert.equal(shape.pf_subtree_attr, 'STYLE');
  const rebound = runInContext(FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT, f.context, { timeout: 2000 });
  const clean = validateSearchPostOpenScan(rebound, 'REVALIDATE', true);
  assert.equal(clean.observedUrl, exactObservedRoute); assert.equal(JSON.stringify(clean.opening).includes('SYNTHETIC'), false);
  assert.equal(clean.opening.targets[0]?.timestamp_proof, 'BOUND_HEADER_GROUP_QUERY_URL'); assert.equal(f.target.clicks, 0);
  assert.equal(runInContext(FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT, f.context, { timeout: 2000 }).searchOpen.status, 'STALE_TARGET');
});

test('review observed URL: interactive descendant roles cannot become a header identity target', () => {
  for (const role of ['menuitem', 'combobox', 'slider']) {
    const f = fixture({ href: exactObservedRoute }); setChildren(f.target, [element('SPAN', { role }, [text('opaque-clock')])]);
    const discovery = runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
    assert.equal(discovery.searchOpen.targets.length, 0, role); assert.equal(f.target.clicks, 0);
  }
});

test('review observed URL: controller performs one exact navigation and binds the fresh callback without clicking', () => withController(async h => {
  const actual = await h.engine.start('review-profile');
  assert.equal(actual.summary.result, 'OPENED_POST_SAMPLE'); assert.deepEqual(h.navigationUrls, [exactObservedRoute]);
  assert.equal(actual.summary.click_count, 0); assert.equal(h.f.target.clicks, 0); assert.equal(h.reads, 1);
  assert.equal((actual.summary as any).navigation_count, 1); assert.equal((actual.summary as any).fresh_document, true);
  for (const secret of [exactObservedRoute, 'SYNTHETIC_TRACKING', '90071992547409931234', 'SYNTHETIC_PRIVATE_ID']) assert.equal(JSON.stringify(actual.summary).includes(secret), false);
  const payload = [...h.written.values()][0]!.get('candidates.json') as any;
  assert.equal(payload.observed_navigation_url, exactObservedRoute);
}, true));

test('review observed URL: owner, generation, search or Stop change after fixed revalidation prevents dispatch', async () => {
  for (const mode of ['owner', 'generation', 'search', 'stop']) await withController(async h => {
    h.onExecute(async code => {
      const value = h.executeFixed(code);
      if (code === FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT) await Promise.resolve().then(() => {
        if (mode === 'owner') h.replaceView(); else if (mode === 'generation') h.commit();
        else if (mode === 'search') h.setUrl(search + '&ref=changed'); else h.engine.stop();
      });
      return value;
    });
    const actual = await h.engine.start('review-profile');
    assert.equal(actual.summary.result, 'INCONCLUSIVE', mode); assert.equal(h.navigationUrls.length, 0, mode); assert.equal(h.reads, 0, mode);
  }, true);
});

test('review observed URL: invalid or cross-origin revalidation URL cannot become navigation input', async () => {
  for (const url of ['javascript:alert(1)', '/groups/987/posts/456/', exactObservedRoute.replace('www.facebook.com', 'm.facebook.com'), exactObservedRoute + '&multi_permalinks=2']) await withController(async h => {
    h.onExecute(async code => { const value = h.executeFixed(code); if (code === FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT) value.searchOpen.observed_url = url; return value; });
    const actual = await h.engine.start('review-profile');
    assert.equal(actual.summary.result, 'INCONCLUSIVE'); assert.equal(h.navigationUrls.length, 0); assert.equal(h.reads, 0);
  }, true);
});

test('review observed URL: Stop while native navigation is pending fences late events and a second operation', () => withController(async h => {
  let release = () => {};
  h.onNavigate(value => new Promise<void>(resolve => { release = () => { h.emit({ kind: 'START', url: value, mainFrame: true }); h.commit(); h.setUrl(value); h.emit({ kind: 'COMMIT', url: value, mainFrame: true }); resolve(); }; }));
  const pending = h.engine.start('review-profile'); await tick(); assert.equal(h.navigationUrls.length, 1);
  h.engine.stop(); const actual = await pending; assert.equal(actual.summary.reason, 'STOPPED'); assert.equal(h.reads, 0);
  await assert.rejects(() => h.engine.start('review-profile'), /BUSY/); const stored = JSON.stringify(actual.summary);
  release(); await tick(); assert.equal(h.reads, 0); assert.equal(JSON.stringify(actual.summary), stored);
}, true));

test('review observed URL: redirects, changed exact tracking and same-document arrival never authorize a read', async () => {
  for (const mode of ['redirect', 'tracking-change', 'same-document']) await withController(async h => {
    h.onNavigate(async value => {
      if (mode === 'redirect') { h.emit({ kind: 'REDIRECT', url: value, mainFrame: true }); return; }
      if (mode === 'same-document') { h.setUrl(value); h.emit({ kind: 'SAME_DOCUMENT', url: value, mainFrame: true }); return; }
      h.emit({ kind: 'START', url: value, mainFrame: true }); h.commit(); h.setUrl(value + '&ref=changed'); h.emit({ kind: 'COMMIT', url: value + '&ref=changed', mainFrame: true });
    });
    const actual = await h.engine.start('review-profile');
    assert.equal(actual.summary.result, 'INCONCLUSIVE', mode); assert.equal(h.navigationUrls.length, 1); assert.equal(h.reads, 0); assert.equal(h.f.target.clicks, 0);
  }, true);
});

test('review search lifecycle: actual placeholder click binds a SPA route and one fresh callback', () => withController(async h => {
  const actual = await h.engine.start('review-profile');
  assert.equal(actual.summary.result, 'OPENED_POST_SAMPLE'); assert.equal(h.f.target.clicks, 1); assert.equal(h.reads, 1);
  assert.equal(actual.summary.click_count, 1); assert.equal(actual.summary.verified_valid_count, 0);
  assert.equal(JSON.stringify(actual.summary).includes(postRoute), false);
}));

test('review search lifecycle: Stop while CLICK result is pending fences late completion and suppresses read', () => withController(async h => {
  let release = () => {};
  h.onExecute(async code => { const value = h.executeFixed(code); if (code === FACEBOOK_SEARCH_POST_CLICK_SCRIPT) await new Promise<void>(resolve => { release = resolve; }); return value; });
  const pending = h.engine.start('review-profile'); await tick();
  assert.equal(h.f.target.clicks, 1); h.engine.stop(); const actual = await pending;
  assert.equal(actual.summary.reason, 'STOPPED'); assert.equal(actual.summary.result, 'INCONCLUSIVE'); assert.equal(h.reads, 0);
  assert.equal(actual.summary.click_confirmation, 'UNCONFIRMED'); await assert.rejects(() => h.engine.start('review-profile'), /BUSY/);
  const stored = JSON.stringify(actual.summary); release(); await tick(); assert.equal(h.reads, 0); assert.equal(JSON.stringify(actual.summary), stored);
}));

test('review search lifecycle: Stop while READ is pending fences late callback and immutable proof', () => withController(async h => {
  let release = () => {};
  h.onRead(() => new Promise<ReadResult>(resolve => { release = () => { const r = h.observation(); h.engine.observe(r); resolve(h.result(r)); }; }));
  const pending = h.engine.start('review-profile'); await tick(); assert.equal(h.reads, 1);
  h.engine.stop(); const actual = await pending; assert.equal(actual.summary.reason, 'STOPPED'); assert.equal(actual.summary.result, 'INCONCLUSIVE'); assert.equal(h.stops, 1);
  await assert.rejects(() => h.engine.start('review-profile'), /BUSY/); const stored = JSON.stringify(actual.summary);
  release(); await tick(); assert.equal(JSON.stringify(actual.summary), stored); assert.equal(actual.summary.body_sha256, null);
}));

test('review search lifecycle: navigation or owner change before selected click cannot produce a successful read', async () => {
  for (const mode of ['spa-before-click', 'owner-before-click']) await withController(async h => {
    h.onExecute(async code => {
      if (code === FACEBOOK_SEARCH_POST_CLICK_SCRIPT) {
        if (mode === 'owner-before-click') { h.replaceView(); h.emit({ kind: 'OWNER_LOST', source: 'DESTROYED' }); return {}; }
        h.setUrl(postRoute); h.emit({ kind: 'SAME_DOCUMENT', url: postRoute, mainFrame: true, source: 'DID_NAVIGATE_IN_PAGE' });
      }
      return h.executeFixed(code);
    });
    const actual = await h.engine.start('review-profile'); assert.equal(actual.summary.result, 'INCONCLUSIVE', mode);
    assert.equal(h.reads, 0, mode); assert.equal(h.f.target.clicks, 0, mode);
  });
});
