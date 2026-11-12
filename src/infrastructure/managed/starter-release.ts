import { JSON_SCHEMA, load } from 'js-yaml';

const maxMetadataBytes = 64 * 1024;
const releaseVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readMetadata(source: string, errorCode: string) {
  if (Buffer.byteLength(source) > maxMetadataBytes) throw Error(errorCode);
  try {
    const data = object(load(source, { schema: JSON_SCHEMA }));
    if (data) return data;
  } catch { /* Malformed release metadata always fails the gate. */ }
  throw Error(errorCode);
}

export function starterUpdateUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw Error('UPDATE_FEED_INVALID');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

export function assertStarterUpdateConfig(source: string, expected: { url: string; publisher: string }) {
  const data = readMetadata(source, 'UPDATE_CONFIG_INVALID');
  const publisher = expected.publisher;
  const names = Array.isArray(data.publisherName) ? data.publisherName : [data.publisherName];
  if (!publisher || publisher.trim() !== publisher || /[\r\n\0]/.test(publisher) || names.length !== 1 || names[0] !== publisher) {
    throw Error('UPDATE_PUBLISHER_INVALID');
  }
  if (data.provider !== 'generic' || (data.channel !== undefined && data.channel !== 'latest') || typeof data.url !== 'string'
      || starterUpdateUrl(data.url).href !== starterUpdateUrl(expected.url).href) throw Error('UPDATE_CONFIG_INVALID');
}

export function readStarterFeed(source: string, expectedVersion?: string) {
  const data = readMetadata(source, 'RELEASE_UPDATE_METADATA_INVALID');
  const version = data.version;
  if (typeof version !== 'string' || !releaseVersion.test(version) || (expectedVersion && version !== expectedVersion)) {
    throw Error('RELEASE_UPDATE_VERSION_INVALID');
  }
  const filename = `FindLink-Starter-${version}-Setup.exe`;
  const file = Array.isArray(data.files) && data.files.length === 1 ? object(data.files[0]) : null;
  const sha512 = file?.sha512;
  const size = file?.size;
  if (file?.url !== filename || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || typeof sha512 !== 'string'
      || !/^[a-zA-Z0-9+/]{86}==$/.test(sha512) || Buffer.from(sha512, 'base64').toString('base64') !== sha512
      || (data.path !== undefined && data.path !== filename) || (data.sha512 !== undefined && data.sha512 !== sha512)) {
    throw Error('RELEASE_UPDATE_METADATA_INVALID');
  }
  return { version, filename, size, sha512 };
}
