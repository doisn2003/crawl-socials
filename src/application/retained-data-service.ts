import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertEvaluationContext, contentHash, type EvaluationContext, type SocialPlatform } from '../domain/conversation.js';
import type { AsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';
import { freezeRetainedSource, readRetainedObservations, retainedRunDirectory, type RetainedSourceManifest } from '../infrastructure/storage/retained-observation-reader.js';

export interface RetainedImportManifest {
  schema_version: 1;
  import_id: string;
  input_sha256: string;
  target_run_id: string;
  target_context: EvaluationContext;
  captured_at: string;
  total_observations: number;
  excluded_observations: number;
  source: RetainedSourceManifest;
  source_location?: RetainedSourceLocation;
}
export interface RetainedSourceLocation { root_id: string; canonical_data_directory: string }
export interface RetainedImportCheckpoint {
  schema_version: 1;
  import_id: string;
  input_sha256: string;
  status: 'IMPORTING' | 'IMPORTED' | 'PAUSED' | 'FAILED';
  imported_observations: number;
  total_observations: number;
  last_source_sequence: number;
  updated_at: string;
  error_code: string | null;
}
export interface RetainedImportState {
  manifest: RetainedImportManifest;
  checkpoint: RetainedImportCheckpoint;
  exportMetadata: ReturnType<typeof retainedExportMetadata>;
}
type Located = { dataDirectory: string; targetRunId: string };
/** Trusted main-process selections only; renderer requests carry an opaque root ID, never these paths. */
type SelectedSource = { sourceDataDirectory?: string; sourceRootId?: string };
const now = () => new Date().toISOString();
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : 'RETAINED_IMPORT_FAILED';
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function validSourceLocation(value: RetainedSourceLocation): boolean {
  return Boolean(value && typeof value.root_id === 'string' && value.root_id.trim() === value.root_id && value.root_id.length > 0
    && value.root_id.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value.root_id)
    && typeof value.canonical_data_directory === 'string' && isAbsolute(value.canonical_data_directory));
}
async function selectedSource(input: SelectedSource, canonicalize = true): Promise<RetainedSourceLocation | undefined> {
  if (input.sourceDataDirectory === undefined && input.sourceRootId === undefined) return undefined;
  const value = { root_id: input.sourceRootId, canonical_data_directory: input.sourceDataDirectory } as RetainedSourceLocation;
  if (!validSourceLocation(value)) throw Error('RETAINED_SOURCE_LOCATION_REQUIRED');
  return { root_id: value.root_id, canonical_data_directory: canonicalize ? await realpath(value.canonical_data_directory) : resolve(value.canonical_data_directory) };
}
function sameSource(a: RetainedSourceLocation | undefined, b: RetainedSourceLocation | undefined): boolean {
  return !a && !b || Boolean(a && b && a.root_id === b.root_id && samePath(a.canonical_data_directory, b.canonical_data_directory));
}
async function differentSource(input: Located, sourceDirectory: string, sourceRunId: string): Promise<void> {
  const target = await retainedRunDirectory(input.dataDirectory, input.targetRunId), source = await retainedRunDirectory(sourceDirectory, sourceRunId);
  if (samePath(target, source)) throw Error('RETAINED_SELF_IMPORT');
}
async function assertPinnedDirectory(manifest: RetainedImportManifest, sourceDirectory: string): Promise<void> {
  if (manifest.source_location && !samePath(await realpath(sourceDirectory), sourceDirectory)) throw Error('RETAINED_IMPORT_INPUT_CHANGED');
}
async function location(input: Located) {
  const run = await retainedRunDirectory(input.dataDirectory, input.targetRunId), directory = join(run, 'opportunity');
  try {
    const physical = await realpath(directory), rel = relative(run, physical);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('RETAINED_PATH_OUTSIDE_DATA');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { directory, manifest: join(directory, 'retained-import.json'), checkpoint: join(directory, 'retained-import-checkpoint.json'), lock: join(directory, 'retained-import.lock') };
}
async function json(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('RETAINED_IMPORT_NOT_PREPARED'); throw Error('RETAINED_IMPORT_FILE_INVALID'); }
}
async function optionalJson(file: string): Promise<unknown | null> {
  try { return await json(file); } catch (error) { if (error instanceof Error && error.message === 'RETAINED_IMPORT_NOT_PREPARED') return null; throw error; }
}
async function atomic(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.next`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true, mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
async function locked<T>(file: string, work: () => Promise<T>): Promise<T> {
  const nonce = randomUUID();
  const take = async () => { const handle = await open(file, 'wx', 0o600); try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce })); await handle.sync(); } finally { await handle.close(); } };
  try { await take(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await json(file) as { pid: number; nonce: string };
    if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || typeof owner.nonce !== 'string') throw Error('RETAINED_IMPORT_LOCK_INVALID');
    let alive = true; try { process.kill(owner.pid, 0); } catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
    if (alive) throw Error('RETAINED_IMPORT_BUSY');
    await rm(file); await take();
  }
  try { return await work(); }
  finally { const owner = await optionalJson(file) as { nonce?: string } | null; if (owner?.nonce === nonce) await rm(file); }
}
function initial(manifest: RetainedImportManifest): RetainedImportCheckpoint {
  return { schema_version: 1, import_id: manifest.import_id, input_sha256: manifest.input_sha256, status: 'PAUSED', imported_observations: 0,
    total_observations: manifest.total_observations, last_source_sequence: 0, updated_at: now(), error_code: null };
}
function validateManifest(value: unknown, targetRunId: string): RetainedImportManifest {
  const record = value as { manifest: RetainedImportManifest; sha256: string };
  if (!record || !record.manifest || record.sha256 !== contentHash(record.manifest)) throw Error('RETAINED_IMPORT_MANIFEST_INVALID');
  const manifest = record.manifest, { input_sha256, import_id, ...input } = manifest;
  if (manifest.schema_version !== 1 || manifest.target_run_id !== targetRunId || input_sha256 !== contentHash(input)
    || import_id !== contentHash(['RETAINED_IMPORT', input_sha256]) || (!manifest.source_location && manifest.source.source_run_id === targetRunId)
    || (manifest.source_location !== undefined && !validSourceLocation(manifest.source_location))
    || !Number.isSafeInteger(manifest.total_observations) || manifest.total_observations < 0) throw Error('RETAINED_IMPORT_MANIFEST_INVALID');
  assertEvaluationContext(manifest.target_context);
  if (manifest.target_context.campaign_id !== targetRunId) throw Error('RETAINED_TARGET_CONTEXT_INVALID');
  return manifest;
}
function validateCheckpoint(value: unknown, manifest: RetainedImportManifest): RetainedImportCheckpoint {
  const checkpoint = value as RetainedImportCheckpoint;
  if (!checkpoint || checkpoint.schema_version !== 1 || checkpoint.import_id !== manifest.import_id || checkpoint.input_sha256 !== manifest.input_sha256
    || !['IMPORTING', 'IMPORTED', 'PAUSED', 'FAILED'].includes(checkpoint.status) || checkpoint.total_observations !== manifest.total_observations
    || !Number.isSafeInteger(checkpoint.imported_observations) || checkpoint.imported_observations < 0 || checkpoint.imported_observations > manifest.total_observations
    || !Number.isSafeInteger(checkpoint.last_source_sequence) || checkpoint.last_source_sequence < 0 || checkpoint.last_source_sequence > manifest.source.watermark.sequence
    || (checkpoint.status === 'IMPORTED' && (checkpoint.imported_observations !== manifest.total_observations || checkpoint.last_source_sequence !== manifest.source.watermark.sequence))) throw Error('RETAINED_CHECKPOINT_INVALID');
  return checkpoint;
}
/** Compact lineage for JSON/XLSX manifests; selected IDs and comment membership lists stay in the private import manifest. */
export function retainedExportMetadata(manifest: RetainedImportManifest, checkpoint: RetainedImportCheckpoint) {
  return { schema_version: 1, import_id: manifest.import_id, input_sha256: manifest.input_sha256, target_context: manifest.target_context,
    source_run_id: manifest.source.source_run_id, captured_at: manifest.captured_at, source_prefix_sha256: manifest.source.prefix_sha256,
    source_kind: manifest.source.kind,
    ...(manifest.source_location ? { source_location: { root_id: manifest.source_location.root_id,
      canonical_data_directory_sha256: contentHash(manifest.source_location.canonical_data_directory) } } : {}),
    ...(manifest.source.kind === 'LEGACY_POSTS_JSONL' ? { source_mapping_version: manifest.source.mapping_version, source_files: manifest.source.files,
      source_comment_semantics: 'ONLY_EXPLICIT_COMMENT_ROWS_NO_COMMENT_BODY_INFERRED_FROM_COUNTS' } : {}),
    source_prefix_bytes: manifest.source.prefix_bytes, source_watermark: manifest.source.watermark, source_root_counts: manifest.source.source_root_counts,
    selected_root_counts: manifest.source.selected_root_counts, platforms: manifest.source.platforms, max_roots: manifest.source.selection.max_roots,
    ...(manifest.source.selection.allocation ? { platform_allocation: manifest.source.selection.allocation } : {}),
    assessment_as_of: manifest.captured_at, assessment_semantics: 'FROZEN_HISTORICAL_AS_OF_ACROSS_RESUME',
    current_eligibility_semantics: 'VALID_UNTIL_USES_CURRENT_VIEW_CLOCK_EXPIRED_RECORDS_PENDING_NO_AUTOMATIC_REFRESH',
    selected_view_semantics: manifest.source.selection.semantics, excluded_comment_entities: manifest.source.selection.excluded_comment_keys.length,
    comment_exclusion_reason: 'FINAL_ROOT_OUTSIDE_SELECTION', total_observations: manifest.total_observations, excluded_observations: manifest.excluded_observations,
    imported_observations: checkpoint.imported_observations, status: checkpoint.status,
    model_charges_imported: false, source_decisions_imported: false, source_access: 'READ_ONLY_FROZEN_PREFIX' };
}
function state(manifest: RetainedImportManifest, checkpoint: RetainedImportCheckpoint): RetainedImportState {
  return { manifest, checkpoint, exportMetadata: retainedExportMetadata(manifest, checkpoint) };
}
/** Pure metadata read. A completed import no longer depends on the source's availability. */
export async function readRetainedImport(input: Located): Promise<RetainedImportState> {
  const files = await location(input), manifest = validateManifest(await json(files.manifest), input.targetRunId);
  return state(manifest, validateCheckpoint(await json(files.checkpoint), manifest));
}
export async function prepareRetainedImport(input: Located & SelectedSource & { sourceRunId: string; targetContext: EvaluationContext; maxRoots: number;
  platformWeights?: Readonly<Record<SocialPlatform, number>> }): Promise<RetainedImportState> {
  assertEvaluationContext(input.targetContext);
  if (input.targetContext.campaign_id !== input.targetRunId) throw Error('RETAINED_TARGET_CONTEXT_INVALID');
  const files = await location(input); await mkdir(files.directory, { recursive: true });
  return locked(files.lock, async () => {
    const existing = await optionalJson(files.manifest);
    if (existing) {
      const manifest = validateManifest(existing, input.targetRunId);
      if (manifest.source.source_run_id !== input.sourceRunId || manifest.source.selection.max_roots !== input.maxRoots
        || contentHash(manifest.source.selection.allocation?.weights ?? null) !== contentHash(input.platformWeights ?? null)
        || contentHash(manifest.target_context) !== contentHash(input.targetContext)) throw Error('RETAINED_IMPORT_INPUT_CHANGED');
      const old = await optionalJson(files.checkpoint), checkpoint = old ? validateCheckpoint(old, manifest) : initial(manifest);
      // Completed materialization is independent of source availability. Trusted callers already hold canonical registry paths.
      const chosen = await selectedSource(input, checkpoint.status !== 'IMPORTED');
      if (!sameSource(chosen, manifest.source_location)) throw Error('RETAINED_IMPORT_INPUT_CHANGED');
      if (!old) await atomic(files.checkpoint, checkpoint);
      return state(manifest, checkpoint);
    }
    const chosen = await selectedSource(input), sourceDirectory = chosen?.canonical_data_directory ?? input.dataDirectory;
    await differentSource(input, sourceDirectory, input.sourceRunId);
    const source = await freezeRetainedSource({ ...input, dataDirectory: sourceDirectory, targetDataDirectory: input.dataDirectory });
    if (source.latest_observed_at && Date.parse(source.latest_observed_at) > Date.parse(source.frozen_at)) throw Error('RETAINED_FUTURE_OBSERVATION');
    let total = 0; for await (const _observation of readRetainedObservations({ dataDirectory: sourceDirectory, manifest: source })) total++;
    const base = { schema_version: 1 as const, target_run_id: input.targetRunId, target_context: structuredClone(input.targetContext),
      captured_at: source.frozen_at, total_observations: total, excluded_observations: source.observation_count - total, source,
      ...(chosen ? { source_location: chosen } : {}) };
    const inputHash = contentHash(base), manifest: RetainedImportManifest = { ...base, input_sha256: inputHash, import_id: contentHash(['RETAINED_IMPORT', inputHash]) };
    await atomic(files.manifest, { manifest, sha256: contentHash(manifest) });
    const checkpoint = initial(manifest); await atomic(files.checkpoint, checkpoint); return state(manifest, checkpoint);
  });
}
export async function importRetainedData(input: Located & SelectedSource & { targetContext: EvaluationContext; store: Pick<AsyncConversationStore, 'ingestImported'>;
  shouldStop?: () => boolean; onProgress?: (checkpoint: RetainedImportCheckpoint) => void | Promise<void> }): Promise<RetainedImportState> {
  assertEvaluationContext(input.targetContext); const files = await location(input);
  return locked(files.lock, async () => {
    const loaded = await readRetainedImport(input), manifest = loaded.manifest; let checkpoint = loaded.checkpoint;
    if (contentHash(input.targetContext) !== contentHash(manifest.target_context)) throw Error('RETAINED_TARGET_CONTEXT_INVALID');
    if (checkpoint.status === 'IMPORTED') return loaded;
    let committedComplete = false;
    const save = async () => { checkpoint = { ...checkpoint, updated_at: now() }; await atomic(files.checkpoint, checkpoint);
      if (checkpoint.status === 'IMPORTED') committedComplete = true;
      await input.onProgress?.(structuredClone(checkpoint)); };
    try {
      const chosen = await selectedSource(input);
      if (chosen && !sameSource(chosen, manifest.source_location)) throw Error('RETAINED_IMPORT_INPUT_CHANGED');
      const sourceDirectory = manifest.source_location?.canonical_data_directory ?? input.dataDirectory;
      await assertPinnedDirectory(manifest, sourceDirectory);
      await differentSource(input, sourceDirectory, manifest.source.source_run_id);
      checkpoint = { ...checkpoint, status: 'IMPORTING', error_code: null }; await save();
      for await (const row of readRetainedObservations({ dataDirectory: sourceDirectory, manifest: manifest.source, afterSequence: checkpoint.last_source_sequence })) {
        if (input.shouldStop?.()) { checkpoint = { ...checkpoint, status: 'PAUSED' }; await save(); return state(manifest, checkpoint); }
        await input.store.ingestImported(row.observation, input.targetContext, { import_id: manifest.import_id, source_run_id: manifest.source.source_run_id,
          source_prefix_sha256: manifest.source.prefix_sha256, source_event_id: row.sourceEventId, source_sequence: row.sequence });
        checkpoint = { ...checkpoint, imported_observations: checkpoint.imported_observations + 1, last_source_sequence: row.sequence }; await save();
      }
      await assertPinnedDirectory(manifest, sourceDirectory);
      if (input.shouldStop?.()) checkpoint = { ...checkpoint, status: 'PAUSED' };
      else {
        if (checkpoint.imported_observations !== manifest.total_observations) throw Error('RETAINED_IMPORT_COUNT_MISMATCH');
        checkpoint = { ...checkpoint, status: 'IMPORTED', last_source_sequence: manifest.source.watermark.sequence };
      }
      await save(); return state(manifest, checkpoint);
    } catch (error) {
      // A presentation callback cannot undo a completed, hash-validated materialization.
      if (committedComplete) throw error;
      checkpoint = { ...checkpoint, status: 'FAILED', error_code: safeCode(error), updated_at: now() };
      await atomic(files.checkpoint, checkpoint); throw error;
    }
  });
}
