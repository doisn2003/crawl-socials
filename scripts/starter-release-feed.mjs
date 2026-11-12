import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultStarterVersion = '0.5.1';
const metadataName = 'latest.yml';
const maximumMetadata = 64 * 1024;
const signingScript = fileURLToPath(new URL('verify-starter-signing.ps1', import.meta.url));

export function verifyStarterSignature(file, publisher) {
  const windows = process.env.SystemRoot;
  if (process.platform !== 'win32' || !windows || !publisher) throw Error('RELEASE_SIGNING_CONFIGURATION_REQUIRED');
  const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-File', signingScript, file, publisher],
    { windowsHide: true, stdio: 'inherit', timeout: 30_000 });
}

async function digest(stream, maximum) {
  const hash = createHash('sha512');
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) throw Error('RELEASE_ARTIFACT_SIZE_MISMATCH');
    hash.update(chunk);
  }
  return { size, sha512: hash.digest('base64') };
}

async function localDigest(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0) throw Error('RELEASE_ARTIFACT_INVALID');
  const measured = await digest(createReadStream(file), stat.size);
  if (measured.size !== stat.size) throw Error('RELEASE_ARTIFACT_SIZE_MISMATCH');
  return measured;
}

function sameDigest(a, b) {
  return a.size === b.size && a.sha512 === b.sha512;
}

export async function inspectStarterFeed(directory, version) {
  const { readStarterFeed } = await import('../dist/infrastructure/managed/starter-release.js');
  const metadata = readStarterFeed(await readFile(join(directory, metadataName), 'utf8'), version);
  const blockmapName = metadata.filename + '.blockmap';
  const [installer, blockmap] = await Promise.all([
    localDigest(join(directory, metadata.filename)), localDigest(join(directory, blockmapName)),
  ]);
  if (!sameDigest(installer, metadata)) throw Error('RELEASE_INSTALLER_CHECKSUM_MISMATCH');
  return { ...metadata, blockmapName, blockmap };
}

export async function stageStarterFeed(directory, root, version, publisher) {
  const feed = await inspectStarterFeed(directory, version);
  const output = join(root, feed.version);
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(root, '.stage-'));
  const names = [feed.filename, feed.blockmapName, metadataName];
  try {
    for (const name of names) await copyFile(join(directory, name), join(scratch, name));
    const copy = await inspectStarterFeed(scratch, version);
    if (!sameDigest(copy, feed) || !sameDigest(copy.blockmap, feed.blockmap)) throw Error('RELEASE_SOURCE_CHANGED');
    verifyStarterSignature(join(scratch, copy.filename), publisher);
    try { await rename(scratch, output); }
    catch (error) {
      const prior = await inspectStarterFeed(output, version).catch(() => null);
      if (!prior) throw error;
      if (!sameDigest(prior, feed) || !sameDigest(prior.blockmap, feed.blockmap)) throw Error('RELEASE_VERSION_ALREADY_STAGED');
    }
    return output;
  } finally {
    for (const name of names) await unlink(join(scratch, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(scratch).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function download(url, status, transport, headers = {}) {
  const response = await transport(url, {
    headers: { 'Accept-Encoding': 'identity', ...headers }, signal: AbortSignal.timeout(300_000),
  });
  if (response.status !== status || !response.body || new URL(response.url || url).protocol !== 'https:') {
    await response.body?.cancel();
    throw Error(`RELEASE_FEED_HTTP_${response.status}`);
  }
  return response;
}

export async function verifyHostedStarterFeed(url, expected, transport = fetch) {
  const { readStarterFeed, starterUpdateUrl } = await import('../dist/infrastructure/managed/starter-release.js');
  const base = starterUpdateUrl(url);
  const manifest = await download(new URL(metadataName, base), 200, transport);
  const metadata = [];
  let size = 0;
  for await (const chunk of manifest.body) {
    size += chunk.length;
    if (size > maximumMetadata) throw Error('RELEASE_UPDATE_METADATA_INVALID');
    metadata.push(chunk);
  }
  const feed = readStarterFeed(Buffer.concat(metadata).toString('utf8'), expected.version);
  if (!sameDigest(feed, expected)) throw Error('RELEASE_HOSTED_METADATA_MISMATCH');

  const installerUrl = new URL(feed.filename, base);
  const partial = await download(installerUrl, 206, transport, { Range: 'bytes=0-0' });
  if (partial.headers.get('content-range') !== `bytes 0-0/${feed.size}`) {
    await partial.body.cancel();
    throw Error('RELEASE_FEED_RANGE_INVALID');
  }
  if ((await digest(partial.body, 1)).size !== 1) throw Error('RELEASE_FEED_RANGE_INVALID');
  const installer = await download(installerUrl, 200, transport);
  if (!sameDigest(await digest(installer.body, feed.size), feed)) throw Error('RELEASE_HOSTED_INSTALLER_MISMATCH');
  const blockmap = await download(new URL(expected.blockmapName, base), 200, transport);
  if (!sameDigest(await digest(blockmap.body, expected.blockmap.size), expected.blockmap)) throw Error('RELEASE_HOSTED_BLOCKMAP_MISMATCH');
  return feed;
}

if (import.meta.main) {
  try {
    if (process.env.FINDLINK_RELEASE_ENV) process.loadEnvFile(process.env.FINDLINK_RELEASE_ENV);
    const { FINDLINK_UPDATE_URL: url, FINDLINK_SIGNING_PUBLISHER: publisher } = process.env;
    const version = process.env.FINDLINK_STARTER_VERSION || defaultStarterVersion;
    if (!url || !publisher || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('RELEASE_FEED_CONFIGURATION_REQUIRED');
    const directory = fileURLToPath(new URL(`../release/starter-feed/${version}/`, import.meta.url));
    const expected = await inspectStarterFeed(directory, version);
    verifyStarterSignature(join(directory, expected.filename), publisher);
    await verifyHostedStarterFeed(url, expected);
    console.log('STARTER_HTTPS_FEED_VERIFIED ' + version);
  } catch (error) {
    console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'RELEASE_FEED_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
