import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDiscoveryAttempt } from '../src/application/discovery-attempt.js';
const started = '2026-10-30T00:00:00.000Z', expired = new Date('2026-10-30T05:00:00.000Z');
function configuration(output: string, platform: 'facebook' | 'threads'): Record<string, unknown> {
  return { runId: 'synthetic-discovery-' + platform, output, maxMinutes: 240, queries: ['quán cafe'], maxScrollsPerQuery: 20, settleMs: 3000,
    includeContextCandidates: true, ...(platform === 'facebook' ? { targetNewRecords: 1000 } : { targetTotal: 2400, modes: ['top', 'recent'] }) };
}
function manifest(config: Record<string, unknown>, at = started) {
  const path = join(String(config.output), 'runs', String(config.runId), 'manifest.json'); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ run_id: config.runId, started_at: at, config_sha256: createHash('sha256').update(JSON.stringify(config)).digest('hex'), config })); return path;
}
test('unexpired or absent manifests retain the same attempt and checkpoint identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-attempt-'));
  try {
    const config = configuration(directory, 'threads');
    assert.equal(prepareDiscoveryAttempt({ config, platform: 'threads', cumulativeRawCount: 100, now: expired }).kind, 'RESUME_EXISTING');
    manifest(config); const result = prepareDiscoveryAttempt({ config, platform: 'threads', cumulativeRawCount: 100, now: new Date('2026-10-30T04:00:00Z') });
    assert.equal(result.kind, 'RESUME_EXISTING'); assert.equal(result.resume, true); assert.deepEqual(result.config, config); assert.equal(result.attempt, null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('explicit Resume of a budget-limited query before deadline retains its frontier, time and raw allowance', () => {
  for (const platform of ['facebook', 'threads'] as const) {
    const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-frontier-attempt-'));
    try {
      const config = configuration(directory, platform), path = manifest(config), before = readFileSync(path);
      const runDirectory = dirname(path), checkpoint = { [platform === 'facebook' ? 'query_index' : 'job_index']: 1,
        batch_sequence: 5, discovery_frontier: { preserved: 'collector-owned frontier' } };
      writeFileSync(join(runDirectory, 'checkpoint.json'), JSON.stringify(checkpoint));
      writeFileSync(join(runDirectory, 'receipt.json'), JSON.stringify({ stop_reason: 'QUERY_BUDGET_COMPLETE' }));
      const checkpointBefore = readFileSync(join(runDirectory, 'checkpoint.json'));
      const result = prepareDiscoveryAttempt({ config, platform, cumulativeRawCount: 500, now: new Date('2026-10-30T03:59:00Z') });
      assert.equal(result.kind, 'RESUME_EXISTING'); assert.equal(result.resume, true); assert.equal(result.attempt, null);
      assert.equal(result.config.runId, config.runId); assert.equal(result.config.maxMinutes, 240); assert.deepEqual(result.config, config);
      assert.deepEqual(readFileSync(path), before); assert.deepEqual(readFileSync(join(runDirectory, 'checkpoint.json')), checkpointBefore);
      assert.equal(Date.parse(JSON.parse(readFileSync(path, 'utf8')).started_at) + Number(result.config.maxMinutes) * 60000 - Date.parse('2026-10-30T03:59:00Z'), 60000);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('expired Facebook attempt keeps prior manifest immutable and budgets only remaining new records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-attempt-'));
  try {
    const config = configuration(directory, 'facebook'), path = manifest(config), before = readFileSync(path, 'utf8');
    const result = prepareDiscoveryAttempt({ config, platform: 'facebook', cumulativeRawCount: 700, now: expired });
    assert.equal(result.kind, 'NEW_ATTEMPT'); assert.equal(result.resume, false); assert.equal(result.config.targetNewRecords, 300);
    assert.equal(result.config.output, directory); assert.deepEqual(result.config.queries, config.queries); assert.match(String(result.config.runId), /^synthetic-discovery-facebook-a[0-9a-f]{12}$/);
    assert.equal(result.attempt!.previous_run_id, config.runId); assert.equal(result.attempt!.allocation_total, 1000); assert.equal(result.attempt!.checkpoint_policy, 'FRESH_SEARCH_WITH_GLOBAL_DEDUP');
    assert.equal(readFileSync(path, 'utf8'), before); assert.equal(config.targetNewRecords, 1000); assert.equal(existsSync(result.recordPath!), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('expired Threads attempt preserves cumulative total instead of asking for the remainder as a total', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-attempt-'));
  try {
    const config = configuration(directory, 'threads'); manifest(config);
    const result = prepareDiscoveryAttempt({ config, platform: 'threads', cumulativeRawCount: 1800, now: expired });
    assert.equal(result.config.targetTotal, 2400); assert.equal(result.attempt!.remaining_raw_allocation, 600); assert.equal(result.resume, false);
    assert.equal(prepareDiscoveryAttempt({ config, platform: 'threads', cumulativeRawCount: 2400, now: expired }).kind, 'ALLOCATION_COMPLETE');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('repeated expired Facebook attempts retain original allocation from separate attempt metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-attempt-'));
  try {
    const config = configuration(directory, 'facebook'); manifest(config);
    const first = prepareDiscoveryAttempt({ config, platform: 'facebook', cumulativeRawCount: 700, now: expired });
    mkdirSync(dirname(first.recordPath!), { recursive: true }); writeFileSync(first.recordPath!, JSON.stringify(first.attempt)); manifest(first.config, expired.toISOString());
    const second = prepareDiscoveryAttempt({ config: first.config, platform: 'facebook', cumulativeRawCount: 900, now: new Date('2026-10-30T10:00:00Z') });
    assert.equal(second.config.targetNewRecords, 100); assert.equal(second.attempt!.allocation_total, 1000); assert.equal(second.attempt!.previous_run_id, first.config.runId);
    assert.equal(String(second.config.runId).split('-a').length, 2);
    assert.throws(() => prepareDiscoveryAttempt({ config: first.config, platform: 'facebook', cumulativeRawCount: 900, allocationTotal: 2000, now: new Date('2026-10-30T10:00:00Z') }), /ALLOCATION_INCREASE/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('new attempt IDs fit collector length limits and malformed manifests fail before renewal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-attempt-'));
  try {
    const config = { ...configuration(directory, 'facebook'), runId: 's'.repeat(80) }; const path = manifest(config);
    const result = prepareDiscoveryAttempt({ config, platform: 'facebook', cumulativeRawCount: 1, now: expired }); assert.equal(String(result.config.runId).length, 80);
    const changed = { ...config, queries: ['changed campaign query'] };
    assert.throws(() => prepareDiscoveryAttempt({ config: changed, platform: 'facebook', cumulativeRawCount: 1, now: expired }), /CONFIG_MISMATCH/);
    writeFileSync(path, JSON.stringify({ run_id: config.runId, started_at: 'invalid' }));
    assert.throws(() => prepareDiscoveryAttempt({ config, platform: 'facebook', cumulativeRawCount: 1, now: expired }), /MANIFEST_INVALID/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
