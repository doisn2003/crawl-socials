import assert from 'node:assert/strict';
import { session, Menu } from 'electron';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { installFacebookDomDiagnosticMenu } from './facebook-dom-diagnostic-menu.js';

export async function runFacebookDomFixture(host: BrowserHost, tools: ReturnType<typeof installFacebookDomDiagnosticMenu>) {
  const profile = await host.create('Synthetic DOM fixture'), isolated = session.fromPartition('persist:csd-v1-' + profile.id);
  const chrome = '<nav role="main">' + '<span>synthetic-private-chrome</span>'.repeat(2600) + '</nav>' +
    '<aside role="feed"><a href="/private-sidebar/posts/private-sidebar-id/">synthetic-private-sidebar</a></aside>';
  let html = '<!doctype html>' + chrome + '<main role="main"><div role="feed">' + Array.from({ length: 8 }, () => `<article role="article">
    <span>synthetic-private-person-name</span><div>Synthetic secret-post-text token=never-export</div><time>private-time</time>
    <a href="/groups/private-group-id/permalink/private-post-id/?token=private-token">private link</a>
    <span aria-label="Công khai"></span><button>Xem thêm</button></article>`).join('') + '</div></main>';
  await isolated.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  try {
    await host.open(profile.id); const wc = host.ownedContents(profile.id)!;
    const url = 'https://www.facebook.com/search/posts/?q=cafe%20H%C3%A0%20N%E1%BB%99i&token=private-token';
    await wc.loadURL(url); await tools.refresh();
    assert.ok(Menu.getApplicationMenu()?.getMenuItemById('csd-dom-read-' + profile.id));
    const matched = await tools.start(profile.id);
    assert.equal(matched.report.capture_mode, 'FIXTURE'); assert.equal(matched.report.status, 'HEURISTIC_MATCH');
    assert.equal(matched.report.result?.route, 'SEARCH_POSTS');
    assert.equal(matched.report.version, 2); assert.equal(matched.report.result?.version, 2);
    assert.equal(matched.report.result?.root.kind, 'MAIN_TAG'); assert.equal(matched.report.result?.root.candidates, 2);
    assert.equal(matched.report.result?.nodeLimit, false); assert.equal(matched.report.result?.scan, 'COMPLETE');
    assert.equal(matched.report.result?.cards.length, 5); assert.equal(matched.report.result?.articleRoots, 8);
    assert.equal(JSON.stringify(matched.report).includes('private'), false);
    assert.equal(wc.debugger.isAttached(), false);
    const mixedUrl = url.replace('/posts/', '/top/');
    html = '<!doctype html>' + chrome + '<div role="main"><section><a href="/pages/private-page-id/">synthetic-private-page-name</a></section>' +
      ('<div data-pagelet="private-pagelet">'.repeat(10) + '<a href="/private-person/posts/private-post-id/?token=private-token">synthetic-private-person-name</a>' + '</div>'.repeat(10)).repeat(8) +
      '<div><a href="https://example.test/?token=private-ad-token">synthetic-private-ad-body</a></div></div>';
    await wc.loadURL(mixedUrl);
    const mixed = await tools.start(profile.id); assert.equal(mixed.report.status, 'POST_LINK_STRUCTURE');
    assert.equal(mixed.report.result?.route, 'SEARCH_TOP_MIXED'); assert.equal(mixed.report.result?.articleRoots, 0);
    assert.equal(mixed.report.result?.root.kind, 'ROLE_MAIN'); assert.equal(mixed.report.result?.nodeLimit, false);
    assert.equal(mixed.report.result?.root.candidates, 1);
    assert.equal(mixed.report.result?.links.page, 1); assert.equal(mixed.report.result?.links.post, 8); assert.equal(mixed.report.result?.links.external, 1);
    assert.equal(mixed.report.result?.postLinkSamples.length, 5); assert.equal(mixed.report.result?.ancestorSteps, 40);
    assert.ok(mixed.report.result?.postLinkSamples.every(sample => sample.depthLimit && sample.ancestors.length === 8));
    assert.equal(mixed.report.verified_valid_count, 0); assert.equal(mixed.report.candidates_collected, 0);
    assert.ok(mixed.report.missing_fields.includes('SOURCE_TYPE_UNVERIFIED')); assert.equal(JSON.stringify(mixed.report).includes('private'), false);
    html = '<!doctype html><form><input type="password" value="private-password"></form>'; await wc.loadURL(mixedUrl);
    const auth = await tools.start(profile.id); assert.equal(auth.report.status, 'AUTH_REQUIRED'); assert.equal(auth.report.result?.cards.length, 0);
    assert.equal(JSON.stringify(auth.report).includes('private-password'), false);
    return { task: 'P02_DOM_DIAGNOSTIC', result: 'PASS', mode: 'FIXTURE', schemaVersion: 2, menuInstalled: true,
      cases: [matched, mixed, auth].map(value => ({ status: value.report.status, mode: value.report.capture_mode, route: value.report.result?.route,
        actions: value.report.actions, sampledStructures: value.report.result?.cards.length || 0, root: value.report.result?.root,
        visited: value.report.result?.visited, scan: value.report.result?.scan, nodeLimit: value.report.result?.nodeLimit,
        postLinkSamples: value.report.result?.postLinkSamples.length, ancestorSteps: value.report.result?.ancestorSteps, resultSha256: value.sha256 })),
      externalNetworkRequests: 0, verifiedValidCount: 0, observerAttached: false };
  } finally { isolated.protocol.unhandle('https'); }
}
