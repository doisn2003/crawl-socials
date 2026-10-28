import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bytesHash, digest, PROBE_LIMITS, PROBE_QUERIES } from './probe-contract.js';
import { isInside } from '../infrastructure/config/runtime-paths.js';

export function createProbeFreeze(appRoot: string, packaged: boolean) {
  const path = join(appRoot, 'dist/resources/probe-build.json');
  const initialBytes = readFileSync(path), initial = bytesHash(initialBytes);
  function freeze() {
    const raw = readFileSync(path); if (bytesHash(raw) !== initial) throw new Error('PROBE_BUILD_CHANGED');
    const build = JSON.parse(raw.toString('utf8')) as { version: number; entries: { path: string; sha256: string }[] };
    if (build.version !== 1 || !Array.isArray(build.entries) || build.entries.length > 512) throw new Error('PROBE_BUILD_INVALID');
    for (const entry of build.entries) {
      const absolute = resolve(appRoot, entry.path);
      if (!isInside(appRoot, absolute) || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('PROBE_BUILD_INVALID');
      if ((!packaged || entry.path.startsWith('dist/')) && bytesHash(readFileSync(absolute)) !== entry.sha256) throw new Error('PROBE_BUILD_CHANGED');
    }
    const reference = (path: string, ref: string) => {
      const entry = build.entries.find(entry => entry.path === path); if (!entry) throw new Error('PROBE_BUILD_INPUT_MISSING');
      return { ref, version: 1, path, sha256: entry.sha256 };
    };
    const evidence = [reference('.brain/decisions/ADR-009-source-probe-operational-limits.md', 'evidence://lead-probe-limits-2026-10-27'),
      reference('.brain/specs/benchmark_protocol.md', 'evidence://probe/protocol-1.0.0'),
      reference('.brain/specs/source_access_matrix.md', 'evidence://probe/source-matrix'),
      reference('.brain/evidence/facebook-browser-route-assessment-2026-10-27.md', 'evidence://probe/route-assessment')];
    return { versions: { built_code_manifest_sha256: initial, effective_configuration_sha256: digest({ limits: PROBE_LIMITS, queries: PROBE_QUERIES,
      mode: 'FIXTURE', metadata_policy: 'DIAGNOSTIC_METADATA_V1' }), source_matrix_sha256: evidence[2]!.sha256,
      assessment_sha256: evidence[3]!.sha256, runtime: { electron: process.versions.electron || 'NODE_TEST', node: process.versions.node,
        platform: process.platform, arch: process.arch } }, buildInputs: build, evidence,
      campaign: JSON.parse(readFileSync(join(appRoot, 'dist/resources/campaign.coffee.json'), 'utf8')) as unknown };
  }
  freeze(); return freeze;
}
