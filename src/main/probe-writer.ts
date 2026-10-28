import { appendFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInside } from '../infrastructure/config/runtime-paths.js';
import { bytesHash, canonical, digest, isRunId } from './probe-contract.js';
import type { sanitizeProbeCapture } from './probe-contract.js';

export function createProbeWriter(input: { userData: string; workspace: string; runId: string; maxBytes: number; now: () => number }) {
  if (!isRunId(input.runId) || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 2 * 1024 * 1024) throw new Error('PROBE_WRITER_INPUT_INVALID');
  const base = realpathSync(input.userData), workspace = realpathSync(input.workspace);
  if (isInside(workspace, base) || isInside(base, workspace)) throw new Error('PROBE_ROOT_DENIED');
  const root = join(base, 'source-probes');
  if (!existsSync(root)) mkdirSync(root);
  const verifyDirectory = (path: string) => {
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== resolve(path) || !isInside(base, realpathSync(path))) throw new Error('PROBE_PATH_DENIED');
  };
  verifyDirectory(root);
  const directory = join(root, input.runId); mkdirSync(directory); verifyDirectory(directory); // Never reuse a run, including interrupted runs.
  let bytes = 0, sealed = false, frozen = false, observationLines = 0;
  const reserve = 1024 * 1024;
  const members: { observation_id: string; record_version: 1; sha256: string; persisted_at: string; observed_at: string; file: string; line: number }[] = [];
  const files = new Map<string, { version: 1; bytes: number; sha256: string }>();
  const contents = new Map<string, string>();
  let inputReferences: unknown = [];
  function write(name: string, data: unknown, append = false, final = false) {
    if (sealed || !['manifest.json', 'build-inputs.json', 'observations.jsonl', 'events.jsonl', 'snapshot.json', 'evidence-map.json', 'summary.json', 'freeze.json'].includes(name)) throw new Error('PROBE_WRITE_CLOSED');
    verifyDirectory(root); verifyDirectory(directory);
    const target = join(directory, name);
    if (existsSync(target) && (!contents.has(name) || lstatSync(target).isSymbolicLink() || lstatSync(target).nlink !== 1 || realpathSync(target) !== target)) throw new Error('PROBE_PATH_DENIED');
    const text = canonical(data) + '\n', size = Buffer.byteLength(text);
    if (bytes + size > input.maxBytes - (final ? 0 : reserve)) throw new Error('PROBE_STORAGE_LIMIT');
    if (append) appendFileSync(target, text, { encoding: 'utf8', flag: 'a', flush: true });
    else writeFileSync(target, text, { encoding: 'utf8', flag: 'wx', flush: true });
    bytes += size;
    // Only bounded, sanitized ledger text is retained, never native response bodies.
    const full = (contents.get(name) || '') + text; contents.set(name, full);
    files.set(name, { version: 1, bytes: Buffer.byteLength(full), sha256: bytesHash(full) });
  }
  return {
    directory, outputRef: 'csd-userdata://source-probes/' + input.runId,
    bytes: () => bytes,
    initialize(manifest: Record<string, unknown>, buildInputs: unknown) {
      write('build-inputs.json', buildInputs); write('manifest.json', manifest);
      inputReferences = manifest.evidence || [];
    },
    ledger(event: { event: 'ACTION' | 'BATCH' | 'OPERATOR_BEGIN' | 'OPERATOR_END' | 'SEGMENT'; at: string;
      elapsed_ms: number; query?: number; batch?: number; retry?: number; action?: 'NAVIGATE_FIXTURE' | 'FETCH_FIXTURE_BATCH' }) {
      if (frozen) throw new Error('PROBE_WRITE_CLOSED'); write('events.jsonl', { record_version: 1, ...event }, true);
    },
    observe(diagnostic: NonNullable<ReturnType<typeof sanitizeProbeCapture>>, context: { runId: string; startedAt: number; deadlineAt: number; query: number; batch: number; segment: number }) {
      if (frozen) throw new Error('PROBE_WRITE_CLOSED');
      const before = input.now(), observed = Date.parse(diagnostic.observed_at);
      if (before > context.deadlineAt || observed < context.startedAt || observed > before) return false;
      const record = { record_version: 1 as const, observation_id: 'diagnostic-' + (++observationLines), run_id: context.runId,
        capture_mode: 'FIXTURE', query_index: context.query, batch: context.batch, segment: context.segment,
        ...diagnostic, write_started_at: new Date(before).toISOString(), persistence_time: 'FROZEN_MEMBERSHIP_COMPLETION_TIME' };
      const hash = digest(record);
      write('observations.jsonl', record, true);
      // A write crossing the deadline is stored but excluded from frozen membership.
      const after = input.now();
      if (after < before || after < observed || after > context.deadlineAt) return false;
      members.push({ observation_id: record.observation_id, record_version: 1, sha256: hash,
        persisted_at: new Date(after).toISOString(), observed_at: diagnostic.observed_at, file: 'observations.jsonl', line: observationLines });
      return true;
    },
    finalize(inputFinal: { cutoff: number; stoppedAt: number; summary: Record<string, unknown> }) {
      if (frozen || sealed) throw new Error('PROBE_WRITE_CLOSED'); frozen = true;
      const membership = members.filter(member => Date.parse(member.persisted_at) <= inputFinal.cutoff);
      const snapshot = { snapshot_version: 1, capture_mode: 'FIXTURE', cutoff_at: new Date(inputFinal.cutoff).toISOString(),
        membership, membership_sha256: digest(membership), verified_valid_unique_posts: 0, kind: 'DIAGNOSTIC_MEMBERSHIP_ONLY' };
      const snapshotHash = digest(snapshot);
      write('snapshot.json', { ...snapshot, snapshot_sha256: snapshotHash }, false, true);
      const evidence = [...files].map(([file, entry]) => ({ ref: 'evidence://probe/' + input.runId + '/' + file,
        file, ...entry }));
      write('evidence-map.json', { map_version: 1, entries: evidence, input_references: inputReferences,
        input_reference_semantics: 'PINNED_REPOSITORY_PATH_AND_HASH_NOT_A_RETAINED_COPY' }, false, true);
      write('freeze.json', { version: 1, snapshot_sha256: snapshotHash, membership_sha256: snapshot.membership_sha256,
        evidence_map_sha256: files.get('evidence-map.json')!.sha256 }, false, true);
      write('summary.json', { ...inputFinal.summary, summary_version: 1, snapshot_sha256: snapshotHash,
        persisted_bytes_before_summary: bytes, expires_at: new Date(inputFinal.stoppedAt + 7 * 86400000).toISOString(),
        retention_cleanup: 'MANUAL_REQUIRED_NO_SCHEDULER', snapshot_members: membership.length }, false, true);
      sealed = true;
    },
  };
}
export type ProbeWriter = ReturnType<typeof createProbeWriter>;
