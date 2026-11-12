import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import updater from 'electron-updater';
import { assertStarterUpdateConfig, readStarterFeed, starterUpdateUrl } from '../infrastructure/managed/starter-release.js';

const exec = promisify(execFile);

export async function hasStarterSignature(file: string, publisher: string) {
  const windows = process.env.SystemRoot;
  if (process.platform !== 'win32' || !windows) return false;
  const verifier = readFileSync(new URL('./verify-starter-signing.ps1', import.meta.url), 'utf8');
  const command = `& {\n${verifier}\n} -Installer $env:FINDLINK_VERIFY_INSTALLER -Publisher $env:FINDLINK_VERIFY_PUBLISHER`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...process.env, FINDLINK_VERIFY_INSTALLER: file, FINDLINK_VERIFY_PUBLISHER: publisher },
    timeout: 20_000, windowsHide: true,
  }).catch(() => null);
  return result?.stdout.trim() === 'STARTER_AUTHENTICODE_VALID';
}

export function managedUpdates(feed: string, publisher: string) {
  const url = starterUpdateUrl(feed);
  const configuration = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8');
  assertStarterUpdateConfig(configuration, { url: url.href, publisher });
  const { autoUpdater, NsisUpdater } = updater;
  if (!(autoUpdater instanceof NsisUpdater)) throw Error('UPDATE_TARGET_INVALID');
  autoUpdater.setFeedURL({ provider: 'generic', url: url.href, channel: 'latest', useMultipleRangeRequest: false });
  autoUpdater.logger = null;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const signedByPublisher = (file: string) => hasStarterSignature(file, publisher).catch(() => false);
  autoUpdater.verifyUpdateCodeSignature = async (_names, file) => (await signedByPublisher(file)) ? null : 'UPDATE_SIGNATURE_INVALID';
  let verifiedFile: string | null = null;
  let generation = 0, closed = false, checking = false;
  autoUpdater.on('update-downloaded', event => {
    if (closed) return;
    const current = ++generation;
    verifiedFile = null;
    try { readStarterFeed(JSON.stringify(event)); } catch { return; }
    const file = event.downloadedFile;
    if (file) void signedByPublisher(file).then(valid => {
      if (valid && !closed && current === generation) verifiedFile = file;
    });
  });
  autoUpdater.on('error', () => {});
  async function check() {
    if (verifiedFile || closed || checking) return;
    checking = true;
    try {
      const update = await autoUpdater.checkForUpdates();
      if (closed || !update?.isUpdateAvailable) return;
      readStarterFeed(JSON.stringify(update.updateInfo));
      await autoUpdater.downloadUpdate(update.cancellationToken);
    } catch { /* Leave the current version running if the feed or download fails. */ }
    finally { checking = false; }
  }
  const first = setTimeout(check, 5000), interval = setInterval(check, 6 * 60 * 60_000);
  first.unref(); interval.unref();
  return {
    ready: () => verifiedFile !== null,
    close() { closed = true; clearTimeout(first); clearInterval(interval); },
    async verifyForInstall() {
      const file = verifiedFile;
      if (!file) throw Error('UPDATE_UNAVAILABLE');
      const valid = await signedByPublisher(file);
      if (verifiedFile !== file) throw Error('UPDATE_UNAVAILABLE');
      if (!valid) { verifiedFile = null; throw Error('UPDATE_SIGNATURE_INVALID'); }
    },
    install() {
      if (!verifiedFile) throw Error('UPDATE_UNAVAILABLE');
      autoUpdater.quitAndInstall(true, true);
    },
  };
}
