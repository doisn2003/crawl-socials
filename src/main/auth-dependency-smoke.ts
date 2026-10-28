import assert from 'node:assert/strict';
import { session } from 'electron';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { PolicyDiagnostics } from '../infrastructure/browser/policy-diagnostics.js';

export async function runAuthDependencySmoke(host: BrowserHost, diagnostics: PolicyDiagnostics) {
  const checks: string[] = [];
  const profile = await host.create('Synthetic auth dependency');
  const isolated = session.fromPartition('persist:csd-v1-' + profile.id);
  let responses = 0;
  // All HTTPS is intercepted inside this isolated session. Never fetch the Internet.
  await isolated.protocol.handle('https', request => {
    responses++;
    const url = new URL(request.url);
    if (url.hostname === 'www.facebook.com') return new Response(`<!doctype html><title>LOCAL FIXTURE</title>
      <h1>Local auth policy fixture</h1><script>
      window.frameReady=false;window.recaptchaReady=false;addEventListener('message',e=>{if(e.origin==='https://auth.fbsbx.com'&&e.data==='fixture-ready')window.frameReady=true;
      if(e.origin==='https://auth.fbsbx.com'&&e.data==='recaptcha-fixture-ready')window.recaptchaReady=true;});
      window.igReady=fetch('https://i.instagram.com/auth-fixture').then(r=>r.ok).catch(()=>false);
      </script><iframe src="https://auth.fbsbx.com/redirect"></iframe>`, { headers: { 'content-type': 'text/html' } });
    if (url.hostname === 'i.instagram.com') return new Response('{}', { headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://www.facebook.com' } });
    if (url.hostname === 'auth.fbsbx.com') {
      if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'https://auth.fbsbx.com/frame' } });
      if (url.pathname === '/frame') return new Response(`<!doctype html><script src="https://auth.fbsbx.com/frame.js"></script>
        <script src="https://www.google.com/recaptcha/enterprise.js"></script><iframe src="https://www.google.com/recaptcha/enterprise/anchor"></iframe>`, { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/frame.js') return new Response(`addEventListener('message',e=>{if(e.origin==='https://www.google.com'&&e.data==='local-recaptcha-rendered')parent.postMessage('recaptcha-fixture-ready','https://www.facebook.com')});
        fetch('https://auth.fbsbx.com/xhr').then(r=>{if(r.ok)parent.postMessage('fixture-ready','https://www.facebook.com')})`, { headers: { 'content-type': 'application/javascript' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'www.google.com' && url.pathname === '/recaptcha/enterprise.js') return new Response('void 0', { headers: { 'content-type': 'application/javascript' } });
    if (url.hostname === 'www.google.com' && url.pathname === '/recaptcha/enterprise/anchor') return new Response(`<!doctype html>
      <h1>LOCAL RENDERING FIXTURE ONLY</h1><script src="https://www.gstatic.com/recaptcha/releases/local-fixture/render.js"></script>`, { headers: { 'content-type': 'text/html' } });
    if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/recaptcha/')) return new Response(`fetch('https://www.google.com/recaptcha/api2/reload').then(r=>{if(r.ok)parent.postMessage('local-recaptcha-rendered','https://auth.fbsbx.com')})`, { headers: { 'content-type': 'application/javascript' } });
    if (url.hostname === 'www.google.com' && url.pathname.startsWith('/recaptcha/')) return new Response('{}', { headers: { 'content-type': 'application/json' } });
    return new Response('LOCAL FIXTURE DENIED', { status: 403 });
  });
  try {
    await host.openLogin(profile.id);
    const wc = host.ownedContents(profile.id)!;
    let ready = false;
    for (let i = 0; i < 200; i++) {
      ready = await wc.executeJavaScript('Promise.resolve(window.igReady).then(ig=>ig===true&&window.frameReady===true&&window.recaptchaReady===true)');
      if (ready) break; await sleep(10);
    }
    assert.equal(ready, true, 'AUTH_FIXTURE_NOT_READY');
    const snapshot = diagnostics.snapshot();
    assert.ok(snapshot.events.some(event => event.kind === 'RESOURCE_COMPLETED' && event.location.registrableDomain === 'instagram.com' && event.statusCode === 200));
    assert.ok(snapshot.events.some(event => event.kind === 'RESOURCE_COMPLETED' && event.location.registrableDomain === 'fbsbx.com' && event.resourceType === 'subFrame'));
    assert.ok(snapshot.events.some(event => event.kind === 'NAVIGATION_ALLOWED' && event.location.registrableDomain === 'fbsbx.com' && event.resourceType === 'subFrame'));
    assert.equal(snapshot.counts.REQUEST_BLOCKED || 0, 0);
    checks.push('OWNED_FACEBOOK_INSTAGRAM_XHR_AND_FBSBX_FRAME_REDIRECT_SCRIPT_XHR_COMPLETE');
    assert.ok(snapshot.events.some(event => event.kind === 'RESOURCE_COMPLETED' && event.location.pathCategory === 'RECAPTCHA' && event.resourceType === 'subFrame'));
    assert.ok(snapshot.events.some(event => event.kind === 'RESOURCE_COMPLETED' && event.location.pathCategory === 'RECAPTCHA' && event.location.origin === 'https://www.gstatic.com'));
    checks.push('OWNED_FBSBX_CHILD_LOADS_RECAPTCHA_SCRIPT_FRAME_GSTATIC_AND_XHR_NO_CHALLENGE');
    await wc.executeJavaScript("location.href='https://auth.fbsbx.com/frame';void 0"); await sleep(30);
    assert.equal(new URL(wc.getURL()).hostname, 'www.facebook.com');
    assert.ok(diagnostics.snapshot().priorityEvents.some(event => event.kind === 'NAVIGATION_BLOCKED' && event.resourceType === 'mainFrame'));
    checks.push('FBSBX_MAIN_NAVIGATION_REMAINS_DENIED');
    await wc.loadURL('about:blank');
    const before = responses;
    assert.equal(await wc.executeJavaScript("fetch('https://i.instagram.com/auth-fixture').then(()=>false,()=>true)"), true);
    assert.equal(responses, before);
    assert.ok(diagnostics.snapshot().priorityEvents.some(event => event.kind === 'REQUEST_BLOCKED' && event.location.registrableDomain === 'instagram.com'));
    checks.push('INSTAGRAM_DENIED_OUTSIDE_FACEBOOK_BEFORE_PROTOCOL_HANDLER');
    assert.equal(wc.debugger.isAttached(), false);
    await host.close(profile.id); diagnostics.publish();
    return { task: 'MANUAL_AUTH_DEPENDENCY_FIX', result: 'PASS', mode: 'FIXTURE', checks, diagnostics: diagnostics.snapshot(),
      externalNetworkRequests: 0, protocolResponses: responses, postsCollected: 0,
      limitations: ['Isolated HTTPS protocol fixture; no real login/session/2FA or external network', 'Live fix still needs lead verification after restart'] };
  } finally { isolated.protocol.unhandle('https'); }
}
