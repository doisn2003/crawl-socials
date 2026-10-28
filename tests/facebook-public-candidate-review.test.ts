import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';
import { FACEBOOK_PUBLIC_CANDIDATE_SCRIPT } from '../src/main/facebook-public-candidate-script.js';
import { canonicalCandidateLink, redactCandidateText } from '../src/main/facebook-public-candidate-fields.js';
import { createFacebookPublicCandidateProbe, validatePublicCandidateResult } from '../src/main/facebook-public-candidate.js';

interface Style { display?: string; visibility?: string; opacity?: string; contentVisibility?: string; boxless?: boolean; zeroArea?: boolean; offscreen?: boolean;
  whiteSpace?: string; overflowX?: string; overflowY?: string; clipPath?: string; clip?: string; transform?: string; position?: string }
const rect = (style: Style = {}) => ({width:style.zeroArea ? 0 : 10,height:style.zeroArea ? 0 : 10,
  left:style.offscreen ? 2000 : 10,top:style.offscreen ? 2000 : 10,right:style.offscreen ? 2010 : style.zeroArea ? 10 : 20,bottom:style.offscreen ? 2010 : style.zeroArea ? 10 : 20});
interface N {
  nodeType: number; tagName?: string; nodeValue?: string; parentElement: N | null; children: N[];
  hidden?: boolean; getAttribute?: (key: string) => string | null; getClientRects?: () => unknown[];
  getBoundingClientRect?: () => ReturnType<typeof rect>; clientLeft?: number; clientTop?: number; clientWidth?: number; clientHeight?: number;
  firstElementChild?: N | null; nextElementSibling?: N | null; querySelector?: (selector: string) => N | null;
  style?: Style; childElementCount?: number; rangeVisible?: boolean; rangeZeroArea?: boolean; rangeRects?: ReturnType<typeof rect>[];
}
const t = (value: string): N => ({ nodeType: 3, nodeValue: value, parentElement: null, children: [] });
function e(tag: string, attrs: Record<string,string> = {}, children: N[] = [], style: Style = {}): N {
  const node: N = { nodeType: 1, tagName: tag, children, parentElement: null, hidden: 'hidden' in attrs,
    style, childElementCount: children.filter(child => child.nodeType === 1).length,
    getAttribute: key => attrs[key] ?? null,
    getBoundingClientRect: () => rect(style),clientLeft:0,clientTop:0,clientWidth:rect(style).width,clientHeight:rect(style).height,
    getClientRects: () => 'hidden' in attrs || ['contents','none'].includes(style.display ?? '') || style.boxless ? [] : [rect(style)] };
  for (const child of children) child.parentElement = node;
  const elements = children.filter(child => child.nodeType === 1);
  node.firstElementChild = elements[0] ?? null;
  for (let i = 0; i < elements.length; i++) elements[i]!.nextElementSibling = elements[i + 1] ?? null;
  node.querySelector = selector => descendants(node).find(child => matches(child, selector)) ?? null;
  return node;
}
function descendants(root: N): N[] { return root.children.flatMap(child => [child, ...descendants(child)]); }
function simple(node: N, selector: string): boolean {
  const m = /^([a-z]+)?(?:\[([a-z-]+)(?:(\*?=)"([^"]*)")?\])?$/.exec(selector);
  if (!m) throw new Error('Unsupported review selector: ' + selector);
  const value = m[2] ? node.getAttribute?.(m[2]) : null;
  return node.nodeType === 1 && (!m[1] || node.tagName === m[1].toUpperCase()) &&
    (!m[2] || (m[3] === '*=' ? (value ?? '').includes(m[4]!) : m[3] === '=' ? value === m[4] : value != null));
}
function matches(node: N, selector: string): boolean {
  return selector.split(',').some(part => {
    if (!simple(node, part.split(':not(')[0]!)) return false;
    for (const match of part.matchAll(/:not\(([^)]+)\)/g)) {
      const value = match[1]!;
      if (value.endsWith(' *')) {
        for (let p = node.parentElement; p; p = p.parentElement) if (simple(p, value.slice(0,-2))) return false;
      } else if (simple(node, value)) return false;
    }
    return true;
  });
}
const url = 'https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';
const pid = '90071992547409931234';
const body = (children: N[]) => e('DIV', { 'data-ad-preview': 'message' }, children);
const badge = (label: string) => e('SPAN', { 'aria-label': label });
function post(options: { label?: string; extra?: N[]; after?: N[]; body?: N[]; href?: string } = {}): N {
  return e('DIV', {}, [e('HEADER', {}, [e('H3', {}, [t('AUTHOR_SECRET')]),
    e('A', { href: options.href ?? '/owner/posts/' + pid + '/?token=SECRET' }), e('TIME'),
    badge(options.label ?? 'Public'), ...(options.extra ?? [])]), body(options.body ?? [t('COFFEE_BODY')]), ...(options.after ?? [])]);
}
interface ApiOptions { xpath?: 'missing' | 'throws'; reads?: number[]; range?: 'missing' | 'throws' }
function inspect(children: N[], outside: N[] = [], elapsed = () => 0, api: ApiOptions = {}) {
  return inspectMain([e('DIV', { role: 'feed' }, children)], outside, elapsed, api);
}
function inspectMain(mainChildren: N[], outside: N[] = [], elapsed = () => 0, api: ApiOptions = {}) {
  const documentBody = e('BODY', {}, [...outside, e('MAIN', {}, mainChildren)]);
  const result = runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT, { URL, location: { href: url },
    innerWidth: 1024, innerHeight: 768,
    performance: { now: elapsed }, getComputedStyle: (node: N) => ({ visibility: 'visible', display: 'block', opacity: '1', contentVisibility: 'visible', ...node.style }),
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: { body: documentBody, querySelector: documentBody.querySelector,
      evaluate: api.xpath === 'missing' ? undefined : (expression: string, context: {body: N}, resolver: unknown, type: number, reusable: unknown) => {
        if (api.xpath === 'throws') throw new Error('XPath fixture unavailable');
        assert.equal(expression, '(//input[@type="password" or @autocomplete="one-time-code" or @name="approvals_code"] | //iframe[contains(@src,"/recaptcha/")] | //dialog | //*[@role="dialog" or @role="alert"])[position() <= 17]');
        assert.equal(context.body, documentBody); assert.equal(resolver, null); assert.equal(type, 7); assert.equal(reusable, null);
        // Ordered union of the fixed XPath's actual matching nodes, then the XPath position bound.
        const snapshot = descendants(documentBody).filter(node => node.nodeType === 1 && (
          (node.tagName === 'INPUT' && (node.getAttribute?.('type') === 'password' || node.getAttribute?.('autocomplete') === 'one-time-code' || node.getAttribute?.('name') === 'approvals_code')) ||
          (node.tagName === 'IFRAME' && node.getAttribute?.('src')?.includes('/recaptcha/')) || node.tagName === 'DIALOG' ||
          ['dialog','alert'].includes(node.getAttribute?.('role') ?? '')
        )).slice(0,17);
        return {snapshotLength:snapshot.length,snapshotItem:(index:number) => { api.reads?.push(index); return snapshot[index] ?? null; }};
      },
      createRange: api.range === 'missing' ? undefined : () => { if (api.range === 'throws') throw new Error('Range fixture unavailable');
        let selected: N | null = null; return { selectNodeContents: (node: N) => { selected = node; }, detach: () => {},
        getClientRects: () => {
          if (!selected || selected.rangeVisible === false || !selected.nodeValue) return [];
          for (let p = selected.parentElement; p; p = p.parentElement) {
            if (p.hidden || p.getAttribute?.('aria-hidden') === 'true' || p.style?.display === 'none' ||
              ['hidden','collapse'].includes(p.style?.visibility ?? '') || p.style?.opacity === '0' || p.style?.contentVisibility === 'hidden') return [];
          }
          for (let p = selected.parentElement; p; p = p.parentElement) if (p.style?.offscreen) return [rect({offscreen:true})];
          return selected.rangeRects ?? [rect(selected.rangeZeroArea ? {zeroArea:true} : {})];
        },
      }; },
      createTreeWalker: (root: N, _mask: number, filter: { acceptNode: (node: N) => number }) => {
        const queue = [...root.children]; return { nextNode() {
          while (queue.length) { const node = queue.shift()!; if (filter.acceptNode(node) === 2) continue;
            queue.unshift(...node.children); return node; } return null;
        } };
      },
    },
  }, { timeout: 2000 });
  return validatePublicCandidateResult(result);
}

test('review: body snippet excludes header, embedded article and comments; missing identity stays null', () => {
  const result = inspect([post({ href: '/groups/123/', body: [t('COFFEE_BODY'),
    e('ARTICLE', {}, [badge('Friends'), body([t('EMBEDDED_SECRET')])]),
    e('DIV', { role: 'comment' }, [t('COMMENT_SECRET')])], after: [e('ARTICLE', {}, [badge('Public'), body([t('SHARED_SECRET')])])] })]);
  assert.equal(result.samples.length, 1); const sample = result.samples[0]!;
  assert.equal(sample.text, 'COFFEE_BODY'); assert.equal(sample.post_id, null); assert.equal(sample.permalink, null);
  assert.ok(sample.missing_fields.includes('PERMALINK_NOT_IN_DOM')); assert.equal(sample.boundary_verified, false);
  assert.equal(sample.source_type, 'UNKNOWN'); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('review: sidebar, body or embedded public label cannot grant publicity to an unknown/restricted outer post', () => {
  for (const label of ['', 'Friends']) {
    const result = inspect([post({ label, body: [badge('Public'), t('PRIVATE_BODY')],
      extra: [e('ARTICLE', {}, [badge('Public')])] })], [e('ASIDE', {}, [badge('Public')])]);
    assert.equal(result.samples.length, 0); assert.equal(JSON.stringify(result).includes('PRIVATE_BODY'), false);
  }
});

test('review: direct restricted or sponsored signal after body cannot be ignored', () => {
  for (const label of ['Friends', 'Sponsored']) {
    const result = inspect([post({ after: [e('FOOTER', {}, [badge(label)])], body: [t('RESTRICTED_OR_AD_BODY')] })]);
    assert.equal(result.samples.length, 0, label);
    assert.equal(JSON.stringify(result).includes('RESTRICTED_OR_AD_BODY'), false);
  }
});

test('review: sibling post boundaries and incomplete scans never combine or persist a partial body', () => {
  // This wrapper is both conflicting and ambiguous; either rejection is valid. Test ambiguity alone separately.
  const conflict = inspect([e('DIV', {}, [post(), post({ label: 'Friends', body: [t('PRIVATE_SECOND')] })])]);
  assert.equal(conflict.samples.length, 0);
  assert.equal(conflict.rejected.CONFLICTING_PUBLIC + conflict.rejected.AMBIGUOUS_BOUNDARY, 1);
  assert.equal(JSON.stringify(conflict).includes('PRIVATE_SECOND'), false);
  const combined = inspect([e('DIV', {}, [post(), post({ body: [t('SECOND_PUBLIC_BODY')] })])]);
  assert.equal(combined.samples.length, 0); assert.equal(combined.rejected.AMBIGUOUS_BOUNDARY, 1);
  const partial = inspect([post({ body: Array.from({ length: 2600 }, () => e('SPAN', {}, [t('PARTIAL_SECRET')])) })]);
  assert.equal(partial.visited, 2500); assert.equal(partial.nodeLimit, true); assert.equal(partial.samples.length, 0);
  assert.equal(JSON.stringify(partial).includes('PARTIAL_SECRET'), false);
});

test('review: canonical identity is a post string, aliases dedup, and tracking/contact material is removed', () => {
  assert.equal(canonicalCandidateLink('/groups/42/permalink/' + pid + '/?token=SECRET#tracking')?.post_id, pid);
  for (const link of ['/groups/' + pid, '/profile.php?id=' + pid, '/photo.php?fbid=' + pid,
    '/story.php?story_fbid=' + pid + '&id=1&id=2', 'https://facebook.com.evil.test/owner/posts/' + pid]) {
    assert.equal(canonicalCandidateLink(link), null);
  }
  const result = inspect([post(), post({ href: '/story.php?story_fbid=' + pid + '&id=42&token=SECRET' })]);
  assert.equal(result.samples.length, 1); assert.equal(result.rejected.DUPLICATE_ID, 1);
  assert.equal(result.samples[0]?.post_id, pid); assert.equal(result.samples[0]?.permalink?.includes('SECRET'), false);
  assert.equal(redactCandidateText('0901234567 contact@example.test token=SECRET'), '[NUMBER] [EMAIL] [REDACTED]');
});

test('review: phone number split across visible DOM text nodes is still redacted before persistence', () => {
  const result = inspect([post({ body: [t('Call '), e('SPAN', {}, [t('090')]), e('SPAN', {}, [t('123')]), e('SPAN', {}, [t('4567')])] })]);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0]?.contacts_redacted, true);
  assert.ok(result.samples[0]?.text?.includes('[NUMBER]'));
  assert.equal((result.samples[0]?.text ?? '').replace(/\D/g, '').includes('0901234567'), false);
});

function memoryProbe(read: () => Promise<unknown>) {
  const files = new Map<string,unknown>(); let loss: (() => void) | null = null;
  const probe = createFacebookPublicCandidateProbe({ mode: 'FIXTURE',
    sink: () => ({ directory: 'in-memory-review', write: (name, value) => {
      files.set(name, value); return createHash('sha256').update(JSON.stringify(value)).digest('hex');
    } }), resolve: () => ({ webContentsId: 1, viewGeneration: 1, url: () => url,
      execute: async code => { assert.equal(code, FACEBOOK_PUBLIC_CANDIDATE_SCRIPT); return read(); },
      watchLoss: callback => { loss = callback; return () => { loss = null; }; },
    }),
  });
  return { probe, files, lose: () => loss?.() };
}

test('review: payload content and canonical URL cannot enter summary/return/started envelope', async () => {
  const fixture = memoryProbe(async () => inspect([post()])); const result = await fixture.probe.start('PROFILE_SECRET');
  assert.equal(result.summary.candidate_count, 1); assert.equal(result.summary.verified_valid_count, 0);
  assert.equal(result.summary.platform_permission, 'UNKNOWN'); assert.equal(result.summary.benchmark_eligible, false);
  assert.equal(result.summary.capture_mode, 'FIXTURE');
  assert.ok(JSON.stringify(fixture.files.get('candidates.json')).includes('COFFEE_BODY'));
  for (const value of [result, fixture.files.get('summary.json'), fixture.files.get('started.json')]) {
    assert.equal(/COFFEE_BODY|https:|PROFILE_SECRET|90071992547409931234/.test(JSON.stringify(value)), false);
  }
});

test('review: Stop and owner loss reject late content without replacing empty payload', async () => {
  for (const reason of ['STOPPED', 'OWNER_CHANGED']) {
    let release!: (value: unknown) => void;
    const fixture = memoryProbe(() => new Promise(resolve => { release = resolve; }));
    const pending = fixture.probe.start('PROFILE_SECRET'); await tick();
    if (reason === 'STOPPED') fixture.probe.stop(); else fixture.lose();
    const result = await pending; assert.equal(result.summary.status, reason);
    assert.equal(result.summary.candidate_count, 0); const before = JSON.stringify([...fixture.files]);
    await assert.rejects(fixture.probe.start('another'), /BUSY/);
    release(inspect([post()])); await tick(); assert.equal(JSON.stringify([...fixture.files]), before);
    assert.equal(before.includes('COFFEE_BODY'), false);
  }
});

const auxiliaryFeed = (count = 7) => e('DIV', { role: 'feed' }, Array.from({ length: count }, () => e('DIV', {}, [t('AUXILIARY_SECRET')])));
function wrap(count: number, node: N): N { for (let i = 0; i < count; i++) node = e('DIV', {}, [node]); return node; }

test('review v2: fallback skips an auxiliary feed and reads an outer article without embedded/comment text', () => {
  const outer = e('ARTICLE', {}, post({ body: [t('OUTER_COFFEE_BODY'),
    e('ARTICLE', {}, post({ label: 'Friends', body: [t('EMBEDDED_PRIVATE')] }).children),
    e('DIV', { role: 'comment' }, [t('COMMENT_PRIVATE')])], after: [e('ARTICLE', {}, post({ body: [t('SHARED_PRIVATE')] }).children)] }).children);
  const result = inspectMain([auxiliaryFeed(), e('SECTION', {}, [outer])]);
  assert.equal(result.version, 13); assert.equal(result.root, 'MAIN_FALLBACK');
  assert.equal(result.selection.fallbackUsed, true); assert.equal(result.selection.feedLandmarks, false);
  assert.equal(result.selection.feedExamined, 6); assert.equal(result.selection.mainExamined, 1);
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0]?.boundary, 'MAIN_ARTICLE_HEADER_TEMPORAL');
  assert.equal(result.samples[0]?.text, 'OUTER_COFFEE_BODY');
  assert.equal(/AUXILIARY_SECRET|EMBEDDED_PRIVATE|COMMENT_PRIVATE|SHARED_PRIVATE/.test(JSON.stringify(result)), false);
});

test('review: a single deep feed-child wrapper has a bounded header cluster without allowing a private counterpart', () => {
  const result = inspect([wrap(7, post())]);
  assert.equal(result.selection.feedLandmarks, true);
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0]?.boundary, 'FEED_CHILD_HEADER_TEMPORAL');
  assert.equal(result.samples[0]?.text, 'COFFEE_BODY');
  const restricted = inspect([wrap(7, post({ label: 'Friends', body: [t('DEEP_PRIVATE')] }))]);
  assert.equal(restricted.samples.length, 0); assert.equal(JSON.stringify(restricted).includes('DEEP_PRIVATE'), false);
});

test('review v2: feed examination, discovery and candidate recheck share one 2500-node budget', () => {
  // Feed padding must finish before fallback; each element now also spends clip-context work.
  const result = inspectMain([e('DIV', { role: 'feed' }, [e('DIV', {}, Array.from({ length: 500 }, () => e('SPAN')))]),
    post({ body: Array.from({ length: 1500 }, () => e('SPAN', {}, [t('OVER_CAP_PRIVATE')])) })]);
  assert.equal(result.visited, 2500); assert.equal(result.nodeLimit, true);
  assert.equal(result.selection.fallbackScan, 'PARTIAL'); assert.equal(result.samples.length, 0);
  assert.equal(result.selection.feedExamined,1);assert.ok(result.selection.mainExamined>0);
  assert.ok(result.rejectionShapes.some(shape => shape.state === 'PARTIAL' && shape.reason === 'INCOMPLETE_BOUNDARY'));
  assert.ok(result.rejectionShapes.length <= 5); assert.equal(JSON.stringify(result).includes('OVER_CAP_PRIVATE'), false);
});

test('review v2: rejection shapes preserve not-scanned uncertainty and contain only bounded enums/counts', async () => {
  const result = inspectMain([auxiliaryFeed(), ...Array.from({ length: 7 }, () => e('DIV', { role: 'SECRET_ROLE', 'aria-label': 'SECRET_NAME' },
    [body([t('UNMATCHED_SECRET_BODY')])]))]);
  assert.equal(result.samples.length, 0); assert.ok(result.rejectionShapes.length <= 5);
  assert.ok(result.rejectionShapes.some(shape => shape.state === 'NOT_SCANNED' && shape.reason === 'NO_COLOCATED_BOUNDARY'));
  assert.equal(/SECRET_ROLE|SECRET_NAME|UNMATCHED_SECRET_BODY|AUXILIARY_SECRET/.test(JSON.stringify(result)), false);
  assert.throws(() => validatePublicCandidateResult({ ...result, version: 1 }), /INVALID_RESULT/);
  assert.throws(() => validatePublicCandidateResult({ ...result, rejectionShapes: [{ ...result.rejectionShapes[0], text: 'SECRET' }] }), /INVALID_RESULT/);
  const fixture = memoryProbe(async () => result); const report = await fixture.probe.start('PROFILE_SECRET');
  assert.equal(report.summary.version, 13); assert.equal(report.summary.candidate_count, 0);
  assert.equal(/SECRET|https:/.test(JSON.stringify(report)), false);
});

const ownHeader = () => post().children[0]!;
const contents: Style = { display: 'contents' };
const aliasBody = (value: N[]) => e('DIV', { 'data-ad-preview': 'message' }, [
  e('DIV', {}, [e('SPAN', { 'data-ad-comet-preview': 'message' }, value, contents)], contents),
], contents);

test('review v3: boxless wrappers pass traversal; visible text ranges and deep header cluster support a pure nested alias', () => {
  for (const wrapperStyle of [contents, { boxless: true }]) {
    const header = e('HEADER', {}, ownHeader().children, contents);
    const candidate = e('ARTICLE', {}, [wrap(10, header), aliasBody([t('LAYOUT_COFFEE_BODY')])], wrapperStyle);
    const result = inspectMain([e('DIV', { role: 'feed' }, [candidate], contents)]);
    assert.equal(result.version, 13); assert.equal(result.samples.length, 1);
    assert.equal(result.samples[0]?.text, 'LAYOUT_COFFEE_BODY'); assert.equal(result.samples[0]?.metadata.messageRegions, 1);
    assert.equal(result.diagnostics.messages.markers, 2); assert.equal(result.diagnostics.messages.nestedAliases, 1);
    assert.ok(result.diagnostics.layout.textRanges > 0); assert.ok(result.diagnostics.headers.deepHints > 0);
    assert.equal(result.samples[0]?.boundary_verified, false);
  }
});

test('review v3: hidden ancestry cannot be undone by visible descendants; boxless public badge alone is not proof', () => {
  const hiddenCases: [Record<string,string>,Style][] = [
    [{hidden:''},{}], [{'aria-hidden':'true'},{}], [{},{display:'none'}], [{},{visibility:'hidden'}],
    [{},{visibility:'collapse'}], [{},{opacity:'0'}], [{},{contentVisibility:'hidden'}],
  ];
  for (const [attrs,style] of hiddenCases) {
    const result = inspectMain([e('DIV', attrs, [e('DIV', {role:'feed'}, [post({body:[t('HIDDEN_SUBTREE_PRIVATE')]})], {visibility:'visible'})], style)]);
    assert.equal(result.samples.length, 0); assert.equal(JSON.stringify(result).includes('HIDDEN_SUBTREE_PRIVATE'), false);
  }
  const header = e('HEADER', {}, [e('H3'), e('TIME'), e('SPAN', {'aria-label':'Public'}, [], contents)]);
  const result = inspect([e('DIV', {}, [header, body([t('NO_VISIBLE_BADGE_PRIVATE')])])]);
  assert.equal(result.samples.length, 0); assert.equal(JSON.stringify(result).includes('NO_VISIBLE_BADGE_PRIVATE'), false);
});

test('review v3: nested marker aliases do not include independent text, inner story, quote, sibling or disjoint bodies', () => {
  const cases = [
    [body([t('OUTER_PRIVATE'), e('DIV', {'data-ad-comet-preview':'message'}, [t('INNER_PRIVATE')])])],
    [body([e('DIV', {'data-ad-comet-preview':'message'}, [ownHeader(), t('INNER_STORY_PRIVATE')])])],
    [body([e('BLOCKQUOTE', {}, [e('DIV', {'data-ad-comet-preview':'message'}, [t('QUOTE_PRIVATE')])])])],
    [body([t('SIBLING_PRIVATE_A')]), e('DIV', {'data-ad-comet-preview':'message'}, [t('SIBLING_PRIVATE_B')])],
    [e('SECTION', {}, [body([t('DISJOINT_PRIVATE_A')])]), e('DIV', {}, [e('DIV', {'data-ad-comet-preview':'message'}, [t('DISJOINT_PRIVATE_B')])])],
  ];
  for (const regions of cases) {
    const result = inspect([e('DIV', {}, [ownHeader(), ...regions])]);
    assert.equal(result.samples.length, 0,JSON.stringify({caseIndex:cases.indexOf(regions),samples:result.samples.length,quotedPayload:JSON.stringify(result).includes('QUOTE_PRIVATE')})); assert.equal(result.rejected.AMBIGUOUS_BOUNDARY, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('review v3: deep header cannot borrow public from body, sidebar or embedded story, or time from another cluster', () => {
  for (const source of ['body','sidebar','embedded']) {
    const header = e('HEADER', {}, [e('H3'), e('TIME')]);
    const candidate = e('DIV', {}, [wrap(10, header),
      ...(source === 'embedded' ? [e('ARTICLE', {}, [badge('Public')])] : []),
      body([...(source === 'body' ? [badge('Public')] : []), t('DEEP_UNPROVEN_PRIVATE')])]);
    const result = inspect([candidate], source === 'sidebar' ? [e('ASIDE', {}, [badge('Public')])] : []);
    assert.equal(result.samples.length, 0); assert.equal(JSON.stringify(result).includes('DEEP_UNPROVEN_PRIVATE'), false);
  }
  const split = inspect([e('DIV', {}, [e('DIV', {}, [e('H3'), e('TIME')]),
    e('DIV', {}, [badge('Public'), body([t('BORROWED_CLUSTER_PRIVATE')])])])]);
  assert.equal(split.samples.length, 0); assert.equal(split.rejected.NO_HEADER_CLUSTER, 1);
});

test('review v3: alias normalization stays partial at the global cap; layout diagnostics reject values/raw payload', () => {
  const result = inspect([e('ARTICLE', {}, [ownHeader(), aliasBody(Array.from({length:2600}, () => e('SPAN', {}, [t('PARTIAL_ALIAS_PRIVATE')])) )])]);
  assert.equal(result.visited, 2500); assert.equal(result.nodeLimit, true); assert.equal(result.samples.length, 0);
  assert.ok(result.rejectionShapes.some(shape => shape.state === 'PARTIAL' && !shape.messages.groupingComplete));
  assert.equal(JSON.stringify(result).includes('PARTIAL_ALIAS_PRIVATE'), false);
  for (const invalid of [{...result,version:2}, {...result,diagnostics:{...result.diagnostics,style:'display:contents'}},
    {...result,diagnostics:{...result.diagnostics,layout:{...result.diagnostics.layout,contents:['1']}}},
  ]) assert.throws(() => validatePublicCandidateResult(invalid), /INVALID_RESULT/);
});

test('review overlay: empty boxless/contents/zero-area alerts and dialogs outside main do not block a post', () => {
  for (const role of ['alert', 'dialog']) for (const style of [{boxless:true}, contents, {zeroArea:true}]) {
    const result = inspect([post()], [e('DIV', {role}, [], style)]);
    assert.equal(result.samples.length, 1, role + '/' + JSON.stringify(style));
    assert.equal(result.status, 'SAMPLES_READY');
    assert.equal(result.barriers.state, 'CLEAR'); assert.equal(result.barriers.empty, 1);
  }
});

test('review overlay: visible overlays and contents wrappers with visible descendants still stop', () => {
  for (const role of ['alert', 'dialog']) for (const style of [{}, contents]) {
    const result = inspect([post()], [e('DIV', {role}, [e('SPAN', {}, [t('VISIBLE_OVERLAY_PRIVATE')])], style)]);
    assert.equal(result.status, 'UNSUPPORTED_OVERLAY'); assert.equal(result.samples.length, 0);
    assert.equal(result.barriers.state, 'VISIBLE'); assert.equal(result.barriers.visible, 1);
    assert.equal(JSON.stringify(result).includes('VISIBLE_OVERLAY_PRIVATE'), false);
  }
});

test('review overlay: a hidden ancestor prevents a visible descendant alert from becoming a barrier', () => {
  for (const style of [{display:'none'}, {visibility:'hidden'}, {opacity:'0'}]) {
    const result = inspect([post()], [e('DIV', {}, [e('DIV', {role:'alert'}, [t('HIDDEN_ALERT_PRIVATE')], {visibility:'visible'})], style)]);
    assert.equal(result.samples.length, 1, JSON.stringify(style));
    assert.equal(result.barriers.state, 'CLEAR'); assert.equal(result.barriers.hidden, 1);
    assert.equal(JSON.stringify(result).includes('HIDDEN_ALERT_PRIVATE'), false);
  }
});

test('review overlay: skipped first empty or hidden alert cannot mask a second visible blocker outside main', () => {
  for (const style of [contents, {boxless:true}, {display:'none'}, {visibility:'hidden'}]) {
    const result = inspect([post()], [e('DIV', {role:'alert'}, [], style),
      e('DIV', {role:'alert'}, [e('SPAN', {}, [t('SECOND_ALERT_PRIVATE')])])]);
    assert.equal(result.status, 'UNSUPPORTED_OVERLAY', JSON.stringify(style));
    assert.equal(result.samples.length, 0); assert.equal(JSON.stringify(result).includes('SECOND_ALERT_PRIVATE'), false);
    assert.equal(result.barriers.inspected, 2); assert.equal(result.barriers.visible, 1);
    assert.equal(result.barriers.empty + result.barriers.hidden, 1);
  }
});

test('review v4: ordered XPath processes16 and stops incomplete on a17th sentinel, including a visible sentinel', () => {
  const reads: number[] = [];
  const alerts = () => Array.from({length:16}, () => e('DIV', {role:'alert'}, [], contents));
  const clear = inspect([post()], alerts(), () => 0, {reads});
  assert.equal(clear.barriers.state, 'CLEAR'); assert.equal(clear.barriers.inspected, 16); assert.equal(clear.samples.length, 1);
  assert.deepEqual(reads, Array.from({length:16}, (_,i) => i));
  reads.length = 0;
  const overflow = inspect([post()], [...alerts(), e('DIV', {role:'alert'}, [t('SENTINEL_PRIVATE')])], () => 0, {reads});
  assert.equal(overflow.status, 'BARRIER_SCAN_INCOMPLETE'); assert.equal(overflow.barriers.reason, 'CANDIDATE_LIMIT');
  assert.equal(overflow.barriers.state, 'INCOMPLETE'); assert.equal(overflow.barriers.overflow, true);
  assert.equal(overflow.barriers.inspected, 16); assert.equal(overflow.samples.length, 0);
  assert.deepEqual(reads, Array.from({length:16}, (_,i) => i)); assert.equal(overflow.root, 'NONE');
});

test('review v4:128 descendant checks are global and ancestor32 bounds return incomplete, never clear', () => {
  const empty = (count:number) => e('DIV', {role:'alert'}, Array.from({length:count}, () => e('SPAN')));
  const clear = inspect([post()], [empty(64), empty(64)]);
  assert.equal(clear.barriers.state, 'CLEAR'); assert.equal(clear.barriers.descendants, 128); assert.equal(clear.samples.length, 1);
  const capped = inspect([post()], [empty(64), empty(65)]);
  assert.equal(capped.status, 'BARRIER_SCAN_INCOMPLETE'); assert.equal(capped.barriers.reason, 'DESCENDANT_LIMIT');
  assert.equal(capped.barriers.descendants, 128); assert.equal(capped.samples.length, 0);
  const ancestorClear = inspect([post()], [wrap(30, e('DIV', {role:'alert'}, [], contents))]);
  assert.equal(ancestorClear.barriers.state, 'CLEAR'); assert.equal(ancestorClear.barriers.ancestors, 32);
  const ancestorCapped = inspect([post()], [wrap(31, e('DIV', {role:'alert'}, [], contents))]);
  assert.equal(ancestorCapped.status, 'BARRIER_SCAN_INCOMPLETE'); assert.equal(ancestorCapped.barriers.reason, 'ANCESTOR_LIMIT');
  assert.equal(ancestorCapped.barriers.ancestors, 32); assert.equal(ancestorCapped.samples.length, 0);
});

test('review v4: barrier checks spend the same2500-node budget used by extraction', () => {
  // Leave16 visits below the cap after geometry costs; the16 barriers add32 ancestry visits.
  const compact = inspect([post({body:[t('CAP_PRIVATE_BODY')]})]); assert.equal(compact.samples.length,1);
  const extra = inspect([post({body:[e('SPAN'),t('CAP_PRIVATE_BODY')]})]);assert.equal(extra.samples.length,1);
  const unitCost=extra.visited-compact.visited;assert.ok(unitCost>0);
  const padding = Math.floor((2500 - compact.visited - 16)/unitCost); assert.ok(padding > 0);
  const candidate = () => post({body:[...Array.from({length:padding}, () => e('SPAN')), t('CAP_PRIVATE_BODY')]});
  assert.equal(inspect([candidate()]).samples.length, 1);
  const bounded = inspect([candidate()], Array.from({length:16}, () => e('DIV', {role:'alert'}, [], contents)));
  assert.equal(bounded.barriers.state, 'CLEAR'); assert.equal(bounded.barriers.ancestors, 32);
  assert.equal(bounded.visited, 2500); assert.equal(bounded.nodeLimit, true); assert.equal(bounded.samples.length, 0);
  assert.equal(JSON.stringify(bounded).includes('CAP_PRIVATE_BODY'), false);
});

test('review v4: unavailable XPath and elapsed barrier deadline are incomplete and retain no content', () => {
  for (const xpath of ['missing','throws'] as const) {
    const result = inspect([post()], [], () => 0, {xpath});
    assert.equal(result.status, 'BARRIER_SCAN_INCOMPLETE'); assert.equal(result.barriers.reason, 'API_UNAVAILABLE');
    assert.equal(result.barriers.state, 'INCOMPLETE'); assert.equal(result.samples.length, 0); assert.equal(result.root, 'NONE');
  }
  let calls = 0;
  const timed = inspect([post()], [e('DIV', {role:'alert'}, [], contents)], () => calls++ === 0 ? 0 : 1001);
  assert.equal(timed.status, 'BARRIER_SCAN_INCOMPLETE'); assert.equal(timed.barriers.reason, 'TIME_LIMIT');
  assert.equal(timed.timeLimit, true); assert.equal(timed.samples.length, 0);
});

test('review v4: viewport-aware overlay text, auth/challenge/denied and metadata remain bounded and sanitized', () => {
  const offscreen = inspect([post()], [e('DIV', {role:'alert'}, [t('OFFSCREEN_PRIVATE')], {offscreen:true})]);
  assert.equal(offscreen.barriers.state, 'CLEAR'); assert.equal(offscreen.samples.length, 1);
  const cases: [N,string,string][] = [
    [e('DIV', {role:'alert'}, [t('Access denied')], contents), 'ACCESS_DENIED', 'DENIED_TEXT'],
    [e('DIV', {role:'alert'}, [t('Confirm your identity')], contents), 'CHALLENGE', 'CHALLENGE_TEXT'],
    [e('INPUT', {type:'password',value:'PASSWORD_PRIVATE'}), 'AUTH_REQUIRED', 'AUTH_FIELD'],
    [e('IFRAME', {src:'https://www.google.com/recaptcha/enterprise/anchor?token=PRIVATE'}), 'CHALLENGE', 'CHALLENGE_FRAME'],
  ];
  for (const [node,status,evidence] of cases) {
    const result = inspect([post()], [node]); assert.equal(result.status, status); assert.equal(result.samples.length, 0);
    assert.equal(result.barriers.state, 'VISIBLE'); assert.equal(result.barriers.evidence, evidence);
    assert.equal(/PRIVATE|https:|Access denied|Confirm your identity/.test(JSON.stringify(result)), false);
    for (const bad of [{...result,version:3}, {...result,barriers:{...result.barriers,text:'PRIVATE'}},
      {...result,barriers:{...result.barriers,state:'CLEAR'}}, {...result,barriers:{...result.barriers,inspected:17}},
    ]) assert.throws(() => validatePublicCandidateResult(bad), /INVALID_RESULT/);
  }
});

test('review R-O4: direct FORM challenge/denied paths record visible metadata and clear earlier staged samples', () => {
  const cases = [
    ['Confirm your identity', 'CHALLENGE', 'CHALLENGE', 'CHALLENGE_TEXT'],
    ['Access denied', 'ACCESS_DENIED', 'DENIED', 'DENIED_TEXT'],
  ] as const;
  assert.equal(inspect([post({body:[t('EARLIER_STAGED_PRIVATE')]})]).samples.length, 1);
  for (const [label,status,kind,evidence] of cases) for (const placement of ['header','body']) {
    // No alert/dialog/input/iframe matches: this must exercise the text-in-FORM guard during extraction.
    const form = e('FORM', {}, [t(label)]);
    const guarded = post({href:'/owner/posts/222/',
      ...(placement === 'header' ? {extra:[form]} : {body:[t('FORM_BODY_PRIVATE'),form]})});
    const reads: number[] = [];
    const result = inspect([post({body:[t('EARLIER_STAGED_PRIVATE')]}),guarded], [], () => 0, {reads});
    assert.deepEqual(reads, []); assert.equal(result.examined, 2);
    assert.equal(result.status, status); assert.equal(result.samples.length, 0);
    assert.equal(result.barriers.state, 'VISIBLE'); assert.equal(result.barriers.reason, 'NONE');
    assert.equal(result.barriers.inspected, 1); assert.equal(result.barriers.visible, 1);
    assert.equal(result.barriers.kind, kind); assert.equal(result.barriers.evidence, evidence);
    assert.equal(/PRIVATE|Confirm your identity|Access denied|https:/.test(JSON.stringify(result)), false);
    for (const state of ['CLEAR','NOT_STARTED','INCOMPLETE']) {
      assert.throws(() => validatePublicCandidateResult({...result,barriers:{...result.barriers,state}}), /INVALID_RESULT/);
    }
    assert.throws(() => validatePublicCandidateResult({...result,status:'NO_PUBLIC_CANDIDATE'}), /INVALID_RESULT/);
  }
});

test('review R-O4: direct FORM guards share the16-candidate quota and exhausted quota clears staged content', () => {
  for (const label of ['Confirm your identity','Access denied']) for (const count of [15,16]) {
    const result = inspect([post({body:[t('QUOTA_STAGED_PRIVATE')]}),post({href:'/owner/posts/333/',
      body:[t('FORM_QUOTA_PRIVATE'),e('FORM', {}, [t(label)])]})],
      Array.from({length:count}, () => e('DIV', {role:'alert'}, [], contents)));
    assert.equal(result.examined, 2); assert.equal(result.samples.length, 0);
    assert.equal(result.barriers.inspected, 16); assert.equal(result.barriers.empty, count);
    assert.equal(result.barriers.overflow, false); // No XPath sentinel; exhaustion occurs in the FORM path.
    assert.equal(result.barriers.state, count === 15 ? 'VISIBLE' : 'INCOMPLETE');
    assert.equal(result.barriers.reason, count === 15 ? 'NONE' : 'CANDIDATE_LIMIT');
    assert.equal(result.barriers.visible, count === 15 ? 1 : 0);
    if (count === 16) {
      assert.equal(result.status, 'BARRIER_SCAN_INCOMPLETE');
      assert.equal(result.barriers.kind, 'NONE'); assert.equal(result.barriers.evidence, 'NONE');
    }
    assert.equal(/PRIVATE|Confirm your identity|Access denied|https:/.test(JSON.stringify(result)), false);
  }
});

function temporalHeaderPost(time: N, label = 'Public', extra: N[] = []): N {
  return e('DIV', {}, [e('HEADER', {}, [e('H3', {}, [t('TEMPORAL_AUTHOR_PRIVATE')]),
    e('A', {href:'/owner/posts/' + pid}),time,badge(label),...extra]),body([t('TEMPORAL_COFFEE_BODY')])]);
}
const directDate = () => e('A', {}, [t('2 giờ')]);
const temporalCases: [string, () => N][] = [
  ['nested anchor text', () => e('A', {}, [e('SPAN', {}, [t('2 giờ')])])],
  ['split anchor text', () => e('A', {}, [e('SPAN', {}, [t('2')]),t(' '),e('SPAN', {}, [t('giờ')])])],
  ['role link text', () => e('SPAN', {role:'link'}, [e('SPAN', {}, [t('2 giờ')])])],
  ['temporal anchor with button role', () => e('A', {role:'button'}, [e('SPAN', {}, [t('2 giờ')])])],
  ['boxless anchor and nested visible text', () => e('A', {}, [e('SPAN', {}, [t('2 giờ')], contents)], contents)],
];
for (const [name,makeTime] of temporalCases) test('review temporal: ' + name + ' stays within its public header cluster', () => {
  assert.equal(inspect([temporalHeaderPost(directDate())]).samples.length, 1); // Same header succeeds with direct text.
  const result = inspect([temporalHeaderPost(makeTime())]);
  assert.equal(result.samples.length, 1, name);
  assert.equal(result.samples[0]!.text, 'TEMPORAL_COFFEE_BODY');
  assert.ok(result.samples[0]!.metadata.temporal > 0);
  assert.equal(JSON.stringify(result).includes('TEMPORAL_AUTHOR_PRIVATE'), false);
  assert.equal(inspect([temporalHeaderPost(makeTime(),'Friends')]).samples.length, 0);
});

test('review temporal: body, comment, embedded story and quoted dates cannot grant time to the outer header', () => {
  const formats: [string, () => N][] = [
    ['body', () => body([directDate()])],
    ['comment', () => e('DIV', {role:'comment'}, [directDate()])],
    ['embedded', () => e('ARTICLE', {}, [directDate()])],
    ['blockquote', () => e('BLOCKQUOTE', {}, [directDate()])],
    ['q', () => e('Q', {}, [directDate()])],
  ];
  for (const [name,makeRegion] of formats) {
    const result = inspect([temporalHeaderPost(makeRegion())]);
    if(name==='body')assert.equal(result.samples.length,0); // A second body still makes the boundary ambiguous.
    else assertOptionalTemporalCandidate(result,'MISSING');
    assert.equal(result.diagnostics.temporal.date+result.diagnostics.temporal.relative+result.diagnostics.temporal.dayWord+result.diagnostics.temporal.abbreviated,0);
  }
});

test('review temporal: hidden date pieces or ordinary controls never provide a visible temporal signal', () => {
  const formats: [string, () => N][] = [
    ['hidden span', () => e('A', {}, [e('SPAN', {}, [t('2 giờ')], {display:'none'})])],
    ['hidden unit', () => e('A', {}, [t('2 '),e('SPAN', {}, [t('giờ')], {visibility:'hidden'})])],
    ['hidden ancestor', () => e('DIV', {}, [e('A', {}, [t('2 giờ')], {visibility:'visible'})], {display:'none'})],
    ['ordinary button', () => e('BUTTON', {}, [t('Xem thêm'),e('SPAN', {}, [t('2 giờ')])])],
    ['plain text', () => e('SPAN', {}, [t('2 giờ')])],
  ];
  for(const [,makeTime] of formats)assertOptionalTemporalCandidate(inspect([temporalHeaderPost(makeTime())]),'MISSING');
});

test('review temporal: date/public from a separate header cannot complete an unrelated heading or combine posts', () => {
  const split = e('DIV', {}, [e('HEADER', {}, [e('H3')]),
    e('HEADER', {}, [directDate(),badge('Public')]),body([t('SPLIT_HEADER_PRIVATE')])]);
  const two = e('DIV', {}, [temporalHeaderPost(directDate()),temporalHeaderPost(directDate(),'Friends')]);
  for (const candidate of [split,two]) {
    const result = inspect([candidate]); assert.equal(result.samples.length, 0);
    assert.equal(/SPLIT_HEADER_PRIVATE|TEMPORAL_COFFEE_BODY/.test(JSON.stringify(result)), false);
  }
});

test('review temporal: a deep invalid tail must not promote the retained date prefix', () => {
  const time = e('A', {}, [t('2 giờ'),wrap(8,e('SPAN', {}, [t(' NOT_A_TIMESTAMP')]))]);
  const result = inspect([temporalHeaderPost(time)]);
  assertOptionalTemporalCandidate(result,'MISSING');
  assert.ok(result.diagnostics.temporal.classifierMisses > 0);
  assert.equal(JSON.stringify(result).includes('NOT_A_TIMESTAMP'), false);
});

test('review temporal: whitespace text nodes cannot fuse separate number tokens into a valid date', () => {
  const time = e('A', {}, [e('SPAN', {}, [t('1')]),t(' '),e('SPAN', {}, [t('2 giờ')])]);
  const result = inspect([temporalHeaderPost(time)]);
  assertOptionalTemporalCandidate(result,'MISSING'); // Rendered whole text is "1 2 giờ", not "12 giờ".
});

test('review temporal: field limits never promote a date and control interruption still rejects an incomplete candidate', () => {
  const long = inspect([temporalHeaderPost(e('A', {}, [t('2 giờ'),t('x'.repeat(97))]))]);
  const parts = inspect([temporalHeaderPost(e('A', {}, [...'2 giờ'.padEnd(97,' ')].map(char => e('SPAN', {}, [t(char)])),{whiteSpace:'pre'}))]);
  const links = inspect([temporalHeaderPost(e('DIV', {}, [...Array.from({length:16}, () => e('A', {}, [t('ordinary')])),directDate()]))]);
  const probe = inspect([temporalHeaderPost(e('BUTTON', {}, [...Array.from({length:65}, () => e('SPAN')),t('2 giờ')]))]);
  for (const result of [long,parts,links,probe]) {
    assert.ok(result.diagnostics.temporal.textLimits > 0);
    if(result===probe||result===parts){assert.equal(result.samples.length,0);assert.equal(JSON.stringify(result).includes('TEMPORAL_COFFEE_BODY'),false);}
    else assertOptionalTemporalCandidate(result,'UNREADABLE');
  }
  assert.ok(long.diagnostics.temporal.charLimits > 0); assert.equal(long.diagnostics.temporal.textNodeLimits, 0);
  assert.ok(parts.diagnostics.temporal.charLimits > 0); assert.ok(parts.diagnostics.temporal.textNodeLimits > 0);
  assert.ok(parts.diagnostics.layout.negativeUnresolved>0); // 97 fragments also exceed the bounded negative-label audit introduced by ADR-013.
  assert.ok(links.diagnostics.temporal.recordLimits > 0); assert.ok(probe.diagnostics.temporal.probeLimits > 0);
  assert.equal(probe.diagnostics.temporal.probeNodes, 64);
  for (const malformed of [{...probe,version:12},
    {...probe,diagnostics:{...probe.diagnostics,temporal:{...probe.diagnostics.temporal,text:'PRIVATE_DATE'}}},
    {...probe,diagnostics:{...probe.diagnostics,temporal:{...probe.diagnostics.temporal,nestedMatches:['1']}}},
  ]) assert.throws(() => validatePublicCandidateResult(malformed), /INVALID_RESULT/);
});

test('review scope: a complete visible date deeper than8 wrappers belongs to its known header link', () => {
  const result = inspect([temporalHeaderPost(e('A', {}, [wrap(10,e('SPAN', {}, [t('2 giờ')]))]))]);
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0]!.text, 'TEMPORAL_COFFEE_BODY');
  assert.ok(result.samples[0]!.metadata.temporal > 0);
});

test('review scope: a complete date split into more than16 single-character nodes remains eligible', () => {
  const value = '27 tháng 10 lúc 10:30';
  assert.ok(value.length > 16 && value.length < 96);
  for (const text of [value,value.padEnd(96,' ')]) {
    const result = inspect([temporalHeaderPost(e('A', {}, [...text].map(char => e('SPAN', {}, [t(char)])),{whiteSpace:'pre'}))]);
    assert.equal(result.samples.length, 1); assert.equal(result.samples[0]!.text, 'TEMPORAL_COFFEE_BODY');
    assert.ok(result.samples[0]!.metadata.temporal > 0);
    assert.equal(result.diagnostics.temporal.charLimits, 0); assert.equal(result.diagnostics.temporal.textNodeLimits, 0);
  }
});

test('review scope: inherited deep link scope does not collect quote, heading, body or nested story dates', () => {
  const cases: [string, () => N][] = [
    ['quote', () => e('Q', {}, [wrap(10,e('SPAN', {}, [t('2 giờ')]))])],
    ['heading', () => e('H3', {}, [wrap(10,e('SPAN', {}, [t('2 giờ')]))])],
    ['body', () => body([wrap(10,e('SPAN', {}, [t('2 giờ')]))])],
    ['comment', () => e('DIV', {role:'comment'}, [wrap(10,e('SPAN', {}, [t('2 giờ')]))])],
    ['nested story link', () => e('ARTICLE', {}, [e('SPAN', {role:'link'}, [wrap(10,e('SPAN', {}, [t('2 giờ')]))])])],
  ];
  for(const [name,makeRegion] of cases){
    const result=inspect([temporalHeaderPost(e('A', {}, [makeRegion()]))]);
    if(name==='heading'||name==='body')assert.equal(result.samples.length,0); // Two headings / bodies remain ambiguous for optional time.
    else assertOptionalTemporalCandidate(result,'MISSING');
    assert.equal(result.diagnostics.temporal.date+result.diagnostics.temporal.relative+result.diagnostics.temporal.dayWord+result.diagnostics.temporal.abbreviated,0);
  }
});

test('review visibility: a parent box cannot prove date text with empty or zero-area Range is rendered', () => {
  for(const kind of ['empty','zero-area']){
    const date = t('2 giờ'); if (kind === 'empty') date.rangeVisible = false; else date.rangeZeroArea = true;
    assertOptionalTemporalCandidate(inspect([temporalHeaderPost(e('A', {}, [e('SPAN', {}, [date])]))]),'MISSING');
  }
});

test('review visibility: non-rendered fragments beside a visible date do not consume its visible string limits', () => {
  const noise = Array.from({length:110}, () => { const node = t('NO_GEOMETRY_NOISE'); node.rangeVisible = false; return e('SPAN', {}, [node]); });
  const result = inspect([temporalHeaderPost(e('A', {}, [t('2 giờ'),...noise]))]);
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0]!.text, 'TEMPORAL_COFFEE_BODY');
  assert.equal(result.diagnostics.temporal.charLimits, 0); assert.equal(result.diagnostics.temporal.textNodeLimits, 0);
  assert.equal(JSON.stringify(result).includes('NO_GEOMETRY_NOISE'), false);
});

test('review visibility: non-rendered body text is excluded even when its parent has a box', () => {
  const hidden = t('NO_GEOMETRY_BODY_PRIVATE'); hidden.rangeVisible = false;
  const zero = t('ZERO_AREA_BODY_PRIVATE'); zero.rangeZeroArea = true;
  const result = inspect([post({body:[t('VISIBLE_BODY'),e('SPAN', {}, [hidden]),e('SPAN', {}, [zero])]})]);
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0]!.text, 'VISIBLE_BODY');
  assert.equal(JSON.stringify(result).includes('BODY_PRIVATE'), false);
});

test('review visibility: missing or failing Range cannot turn a parent box into temporal proof', () => {
  const outcomes = (['missing','throws'] as const).map(range => {
    const result=inspect([temporalHeaderPost(directDate())],[],() => 0,{range});
    assert.ok(result.diagnostics.layout.textUnknownApi>0);assert.equal(result.diagnostics.layout.textUnknownAncestor,0);
    return{range,samples:result.samples.length};});
  assert.deepEqual(outcomes,[{range:'missing',samples:0},{range:'throws',samples:0}]);
});

test('review visibility: fully clipped sibling text is excluded without contaminating a visible sibling scope', () => {
  for (const clippedFirst of [true,false]) {
    const clipped = e('SPAN', {}, [t('FULLY_CLIPPED_PRIVATE')], {overflowX:'hidden',overflowY:'hidden'});
    clipped.clientWidth = 0; clipped.clientHeight = 0;
    const visible = e('SPAN', {}, [t('2 giờ')]);
    const result = inspect([temporalHeaderPost(e('A', {}, clippedFirst ? [clipped,visible] : [visible,clipped]))]);
    assert.equal(result.samples.length, 1); assert.equal(result.samples[0]!.text, 'TEMPORAL_COFFEE_BODY');
    assert.ok(result.diagnostics.layout.textClipped > 0); assert.equal(result.diagnostics.layout.textUnknown, 0);
    assert.equal(JSON.stringify(result).includes('FULLY_CLIPPED_PRIVATE'), false);
  }
});

test('review visibility: partial or unknown clipping invalidates the whole temporal record, not just its tail', () => {
  const cases: [string, () => N][] = [
    ['partial', () => { const node=e('SPAN', {}, [t('PARTIAL_PRIVATE')], {overflowX:'hidden'});node.clientWidth=5;return node; }],
    ['clip-path', () => e('SPAN', {}, [t('CLIP_PATH_PRIVATE')], {clipPath:'inset(1px)'})],
    ['transformed clip', () => e('SPAN', {}, [t('TRANSFORM_PRIVATE')], {overflowX:'hidden',transform:'matrix(1,0,0,1,1,0)'})],
    ['missing clip geometry', () => { const node=e('SPAN', {}, [t('MISSING_GEOMETRY_PRIVATE')], {overflowX:'hidden'});delete node.getBoundingClientRect;return node; }],
  ];
  for (const [name,tail] of cases) {
    const result = inspect([temporalHeaderPost(e('A', {}, [t('2 giờ'),tail()]))]);
    assertOptionalTemporalCandidate(result,'UNREADABLE'); assert.ok(result.diagnostics.layout.textUnknown > 0,name);
    assert.ok(result.diagnostics.layout[name==='partial'?'textUnknownPartial':'textUnknownClip']>0,name);
    assert.ok(result.diagnostics.temporal.unknownSegments > 0,name); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('review visibility: excessive date Range rectangles remain unknown while a separate body remains diagnostic', () => {
  const fragmented = t('2 giờ');fragmented.rangeRects=Array.from({length:9},()=>rect());
  for (const date of [e('SPAN', {}, [fragmented])]) {
    const result = inspect([temporalHeaderPost(e('A', {}, [date]))]);
    assertOptionalTemporalCandidate(result,'UNREADABLE');assert.ok(result.diagnostics.layout.textUnknown > 0);
    assert.ok(result.diagnostics.layout.textUnknownRect>0);assert.equal(result.diagnostics.layout.textUnknownApi,0);
    assert.ok(result.visited <= 2500);
  }
});

test('review clip scope: a post under40 visited wrappers retains known ancestor geometry', () => {
  const result = inspect([wrap(40,temporalHeaderPost(directDate()))]);
  assert.equal(result.samples.length, 1,JSON.stringify({visited:result.visited,nodeLimit:result.nodeLimit,unknown:result.diagnostics.layout.textUnknown,clipChecks:result.diagnostics.layout.textClipChecks}));assert.equal(result.samples[0]!.text,'TEMPORAL_COFFEE_BODY');
  assert.equal(result.nodeLimit, false);assert.equal(result.diagnostics.layout.textUnknown,0);
  assert.equal(result.diagnostics.layout.clipAncestorMisses,0);assert.ok(result.diagnostics.layout.clipPropagations>0);
});

test('review clip scope: deep sibling text reuses known context and completes within the shared budget', () => {
  const text='2 giờ'.padEnd(80,' ');
  const date=e('A', {}, [...text].map(char=>t(char)),{whiteSpace:'pre'});
  const result=inspect([wrap(40,temporalHeaderPost(date))]);
  assert.equal(result.samples.length,1,JSON.stringify({visited:result.visited,nodeLimit:result.nodeLimit,unknown:result.diagnostics.layout.textUnknown,clipChecks:result.diagnostics.layout.textClipChecks}));assert.equal(result.nodeLimit,false);assert.ok(result.visited<2500);
  assert.equal(result.samples[0]!.text,'TEMPORAL_COFFEE_BODY');assert.equal(result.diagnostics.layout.textUnknown,0);
  assert.equal(result.diagnostics.layout.clipAncestorMisses,0);assert.ok(result.diagnostics.layout.clipCacheHits>0);
});

test('review clip scope: clip or unknown geometry above the feed is not discarded at the candidate boundary', () => {
  for (const kind of ['full','partial','unknown']) {
    const ancestor=e('SECTION',{},[e('DIV',{role:'feed'},[temporalHeaderPost(directDate())])],{overflowX:'hidden'});
    if(kind==='full')ancestor.clientWidth=0;
    else if(kind==='partial')ancestor.clientWidth=5;
    else delete ancestor.getBoundingClientRect;
    const result=inspectMain([ancestor]);
    assert.equal(result.samples.length,0,kind);assert.equal(JSON.stringify(result).includes('TEMPORAL_COFFEE_BODY'),false);
    if(kind!=='full')assert.ok(result.diagnostics.layout.textUnknown>0,kind);
  }
});

const localUnknownPost=()=>post({href:'/owner/posts/70001/',body:[t('LOCAL_UNKNOWN_PRIVATE'),
  e('SPAN',{},[t('CLIP_TAIL_PRIVATE')],{clipPath:'inset(1px)'})]});
const laterPublicPost=()=>post({href:'/owner/posts/70002/',body:[t('LATER_PUBLIC_BODY')]});

test('review local: unknown geometry in the first feed boundary does not discard a later loaded public boundary', () => {
  const result=inspect([localUnknownPost(),laterPublicPost()]);
  assert.deepEqual(Array.from(result.samples,sample=>sample.text),['LATER_PUBLIC_BODY'],JSON.stringify({examined:result.examined,fallback:result.selection.fallbackScan,barriers:result.barriers.state,visited:result.visited}));
  assert.equal(result.selection.feedExamined,2);assert.equal(result.selection.mainExamined,0);
  assert.equal(result.barriers.state,'CLEAR');assert.notEqual(result.selection.fallbackScan,'BARRIER_STOP');
  assert.equal(result.nodeLimit,false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('review local: fallback continues past a locally unknown article without reporting a false barrier stop', () => {
  const result=inspectMain([auxiliaryFeed(),e('ARTICLE',{},localUnknownPost().children),e('ARTICLE',{},laterPublicPost().children)]);
  assert.deepEqual(Array.from(result.samples,sample=>sample.text),['LATER_PUBLIC_BODY'],JSON.stringify({examined:result.examined,fallback:result.selection.fallbackScan,barriers:result.barriers.state,visited:result.visited}));
  assert.equal(result.selection.mainExamined,2);assert.equal(result.selection.fallbackScan,'COMPLETE');
  assert.equal(result.barriers.state,'CLEAR');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('review local: global budget and real auth/challenge stop before later loaded candidates', () => {
  const capped=inspect([post({body:Array.from({length:3000},()=>e('SPAN',{},[t('GLOBAL_PARTIAL_PRIVATE')]))}),laterPublicPost()]);
  assert.equal(capped.nodeLimit,true);assert.equal(capped.visited,2500);assert.equal(capped.examined,1);assert.equal(capped.samples.length,0);
  const auth=inspect([post({extra:[e('INPUT',{type:'password'})]}),laterPublicPost()]);
  assert.equal(auth.status,'AUTH_REQUIRED');assert.equal(auth.examined,0);assert.equal(auth.samples.length,0);
  const challenge=inspect([post({body:[e('FORM',{},[t('Confirm your identity')])]}),laterPublicPost()]);
  assert.equal(challenge.status,'CHALLENGE');assert.equal(challenge.examined,1);assert.equal(challenge.samples.length,0);
  for(const result of [capped,auth,challenge])assert.equal(/PRIVATE|LATER_PUBLIC_BODY/.test(JSON.stringify(result)),false);
});

test('review local: completed unknown feed boundary is covered before fallback reads the next outside article', () => {
  const result=inspectMain([e('DIV',{role:'feed'},[localUnknownPost()]),e('ARTICLE',{},laterPublicPost().children)]);
  assert.deepEqual(Array.from(result.samples,sample=>sample.text),['LATER_PUBLIC_BODY']);
  assert.equal(result.selection.feedExamined,1);assert.equal(result.selection.mainExamined,1);
  assert.equal(result.diagnostics.layout.localIncomplete,1);assert.equal(result.selection.fallbackScan,'COMPLETE');
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('review local: geometry shapes distinguish partial axis/bucket/scope and retain only bounded enums/counts', () => {
  const tail=t('TEMPORAL_TAIL_PRIVATE');
  const partial=e('SPAN',{},[tail],{overflowX:'hidden'});partial.clientWidth=9.5;
  const temporal=inspect([temporalHeaderPost(e('A',{},[t('2 giờ'),partial]))]);
  assertOptionalTemporalCandidate(temporal,'UNREADABLE');
  assert.deepEqual({...temporal.geometryShapes[0]}, {scope:'TEMPORAL',reason:'BOUNDS',axis:'X',coverage:'PARTIAL',excess:'SUBPIXEL',rects:'ONE',count:1});
  const bodyResult=inspect([localUnknownPost()]);
  assert.deepEqual({...bodyResult.geometryShapes[0]}, {scope:'BODY',reason:'CLIP_PATH',axis:'UNKNOWN',coverage:'UNSUPPORTED',excess:'UNKNOWN',rects:'ONE',count:1});
  const mixed=t('MIXED_PRIVATE');mixed.rangeRects=[rect(),{width:10,height:10,left:100,top:10,right:110,bottom:20}];
  const mixedResult=inspect([temporalHeaderPost(e('A',{},[e('SPAN',{},[mixed],{overflowX:'hidden'})]))]);
  assertOptionalTemporalCandidate(mixedResult,'UNREADABLE');
  assert.deepEqual({...mixedResult.geometryShapes[0]}, {scope:'TEMPORAL',reason:'BOUNDS',axis:'X',coverage:'MIXED',excess:'GT_16',rects:'MULTIPLE',count:1});
  for(const result of [temporal,bodyResult,mixedResult]) {
    assert.ok(result.geometryShapes.length<=5);assert.equal(/PRIVATE|inset\(|https:/.test(JSON.stringify(result.geometryShapes)),false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
  const valid=temporal.geometryShapes[0]!;
  for(const shape of [{...valid,left:10},{...valid,text:'PRIVATE'},{...valid,axis:['X']},{...valid,count:0},{...valid,count:2501}]) {
    assert.throws(()=>validatePublicCandidateResult({...temporal,geometryShapes:[shape]}),/INVALID_RESULT/);
  }
  assert.throws(()=>validatePublicCandidateResult({...temporal,geometryShapes:Array.from({length:6},()=>valid)}),/INVALID_RESULT/);
});

function assertOptionalTemporalCandidate(result: ReturnType<typeof inspect>,status:'MISSING'|'UNREADABLE'): void {
  assert.equal(result.samples.length,1);const sample=result.samples[0]!;
  assert.equal(sample.metadata.temporal,0);assert.equal(sample.metadata.timeTag,false);assert.equal(sample.metadata.abbr,false);assert.equal(sample.metadata.ariaTemporal,false);
  assert.equal(sample.boundary.endsWith('_HEADER_PUBLIC_OPTIONAL_TIME'),true);
  assert.equal(sample.boundary_verified,false);assert.equal(sample.source_type,'UNKNOWN');
  assert.equal(sample.metadata.temporalStatus,status);assert.equal(sample.metadata.headerProof,'HEADING_PUBLIC');
  assert.equal(sample.metadata.headings,1);assert.equal(sample.metadata.messageRegions,1);assert.ok(sample.metadata.publicLabels>0);
  assert.ok(sample.missing_fields.includes(status==='MISSING'?'TEMPORAL_NOT_OBSERVED':'TEMPORAL_UNREADABLE'));
  assert.equal(sample.published_at,null);
  assert.equal(sample.text,'TEMPORAL_COFFEE_BODY');
}

test('review field scope: a verified public header and single visible body admit a diagnostic candidate with no temporal', () => {
  assertOptionalTemporalCandidate(inspect([temporalHeaderPost(e('A'))]),'MISSING');
});

test('review field scope: uncertain temporal alone does not corrupt the body or become a matched date', () => {
  const tail=e('SPAN',{},[t('PARTIAL_TIMESTAMP_PRIVATE')],{overflowX:'hidden'});tail.clientWidth=5;
  const result=inspect([temporalHeaderPost(e('A',{},[t('2 giờ'),tail]))]);
  assertOptionalTemporalCandidate(result,'UNREADABLE');assert.equal(JSON.stringify(result).includes('PARTIAL_TIMESTAMP_PRIVATE'),false);
  assert.equal(result.diagnostics.temporal.date+result.diagnostics.temporal.relative+result.diagnostics.temporal.dayWord+result.diagnostics.temporal.abbreviated,0);
});

test('review field scope: optional temporal never substitutes for public proof, body certainty or header co-location', () => {
  const cases: [string,()=>N][]=[
    ['private',()=>temporalHeaderPost(e('A'),'Friends')],
    ['ad',()=>temporalHeaderPost(e('A'),'Public',[badge('Sponsored')])],
    ['body public only',()=>e('DIV',{},[e('HEADER',{},[e('H3')]),body([badge('Public'),t('NO_HEADER_PUBLIC_PRIVATE')])])],
    ['split header',()=>e('DIV',{},[e('HEADER',{},[e('H3')]),e('HEADER',{},[badge('Public')]),body([t('SPLIT_PRIVATE')])])],
    ['mixed sibling',()=>e('DIV',{},[temporalHeaderPost(e('A')),temporalHeaderPost(e('A'),'Friends')])],
    ['body unknown',()=>{const value=temporalHeaderPost(e('A'));const bodyNode=value.children[1]!;bodyNode.style={clipPath:'polygon(0 0,100% 100%,0 100%)'};return value;}],
    ['body absent',()=>e('DIV',{},[e('HEADER',{},[e('H3'),badge('Public')])])],
  ];
  const results=cases.map(([name,make])=>({name,samples:inspect([make()]).samples.length}));
  assert.deepEqual(results,cases.map(([name])=>({name,samples:0})));
});

test('review field scope: empty legacy clip applies only to positioned content and cannot hide a rendered ad signal', () => {
  const outcomes=(['static','absolute'] as const).map(position=>({position,samples:inspect([post({after:[
    e('SPAN',{},[t('Sponsored')],{position,clip:'rect(0px, 0px, 0px, 0px)'})]})]).samples.length}));
  assert.deepEqual(outcomes,[{position:'static',samples:0},{position:'absolute',samples:1}]);
});

test('review field scope: a non-date header link cannot hide direct restricted or ad text behind optional time', () => {
  const cases:[string,()=>N][]=[
    ['visible restricted',()=>e('A',{},[t('Friends')])],
    ['visible restricted Vietnamese',()=>e('A',{},[t('Bạn bè')])],
    ['visible restricted control',()=>e('BUTTON',{},[t('Friends')])],
    ['unknown restricted',()=>{const n=e('SPAN',{},[t('Friends')],{overflowX:'hidden'});n.clientWidth=5;return e('A',{},[n]);}],
    ['unknown ad',()=>{const n=e('SPAN',{},[t('Sponsored')],{overflowX:'hidden'});n.clientWidth=5;return e('A',{},[n]);}],
  ];
  const outcomes=cases.map(([name,make])=>({name,samples:inspect([temporalHeaderPost(make())]).samples.length}));
  assert.deepEqual(outcomes,cases.map(([name])=>({name,samples:0})));
});

test('review field scope: restricted words in body, quote or author text are not privacy badges', () => {
  const bodyWord=temporalHeaderPost(e('A'));bodyWord.children[1]!.children[0]!.nodeValue='Friends';
  const quotedWord=temporalHeaderPost(e('A',{},[e('Q',{},[t('Friends')])]));
  const authorWord=temporalHeaderPost(e('A'));authorWord.children[0]!.children[0]!.children[0]!.nodeValue='Bạn bè';
  for(const [name,candidate] of [['body',bodyWord],['quote',quotedWord],['author',authorWord]] as const){
    const result=inspect([candidate]);assert.equal(result.samples.length,1,name);
    const sample=result.samples[0]!;assert.equal(sample.metadata.restrictedLabels,0);assert.equal(sample.metadata.temporal,0);
    assert.equal(sample.metadata.headerProof,'HEADING_PUBLIC');assert.equal(sample.published_at,null);
    assert.equal(sample.text,name==='body'?'Friends':'TEMPORAL_COFFEE_BODY');
  }
});

test('review field scope: exact empty clips cannot provide public proof or the mandatory body', () => {
  const clips:Style[]=[{position:'absolute',clip:'rect(0px, 0px, 0px, 0px)'},{clipPath:'inset(50%)'}];
  for(const style of clips){
    const publicNode=e('SPAN',{'aria-label':'Public'},[],style);
    const clippedPublic=e('DIV',{},[e('HEADER',{},[e('H3'),publicNode]),body([t('UNPROVEN_BODY_PRIVATE')])]);
    assert.equal(inspect([clippedPublic]).samples.length,0);
    const clippedBody=temporalHeaderPost(e('A'));clippedBody.children[1]!.style=style;
    const result=inspect([clippedBody]);assert.equal(result.samples.length,0);
    assert.equal(JSON.stringify(result).includes('TEMPORAL_COFFEE_BODY'),false);
    const emptyLabel=inspect([post({after:[e('SPAN',{},[t('Sponsored')],style)]})]);
    assert.equal(emptyLabel.samples.length,1);
    assert.ok(emptyLabel.diagnostics.layout[style.clip?'clipEmptyLegacy':'clipEmptyInset']>0);
  }
});

test('review field scope: optional-time schema rejects fabricated dates or contradictory proof and contains no body in summary', async () => {
  const result=inspect([temporalHeaderPost(e('A'))]);assertOptionalTemporalCandidate(result,'MISSING');
  const sample=result.samples[0]!;
  const malformed=[
    {...sample,published_at:'2026-10-28T00:00:00.000Z'},
    {...sample,published_at:undefined},
    {...sample,metadata:{...sample.metadata,temporal:1}},
    {...sample,metadata:{...sample.metadata,temporalStatus:['MISSING']}},
    {...sample,metadata:{...sample.metadata,temporalStatus:'OBSERVED'}},
    {...sample,metadata:{...sample.metadata,headerProof:'HEADING_TEMPORAL_PUBLIC'}},
    {...sample,metadata:{...sample.metadata,messageRegions:0}},
    {...sample,text:null,text_status:'MISSING_BODY_TEXT'},
    {...sample,missing_fields:sample.missing_fields.filter(reason=>reason!=='TEMPORAL_NOT_OBSERVED')},
    {...sample,missing_fields:[...sample.missing_fields,'TEMPORAL_UNREADABLE']},
    {...sample,boundary:'FEED_CHILD_HEADER_TEMPORAL'},
  ];
  for(const bad of malformed)assert.throws(()=>validatePublicCandidateResult({...result,samples:[bad]}),/INVALID_RESULT/);
  const {probe,files}=memoryProbe(async()=>result);await probe.start('review-profile');
  assert.ok(JSON.stringify(files.get('candidates.json')).includes('TEMPORAL_COFFEE_BODY'));
  assert.equal(JSON.stringify(files.get('summary.json')).includes('TEMPORAL_COFFEE_BODY'),false);
  assert.equal(JSON.stringify(files.get('started.json')).includes('TEMPORAL_COFFEE_BODY'),false);
});

function deepBranchHeader(depth:number, label='Public', observed=false):N {
  return e('DIV',{},[e('HEADER',{},[wrap(depth,e('H3',{},[t('TREE_AUTHOR_PRIVATE')])),
    wrap(depth,e('DIV',{},[badge(label),...(observed?[directDate()]:[])]))]),body([t('TREE_PUBLIC_BODY')])]);
}

test('review header tree: deep neutral branches share a header without a fixed ancestor-distance cutoff', () => {
  const outcomes:{depth:number;observed:boolean;samples:number}[]=[];
  for(const depth of [12,40])for(const observed of [false,true]){
    const result=inspect([deepBranchHeader(depth,'Public',observed)]);
    outcomes.push({depth,observed,samples:result.samples.length});
    if(result.samples.length!==1)continue;
    const sample=result.samples[0]!;assert.equal(sample.text,'TREE_PUBLIC_BODY');assert.equal(sample.published_at,null);
    assert.equal(sample.metadata.headerProof,observed?'HEADING_TEMPORAL_PUBLIC':'HEADING_PUBLIC');
    assert.equal(sample.metadata.temporalStatus,observed?'OBSERVED':'MISSING');
    assert.equal(result.nodeLimit,false);assert.ok(result.visited<=2500);assert.equal(JSON.stringify(result).includes('TREE_AUTHOR_PRIVATE'),false);
  }
  assert.deepEqual(outcomes,[12,40].flatMap(depth=>[false,true].map(observed=>({depth,observed,samples:1}))));
});

test('review header tree: the common ancestor of separate headers remains contaminated by a deep body', () => {
  const candidate=e('DIV',{},[e('HEADER',{},[e('H3')]),e('HEADER',{},[badge('Public')]),wrap(40,body([t('CROSS_HEADER_BODY_PRIVATE')]))]);
  const result=inspect([candidate]);assert.equal(result.samples.length,0);
  assert.equal(JSON.stringify(result).includes('CROSS_HEADER_BODY_PRIVATE'),false);
});

test('review header tree: deep wrappers never borrow public from body, quote, embedded story or a second post', () => {
  const wrongSources=[body([badge('Public'),t('BODY_ONLY_PUBLIC_PRIVATE')]),e('Q',{},[badge('Public')]),
    e('ARTICLE',{},[badge('Public')]),e('DIV',{role:'comment'},[badge('Public')])];
  for(const source of wrongSources){
    const candidate=e('DIV',{},[e('HEADER',{},[wrap(12,e('H3')),wrap(12,source)]),body([t('OUTER_BODY_PRIVATE')])]);
    assert.equal(inspect([candidate]).samples.length,0);
  }
  const split=e('DIV',{},[e('HEADER',{},[wrap(12,e('H3'))]),e('HEADER',{},[wrap(12,badge('Public'))]),body([t('SPLIT_TREE_PRIVATE')])]);
  const mixed=e('DIV',{},[deepBranchHeader(12),deepBranchHeader(12,'Friends')]);
  const twoBodies=deepBranchHeader(12);twoBodies.children.push(body([t('SECOND_BODY_PRIVATE')]));twoBodies.children.at(-1)!.parentElement=twoBodies;
  const ad=deepBranchHeader(12);ad.children[0]!.children.push(badge('Sponsored'));ad.children[0]!.children.at(-1)!.parentElement=ad.children[0]!;
  for(const candidate of [split,mixed,twoBodies,deepBranchHeader(12,'Friends'),ad]){
    const result=inspect([candidate]);assert.equal(result.samples.length,0);assert.equal(/TREE_PUBLIC_BODY|PRIVATE/.test(JSON.stringify(result)),false);
  }
});

test('review header tree: incomplete global traversal cannot publish a deep header candidate', () => {
  const candidate=deepBranchHeader(40);const message=candidate.children[1]!;
  message.children.push(...Array.from({length:1600},()=>e('SPAN',{},[t('GLOBAL_TREE_PRIVATE')])));
  for(const node of message.children)node.parentElement=message;
  const result=inspect([candidate]);assert.equal(result.nodeLimit,true);assert.equal(result.visited,2500);
  assert.equal(result.samples.length,0);assert.equal(/TREE_PUBLIC_BODY|PRIVATE/.test(JSON.stringify(result)),false);
  assert.ok(result.diagnostics.headers.treeIncomplete>0);
  const partial=result.rejectionShapes.find(shape=>shape.reason==='INCOMPLETE_BOUNDARY')!;
  assert.equal(partial.header.treeState,'INCOMPLETE');assert.equal(partial.header.publicClusterFound,false);assert.equal(partial.header.clusterFound,false);
});

test('review header tree: unvisited ancestry is incomplete rather than a detached proof', () => {
  const candidate=temporalHeaderPost(e('A')),header=candidate.children[0]!,heading=header.children[0]!;
  const unvisited=e('DIV');unvisited.parentElement=header;heading.parentElement=unvisited;
  const result=inspect([candidate]);assert.equal(result.samples.length,0);assert.equal(result.diagnostics.headers.ancestryCuts,1);
  assert.equal(result.diagnostics.headers.treeIncomplete,1);assert.equal(result.nodeLimit,false);
  const shape=result.rejectionShapes.find(value=>value.reason==='INCOMPLETE_BOUNDARY')!;
  assert.equal(shape.header.treeState,'INCOMPLETE');assert.equal(shape.header.ancestorLimit,true);
  assert.equal(shape.header.publicClusterFound,false);assert.equal(shape.header.clusterFound,false);
  assert.equal(JSON.stringify(result).includes('TEMPORAL_COFFEE_BODY'),false);
});

test('review header tree: metadata separates public and temporal clusters with bounded sanitized ancestry fields', () => {
  for(const observed of [false,true]){
    const candidate=deepBranchHeader(12,'Public',observed),header=candidate.children[0]!;
    const ad=badge('Sponsored');ad.parentElement=header;header.children.push(ad);
    const result=inspect([candidate]);assert.equal(result.samples.length,0);
    const shape=result.rejectionShapes.find(value=>value.reason==='AD_OR_SUGGESTION')!;
    assert.equal(shape.header.treeState,'COMPLETE');assert.equal(shape.header.ancestorLimit,false);
    assert.equal(shape.header.publicClusterFound,true);assert.equal(shape.header.clusterFound,observed);
    assert.equal(shape.header.publicDepth,'DEEP');assert.equal(shape.header.temporalDepth,observed?'DEEP':'NONE');
    assert.equal(result.diagnostics.headers.publicClustersFound,1);assert.equal(result.diagnostics.headers.clustersFound,observed?1:0);
    assert.equal(result.diagnostics.headers.treeIncomplete,0);assert.equal(result.diagnostics.headers.ancestryCuts,0);
    assert.ok(result.diagnostics.headers.treeEdges<result.diagnostics.headers.treeNodes);
    assert.ok(result.diagnostics.headers.treeNodes<=result.visited);
    assert.equal(/TREE_PUBLIC_BODY|TREE_AUTHOR_PRIVATE/.test(JSON.stringify(result)),false);
    for(const headerValue of [{...shape.header,rawPath:'PRIVATE'},{...shape.header,treeState:['COMPLETE']},{...shape.header,publicDepth:12}]){
      assert.throws(()=>validatePublicCandidateResult({...result,rejectionShapes:[{...shape,header:headerValue}]}),/INVALID_RESULT/);
    }
    for(const diagnostics of [{...result.diagnostics.headers,treeEdges:2501},{...result.diagnostics.headers,ancestryCuts:-1}]){
      assert.throws(()=>validatePublicCandidateResult({...result,diagnostics:{...result.diagnostics,headers:diagnostics}}),/INVALID_RESULT/);
    }
  }
});

const partialAux=(children:N[])=>{const node=e('SPAN',{},children,{overflowX:'hidden'});node.clientWidth=5;return node;};

test('review auxiliary: uncertain text outside required fields is omitted while independent public body remains usable', () => {
  const cases=[
    post({extra:[partialAux([t('AUXILIARY_COUNTER_PRIVATE')])]}),
    post({after:[e('FOOTER',{},[partialAux([t('AUXILIARY_COUNTER_PRIVATE')])])]}),
  ];
  const author=post();author.children[0]!.children[0]=e('H3',{},[partialAux([t('AUXILIARY_AUTHOR_PRIVATE')])]);author.children[0]!.children[0]!.parentElement=author.children[0]!;cases.push(author);
  for(const candidate of cases){
    const result=inspect([candidate]);assert.equal(result.samples.length,1);
    assert.equal(result.samples[0]!.text,'COFFEE_BODY');assert.equal(result.samples[0]!.published_at,null);
    assert.equal(/AUXILIARY_COUNTER_PRIVATE|AUXILIARY_AUTHOR_PRIVATE/.test(JSON.stringify(result)),false);assert.ok(result.diagnostics.layout.textUnknownPartial>0);
    assert.equal(result.samples[0]!.metadata.auxiliaryTextOmitted,true);assert.ok(result.samples[0]!.missing_fields.includes('AUXILIARY_TEXT_OMITTED'));
  }
});

test('review auxiliary: body, heading signal and public signal uncertainty remain mandatory failures', () => {
  const bodyUnknown=post({body:[partialAux([t('BODY_UNCERTAIN_PRIVATE')])]});
  const headingUnknown=post();const heading=headingUnknown.children[0]!.children[0]!;heading.style={overflowX:'hidden'};heading.clientWidth=5;
  const publicUnknown=post();const publicSignal=publicUnknown.children[0]!.children[3]!;publicSignal.style={overflowX:'hidden'};publicSignal.clientWidth=5;
  const deepBodyUnknown=post({body:[wrap(40,partialAux([t('DEEP_BODY_UNCERTAIN_PRIVATE')]))]});
  const formUnknown=post({extra:[e('FORM',{},[partialAux([t('FORM_UNCERTAIN_PRIVATE')])])]});
  for(const candidate of [bodyUnknown,headingUnknown,publicUnknown,deepBodyUnknown,formUnknown]){
    const result=inspect([candidate]);assert.equal(result.samples.length,0);
    assert.equal(/COFFEE_BODY|BODY_UNCERTAIN_PRIVATE|FORM_UNCERTAIN_PRIVATE/.test(JSON.stringify(result)),false);
  }
});

test('review auxiliary: exact restricted and ad labels still veto when their auxiliary text geometry is unknown', () => {
  for(const label of ['Friends','Bạn bè','Sponsored','Được tài trợ']){
    const result=inspect([post({after:[partialAux([t(label)])]})]);assert.equal(result.samples.length,0,label);
    assert.equal(JSON.stringify(result).includes('COFFEE_BODY'),false);
  }
});

test('review auxiliary: split restricted and ad labels within one narrow text scope cannot disappear', () => {
  const labels=[['Fri','ends'],['Bạn',' ','bè'],['Spon','sored'],['Được',' ','tài trợ']];
  const outcomes=labels.flatMap(parts=>[false,true].map(partial=>{
    const children=parts.map(part=>e('SPAN',{},[t(part)]));const signal=partial?partialAux(children):e('SPAN',{},children);
    const result=inspect([post({after:[signal]})]);
    return{label:parts.join(''),partial,samples:result.samples.length};
  }));
  assert.deepEqual(outcomes,labels.flatMap(parts=>[false,true].map(partial=>({label:parts.join(''),partial,samples:0}))));
});

test('review auxiliary: negative words in body, quote or author retain their own scope', () => {
  const bodyWords=post({body:[t('Friends')]});
  const quoted=post({extra:[e('Q',{},[partialAux([t('Friends')])])]});
  const author=post();author.children[0]!.children[0]=e('H3',{},[partialAux([t('Friends')])]);author.children[0]!.children[0]!.parentElement=author.children[0]!;
  for(const [name,candidate] of [['body',bodyWords],['quote',quoted],['author',author]] as const){
    const result=inspect([candidate]);assert.equal(result.samples.length,1,name);
    assert.equal(result.samples[0]!.metadata.restrictedLabels,0);assert.equal(result.samples[0]!.text,name==='body'?'Friends':'COFFEE_BODY');
  }
});

test('review auxiliary: separate semantic controls and whitespace never fuse into a negative label', () => {
  const regions=[
    e('DIV',{},[e('A',{},[t('Fri')]),e('A',{},[t('ends')])]),
    e('SPAN',{},[e('SPAN',{},[t('Fri')]),t(' '),e('SPAN',{},[t('ends')])]),
    e('SPAN',{},[t('Fri'),e('Q',{},[t('ends')])]),
  ];
  for(const region of regions){
    const result=inspect([post({after:[region]})]);assert.equal(result.samples.length,1);
    assert.equal(result.samples[0]!.text,'COFFEE_BODY');assert.equal(result.samples[0]!.metadata.restrictedLabels,0);
    assert.equal(result.diagnostics.layout.negativeVetoes,0);
  }
});

test('review auxiliary: unknown prefix or oversized negative scope cannot become benign omission', () => {
  for(const raw of ['Fri','x'.repeat(161)]){
    const result=inspect([post({after:[partialAux([t(raw)])]})]);assert.equal(result.samples.length,0);
    assert.ok(result.diagnostics.layout.negativeUnresolved>0);assert.equal(JSON.stringify(result).includes('COFFEE_BODY'),false);
  }
  const bounded=inspect([post({after:[partialAux([t('x'.repeat(160))])]})]);
  assert.equal(bounded.samples.length,1);assert.equal(bounded.samples[0]!.metadata.auxiliaryTextOmitted,true);
  assert.equal(bounded.diagnostics.layout.negativeUnresolved,0);
});

test('review auxiliary: omission metadata requires a readable body and matching reason without retaining skipped text', async () => {
  const result=inspect([post({extra:[partialAux([t('OMITTED_TEXT_PRIVATE')])]} )]);
  assert.equal(result.samples.length,1);const sample=result.samples[0]!;
  const malformed=[
    {...sample,metadata:{...sample.metadata,auxiliaryTextOmitted:false}},
    {...sample,missing_fields:sample.missing_fields.filter(value=>value!=='AUXILIARY_TEXT_OMITTED')},
    {...sample,metadata:{...sample.metadata,auxiliaryTextOmitted:['true']}},
    {...sample,metadata:{...sample.metadata,headings:2}},
    {...sample,text:null,text_status:'MISSING_BODY_TEXT'},
  ];
  for(const bad of malformed)assert.throws(()=>validatePublicCandidateResult({...result,samples:[bad]}),/INVALID_RESULT/);
  const fixture=memoryProbe(async()=>result),returned=await fixture.probe.start('PROFILE_SECRET');
  assert.equal(returned.summary.field_contract_ref,'ADR-013');
  for(const value of [result,returned,...fixture.files.values()])assert.equal(JSON.stringify(value).includes('OMITTED_TEXT_PRIVATE'),false);
  for(const value of [returned,fixture.files.get('summary.json'),fixture.files.get('started.json')])assert.equal(JSON.stringify(value).includes('COFFEE_BODY'),false);
});

const publicGroupLabel='Đã chia sẻ với Nhóm công khai';
const groupLabelPost=(signal:N)=>e('DIV',{},[e('HEADER',{},[e('H3'),e('TIME'),signal]),body([t('GROUP_LABEL_BODY')])]);

test('review public group: exact graphic aria-label or title supports diagnostic publicity without inferring source type', () => {
  const signals=[e('SVG',{role:'img','aria-label':publicGroupLabel}),e('SPAN',{role:'img',title:publicGroupLabel}),e('IMG',{'aria-label':publicGroupLabel})];
  const counts=signals.map(signal=>{
    const result=inspect([groupLabelPost(signal)]);
    if(result.samples.length===1){const sample=result.samples[0]!;assert.equal(sample.text,'GROUP_LABEL_BODY');assert.equal(sample.source_type,'UNKNOWN');
      assert.equal(sample.boundary_verified,false);assert.ok(sample.missing_fields.includes('PUBLICITY_NOT_INDEPENDENTLY_VERIFIED'));}
    return result.samples.length;
  });
  assert.deepEqual(counts,[1,1,1]);
});

test('review public group: direct public button labels are recognized before safe control pruning', () => {
  const outcomes=['Public',publicGroupLabel].flatMap(label=>['BUTTON','SPAN'].map(tag=>{
    const signal=e(tag,{...(tag==='SPAN'?{role:'button'}:{}),'aria-label':label});
    const result=inspect([groupLabelPost(signal)]);
    assert.equal(result.diagnostics.headers.publicLabelsSeen,1);assert.equal(result.diagnostics.headers.publicSignalsAccepted,1);assert.equal(result.diagnostics.headers.publicControlsPruned,1);
    for(const [key,value] of [['publicLabelsSeen',['1']],['publicSignalsAccepted',2501],['publicControlsPruned',-1],['rawLabel',label]] as const){
      assert.throws(()=>validatePublicCandidateResult({...result,diagnostics:{...result.diagnostics,headers:{...result.diagnostics.headers,[key]:value}}}),/INVALID_RESULT/);
    }
    return{label,tag,samples:result.samples.length};
  }));
  assert.deepEqual(outcomes,['Public',publicGroupLabel].flatMap(label=>['BUTTON','SPAN'].map(tag=>({label,tag,samples:1}))));
});

test('review public group: private, substring, non-header and uncertain signals cannot grant publicity', () => {
  const signals=[
    e('SPAN',{'aria-label':'Đã chia sẻ với Nhóm riêng tư'}),e('SPAN',{'aria-label':'Nhóm riêng tư'}),
    e('SPAN',{'aria-label':'Thông tin '+publicGroupLabel}),e('SPAN',{'aria-label':publicGroupLabel+' và bạn bè'}),
    e('Q',{},[badge(publicGroupLabel)]),e('ARTICLE',{},[badge(publicGroupLabel)]),e('DIV',{role:'comment'},[badge(publicGroupLabel)]),
    e('SPAN',{'aria-label':publicGroupLabel},[],{display:'none'}),
  ];
  const partial=e('SPAN',{'aria-label':publicGroupLabel},[],{overflowX:'hidden'});partial.clientWidth=5;signals.push(partial);
  const candidates=signals.map(signal=>groupLabelPost(signal));
  candidates.push(e('DIV',{},[e('HEADER',{},[e('H3'),e('TIME')]),body([badge(publicGroupLabel),t('BODY_PUBLIC_PRIVATE')])]));
  candidates.push(e('DIV',{},[e('HEADER',{},[e('H3'),e('TIME')]),body([t('OUTSIDE_HEADER_PRIVATE')]),badge(publicGroupLabel)]));
  candidates.push(e('DIV',{},[e('HEADER',{},[e('H3'),e('TIME')]),e('HEADER',{},[badge(publicGroupLabel)]),body([t('SPLIT_HEADER_PRIVATE')])]));
  candidates.push(groupLabelPost(e('SPAN',{},[badge(publicGroupLabel),badge('Nhóm riêng tư')])));
  for(const candidate of candidates){const result=inspect([candidate]);assert.equal(result.samples.length,0);assert.equal(/GROUP_LABEL_BODY|PRIVATE/.test(JSON.stringify(result)),false);}
});

test('review public group: accepted control labels still require bounded negative audit and cannot borrow nested-only proof', () => {
  const controls=[
    e('BUTTON',{'aria-label':publicGroupLabel},[badge('Nhóm riêng tư')]),
    e('BUTTON',{'aria-label':publicGroupLabel},[e('SPAN',{},[t('Fri')]),e('SPAN',{},[t('ends')])]),
    e('BUTTON',{'aria-label':publicGroupLabel},[e('SPAN',{},[t('Spon')]),e('SPAN',{},[t('sored')])]),
    e('BUTTON',{'aria-label':publicGroupLabel},[e('ARTICLE',{},[t('EMBEDDED_CONTROL_PRIVATE')])]),
    e('BUTTON',{},[badge(publicGroupLabel)]),
    e('BUTTON',{'aria-label':publicGroupLabel},[],{display:'none'}),
  ];
  const partial=e('SPAN',{role:'button','aria-label':publicGroupLabel},[],{overflowX:'hidden'});partial.clientWidth=5;controls.push(partial);
  for(const control of controls){const result=inspect([groupLabelPost(control)]);assert.equal(result.samples.length,0);assert.equal(/GROUP_LABEL_BODY|PRIVATE/.test(JSON.stringify(result)),false);}
  const conflict=groupLabelPost(e('SPAN',{},[badge(publicGroupLabel),badge('Đã chia sẻ với Nhóm riêng tư')]));
  assert.equal(inspect([conflict]).samples.length,0);
});

test('review public group: required public-control audit stops at four controls and64 shared probe nodes', () => {
  for(const count of [4,5]){
    const controls=Array.from({length:count},()=>e('BUTTON',{'aria-label':publicGroupLabel}));
    const result=inspect([groupLabelPost(e('SPAN',{},controls))]);assert.equal(result.samples.length,count===4?1:0);
    if(count===5)assert.equal(JSON.stringify(result).includes('GROUP_LABEL_BODY'),false);
  }
  for(const count of [64,65]){
    const control=e('BUTTON',{'aria-label':publicGroupLabel},Array.from({length:count},()=>e('SPAN')));
    const result=inspect([groupLabelPost(control)]);assert.equal(result.samples.length,count===64?1:0);
    assert.equal(result.diagnostics.temporal.probeNodes,64);
    if(count===65){assert.ok(result.diagnostics.temporal.probeLimits>0);assert.equal(JSON.stringify(result).includes('GROUP_LABEL_BODY'),false);}
  }
});
