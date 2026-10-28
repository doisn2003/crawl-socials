import { BaseWindow, WebContentsView, session } from 'electron';
import type { Session, Cookie, CookiesSetDetails, WebContents } from 'electron';
import type { BrowserProfiles } from '../../application/ports/browser-profiles.js';
import type { SecretStore } from '../../application/ports/secret-store.js';
import type { BrowserProfile } from '../../domain/browser-profile.js';
import { createBrowserPolicy, ownedRequestContext } from './navigation-policy.js';
import { createSessionSnapshotJournal } from './session-snapshot-journal.js';
import type { PolicyDiagnostics } from './policy-diagnostics.js';

interface SessionCookie {
  name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean;
  hostOnly: boolean; sameSite: Cookie['sameSite'];
}
interface Entry {
  profile: BrowserProfile; session: Session; view: WebContentsView | null; window: BaseWindow | null;
  restoring: boolean; closing: boolean; timer: ReturnType<typeof setTimeout> | null;
  saves: Promise<void>; persistenceError: string | null; cookieRevision: number;
  viewGeneration: number;
}
export function createBrowserHost(input: {
  profiles: BrowserProfiles; secrets: SecretStore; journalDirectory: string;
  manualLoginEnabled: boolean; fixtureOrigin?: string; hidden?: boolean; cookieSaveDelayMs?: number;
  policyDiagnostics?: PolicyDiagnostics;
  sessionForPartition?: (partition: string) => Session;
}) {
  const policy = createBrowserPolicy(input);
  const journal = createSessionSnapshotJournal(input.journalDirectory);
  const entries = new Map<string, Entry>();
  const locks = new Map<string, Promise<unknown>>();
  let stopping = false, shutdownPromise: Promise<void> | null = null;
  let blockedRequests = 0, blockedNavigations = 0, deniedPopups = 0;
  let nextViewGeneration = 0;
  const keyFor = (id: string) => 'session:' + id;
  const record = (kind: Parameters<PolicyDiagnostics['record']>[0], details?: Parameters<PolicyDiagnostics['record']>[1]) => input.policyDiagnostics?.record(kind, details);
  const keyCookie = (cookie: { domain?: string; name: string; path?: string }) => JSON.stringify([cookie.domain, cookie.path, cookie.name]);
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const result = (locks.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (stopping) throw new Error('BROWSER_STOPPING');
      return work();
    });
    locks.set(id, result);
    void result.finally(() => { if (locks.get(id) === result) locks.delete(id); }).catch(() => {});
    return result;
  };
  async function save(entry: Entry) {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    const result = entry.saves.catch(() => {}).then(async () => {
      try {
        const revision = entry.cookieRevision;
        const native = await entry.session.cookies.get({});
        const cookies: SessionCookie[] = [];
        for (const cookie of native) {
          if (!cookie.session || !cookie.domain || !cookie.path || !policy.cookieUrl(cookie.domain, cookie.path, !!cookie.secure)) continue;
          cookies.push({ name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
            secure: !!cookie.secure, httpOnly: !!cookie.httpOnly, hostOnly: !!cookie.hostOnly, sameSite: cookie.sameSite || 'unspecified' });
        }
        if (cookies.length > 512) throw new Error();
        await input.secrets.set(keyFor(entry.profile.id), JSON.stringify({ version: 1, profileId: entry.profile.id, cookies }));
        await entry.session.cookies.flushStore();
        entry.session.flushStorageData();
        if (revision === entry.cookieRevision) journal.clearDirty(entry.profile.id);
        entry.persistenceError = null;
      } catch { entry.persistenceError = 'SESSION_SAVE_FAILED'; throw new Error('SESSION_SAVE_FAILED'); }
    });
    entry.saves = result;
    return result;
  }
  async function ensure(id: string): Promise<Entry> {
    const profile = await input.profiles.get(id);
    if (journal.recoveryRequired(id)) throw new Error('SESSION_RECOVERY_REQUIRED');
    const existing = entries.get(id);
    if (existing) return existing;
    const current = (input.sessionForPartition || session.fromPartition)('persist:csd-v1-' + profile.id);
    const entry: Entry = { profile, session: current, view: null, window: null, restoring: true, closing: false,
      timer: null, saves: Promise.resolve(), persistenceError: null, cookieRevision: 0, viewGeneration: 0 };
    current.setPermissionRequestHandler((contents, _permission, callback) => {
      record('PERMISSION_DENIED', { url: contents.isDestroyed() ? undefined : contents.getURL(), view: entry.viewGeneration }); callback(false);
    });
    current.setPermissionCheckHandler(() => false);
    current.setDevicePermissionHandler(() => false);
    current.on('will-download', event => event.preventDefault());
    current.webRequest.onBeforeRequest((details, callback) => {
      const context = !entry.closing && !stopping ? ownedRequestContext(entry.view?.webContents, details.webContentsId, details.resourceType) : undefined;
      const allow = policy.resourceAllowed(details.url, context);
      if (!allow) blockedRequests++;
      record(allow ? 'REQUEST_ALLOWED' : 'REQUEST_BLOCKED', { url: details.url, view: entry.viewGeneration, resourceType: details.resourceType });
      callback({ cancel: !allow });
    });
    if (input.policyDiagnostics) {
      current.webRequest.onCompleted(details => record('RESOURCE_COMPLETED', { url: details.url,
        view: entry.viewGeneration, resourceType: details.resourceType, statusCode: details.statusCode }));
      current.webRequest.onErrorOccurred(details => record('RESOURCE_FAILED', { url: details.url,
        view: entry.viewGeneration, resourceType: details.resourceType, networkError: details.error }));
    }
    try {
      // Pending cookie changes may include logout. Never resurrect the older encrypted snapshot.
      const stored = await input.secrets.get(keyFor(id));
      const text = journal.dirty(id) ? null : stored;
      if (text !== null) {
        const saved = JSON.parse(text);
        if (saved?.version !== 1 || saved.profileId !== id || !Array.isArray(saved.cookies) || saved.cookies.length > 512) throw new Error();
        const native = new Set((await current.cookies.get({})).map(keyCookie));
        const toRestore: CookiesSetDetails[] = [];
        for (const cookie of saved.cookies) {
          if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string' ||
            typeof cookie.path !== 'string' || typeof cookie.secure !== 'boolean' || typeof cookie.httpOnly !== 'boolean' ||
            typeof cookie.hostOnly !== 'boolean' || !['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) throw new Error();
          const url = policy.cookieUrl(cookie.domain, cookie.path, cookie.secure);
          if (!url) throw new Error();
          if (native.has(keyCookie(cookie))) continue; // Never overwrite newer native cookies from this partition.
          const details: CookiesSetDetails = { url, name: cookie.name, value: cookie.value, path: cookie.path,
            secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite };
          if (!cookie.hostOnly) details.domain = cookie.domain;
          toRestore.push(details);
        }
        // Validate the entire snapshot first. A crash/failure after this marker quarantines
        // the profile across restarts instead of accepting a partial cookie restoration.
        if (toRestore.length) {
          journal.beginRestore(id);
          for (const details of toRestore) await current.cookies.set(details);
          await current.cookies.flushStore();
          journal.finishRestore(id);
        }
      }
      await current.cookies.flushStore();
    } catch { throw new Error('SESSION_RESTORE_FAILED'); }
    entry.restoring = false;
    current.cookies.on('changed', () => {
      if (entry.restoring) return;
      entry.cookieRevision++;
      try { journal.markDirty(id); }
      catch { entry.persistenceError = 'SESSION_INVALIDATION_FAILED'; return; }
      if (entry.closing || stopping) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { entry.timer = null; void save(entry).catch(() => {}); }, input.cookieSaveDelayMs ?? 150);
      entry.timer.unref();
    });
    entries.set(id, entry);
    return entry;
  }
  async function navigate(entry: Entry, url: string) {
    if (!policy.navigationAllowed(url)) throw new Error('BROWSER_URL_DENIED');
    const wc = entry.view?.webContents;
    if (!wc || wc.isDestroyed()) throw new Error('BROWSER_VIEW_CLOSED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([wc.loadURL(url), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { record('HOST_NAVIGATION_TIMEOUT', { url, view: entry.viewGeneration, resourceType: 'mainFrame' });
          if (!wc.isDestroyed()) wc.stop(); reject(new Error('BROWSER_LOAD_FAILED')); }, 15000);
      })]);
    } catch { throw new Error('BROWSER_LOAD_FAILED'); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function openInternal(id: string) {
    const entry = await ensure(id);
    const previousContents = entry.view?.webContents;
    if (previousContents && !previousContents.isDestroyed()) {
      if (!input.hidden) { entry.window?.show(); entry.window?.focus(); }
      return entry;
    }
    if (entry.window && !entry.window.isDestroyed()) entry.window.destroy();
    entry.view = null; entry.window = null;
    const window = new BaseWindow({ title: 'CSD — Phiên ' + entry.profile.label, width: 1000, height: 760, show: !input.hidden });
    const view = new WebContentsView({ webPreferences: { session: entry.session, sandbox: true,
      contextIsolation: true, nodeIntegration: false, webviewTag: false,
      ...(input.hidden ? { backgroundThrottling: false } : {}) } });
    entry.window = window; entry.view = view; entry.closing = false; entry.viewGeneration = ++nextViewGeneration;
    const resize = () => {
      const bounds = window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
    };
    window.contentView.addChildView(view); resize(); window.on('resize', resize);
    window.on('close', event => { event.preventDefault(); void close(id).catch(() => {}); });
    const wc = view.webContents;
    const contextFor = (resourceType: string) => !entry.closing && !stopping && entry.view?.webContents === wc
      ? ownedRequestContext(wc, wc.id, resourceType) : undefined;
    wc.setWindowOpenHandler(details => { deniedPopups++; record('POPUP_DENIED', { url: details.url, view: entry.viewGeneration }); return { action: 'deny' }; });
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.on('will-navigate', event => { const allow = policy.navigationAllowed(event.url, contextFor('mainFrame'));
      record(allow ? 'NAVIGATION_ALLOWED' : 'NAVIGATION_BLOCKED', { url: event.url, view: entry.viewGeneration, resourceType: 'mainFrame' });
      if (!allow) { blockedNavigations++; event.preventDefault(); } });
    wc.on('will-redirect', event => { const allow = policy.navigationAllowed(event.url, contextFor(event.isMainFrame ? 'mainFrame' : 'subFrame'));
      record(allow ? 'NAVIGATION_ALLOWED' : 'NAVIGATION_BLOCKED', { url: event.url, view: entry.viewGeneration, resourceType: event.isMainFrame ? 'mainFrame' : 'subFrame' });
      if (!allow) { blockedNavigations++; event.preventDefault(); } });
    wc.on('will-frame-navigate', event => { const allow = policy.navigationAllowed(event.url, contextFor(event.isMainFrame ? 'mainFrame' : 'subFrame'));
      record(allow ? 'NAVIGATION_ALLOWED' : 'NAVIGATION_BLOCKED', { url: event.url, view: entry.viewGeneration, resourceType: event.isMainFrame ? 'mainFrame' : 'subFrame' });
      if (!allow) { blockedNavigations++; event.preventDefault(); } });
    if (input.policyDiagnostics) {
      wc.on('did-start-navigation', event => record('NAVIGATION_STARTED', { url: event.url, view: entry.viewGeneration, resourceType: event.isMainFrame ? 'mainFrame' : 'subFrame' }));
      wc.on('did-navigate', (_event, url, statusCode) => record('NAVIGATION_COMMITTED', { url, view: entry.viewGeneration, resourceType: 'mainFrame', statusCode }));
      wc.on('did-finish-load', () => record('LOAD_FINISHED', { url: wc.getURL(), view: entry.viewGeneration, resourceType: 'mainFrame' }));
      wc.on('did-fail-load', (_event, errorCode, _description, url, mainFrame) => record('LOAD_FAILED', { url, view: entry.viewGeneration, errorCode, resourceType: mainFrame ? 'mainFrame' : 'subFrame' }));
      wc.on('render-process-gone', () => record('RENDERER_GONE', { view: entry.viewGeneration }));
      wc.on('destroyed', () => record('VIEW_CLOSED', { view: entry.viewGeneration }));
    }
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    await navigate(entry, 'about:blank');
    return entry;
  }
  async function closeEntry(entry: Entry) {
    entry.closing = true;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    const view = entry.view, window = entry.window;
    entry.view = null; entry.window = null;
    const wc = view?.webContents;
    if (view && wc && !wc.isDestroyed()) {
      if (window && !window.isDestroyed()) window.contentView.removeChildView(view);
      await new Promise<void>(resolve => {
        wc.once('destroyed', resolve);
        wc.close({ waitForBeforeUnload: false });
        if (wc.isDestroyed()) resolve();
      });
    }
    if (window && !window.isDestroyed()) window.destroy();
    await entry.session.closeAllConnections();
    await save(entry);
    if (journal.dirty(entry.profile.id)) await save(entry);
    if (journal.dirty(entry.profile.id)) { entry.persistenceError = 'SESSION_SAVE_FAILED'; throw new Error('SESSION_SAVE_FAILED'); }
    entry.closing = false;
  }
  function close(id: string) { return serial(id, async () => { await input.profiles.get(id); const entry = entries.get(id); if (entry) await closeEntry(entry); }); }
  return {
    async list() {
      return (await input.profiles.list()).map(profile => ({ ...profile,
        open: !!entries.get(profile.id)?.view?.webContents && !entries.get(profile.id)!.view!.webContents.isDestroyed(),
        persistenceError: journal.recoveryRequired(profile.id) ? 'SESSION_RECOVERY_REQUIRED' : entries.get(profile.id)?.persistenceError || null }));
    },
    create: (label: string) => { if (stopping) return Promise.reject(new Error('BROWSER_STOPPING')); return input.profiles.create(label); },
    open: (id: string) => serial(id, async () => { await openInternal(id); }),
    close,
    openLogin: (id: string) => serial(id, async () => {
      if (!input.manualLoginEnabled || policy.fixtureOrigin) throw new Error('MANUAL_LOGIN_DISABLED');
      const entry = await openInternal(id); await navigate(entry, 'https://www.facebook.com/login/');
    }),
    // Main-only ownership access for local diagnostics/future observer lifecycle; never bridged to website/UI.
    ownedContents: (id: string): WebContents | null => entries.get(id)?.view?.webContents || null,
    ownedSession: (id: string): Session | null => entries.get(id)?.session || null,
    observerTarget(id: string) {
      const entry = entries.get(id), contents = entry?.view?.webContents;
      if (!entry || !contents || contents.isDestroyed()) return null;
      return { profileId: id, webContentsId: contents.id, viewGeneration: entry.viewGeneration, contents };
    },
    async openFixture(id: string, url: string) {
      if (!policy.fixtureOrigin) throw new Error('FIXTURE_DISABLED');
      await serial(id, async () => { const entry = await openInternal(id); await navigate(entry, url); });
    },
    diagnostics: () => ({ openViews: [...entries.values()].filter(entry => entry.view?.webContents && !entry.view.webContents.isDestroyed()).length, blockedRequests, blockedNavigations, deniedPopups }),
    shutdown(): Promise<void> {
      return shutdownPromise ??= (async () => {
        stopping = true;
        await Promise.allSettled([...locks.values()]);
        const results = await Promise.allSettled([...entries.values()].map(closeEntry));
        if (results.some(result => result.status === 'rejected')) throw new Error('BROWSER_SHUTDOWN_FAILED');
      })();
    },
  };
}
export type BrowserHost = ReturnType<typeof createBrowserHost>;
