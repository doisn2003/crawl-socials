import { createHash } from 'node:crypto';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { contentHash, stableJson, validateObservation, type ConversationObservation, type SocialPlatform } from '../../domain/conversation.js';
import { allocatePlatformTargets } from '../../shared/platform-targets.js';

const RUN_ID = /^crawl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const RELATIVE_JOURNAL = 'opportunity/store/conversation-events.jsonl';
const LEGACY_PATHS = ['facebook/posts.jsonl', 'threads/posts.jsonl'] as const;
const LEGACY_MAPPING = 'COLLECTOR_POST_OBSERVATION_V1' as const;
const LIMITS = { sourceBytes: 512 * 1024 * 1024, lineBytes: 8 * 1024 * 1024, events: 1_000_000, roots: 100_000 } as const;
const TYPES = new Set(['OBSERVATION', 'DECISION', 'JOB_ENQUEUED', 'KEYWORD_COMMENT_CAPTURE', 'INVOCATION_RESERVED', 'INVOCATION_FINISHED']);
type JournalEvent = { id: string; seq: number; type: string; payload?: { observation?: ConversationObservation } };
export interface RetainedPlatformAllocation {
  policy: 'PLATFORM_WEIGHTED_PREFIX_V1';
  weights: Record<SocialPlatform, number>;
  requested_counts: Record<SocialPlatform, number>;
  shortfall_policy: 'FILL_FROM_REMAINING_SOURCE_ORDER';
}
interface RetainedSourceCommon {
  schema_version: 1;
  source_run_id: string;
  frozen_at: string;
  prefix_bytes: number;
  prefix_sha256: string;
  source_bytes_at_freeze: number;
  ignored_tail_bytes: number;
  event_count: number;
  observation_count: number;
  latest_observed_at: string | null;
  watermark: { sequence: number; event_id: string | null };
  selection: { max_roots: number; roots: Array<{ platform: SocialPlatform; root_post_id: string }>; unknown_root_candidates: 'RETAIN_RAW';
    excluded_comment_keys: string[]; semantics: 'SELECTED_ROOT_VIEW_CANONICAL_COMMENT_MEMBERSHIP'; allocation?: RetainedPlatformAllocation };
  source_root_counts: Record<SocialPlatform, number>;
  selected_root_counts: Record<SocialPlatform, number>;
  platforms: SocialPlatform[];
  limits: typeof LIMITS;
}
export interface RetainedLegacyFile {
  platform: SocialPlatform;
  relative_path: typeof LEGACY_PATHS[number];
  prefix_bytes: number;
  prefix_sha256: string;
  source_bytes_at_freeze: number;
  ignored_tail_bytes: number;
  record_count: number;
}
export type RetainedSourceManifest = RetainedSourceCommon & (
  { kind: 'OPPORTUNITY_JOURNAL'; relative_path: typeof RELATIVE_JOURNAL }
  | { kind: 'LEGACY_POSTS_JSONL'; relative_path: null; mapping_version: typeof LEGACY_MAPPING; files: RetainedLegacyFile[] }
);
export interface RetainedObservation {
  sourceEventId: string;
  sequence: number;
  byteEnd: number;
  observation: ConversationObservation;
}

function within(root: string, file: string): boolean {
  const rel = relative(root, file); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
/** The caller supplies the application's trusted data root; UI input supplies only a validated run ID. */
export async function retainedRunDirectory(dataDirectory: string, runId: string): Promise<string> {
  if (!isAbsolute(dataDirectory) || !RUN_ID.test(runId)) throw Error('RETAINED_RUN_ID_INVALID');
  const root = await realpath(dataDirectory), collections = await realpath(join(root, 'collections'));
  if (!within(root, collections)) throw Error('RETAINED_PATH_OUTSIDE_DATA');
  const run = await realpath(join(collections, runId));
  if (!within(collections, run)) throw Error('RETAINED_PATH_OUTSIDE_DATA');
  return run;
}
async function sourceFile(dataDirectory: string, runId: string, relativePath: string = RELATIVE_JOURNAL): Promise<string> {
  if (![RELATIVE_JOURNAL, ...LEGACY_PATHS].includes(relativePath)) throw Error('RETAINED_SOURCE_INVALID');
  const run = await retainedRunDirectory(dataDirectory, runId);
  let file: string; try { file = await realpath(join(run, ...relativePath.split('/'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('RETAINED_OPPORTUNITY_JOURNAL_REQUIRED'); throw error; }
  if (!within(run, file) || !(await stat(file)).isFile()) throw Error('RETAINED_SOURCE_INVALID');
  return file;
}
async function hasSourceFile(dataDirectory: string, runId: string, relativePath: string): Promise<boolean> {
  const run = await retainedRunDirectory(dataDirectory, runId);
  try { await lstat(join(run, ...relativePath.split('/'))); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/** Reads a bounded prefix and never repairs a torn tail or opens the source SQLite writer. */
async function* completeLines(file: string, byteLimit: number): AsyncGenerator<{ bytes: Buffer; end: number }> {
  const handle = await open(file, 'r'); let offset = 0, pending = Buffer.alloc(0), completeEnd = 0;
  try {
    while (offset < byteLimit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, byteLimit - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) throw Error('RETAINED_SOURCE_TRUNCATED');
      offset += bytesRead; pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
      let index: number;
      while ((index = pending.indexOf(10)) !== -1) {
        if (index + 1 > LIMITS.lineBytes) throw Error('RETAINED_LINE_LIMIT');
        const bytes = pending.subarray(0, index + 1); completeEnd += bytes.length;
        yield { bytes, end: completeEnd }; pending = pending.subarray(index + 1);
      }
      if (pending.length > LIMITS.lineBytes) throw Error('RETAINED_LINE_LIMIT');
    }
  } finally { await handle.close(); }
}
function eventFrom(bytes: Buffer, previous: number): JournalEvent | null {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { throw Error('RETAINED_JOURNAL_ENCODING'); }
  if (!text) return null;
  let event: JournalEvent; try { event = JSON.parse(text) as JournalEvent; } catch { throw Error('RETAINED_JOURNAL_CORRUPT'); }
  if (!event || typeof event.id !== 'string' || !event.id || !Number.isSafeInteger(event.seq) || event.seq <= previous || !TYPES.has(event.type)) throw Error('RETAINED_JOURNAL_EVENT_INVALID');
  if (event.type === 'OBSERVATION') {
    try { validateObservation(event.payload?.observation as ConversationObservation); } catch { throw Error('RETAINED_OBSERVATION_INVALID'); }
  }
  return event;
}
const key = (platform: SocialPlatform, root: string) => `${platform}:${root}`;
type SourceInput = { dataDirectory: string; sourceRunId: string; targetRunId: string; maxRoots: number;
  targetDataDirectory?: string; platformWeights?: Readonly<Record<SocialPlatform, number>> };
function selectRoots(roots: RetainedSourceCommon['selection']['roots'], maxRoots: number, weights?: Readonly<Record<SocialPlatform, number>>) {
  let chosen = roots.slice(0, maxRoots), allocation: RetainedPlatformAllocation | undefined;
  if (weights) {
    const available = (['facebook', 'threads'] as const).filter(platform => roots.some(root => root.platform === platform));
    const requested = allocatePlatformTargets(maxRoots, weights, available.length ? available : ['facebook', 'threads']);
    const counts = { facebook: 0, threads: 0 }, keys = new Set<string>();
    for (const root of roots) if (counts[root.platform] < requested[root.platform]) { keys.add(key(root.platform, root.root_post_id)); counts[root.platform]++; }
    // A preference is not a hard exclusion: unused slots use the other platform's original prefix.
    for (const root of roots) { if (keys.size >= maxRoots) break; keys.add(key(root.platform, root.root_post_id)); }
    chosen = roots.filter(root => keys.has(key(root.platform, root.root_post_id)));
    allocation = { policy: 'PLATFORM_WEIGHTED_PREFIX_V1', weights: { facebook: weights.facebook, threads: weights.threads },
      requested_counts: requested, shortfall_policy: 'FILL_FROM_REMAINING_SOURCE_ORDER' };
  }
  const counts = { facebook: 0, threads: 0 }; for (const root of chosen) counts[root.platform]++;
  return { roots: chosen, counts, ...(allocation ? { allocation } : {}) };
}
export async function freezeRetainedSource(input: SourceInput): Promise<RetainedSourceManifest> {
  if (!RUN_ID.test(input.targetRunId)) throw Error('RETAINED_SELF_IMPORT');
  if (input.targetDataDirectory !== undefined) {
    const source = await retainedRunDirectory(input.dataDirectory, input.sourceRunId), target = await retainedRunDirectory(input.targetDataDirectory, input.targetRunId);
    if (process.platform === 'win32' ? source.toLowerCase() === target.toLowerCase() : source === target) throw Error('RETAINED_SELF_IMPORT');
  } else if (input.targetRunId === input.sourceRunId) throw Error('RETAINED_SELF_IMPORT');
  if (!Number.isSafeInteger(input.maxRoots) || input.maxRoots < 1 || input.maxRoots > LIMITS.roots) throw Error('RETAINED_ROOT_LIMIT_INVALID');
  if (input.platformWeights !== undefined) allocatePlatformTargets(input.maxRoots, input.platformWeights, ['facebook', 'threads']);
  // A present empty/corrupt journal remains authoritative; never silently replace it with older posts.
  if (!await hasSourceFile(input.dataDirectory, input.sourceRunId, RELATIVE_JOURNAL)) return freezeLegacySource(input);
  const file = await sourceFile(input.dataDirectory, input.sourceRunId), size = (await stat(file)).size;
  if (size > LIMITS.sourceBytes) throw Error('RETAINED_SOURCE_BYTE_LIMIT');
  const hash = createHash('sha256'), roots = new Set<string>(), eventIds = new Set<string>();
  const candidates: RetainedSourceManifest['selection']['roots'] = [], sourceCounts = { threads: 0, facebook: 0 };
  const commentRoots = new Map<string, { root: string | null; at: number }>(); let latestObservedAt: string | null = null;
  let end = 0, sequence = 0, eventId: string | null = null, events = 0, observations = 0;
  for await (const line of completeLines(file, size)) {
    hash.update(line.bytes); end = line.end;
    const event = eventFrom(line.bytes, sequence); if (!event) continue;
    if (++events > LIMITS.events || eventIds.has(event.id)) throw Error('RETAINED_EVENT_LIMIT_OR_DUPLICATE');
    eventIds.add(event.id); sequence = event.seq; eventId = event.id;
    if (event.type !== 'OBSERVATION') continue;
    observations++; const observation = event.payload!.observation!;
    if (!latestObservedAt || Date.parse(observation.observed_at) > Date.parse(latestObservedAt)) latestObservedAt = observation.observed_at;
    if (observation.entity_type === 'COMMENT' && observation.entity_id) {
      const id = key(observation.platform, observation.entity_id), prior = commentRoots.get(id), observed = Date.parse(observation.observed_at);
      if (!prior || observed >= prior.at) commentRoots.set(id, { root: observation.root_post_id ? key(observation.platform, observation.root_post_id) : null, at: observed });
    }
    if (observation.entity_type !== 'POST' || !observation.entity_id) continue;
    const root = observation.root_post_id ?? observation.entity_id, id = key(observation.platform, root);
    if (roots.has(id)) continue;
    if (roots.size >= LIMITS.roots) throw Error('RETAINED_SOURCE_ROOT_LIMIT');
    roots.add(id); sourceCounts[observation.platform]++;
    if (input.platformWeights || candidates.length < input.maxRoots) candidates.push({ platform: observation.platform, root_post_id: root });
  }
  if (!events || !observations) throw Error('RETAINED_SOURCE_EMPTY');
  const selection = selectRoots(candidates, input.maxRoots, input.platformWeights), selected = selection.roots, selectedCounts = selection.counts;
  const selectedKeys = new Set(selected.map(root => key(root.platform, root.root_post_id)));
  const excludedComments = [...commentRoots].filter(([, value]) => !value.root || !selectedKeys.has(value.root)).map(([id]) => id).sort();
  return { schema_version: 1, kind: 'OPPORTUNITY_JOURNAL', source_run_id: input.sourceRunId, relative_path: RELATIVE_JOURNAL,
    frozen_at: new Date().toISOString(), prefix_bytes: end, prefix_sha256: hash.digest('hex'), source_bytes_at_freeze: size, ignored_tail_bytes: size - end,
    event_count: events, observation_count: observations, latest_observed_at: latestObservedAt, watermark: { sequence, event_id: eventId },
    selection: { max_roots: input.maxRoots, roots: selected, unknown_root_candidates: 'RETAIN_RAW', excluded_comment_keys: excludedComments,
      semantics: 'SELECTED_ROOT_VIEW_CANONICAL_COMMENT_MEMBERSHIP', ...(selection.allocation ? { allocation: selection.allocation } : {}) }, source_root_counts: sourceCounts, selected_root_counts: selectedCounts,
    platforms: (['facebook', 'threads'] as const).filter(platform => selectedCounts[platform] > 0), limits: LIMITS };
}
function assertManifest(manifest: RetainedSourceManifest): void {
  if (manifest.schema_version !== 1 || !['OPPORTUNITY_JOURNAL', 'LEGACY_POSTS_JSONL'].includes(manifest.kind) || !RUN_ID.test(manifest.source_run_id)
    || !/^[a-f0-9]{64}$/.test(manifest.prefix_sha256) || !Number.isSafeInteger(manifest.prefix_bytes) || manifest.prefix_bytes < 1 || manifest.prefix_bytes > LIMITS.sourceBytes
    || !Array.isArray(manifest.selection?.roots) || manifest.selection.roots.length > LIMITS.roots
    || !Array.isArray(manifest.selection.excluded_comment_keys) || manifest.selection.excluded_comment_keys.some(value => typeof value !== 'string')
    || contentHash(manifest.limits) !== contentHash(LIMITS)) throw Error('RETAINED_MANIFEST_INVALID');
  if (manifest.kind === 'OPPORTUNITY_JOURNAL') {
    if (manifest.relative_path !== RELATIVE_JOURNAL) throw Error('RETAINED_MANIFEST_INVALID');
  } else {
    if (manifest.relative_path !== null || manifest.mapping_version !== LEGACY_MAPPING || !Array.isArray(manifest.files)
      || manifest.files.length < 1 || manifest.files.length > 2) throw Error('RETAINED_MANIFEST_INVALID');
    let previous = -1;
    for (const file of manifest.files) {
      const index = LEGACY_PATHS.indexOf(file.relative_path);
      if (index <= previous || file.relative_path !== `${file.platform}/posts.jsonl` || !/^[a-f0-9]{64}$/.test(file.prefix_sha256)
        || !Number.isSafeInteger(file.prefix_bytes) || file.prefix_bytes < 0 || file.prefix_bytes > LIMITS.sourceBytes
        || !Number.isSafeInteger(file.record_count) || file.record_count < 0 || file.record_count > LIMITS.events) throw Error('RETAINED_MANIFEST_INVALID');
      previous = index;
    }
    if (manifest.prefix_sha256 !== legacyHash(manifest.files) || manifest.prefix_bytes !== manifest.files.reduce((n, file) => n + file.prefix_bytes, 0)
      || manifest.event_count !== manifest.files.reduce((n, file) => n + file.record_count, 0)
      || manifest.watermark.sequence !== manifest.event_count || manifest.observation_count !== manifest.event_count) throw Error('RETAINED_MANIFEST_INVALID');
  }
  const keys = new Set<string>();
  for (const root of manifest.selection.roots) {
    if (!['threads', 'facebook'].includes(root.platform) || typeof root.root_post_id !== 'string' || !root.root_post_id || keys.has(key(root.platform, root.root_post_id))) throw Error('RETAINED_MANIFEST_INVALID');
    keys.add(key(root.platform, root.root_post_id));
  }
  if (manifest.selection.allocation) {
    const allocation = manifest.selection.allocation, available = (['facebook', 'threads'] as const).filter(platform => manifest.source_root_counts[platform] > 0);
    if (allocation.policy !== 'PLATFORM_WEIGHTED_PREFIX_V1' || allocation.shortfall_policy !== 'FILL_FROM_REMAINING_SOURCE_ORDER'
      || contentHash(allocation.requested_counts) !== contentHash(allocatePlatformTargets(manifest.selection.max_roots, allocation.weights,
        available.length ? available : ['facebook', 'threads']))) throw Error('RETAINED_MANIFEST_INVALID');
  }
}
export async function verifyRetainedSource(input: { dataDirectory: string; manifest: RetainedSourceManifest }): Promise<void> {
  assertManifest(input.manifest);
  if (input.manifest.kind === 'LEGACY_POSTS_JSONL') {
    for (const file of input.manifest.files) await verifyLegacyFile(input.dataDirectory, input.manifest.source_run_id, file);
    return;
  }
  const file = await sourceFile(input.dataDirectory, input.manifest.source_run_id), hash = createHash('sha256'); let end = 0;
  for await (const line of completeLines(file, input.manifest.prefix_bytes)) { hash.update(line.bytes); end = line.end; }
  if (end !== input.manifest.prefix_bytes || hash.digest('hex') !== input.manifest.prefix_sha256) throw Error('RETAINED_SOURCE_PREFIX_CHANGED');
}
export async function* readRetainedObservations(input: { dataDirectory: string; manifest: RetainedSourceManifest; afterSequence?: number }): AsyncGenerator<RetainedObservation> {
  assertManifest(input.manifest); const after = input.afterSequence ?? 0;
  if (!Number.isSafeInteger(after) || after < 0 || after > input.manifest.watermark.sequence) throw Error('RETAINED_CHECKPOINT_INVALID');
  await verifyRetainedSource(input);
  if (input.manifest.kind === 'LEGACY_POSTS_JSONL') { yield* readLegacyObservations(input.dataDirectory, input.manifest, after); return; }
  const selected = new Set(input.manifest.selection.roots.map(root => key(root.platform, root.root_post_id)));
  const excludedComments = new Set(input.manifest.selection.excluded_comment_keys);
  const file = await sourceFile(input.dataDirectory, input.manifest.source_run_id), hash = createHash('sha256'); let sequence = 0, events = 0, end = 0;
  for await (const line of completeLines(file, input.manifest.prefix_bytes)) {
    hash.update(line.bytes); end = line.end; const event = eventFrom(line.bytes, sequence); if (!event) continue;
    sequence = event.seq; events++; if (events > LIMITS.events) throw Error('RETAINED_EVENT_LIMIT_OR_DUPLICATE');
    if (event.type !== 'OBSERVATION' || sequence <= after) continue;
    const observation = event.payload!.observation!, root = observation.root_post_id ?? (observation.entity_type === 'POST' ? observation.entity_id : null);
    if (observation.entity_type === 'COMMENT' && observation.entity_id && excludedComments.has(key(observation.platform, observation.entity_id))) continue;
    if (root && !selected.has(key(observation.platform, root))) continue;
    yield { sourceEventId: event.id, sequence, byteEnd: line.end, observation };
  }
  if (end !== input.manifest.prefix_bytes || sequence !== input.manifest.watermark.sequence || events !== input.manifest.event_count
    || hash.digest('hex') !== input.manifest.prefix_sha256) throw Error('RETAINED_SOURCE_PREFIX_CHANGED');
}

type LegacyManifest = Extract<RetainedSourceManifest, { kind: 'LEGACY_POSTS_JSONL' }>;
const legacyHash = (files: RetainedLegacyFile[]) => contentHash({ mapping_version: LEGACY_MAPPING,
  files: files.map(file => ({ platform: file.platform, relative_path: file.relative_path, prefix_bytes: file.prefix_bytes,
    prefix_sha256: file.prefix_sha256, record_count: file.record_count })) });
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nativeId = (value: unknown): value is string => typeof value === 'string' && /^\d+$/u.test(value);
function legacyRecord(bytes: Buffer): Record<string, unknown> | null {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { throw Error('RETAINED_LEGACY_ENCODING'); }
  if (!text) return null;
  let value: unknown; try { value = JSON.parse(text); } catch { throw Error('RETAINED_LEGACY_CORRUPT'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  return value as Record<string, unknown>;
}
function legacyObservation(row: Record<string, unknown>, platform: SocialPlatform, relativePath: string, line: number): ConversationObservation {
  const first = row.first_observation as Record<string, unknown> | undefined;
  const method = first?.method;
  const id = row.post_id, url = platform === 'facebook' ? row.observed_post_url : row.post_url;
  if (!nativeId(id) || typeof row.text !== 'string' || !validDate(row.collected_at)
    || (row.published_at !== null && row.published_at !== undefined && !validDate(row.published_at))
    || typeof row.query !== 'string' || !first || !nonempty(first.run_id) || !nonempty(first.batch_id)
    || !['BROWSER_RESPONSE', 'EMBEDDED_DOCUMENT_JSON'].includes(String(method))
    || !Number.isSafeInteger(first.query_index) || Number(first.query_index) < 0
    || !Number.isSafeInteger(first.scroll_index) || Number(first.scroll_index) < 0
    || typeof first.response_sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(first.response_sha256)
    || !nonempty(url)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  let parsed: URL; try { parsed = new URL(url); } catch { throw Error('RETAINED_LEGACY_URL_INVALID'); }
  const hosts = platform === 'facebook' ? ['facebook.com', 'www.facebook.com'] : ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'];
  if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw Error('RETAINED_LEGACY_URL_INVALID');
  if (platform === 'facebook') {
    // Keep the native routes accepted by the collector parser; an opaque pfbid is not a numeric identity.
    const groupRoute = /^\/groups\/[^/]+\/posts\/(\d+)\/?$/u.test(parsed.pathname);
    const pageRoute = /^\/[^/]+\/posts\/(?:pfbid[A-Za-z0-9]+|\d+)\/?$/u.test(parsed.pathname);
    const numericPost = parsed.pathname.match(/\/posts\/(\d+)\/?$/u)?.[1], queryPost = parsed.searchParams.get('story_fbid');
    const queryRoute = parsed.pathname === '/permalink.php' && queryPost !== null && /^(?:pfbid[A-Za-z0-9]+|\d+)$/u.test(queryPost)
      && /^\d+$/u.test(parsed.searchParams.get('id') || '') && [...parsed.searchParams.keys()].every(field => ['story_fbid', 'id'].includes(field))
      && parsed.searchParams.getAll('story_fbid').length === 1 && parsed.searchParams.getAll('id').length === 1;
    if (parsed.hash || (parsed.search && !queryRoute) || (!groupRoute && !pageRoute && !queryRoute) || (numericPost && numericPost !== id)
      || (queryRoute && /^\d+$/u.test(queryPost!) && queryPost !== id)) throw Error('RETAINED_LEGACY_URL_INVALID');
  }
  if (platform === 'threads' && (row.platform !== 'threads' || !nonempty(row.shortcode) || !/^[A-Za-z0-9_-]+$/u.test(row.shortcode)
    || !nonempty(row.author_username) || !['top', 'recent'].includes(String(row.search_mode))
    || parsed.pathname !== `/@${row.author_username}/post/${row.shortcode}`)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  if (row.is_reply !== undefined && typeof row.is_reply !== 'boolean') throw Error('RETAINED_LEGACY_RECORD_INVALID');
  if ((row.entity_type === 'POST' && row.is_reply === true) || (row.entity_type === 'COMMENT' && row.is_reply === false)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  const isReply = row.entity_type === 'COMMENT' || row.is_reply === true;
  for (const field of ['root_post_id', 'parent_id'] as const) if (row[field] !== undefined && row[field] !== null && !nativeId(row[field])) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  if (row.entity_type !== undefined && !['POST', 'COMMENT'].includes(String(row.entity_type))) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  if (!isReply && ((row.root_post_id != null && row.root_post_id !== id) || row.parent_id != null)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  const root = isReply ? (row.root_post_id as string | null | undefined) ?? null : id;
  const count = platform === 'facebook' ? row.comments_count : row.replies;
  if (count !== undefined && count !== null && (!Number.isSafeInteger(count) || Number(count) < 0)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
  const media: NonNullable<ConversationObservation['media']> = [];
  if (row.media_refs !== undefined) {
    if (!Array.isArray(row.media_refs)) throw Error('RETAINED_LEGACY_RECORD_INVALID');
    for (const value of row.media_refs) {
      if (!value || typeof value !== 'object' || !['IMAGE', 'VIDEO'].includes(value.type) || typeof value.url !== 'string'
        || !value.url.startsWith('https://')) throw Error('RETAINED_LEGACY_RECORD_INVALID');
      media.push({ type: value.type as 'IMAGE' | 'VIDEO', url: value.url });
    }
  }
  const sourceKind = ['PROFILE', 'GROUP', 'PAGE'].includes(String(row.source_type)) ? row.source_type as 'PROFILE' | 'GROUP' | 'PAGE' : 'UNKNOWN';
  const authorName = nonempty(row.author_name) ? row.author_name : nonempty(row.author_username) ? row.author_username : null;
  // Locator keeps native capture metadata, including older parser/transport disagreements, outside model text.
  const capture = Object.fromEntries(['run_id', 'batch_id', 'query_index', 'scroll_index', 'method', 'response_sha256', 'operation', 'transport_request_id', 'request_id']
    .filter(field => first[field] !== undefined).map(field => [field, first[field]]));
  const observation: ConversationObservation = { platform, entity_type: !root ? 'CANDIDATE' : isReply ? 'COMMENT' : 'POST', entity_id: id,
    root_post_id: root, parent_id: (row.parent_id as string | null | undefined) ?? null, text: row.text, observed_at: row.collected_at,
    ...(row.published_at !== undefined ? { published_at: row.published_at as string | null } : {}), permalink: url,
    ...(authorName ? { author: { name: authorName } } : {}),
    ...(sourceKind !== 'UNKNOWN' || row.source_name !== undefined || row.source_url !== undefined ? { source: { kind: sourceKind,
      ...(row.source_name !== undefined ? { name: nonempty(row.source_name) ? row.source_name : null } : {}),
      ...(row.source_url !== undefined ? { url: nonempty(row.source_url) ? row.source_url : null } : {}) } } : {}),
    ...(row.media_refs !== undefined ? { media } : {}),
    ...(!isReply ? { coverage: { status: 'NOT_ATTEMPTED' as const, advertised_count: count == null ? null : Number(count) } } : {}),
    provenance: { run_id: first.run_id as string, method: method as string, response_sha256: first.response_sha256 as string, query: row.query, url,
      locator: stableJson({ legacy_file: relativePath, line, first_observation: capture, extraction_method: row.extraction_method,
        evidence_ref: row.evidence_ref, source_evidence: row.source_evidence, source_signals: row.source_signals,
        author_url: row.author_url, visibility: row.visibility, text_completeness: row.text_completeness }) } };
  validateObservation(observation); return observation;
}
async function freezeLegacySource(input: SourceInput): Promise<LegacyManifest> {
  const files: RetainedLegacyFile[] = [], roots = new Set<string>(), entityIds = new Set<string>();
  const candidates: RetainedSourceCommon['selection']['roots'] = [], sourceCounts = { facebook: 0, threads: 0 };
  const commentRoots = new Map<string, string | null>(); let latest: string | null = null, totalBytes = 0, sequence = 0, eventId: string | null = null;
  for (const relativePath of LEGACY_PATHS) {
    if (!await hasSourceFile(input.dataDirectory, input.sourceRunId, relativePath)) continue;
    const platform: SocialPlatform = relativePath === 'facebook/posts.jsonl' ? 'facebook' : 'threads';
    const file = await sourceFile(input.dataDirectory, input.sourceRunId, relativePath), size = (await stat(file)).size;
    totalBytes += size; if (totalBytes > LIMITS.sourceBytes) throw Error('RETAINED_SOURCE_BYTE_LIMIT');
    const hash = createHash('sha256'); let end = 0, records = 0, lineNumber = 0;
    for await (const line of completeLines(file, size)) {
      hash.update(line.bytes); end = line.end; lineNumber++;
      const row = legacyRecord(line.bytes); if (!row) continue;
      if (++sequence > LIMITS.events) throw Error('RETAINED_EVENT_LIMIT_OR_DUPLICATE');
      records++; const observation = legacyObservation(row, platform, relativePath, lineNumber);
      eventId = `legacy:${platform}:${lineNumber}:${contentHash(row)}`;
      const entityKey = key(platform, observation.entity_id!);
      if (entityIds.has(entityKey)) throw Error('RETAINED_LEGACY_DUPLICATE'); entityIds.add(entityKey);
      if (!latest || Date.parse(observation.observed_at) > Date.parse(latest)) latest = observation.observed_at;
      if (observation.entity_type === 'COMMENT') commentRoots.set(entityKey, observation.root_post_id ? key(platform, observation.root_post_id) : null);
      if (observation.entity_type !== 'POST') continue;
      const root = observation.root_post_id!, rootKey = key(platform, root); if (roots.has(rootKey)) continue;
      if (roots.size >= LIMITS.roots) throw Error('RETAINED_SOURCE_ROOT_LIMIT'); roots.add(rootKey); sourceCounts[platform]++;
      if (input.platformWeights || candidates.length < input.maxRoots) candidates.push({ platform, root_post_id: root });
    }
    files.push({ platform, relative_path: relativePath, prefix_bytes: end, prefix_sha256: hash.digest('hex'), source_bytes_at_freeze: size,
      ignored_tail_bytes: size - end, record_count: records });
  }
  if (!files.length) throw Error('RETAINED_OPPORTUNITY_JOURNAL_REQUIRED');
  if (!sequence) throw Error('RETAINED_SOURCE_EMPTY');
  const selection = selectRoots(candidates, input.maxRoots, input.platformWeights), selected = selection.roots, selectedCounts = selection.counts;
  const selectedKeys = new Set(selected.map(root => key(root.platform, root.root_post_id)));
  const excludedComments = [...commentRoots].filter(([, root]) => !root || !selectedKeys.has(root)).map(([id]) => id).sort();
  return { schema_version: 1, kind: 'LEGACY_POSTS_JSONL', source_run_id: input.sourceRunId, relative_path: null, mapping_version: LEGACY_MAPPING, files,
    frozen_at: new Date().toISOString(), prefix_bytes: files.reduce((n, file) => n + file.prefix_bytes, 0), prefix_sha256: legacyHash(files),
    source_bytes_at_freeze: totalBytes, ignored_tail_bytes: files.reduce((n, file) => n + file.ignored_tail_bytes, 0),
    event_count: sequence, observation_count: sequence, latest_observed_at: latest, watermark: { sequence, event_id: eventId },
    selection: { max_roots: input.maxRoots, roots: selected, unknown_root_candidates: 'RETAIN_RAW', excluded_comment_keys: excludedComments,
      semantics: 'SELECTED_ROOT_VIEW_CANONICAL_COMMENT_MEMBERSHIP', ...(selection.allocation ? { allocation: selection.allocation } : {}) }, source_root_counts: sourceCounts, selected_root_counts: selectedCounts,
    platforms: (['facebook', 'threads'] as const).filter(platform => selectedCounts[platform] > 0), limits: LIMITS };
}
async function verifyLegacyFile(dataDirectory: string, runId: string, descriptor: RetainedLegacyFile): Promise<void> {
  const file = await sourceFile(dataDirectory, runId, descriptor.relative_path), hash = createHash('sha256'); let end = 0;
  for await (const line of completeLines(file, descriptor.prefix_bytes)) { hash.update(line.bytes); end = line.end; }
  if (end !== descriptor.prefix_bytes || hash.digest('hex') !== descriptor.prefix_sha256) throw Error('RETAINED_SOURCE_PREFIX_CHANGED');
}
async function* readLegacyObservations(dataDirectory: string, manifest: LegacyManifest, after: number): AsyncGenerator<RetainedObservation> {
  const selected = new Set(manifest.selection.roots.map(root => key(root.platform, root.root_post_id))), excluded = new Set(manifest.selection.excluded_comment_keys);
  let sequence = 0, byteOffset = 0;
  for (const descriptor of manifest.files) {
    const file = await sourceFile(dataDirectory, manifest.source_run_id, descriptor.relative_path), hash = createHash('sha256');
    let end = 0, records = 0, lineNumber = 0;
    for await (const line of completeLines(file, descriptor.prefix_bytes)) {
      hash.update(line.bytes); end = line.end; lineNumber++;
      const row = legacyRecord(line.bytes); if (!row) continue; sequence++; records++;
      const observation = legacyObservation(row, descriptor.platform, descriptor.relative_path, lineNumber);
      if (sequence <= after || (observation.entity_type === 'COMMENT' && excluded.has(key(observation.platform, observation.entity_id!)))
        || (observation.root_post_id && !selected.has(key(observation.platform, observation.root_post_id)))) continue;
      yield { sourceEventId: `legacy:${descriptor.platform}:${lineNumber}:${contentHash(row)}`, sequence, byteEnd: byteOffset + line.end, observation };
    }
    if (end !== descriptor.prefix_bytes || records !== descriptor.record_count || hash.digest('hex') !== descriptor.prefix_sha256) throw Error('RETAINED_SOURCE_PREFIX_CHANGED');
    byteOffset += end;
  }
  if (sequence !== manifest.watermark.sequence) throw Error('RETAINED_SOURCE_PREFIX_CHANGED');
  // Revalidate both files after the final row, including a first file changed while reading the second.
  for (const descriptor of manifest.files) await verifyLegacyFile(dataDirectory, manifest.source_run_id, descriptor);
}
