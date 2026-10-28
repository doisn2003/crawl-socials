import { BrowserWindow, session } from 'electron';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { setImmediate as tick, setTimeout as sleep } from 'node:timers/promises';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { ObserverEvent, ObserverOwner, ResponseObserver } from '../application/ports/response-observer.js';
import { createResponseObserverManager } from '../infrastructure/browser/response-observer.js';
import { createOwnedObserverResolver } from '../infrastructure/browser/electron-observer-target.js';

function check(value: unknown, code: string): asserts value { if (!value) throw new Error('OBSERVER_CHECK_' + code); }
export async function runObserverSmoke(host: BrowserHost, origin: string, scenario: 'all' | 'query') {
  const checks: string[] = [], captures: { bytes: number; sha256: string; captureMode: string; profile: string; status: number }[] = [];
  const manager = createResponseObserverManager({ resolveOwned: createOwnedObserverResolver(host),
    urlAllowed: input => { const url = new URL(input); return url.origin === origin && url.pathname === '/capture'; },
    mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'], limits: { maxRunMs: 20000, requestTimeoutMs: 3000 } });
  const ownership = (id: string): ObserverOwner => {
    const target = host.observerTarget(id); check(target, 'OWNED_TARGET');
    return { profileId: id, webContentsId: target.webContentsId, viewGeneration: target.viewGeneration };
  };
  async function next(handle: ResponseObserver, predicate: (event: ObserverEvent) => boolean) {
    for (let index = 0; index < 30; index++) {
      const read = await handle.read(500);
      if (read.kind === 'EVENT' && predicate(read.event)) return read.event;
      if (read.kind === 'END') break;
    }
    throw new Error('OBSERVER_CHECK_EVENT_TIMEOUT');
  }
  async function body(handle: ResponseObserver, label: string) {
    const event = await next(handle, value => value.kind === 'BODY' || value.kind === 'ERROR');
    check(event.kind === 'BODY', 'EXPECTED_BODY');
    captures.push({ bytes: event.body.byteLength, sha256: createHash('sha256').update(event.body).digest('hex'),
      captureMode: event.captureMode, profile: label, status: event.status });
    check(event.captureMode === 'FIXTURE', 'CAPTURE_MODE'); return event;
  }
  const query = (id: string, value: string) => {
    const wc = host.ownedContents(id); check(wc, 'QUERY_TARGET');
    return wc.executeJavaScript('window.queryFixture(' + JSON.stringify(value) + ')');
  };
  async function pending(handle: ResponseObserver) {
    const deadline = Date.now() + 1500;
    while (handle.snapshot().pendingRequests === 0 && Date.now() < deadline) await sleep(5);
    check(handle.snapshot().pendingRequests > 0, 'PENDING_REQUEST');
  }
  let devToolsTerminalCode: string | null = null;
  try {
    const a = await host.create('Observer fixture A'); await host.openFixture(a.id, origin + '/page');
    const ownerA = ownership(a.id), wcA = host.ownedContents(a.id)!;
    const messageBaseline = wcA.debugger.listenerCount('message');
    let observerA = await manager.attach(ownerA, 'FIXTURE');
    check((await manager.attach(ownerA, 'FIXTURE')) === observerA, 'ATTACH_IDEMPOTENCY');
    check(wcA.debugger.listenerCount('message') === messageBaseline + 1, 'LISTENER_BOUND');
    await next(observerA, event => event.kind === 'STATE' && event.code === 'ATTACHED');
    await query(a.id, 'json'); const text = await body(observerA, 'A');
    check(JSON.parse(Buffer.from(text.body).toString('utf8')).fixture === 'cà phê', 'JSON_ROUND_TRIP');
    checks.push('one local query captures correlated JSON via real Electron CDP with FIXTURE provenance');
    if (scenario === 'all') {
      await query(a.id, 'empty'); check((await body(observerA, 'A')).body.byteLength === 0, 'EMPTY_BODY');
      await query(a.id, 'binary'); check(Buffer.from((await body(observerA, 'A')).body).equals(Buffer.from([0, 255, 128, 1, 2])), 'BINARY_BODY');
      await query(a.id, 'post'); check((await body(observerA, 'A')).method === 'POST', 'POST_METHOD');
      await query(a.id, 'http-error'); check((await body(observerA, 'A')).status === 403, 'HTTP_STATUS_PRESERVED');
      checks.push('empty, binary/base64, POST and non-2xx response status remain distinct transport facts');
      const b = await host.create('Observer fixture B'); await host.openFixture(b.id, origin + '/page');
      const observerB = await manager.attach(ownership(b.id), 'FIXTURE'); await next(observerB, event => event.kind === 'STATE');
      await query(b.id, 'json'); const isolated = await body(observerB, 'B');
      check(isolated.owner.profileId === b.id, 'PROFILE_B_OWNER'); check((await observerA.read(30)).kind === 'TIMEOUT', 'PROFILE_ISOLATION');
      checks.push('same-origin requests in a second profile do not appear in the first profile observer');
      const beforeNavigation = observerA.snapshot().captureGeneration;
      void query(a.id, 'slow').catch(() => {}); await pending(observerA);
      const loaded = once(wcA, 'did-finish-load'); wcA.reload(); await loaded;
      await next(observerA, event => event.kind === 'STATE' && event.code === 'NAVIGATION_RESET');
      check(observerA.snapshot().pendingRequests === 0, 'RELOAD_CLEANUP');
      await query(a.id, 'json'); check((await body(observerA, 'A')).captureGeneration > beforeNavigation, 'RELOAD_GENERATION');
      checks.push('reload while pending cancels old request generation and captures the new document');
      observerA.suspend(); check(!wcA.debugger.isAttached(), 'SUSPEND_DETACH');
      await next(observerA, event => event.kind === 'STATE' && event.code === 'SUSPENDED');
      await query(a.id, 'json'); check((await observerA.read(30)).kind === 'TIMEOUT', 'SUSPEND_NO_BODY');
      await observerA.resume(); await next(observerA, event => event.kind === 'STATE' && event.code === 'ATTACHED');
      await query(a.id, 'json'); await body(observerA, 'A');
      checks.push('suspend detaches and suppresses captures; resume binds a fresh generation');
      await query(a.id, 'huge');
      const huge = await next(observerA, event => event.kind === 'ERROR');
      check(huge.kind === 'ERROR' && huge.code === 'BODY_TOO_LARGE', 'BODY_LIMIT');
      await query(a.id, 'abort');
      const abort = await next(observerA, event => event.kind === 'ERROR');
      check(abort.kind === 'ERROR' && abort.code === 'NETWORK_FAILED', 'NETWORK_FAILURE');
      checks.push('oversized response and aborted HTTP response produce errors rather than empty success');
      void query(a.id, 'slow').catch(() => {}); await pending(observerA); wcA.debugger.detach();
      const detached = await next(observerA, event => event.kind === 'ERROR');
      check(detached.kind === 'ERROR' && detached.code === 'DEBUGGER_DETACHED', 'EXTERNAL_DETACH');
      check(wcA.debugger.listenerCount('message') === messageBaseline, 'DETACH_CLEANUP');
      observerA = await manager.attach(ownerA, 'FIXTURE'); await next(observerA, event => event.kind === 'STATE');
      checks.push('external debugger detach while pending clears listeners; explicit reattach does not duplicate them');
      const toolsSession = session.fromPartition('csd-observer-tools');
      toolsSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      toolsSession.setPermissionCheckHandler(() => false);
      toolsSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['devtools:', 'chrome-devtools:', 'about:', 'data:'].includes(new URL(details.url).protocol) }));
      const tools = new BrowserWindow({ show: false, webPreferences: { session: toolsSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        void query(a.id, 'slow').catch(() => {}); await pending(observerA);
        wcA.setDevToolsWebContents(tools.webContents);
        const opened = once(wcA, 'devtools-opened'); wcA.openDevTools({ mode: 'detach', activate: false });
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([opened, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('OBSERVER_CHECK_DEVTOOLS_OPEN')), 3000); })]).finally(() => { if (timer) clearTimeout(timer); });
        await tick();
        const interrupted = await next(observerA, event => event.kind === 'ERROR');
        check(interrupted.kind === 'ERROR' && ['DEVTOOLS_OPENED', 'DEBUGGER_DETACHED'].includes(interrupted.code), 'DEVTOOLS_LIFECYCLE');
        devToolsTerminalCode = interrupted.code;
        check(observerA.snapshot().pendingRequests === 0 && wcA.debugger.listenerCount('message') === messageBaseline, 'DEVTOOLS_CLEANUP');
        wcA.closeDevTools();
      } finally { tools.destroy(); }
      observerA = await manager.attach(ownerA, 'FIXTURE'); await next(observerA, event => event.kind === 'STATE');
      await query(a.id, 'json'); await body(observerA, 'A');
      checks.push('hidden real DevTools lifecycle is recorded; observer can explicitly reattach after it closes');
      void query(a.id, 'slow').catch(() => {}); await pending(observerA); await host.close(a.id);
      const closed = await next(observerA, event => event.kind === 'ERROR');
      check(closed.kind === 'ERROR' && ['DEBUGGER_DETACHED', 'TARGET_DESTROYED'].includes(closed.code), 'CLOSED_TARGET');
      check(observerA.snapshot().pendingRequests === 0, 'CLOSE_PENDING_CLEANUP');
      await host.openFixture(a.id, origin + '/page'); const reopened = ownership(a.id);
      check(reopened.viewGeneration > ownerA.viewGeneration && reopened.webContentsId !== ownerA.webContentsId, 'REOPEN_IDENTITY');
      let staleOwnerRejected = false; try { await manager.attach(ownerA, 'FIXTURE'); } catch { staleOwnerRejected = true; }
      check(staleOwnerRejected, 'STALE_OWNER_REJECTED');
      observerA = await manager.attach(reopened, 'FIXTURE'); await query(a.id, 'json'); await body(observerA, 'A');
      checks.push('closing pending view stops capture; reopen gets new ownership and rejects old target identity');
      observerB.stop(); await host.close(b.id);
    }
    observerA.stop(); manager.stopAll(); await tick(); await host.close(a.id);
    const report = { task: 'P01.03', date: '2026-10-27', result: 'PASS', mode: 'FIXTURE', scenario, checks,
      captures, devToolsTerminalCode, limits: manager.limits, verifiedValidUniquePosts: 0,
      limitations: ['Local HTTP fixtures only; no Facebook parser/login/live data',
        'Native body command rejection/timeout and strict capacity faults are injected in unit tests',
        'CDP buffer hints and post-decode checks are not an absolute bound on native/string allocation'] };
    return report;
  } finally { manager.stopAll(); }
}
