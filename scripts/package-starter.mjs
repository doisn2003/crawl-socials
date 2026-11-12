import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import builder from 'electron-builder';
import asar from '@electron/asar';
import { defaultStarterVersion, stageStarterFeed, verifyStarterSignature } from './starter-release-feed.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const qa = process.argv.includes('--qa');
const unsigned = process.argv.includes('--unsigned');
if (qa && unsigned) throw Error('STARTER_BUILD_MODE_INVALID');
const signed = !qa && !unsigned;
const directoryOnly = process.argv.includes('--dir');
const releaseEnv = process.env.FINDLINK_RELEASE_ENV;
if (releaseEnv) process.loadEnvFile(releaseEnv);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw Error(name + '_REQUIRED');
  return value;
}
function httpsUrl(value, pathAllowed = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (!pathAllowed && url.pathname !== '/')) {
    throw Error('RELEASE_HTTPS_URL_INVALID');
  }
  return url;
}

const version = process.env.FINDLINK_STARTER_VERSION || defaultStarterVersion;
if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) throw Error('STARTER_VERSION_INVALID');
const publisherName = signed ? required('FINDLINK_SIGNING_PUBLISHER') : null;
const manifest = qa ? { origin: process.env.FINDLINK_QA_ORIGIN || 'http://127.0.0.1:9070', testOnly: true } : {
  origin: httpsUrl(required('FINDLINK_PUBLIC_URL')).origin,
  leasePublicKey: required('FINDLINK_LEASE_PUBLIC_KEY'),
  ...(signed ? { updateUrl: httpsUrl(required('FINDLINK_UPDATE_URL'), true).href, updatePublisher: publisherName } : { manualUpdate: true }),
};
const certSha1 = process.env.FINDLINK_SIGNING_CERT_SHA1;
if (!qa) {
  const key = createPublicKey({ key: Buffer.from(manifest.leasePublicKey, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw Error('RELEASE_LEASE_KEY_INVALID');
}
if (signed && !process.env.CSC_LINK && !process.env.WIN_CSC_LINK && !/^[A-Fa-f0-9]{40}$/.test(certSha1 || '')) {
  throw Error('RELEASE_CODE_SIGNING_IDENTITY_REQUIRED');
}
if (process.platform !== 'win32') throw Error('STARTER_RELEASE_REQUIRES_WINDOWS');
const node = process.execPath;
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error('RUN_WITH_NPM');
execFileSync(node, [npmCli, 'run', 'build'], { cwd: root, stdio: 'inherit', windowsHide: true });
writeFileSync(join(root,'dist','managed-release.json'), JSON.stringify(manifest) + '\n');
const base = JSON.parse(readFileSync(join(root,'package.json'),'utf8')).build;
const output = qa ? 'release/starter-qa' : signed ? 'release/starter' : 'release/starter-unsigned';
const artifactName = (qa ? 'FindLink-Starter-QA-' : 'FindLink-Starter-') + '${version}-Setup.${ext}';
const config = {
  ...base, extraMetadata: { version, findlinkManaged: true }, directories: { output },
  ...(qa ? { appId: 'io.csd.desktop.starter.qa', productName: 'FindLink Starter QA' } : {}),
  forceCodeSigning: signed,
  win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }],
    verifyUpdateCodeSignature: true,
    ...(signed ? { signtoolOptions: { publisherName, ...(certSha1 ? { certificateSha1: certSha1 } : {}) } } : {}) },
  nsis: { artifactName, oneClick: false, perMachine: false, deleteAppDataOnUninstall: false },
  publish: signed ? [{ provider: 'generic', url: manifest.updateUrl, channel: 'latest' }] : null,
};
const targets = builder.Platform.WINDOWS.createTarget(directoryOnly ? ['dir'] : ['nsis'], builder.Arch.x64);
try {
  await builder.build({ projectDir: root, config, targets, publish: 'never' });
  const packageFile = join(root, output, 'win-unpacked','resources','app.asar');
  const contents = asar.listPackage(packageFile);
  if (contents.some(file => /(?:^|[\\/])(?:\.env(?:[.\\/]|$)|secrets[\\/].*\.(?:json|key)$)|[\\/]dist[\\/]backend[\\/]/i.test(file))) {
    throw Error('RELEASE_PACKAGE_CONTAINS_PRIVATE_FILES');
  }
  const metadata = JSON.parse(asar.extractFile(packageFile,'package.json').toString('utf8'));
  if (metadata.findlinkManaged !== true || !contents.some(path => /[\\/]dist[\\/]managed-release\.json$/.test(path))) {
    throw Error('RELEASE_PACKAGE_MANAGED_FLAG_MISSING');
  }
  const bundledVerifier = asar.extractFile(packageFile, join('dist', 'main', 'verify-starter-signing.ps1'));
  if (!bundledVerifier.equals(readFileSync(join(root, 'scripts', 'verify-starter-signing.ps1')))) {
    throw Error('RELEASE_UPDATE_VERIFIER_MISMATCH');
  }
  if (signed && !directoryOnly) {
    const { assertStarterUpdateConfig } = await import('../dist/infrastructure/managed/starter-release.js');
    const unpacked = join(root, output, 'win-unpacked');
    assertStarterUpdateConfig(readFileSync(join(unpacked, 'resources', 'app-update.yml'), 'utf8'),
      { url: manifest.updateUrl, publisher: publisherName });
    verifyStarterSignature(join(unpacked, base.productName + '.exe'), publisherName);
    await stageStarterFeed(join(root, output), join(root, 'release', 'starter-feed'), version, publisherName);
  }
  console.log(qa ? 'STARTER_QA_PACKAGE_READY' : signed ? 'STARTER_SIGNED_PACKAGE_READY' : 'STARTER_UNSIGNED_PACKAGE_READY');
} finally {
  // This flag is only for the current packaging target. A development launch
  // should use the configured development URL.
  const { unlinkSync } = await import('node:fs');
  unlinkSync(join(root,'dist','managed-release.json'));
}
