import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bytesHash } from '../src/main/probe-contract.js';
import { createProbeFreeze } from '../src/main/probe-freeze.js';
test('Start freeze pins actual built/source/input bytes and refuses subsequent mutations', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-probe-freeze-'));
  try {
    const paths = ['dist/main/index.js', 'dist/resources/campaign.coffee.json',
      '.brain/decisions/ADR-009-source-probe-operational-limits.md', '.brain/specs/benchmark_protocol.md',
      '.brain/specs/source_access_matrix.md', '.brain/evidence/facebook-browser-route-assessment-2026-10-27.md'];
    const entries = paths.map(path => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), path.endsWith('.json') ? '{}' : 'synthetic build input');
      return { path, sha256: bytesHash(readFileSync(join(root, path))) };
    });
    const buildPath = join(root, 'dist/resources/probe-build.json');
    writeFileSync(buildPath, JSON.stringify({ version: 1, entries }));
    const freeze = createProbeFreeze(root, false), first = freeze();
    assert.equal(first.versions.built_code_manifest_sha256, bytesHash(readFileSync(buildPath)));
    assert.equal(first.evidence.length, 4);
    writeFileSync(join(root, 'dist/main/index.js'), 'changed');
    assert.throws(freeze, /BUILD_CHANGED/);
    writeFileSync(buildPath, '{}'); assert.throws(freeze, /BUILD_CHANGED/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'csd-probe-freeze-'))); rmSync(root, { recursive: true, force: true });
  }
});
