import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import { createOwnedObserverResolver } from '../infrastructure/browser/electron-observer-target.js';
import { createResponseObserverManager } from '../infrastructure/browser/response-observer.js';
import type { ProbeDriver } from './probe-controller.js';

export function createFixtureProbeDriver(host: BrowserHost, fixtureOrigin: string): ProbeDriver {
  const origin = new URL(fixtureOrigin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PROBE_FIXTURE_ORIGIN_INVALID');
  const resolver = createOwnedObserverResolver(host);
  // Shared across segments and runs: native promises and poisoned targets remain accounted.
  const manager = createResponseObserverManager({ resolveOwned: resolver,
    urlAllowed: url => { try { const parsed = new URL(url); return parsed.origin === origin.origin && parsed.pathname === '/capture'; } catch { return false; } },
    limits: { maxRunMs: 30000 } });
  return { acquire(profileId, lost) {
    const target = host.observerTarget(profileId);
    if (!target) throw new Error('PROBE_PROFILE_NOT_OPEN');
    const wc = target.contents;
    if (wc.debugger.isAttached() || wc.isDevToolsOpened()) throw new Error('PROBE_DEBUGGER_BUSY');
    let released = false, navigating = false, revoked = false;
    const lose = (reason: Parameters<typeof lost>[0]) => {
      if (revoked || released) return; revoked = true;
      // Never detach a native debugger reentrantly inside a navigation/DevTools callback.
      // Revoke the driver synchronously so no new controlled action can slip through.
      setImmediate(() => { if (!released) lost(reason); });
    };
    const check = () => {
      const now = host.observerTarget(profileId);
      if (released || revoked || !now || now.webContentsId !== target.webContentsId || now.viewGeneration !== target.viewGeneration) throw new Error('PROBE_OWNER_CHANGED');
    };
    const checkAfterNative = async () => {
      // Let the already queued lifecycle reason win over an incidental promise rejection.
      if (revoked) await new Promise<void>(resolve => setImmediate(resolve));
      check();
    };
    const blocked = (event: Electron.Event) => event.preventDefault();
    const navigation = (event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>) => {
      if (!navigating || event.url !== origin.origin + '/page') { event.preventDefault(); lose('COVERAGE_LOST'); }
    };
    const started = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!navigating) lose('COVERAGE_LOST');
    };
    const destroyed = () => lose('TARGET_CLOSED'), devtools = () => lose('DEVTOOLS_OPENED');
    wc.on('before-input-event', blocked); wc.on('before-mouse-event', blocked);
    wc.on('will-frame-navigate', navigation); wc.on('did-start-navigation', started);
    wc.on('destroyed', destroyed); wc.on('devtools-opened', devtools);
    // Page keyboard and mouse input are disabled for the run, even between observer segments.
    // Network requests spawned by a controlled action are deliberately not called actions.
    return {
      async beginSegment(maxRunMs) {
        await checkAfterNative(); if (maxRunMs < 1 || maxRunMs > 60000) throw new Error('PROBE_SEGMENT_INVALID'); manager.stopAll();
        const handle = await manager.attach(target, 'FIXTURE'); await checkAfterNative(); return handle;
      },
      async action(action, query, batch, signal) {
        await checkAfterNative(); if (signal.aborted) return;
        const stop = () => { if (!wc.isDestroyed()) wc.stop(); };
        signal.addEventListener('abort', stop, { once: true });
        try {
          if (action === 'NAVIGATE_FIXTURE') {
            navigating = true;
            try { await host.openFixture(profileId, origin.origin + '/page'); } finally { navigating = false; }
          } else {
            if (!Number.isInteger(query) || query < 0 || query > 2 || !Number.isInteger(batch) || batch < 1 || batch > 5) throw new Error('PROBE_ACTION_INVALID');
            // Fixed script and numeric indices only; no renderer-supplied URL/JS/selector.
            await wc.executeJavaScript(`fetch('/capture?q=${query}&batch=${batch}', {cache:'no-store'}).then(r=>r.arrayBuffer()).then(()=>undefined)`);
          }
          await checkAfterNative();
        } finally { signal.removeEventListener('abort', stop); }
      },
      release() {
        if (released) return; released = true; manager.stopAll();
        wc.removeListener('before-input-event', blocked); wc.removeListener('before-mouse-event', blocked);
        wc.removeListener('will-frame-navigate', navigation); wc.removeListener('did-start-navigation', started);
        wc.removeListener('destroyed', destroyed); wc.removeListener('devtools-opened', devtools);
      },
    };
  } };
}
