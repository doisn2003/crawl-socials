import updater from 'electron-updater';

export function managedUpdates(feed: string) {
  const url = new URL(feed);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw Error('UPDATE_FEED_INVALID');
  const { autoUpdater } = updater;
  autoUpdater.setFeedURL({ provider: 'generic', url: url.href, channel: 'latest' });
  autoUpdater.logger = null;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  let downloaded = false;
  autoUpdater.on('update-downloaded', () => { downloaded = true; });
  autoUpdater.on('error', () => {});
  const check = () => { if (!downloaded) void autoUpdater.checkForUpdates().catch(() => {}); };
  const first = setTimeout(check, 5000), interval = setInterval(check, 6 * 60 * 60_000);
  first.unref(); interval.unref();
  return {
    ready: () => downloaded,
    close() { clearTimeout(first); clearInterval(interval); },
    install() {
      if (!downloaded) throw Error('UPDATE_UNAVAILABLE');
      autoUpdater.quitAndInstall(false, true);
    },
  };
}
