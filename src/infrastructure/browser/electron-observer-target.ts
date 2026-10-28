import type { WebContents } from 'electron';
import type { BrowserHost } from './browser-host.js';
import type { ObserverTarget } from './observer-target.js';
import type { ObserverOwner } from '../../application/ports/response-observer.js';

export function electronObserverTarget(contents: WebContents): ObserverTarget {
  const debug = contents.debugger;
  return {
    id: contents.id,
    isDestroyed: () => contents.isDestroyed(),
    debuggerAttached: () => debug.isAttached(),
    devToolsOpened: () => contents.isDevToolsOpened(),
    attachDebugger: () => debug.attach('1.3'),
    detachDebugger: () => debug.detach(),
    command: (method, params) => debug.sendCommand(method, params),
    onMessage(callback) {
      const listener = (_event: Electron.Event, method: string, params: unknown, sessionId: string) => callback(method, params, !!sessionId);
      debug.on('message', listener); return () => debug.removeListener('message', listener);
    },
    onDetach(callback) { const listener = () => callback(); debug.on('detach', listener); return () => debug.removeListener('detach', listener); },
    onDestroyed(callback) { contents.on('destroyed', callback); return () => contents.removeListener('destroyed', callback); },
    onDevTools(callback) { contents.on('devtools-opened', callback); return () => contents.removeListener('devtools-opened', callback); },
    onNavigation(callback) {
      const listener = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => { if (event.isMainFrame && !event.isSameDocument) callback(); };
      contents.on('did-start-navigation', listener); return () => contents.removeListener('did-start-navigation', listener);
    },
  };
}
export function createOwnedObserverResolver(host: BrowserHost) {
  const cache = new WeakMap<WebContents, ObserverTarget>();
  return (owner: ObserverOwner): ObserverTarget | null => {
    const target = host.observerTarget(owner.profileId);
    if (!target || target.webContentsId !== owner.webContentsId || target.viewGeneration !== owner.viewGeneration) return null;
    let driver = cache.get(target.contents);
    if (!driver) { driver = electronObserverTarget(target.contents); cache.set(target.contents, driver); }
    return driver;
  };
}
