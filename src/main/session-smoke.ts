// Local fixture instrumentation only. Never reachable through IPC or the production login affordance.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseWindow, session } from 'electron';
import type { BrowserWindow, WebContents, Session } from 'electron';
import type { BrowserProfiles } from '../application/ports/browser-profiles.js';
import type { SecretStore } from '../application/ports/secret-store.js';
import { createBrowserHost } from '../infrastructure/browser/browser-host.js';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';

export async function runSessionSmoke(input: {
  host: BrowserHost; profiles: BrowserProfiles; secrets: SecretStore;
  fixtureOrigin: string; smokeRoot: string; mainWindow: BrowserWindow;
}): Promise<{ abruptExit: boolean }> {
  const { host, profiles, secrets, fixtureOrigin: origin, smokeRoot: root, mainWindow } = input;
  const phase = process.env.CSD_SESSION_SMOKE_PHASE;
  assert.ok(['seed', 'logout-crash', 'verify-logout'].includes(phase || ''));
  const stateFile = join(root, 'profile-ids.json');
  const checks: string[] = [];
  const observations: Record<string, boolean> = {};
  const pass = (name: string) => checks.push(name);
  const view = (id: string): WebContents => { const value = host.ownedContents(id); assert.ok(value); return value; };
  const cookie = async (id: string, name: string) => (await host.ownedSession(id)!.cookies.get({ name }))[0]?.value || null;
  const readPage = (id: string) => view(id).executeJavaScript('window.fixtureState()');
  const open = async (id: string, seed?: string) => {
    await host.openFixture(id, origin + '/state' + (seed ? '?seed=' + seed : ''));
  };
  let ids: { a: string; b: string };
  if (phase === 'seed') {
    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      const waitFor = (condition) => new Promise((resolve, reject) => {
        if (condition()) { resolve(); return; }
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('UI_FIXTURE_TIMEOUT')); }, 5000);
        const observer = new MutationObserver(() => { if (condition()) { clearTimeout(timer); observer.disconnect(); resolve(); } });
        observer.observe(document.documentElement, { childList: true, attributes: true, characterData: true, subtree: true });
      });
      await waitFor(() => document.documentElement.dataset.ready === 'true');
      await document.fonts.ready;
      document.getElementById('profile-label').value = 'Fixture A';
      document.getElementById('profile-form').requestSubmit();
      await waitFor(() => document.getElementById('profiles').children.length === 1);
      await window.csd.profiles.create({ label: 'Fixture B', platform: 'threads' });
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => document.getElementById('profiles').children.length === 2);
      document.querySelector('#profiles li button').click();
      await waitFor(() => document.querySelector('#profiles li').textContent.includes('Đang mở'));
      document.getElementById('profiles-heading').scrollIntoView({block:'center'});
      const state = await window.csd.profiles.list();
      const a = state.profiles[0].id, b = state.profiles[1].id;
      const rejects = async (run) => { try { await run(); return false; } catch { return true; } };
      return { a, b, manualLoginEnabled: state.manualLoginEnabled, invalid: [
        await rejects(() => window.csd.profiles.open({ profileId: a, url: 'file:///arbitrary' })),
        await rejects(() => window.csd.profiles.open({ profileId: '../other' })),
        await rejects(() => window.csd.profiles.create({ label: ' ', password: 'synthetic-only' })),
        await rejects(() => window.csd.profiles.openLogin({ profileId: a }))
      ] };
    })()`);
    assert.equal(result.manualLoginEnabled, false); assert.deepEqual(result.invalid, [true, true, true, true]);
    ids = { a: result.a, b: result.b }; writeFileSync(stateFile, JSON.stringify(ids));
    const screenshot = await mainWindow.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    writeFileSync(join(root, 'profile-ui.png'), screenshot.toPNG());
    pass('UI form creates profile and open-session control opens its isolated view');
    pass('IPC rejects extra URL, invalid ID, credential payload and disabled login');
    await open(ids.a, 'A');
    await host.ownedSession(ids.a)!.cookies.set({ url: origin, name: 'http_only', value: 'http-A', httpOnly: true });
    await open(ids.b);
    assert.equal((await readPage(ids.b)).storage, null); assert.equal(await cookie(ids.b, 'session_cookie'), null);
    await open(ids.b, 'B');
    assert.equal((await profiles.get(ids.a)).platform, 'facebook');
    assert.equal((await profiles.get(ids.b)).platform, 'threads');
    assert.ok(BaseWindow.getAllWindows().some(window => window.getTitle().includes('Threads')));
    assert.ok(BaseWindow.getAllWindows().some(window => window.getTitle().includes('Facebook')));
    pass('Facebook and Threads use separate titled windows and persisted platform profiles');
    assert.equal((await readPage(ids.a)).storage, 'A'); assert.equal((await readPage(ids.b)).storage, 'B');
    assert.equal(await cookie(ids.a, 'session_cookie'), 'session-A'); assert.equal(await cookie(ids.b, 'session_cookie'), 'session-B');
    pass('two profiles isolate localStorage and persistent/session/HttpOnly cookies');
    assert.deepEqual(await view(ids.a).executeJavaScript(`({ node: typeof require, bridge: typeof window.csd, popupDenied: window.open('/state') === null })`),
      { node: 'undefined', bridge: 'undefined', popupDenied: true });
    const permission = await view(ids.a).executeJavaScript(`navigator.permissions.query({name:'geolocation'}).then(p=>p.state)`);
    assert.equal(permission, 'denied');
    const redirected = once(view(ids.a), 'will-redirect');
    await view(ids.a).executeJavaScript(`location.href = '/redirect'; void 0`); await redirected;
    assert.ok(view(ids.a).getURL().startsWith(origin));
    assert.equal(await view(ids.a).executeJavaScript(`fetch('https://csd-session.invalid/blocked').then(()=>false,()=>true)`), true);
    pass('site has no Node/CSD bridge; permissions, popup, external redirect/request denied');
    const old = view(ids.a); await host.close(ids.a); assert.equal(old.isDestroyed(), true);
    assert.equal(host.diagnostics().openViews, 1); await open(ids.a);
    assert.equal(await cookie(ids.a, 'session_cookie'), 'session-A');
    pass('closing destroys owned contents; reopen reuses only its own partition');
    const stale = view(ids.a), destroyed = once(stale, 'destroyed');
    stale.close({ waitForBeforeUnload: false }); await destroyed;
    await host.open(ids.a);
    assert.equal(BaseWindow.getAllWindows().length, 3); // UI + the two profile windows, with no stale fourth host.
    pass('replacing destroyed contents also closes the stale host window');
    await secrets.set('fixture-vault-key', 'p01-vault-synthetic');
    assert.equal(await secrets.get('fixture-vault-key'), 'p01-vault-synthetic');
    await host.close(ids.a); await host.close(ids.b);
    const customSecrets = join(root, 'user-data', 'secrets');
    for (const name of readdirSync(customSecrets)) {
      const bytes = readFileSync(join(customSecrets, name));
      for (const marker of ['p01-vault-synthetic', 'session-A', 'session-B', 'http-A']) assert.equal(bytes.includes(marker), false);
    }
    pass('Windows async safeStorage vault round-trip; custom files contain no plaintext markers');
  } else {
    ids = JSON.parse(readFileSync(stateFile, 'utf8'));
    const rows = await profiles.list(); assert.deepEqual(rows.map(row => row.id), [ids.a, ids.b]);
    assert.ok(rows.every(row => row.accountBinding.status === 'UNVERIFIED' && row.accountBinding.accountId === null));
    const nativeBeforeRestore = session.fromPartition('persist:csd-v1-' + ids.a);
    observations.nativeSessionCookiePresentBeforeHostRestore = (await nativeBeforeRestore.cookies.get({ name: 'session_cookie' })).length > 0;
    observations.nativePersistentCookiePresentBeforeHostRestore = (await nativeBeforeRestore.cookies.get({ name: 'persistent_cookie' })).length > 0;
    await open(ids.a); await open(ids.b);
    assert.equal((await readPage(ids.a)).storage, 'A'); assert.equal((await readPage(ids.b)).storage, 'B');
    assert.equal(await cookie(ids.b, 'session_cookie'), 'session-B');
    assert.equal(await cookie(ids.b, 'persistent_cookie'), 'persistent-B');
    assert.equal(await secrets.get('fixture-vault-key'), 'p01-vault-synthetic');
    pass('stable IDs, unverified binding, partition storage and OS vault persist across processes');
    if (phase === 'logout-crash') {
      assert.equal(await cookie(ids.a, 'session_cookie'), 'session-A');
      assert.equal(await cookie(ids.a, 'persistent_cookie'), 'persistent-A');
      assert.equal(await cookie(ids.a, 'http_only'), 'http-A');
      pass('restart restores session/HttpOnly cookies and Chromium persistent cookie');
      await host.close(ids.b);
      const current = host.ownedSession(ids.a)!;
      for (const entry of await current.cookies.get({})) await current.cookies.remove(origin + (entry.path || '/'), entry.name);
      await current.cookies.flushStore();
      assert.equal((await current.cookies.get({})).length, 0);
      assert.ok(existsSync(join(root, 'user-data/data/session-snapshots', ids.a + '.dirty')));
      // Controlled long debounce keeps the old backup present while testing abrupt exit.
      const old = JSON.parse((await secrets.get('session:' + ids.a))!);
      assert.ok(old.cookies.some((entry: { name: string }) => entry.name === 'session_cookie'));
      pass('logout invalidates old encrypted snapshot durably before debounce completes');
      writeFileSync(join(root, 'session-result.json'), JSON.stringify({ phase, checks, observations, abruptExit: true }));
      return { abruptExit: true };
    }
    assert.equal(await cookie(ids.a, 'session_cookie'), null);
    assert.equal(await cookie(ids.a, 'persistent_cookie'), null);
    assert.equal(await cookie(ids.a, 'http_only'), null);
    pass('abrupt exit during pending save cannot resurrect logged-out cookies');
    const broken = await profiles.create('Fixture restore failure');
    const savedCookie = (name: string) => ({ name, value: 'synthetic', domain: '127.0.0.1', path: '/', secure: false, httpOnly: true, hostOnly: true, sameSite: 'lax' });
    await secrets.set('session:' + broken.id, JSON.stringify({ version: 1, profileId: broken.id, cookies: [savedCookie('first'), savedCookie('second')] }));
    let writes = 0;
    const failing = createBrowserHost({ profiles, secrets, fixtureOrigin: origin, manualLoginEnabled: false, hidden: true,
      journalDirectory: join(root, 'user-data/data/session-snapshots'),
      sessionForPartition(partition): Session {
        const native = session.fromPartition(partition);
        const cookies = new Proxy(native.cookies, { get(target, key) {
          if (key === 'set') return async (details: Electron.CookiesSetDetails) => {
            if (++writes === 2) throw new Error('synthetic failure');
            return target.set(details);
          };
          const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
        return new Proxy(native, { get(target, key) {
          if (key === 'cookies') return cookies;
          const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
    });
    await assert.rejects(failing.open(broken.id), /SESSION_RESTORE_FAILED/);
    assert.equal(writes, 2); assert.equal(failing.diagnostics().openViews, 0);
    await assert.rejects(host.open(broken.id), /SESSION_RECOVERY_REQUIRED/);
    assert.equal((await host.list()).find(row => row.id === broken.id)?.persistenceError, 'SESSION_RECOVERY_REQUIRED');
    await failing.shutdown();
    pass('partial restore failure is quarantined durably; next owner cannot accept partial auth');
    await host.close(ids.a); await host.close(ids.b);
  }
  assert.equal(host.diagnostics().openViews, 0);
  writeFileSync(join(root, 'session-result.json'), JSON.stringify({ phase, checks, observations, abruptExit: false }));
  return { abruptExit: false };
}
