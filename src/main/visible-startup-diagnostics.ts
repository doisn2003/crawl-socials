import type { BrowserWindow } from 'electron';
import { basename, dirname, join } from 'node:path';
import { realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { ProbeController } from './probe-controller.js';

// Explicit local diagnostics only. It keeps normal userData, visibility, throttling,
// session policy and manual-login configuration; it does not enable smoke/capture.
export async function recordVisibleStartup(input: { directory: string; window: BrowserWindow;
  host: BrowserHost; probe: ProbeController; manualLoginEnabled: boolean; rendererErrors: string[] }) {
  const directory = realpathSync(input.directory), temp = realpathSync(tmpdir());
  if (dirname(directory) !== temp || !basename(directory).startsWith('csd-visible-')) throw new Error('VISIBLE_DIAGNOSTICS_ROOT_DENIED');
  const dom = await input.window.webContents.executeJavaScript(`(async () => {
    await new Promise((resolve, reject) => {
      if (document.documentElement.dataset.ready === 'true') { resolve(); return; }
      const observer = new MutationObserver(() => {
        if (document.documentElement.dataset.ready === 'true') { clearTimeout(timer); observer.disconnect(); resolve(); }
      });
      const timer = setTimeout(() => {observer.disconnect(); reject(new Error('UI_READY_TIMEOUT'));}, 5000);
      observer.observe(document.documentElement, {attributes:true,attributeFilter:['data-ready']});
    });
    await document.fonts.ready;
    const profiles = await window.csd.profiles.list(), config = await window.csd.probe.config(), status = await window.csd.probe.status();
    return { ready: document.documentElement.dataset.ready === 'true', readyState: document.readyState,
      titleMatches: document.title === 'CSD — Crawl Socials Data',
      headingMatches: document.querySelector('h1')?.textContent === 'Bắt đầu từ một chủ đề.',
      profileFormPresent: !!document.getElementById('profile-form'),
      profileLabelPresent: !!document.getElementById('profile-label'),
      offlineButtonEnabled: !document.getElementById('offline-check').disabled,
      probeStartDisabled: document.getElementById('probe-start').disabled,
      bodyChildren: document.body.children.length, contentHeight: document.documentElement.scrollHeight,
      viewport: {width:innerWidth,height:innerHeight},
      manualLoginEnabled: profiles.manualLoginEnabled, profileCount: profiles.profiles.length,
      probeLiveAvailable: config.liveAvailable, probeAvailable: config.available, probeState: status.state,
      probeActions: status.counters.actions, diagnosticCaptures: status.counters.diagnosticCaptures,
      nodeAvailable: typeof require !== 'undefined', bridgeKeys: Object.keys(window.csd).sort() };
  })()`);
  const image = await input.window.webContents.capturePage();
  const size = image.getSize(), bitmap = image.toBitmap();
  let distinctFromBackground = 0;
  // BGRA capture pixels: count content differing from the configured #f5f5f0 background.
  for (let i = 0; i < bitmap.length; i += 4) {
    if (Math.abs(bitmap[i]! - 240) + Math.abs(bitmap[i + 1]! - 245) + Math.abs(bitmap[i + 2]! - 245) > 30) distinctFromBackground++;
  }
  const report = { task: 'R06_VISIBLE_STARTUP', reportVersion: 1, mode: 'NORMAL_DIAGNOSTIC', smoke: false,
    recordedAt: new Date().toISOString(), pid: process.pid, electron: process.versions.electron, node: process.versions.node,
    visible: input.window.isVisible(), minimized: input.window.isMinimized(), loading: input.window.webContents.isLoading(),
    mainManualLoginEnabled: input.manualLoginEnabled, uiDebuggerAttached: input.window.webContents.debugger.isAttached(),
    browserOpenViews: input.host.diagnostics().openViews, probeLiveAvailable: input.probe.config().liveAvailable,
    probeState: input.probe.status().state, rendererErrors: [...input.rendererErrors], dom,
    capture: { ...size, distinctFromBackground, screenshotKind: 'ELECTRON_CAPTURE_PAGE_NOT_NATIVE_WINDOW_WITNESS' } };
  writeFileSync(join(directory, 'visible-startup.png'), image.toPNG());
  writeFileSync(join(directory, 'visible-startup.json'), JSON.stringify(report, null, 2) + '\n');
}
