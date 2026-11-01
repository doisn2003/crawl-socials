import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { listRetainedSources } from '../src/application/retained-source-catalog.js';

async function temporary(work: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-retained-catalog-'));
  try { await work(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-retained-catalog-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
function source(directory: string, metadata?: string, content = 'opaque journal bytes; catalog does not parse observations\n') {
  const runId = 'crawl-' + randomUUID(), output = join(directory, 'collections', runId), opportunity = join(output, 'opportunity');
  mkdirSync(join(opportunity, 'store'), { recursive: true });
  const journal = join(opportunity, 'store', 'conversation-events.jsonl'); writeFileSync(journal, content);
  if (metadata !== undefined) writeFileSync(join(opportunity, 'campaign.json'), metadata);
  return { runId, output, opportunity, journal };
}
function legacyFile(output: string, platform: 'facebook' | 'threads', content: string, seconds: number) {
  const folder = join(output, platform), file = join(folder, 'posts.jsonl'); mkdirSync(folder, { recursive: true });
  writeFileSync(file, content); utimesSync(file, seconds, seconds); return file;
}
function digestTree(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) for (const [child, digest] of Object.entries(digestTree(file))) result[join(entry.name, child)] = digest;
    else result[entry.name] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return result;
}

test('retained catalog treats missing or empty collections as empty and ignores malformed sibling names', async () => temporary(async directory => {
  assert.deepEqual(await listRetainedSources(directory), []);
  mkdirSync(join(directory, 'collections'));
  mkdirSync(join(directory, 'collections', 'not-a-crawl'));
  mkdirSync(join(directory, 'collections', 'crawl-' + 'a'.repeat(36)));
  mkdirSync(join(directory, 'collections', 'crawl-' + '-'.repeat(36)));
  mkdirSync(join(directory, 'collections', 'crawl-' + randomUUID()));
  source(directory, undefined, '');
  const valid = source(directory, JSON.stringify({ prompt: 'Chủ đề hợp lệ' }));
  const result = await listRetainedSources(directory);
  assert.deepEqual(result.map(item => item.runId), [valid.runId]); assert.equal(result[0]!.prompt, 'Chủ đề hợp lệ');
}));

test('catalog remains a read-only metadata scan and tolerates missing, malformed or oversized campaign display data', async () => temporary(async directory => {
  const missing = source(directory), malformed = source(directory, '{broken'), nullMetadata = source(directory, 'null');
  const oversized = source(directory, JSON.stringify({ prompt: 'x'.repeat(1_048_577) }));
  const valid = source(directory, JSON.stringify({ prompt: 'Đ'.repeat(500) }));
  const fixtures = [missing, malformed, nullMetadata, oversized, valid];
  fixtures.forEach((item, index) => utimesSync(item.journal, 1000 + index, 1000 + index));
  const before = digestTree(directory), result = await listRetainedSources(directory);
  assert.deepEqual(result.map(item => item.runId), [...fixtures].reverse().map(item => item.runId));
  assert.equal(result.find(item => item.runId === valid.runId)!.prompt, 'Đ'.repeat(300));
  for (const fixture of fixtures.slice(0, -1)) assert.equal(result.find(item => item.runId === fixture.runId)!.prompt, '');
  for (const item of result) { assert.equal(item.format, 'OBSERVATION_JOURNAL'); assert.ok(item.bytes > 0); assert.ok(Number.isFinite(Date.parse(item.updatedAt))); }
  assert.deepEqual(digestTree(directory), before);
  assert.equal(fixtures.some(item => existsSync(join(item.opportunity, 'store', 'conversations.sqlite'))), false);
}));

test('catalog excludes a journal reached through an opportunity junction outside the owned run', async () => temporary(async directory => {
  const data = join(directory, 'data'), external = join(directory, 'external');
  mkdirSync(data); mkdirSync(external);
  const valid = source(data), outside = source(external), escapedId = 'crawl-' + randomUUID();
  const escapedRun = join(data, 'collections', escapedId), junction = join(escapedRun, 'opportunity'); mkdirSync(escapedRun);
  symlinkSync(outside.opportunity, junction, process.platform === 'win32' ? 'junction' : 'dir');
  const outsideBytes = readFileSync(outside.journal);
  try {
    assert.deepEqual((await listRetainedSources(data)).map(item => item.runId), [valid.runId]);
    assert.deepEqual(readFileSync(outside.journal), outsideBytes);
  } finally { unlinkSync(junction); }
}));

test('catalog does not follow a collections junction outside the application data root', async () => temporary(async directory => {
  const data = join(directory, 'data'), external = join(directory, 'external'); mkdirSync(data); mkdirSync(external);
  const outside = source(external), junction = join(data, 'collections');
  symlinkSync(join(external, 'collections'), junction, process.platform === 'win32' ? 'junction' : 'dir');
  const before = digestTree(external);
  try { assert.deepEqual(await listRetainedSources(data), []); assert.deepEqual(digestTree(external), before); assert.ok(existsSync(outside.journal)); }
  finally { unlinkSync(junction); }
}));

test('legacy catalog sums only the fixed Facebook and Threads JSONL files and uses their latest mtime', async () => temporary(async directory => {
  const runId = 'crawl-' + randomUUID(), output = join(directory, 'collections', runId);
  const facebook = legacyFile(output, 'facebook', '{"post_id":"1","text":"fixture"}\n', 1000);
  const threads = legacyFile(output, 'threads', '{"post_id":"2","text":"fixture two"}\n', 2000);
  writeFileSync(join(output, 'posts.jsonl'), 'arbitrary external-style filename must not be counted');
  writeFileSync(join(output, 'facebook', 'posts.json'), '[]');
  const before = digestTree(directory), result = await listRetainedSources(directory);
  assert.deepEqual(result, [{ runId, prompt: '', updatedAt: new Date(2000 * 1000).toISOString(),
    bytes: readFileSync(facebook).length + readFileSync(threads).length, format: 'LEGACY_JSONL' }]);
  assert.deepEqual(digestTree(directory), before);
}));

test('a present journal takes precedence over legacy JSONL and an empty journal does not trigger fallback', async () => temporary(async directory => {
  const populated = source(directory), empty = source(directory, undefined, '');
  for (const item of [populated, empty]) { legacyFile(item.output, 'facebook', '{"post_id":"legacy"}\n', 3000); legacyFile(item.output, 'threads', '{"post_id":"legacy-two"}\n', 4000); }
  utimesSync(populated.journal, 1000, 1000);
  const result = await listRetainedSources(directory);
  assert.deepEqual(result.map(item => [item.runId, item.format, item.bytes, item.updatedAt]),
    [[populated.runId, 'OBSERVATION_JOURNAL', readFileSync(populated.journal).length, new Date(1000 * 1000).toISOString()]]);
}));

test('legacy fallback excludes the whole source when one platform JSONL escapes through a junction', async () => temporary(async directory => {
  const data = join(directory, 'data'), external = join(directory, 'external'); mkdirSync(data); mkdirSync(external);
  const validId = 'crawl-' + randomUUID(), valid = join(data, 'collections', validId), escaped = join(data, 'collections', 'crawl-' + randomUUID());
  legacyFile(valid, 'threads', '{"post_id":"valid"}\n', 1000);
  legacyFile(escaped, 'threads', '{"post_id":"owned"}\n', 2000);
  const outside = legacyFile(external, 'facebook', '{"post_id":"outside"}\n', 3000), junction = join(escaped, 'facebook');
  symlinkSync(dirname(outside), junction, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.deepEqual((await listRetainedSources(data)).map(item => item.runId), [validId]); }
  finally { unlinkSync(junction); }
}));

test('a present dangling journal link is not treated as an absent journal eligible for legacy fallback', async t => temporary(async directory => {
  const fixture = source(directory); unlinkSync(fixture.journal);
  legacyFile(fixture.output, 'threads', '{"post_id":"legacy"}\n', 1000);
  try { symlinkSync(join(directory, 'missing-target.jsonl'), fixture.journal, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('File symlinks are unavailable for this test account.'); return; }
    throw error;
  }
  try { assert.deepEqual(await listRetainedSources(directory), []); }
  finally { unlinkSync(fixture.journal); }
}));
