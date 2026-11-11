import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';

export interface BackupFile { path: string; category: string; sha256: string; content: Buffer; }
export interface BackupEntry { path: string; category: string; sha256: string; size: number; }
export interface ProjectSnapshot { directory: string; scratch: string; files: BackupEntry[]; }
export type ProjectFileHashes = Map<string, { stamp: string; sha256: string }>;
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function category(path: string): string {
  if (/\.sqlite(?:3)?$|\.db$/.test(path)) return 'database';
  if (/assessment-cache/.test(path)) return 'assessment';
  if (/response|usage|spend|ledger/.test(path)) return 'model-evidence';
  if (/observations|journal|jsonl/.test(path)) return 'raw';
  if (/result|export|\.xlsx$/.test(path)) return 'result';
  if (/draft|recipe|preset|plan/.test(path)) return 'recipe';
  return 'state';
}

export function safePath(directory: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.' || !part)) throw Error('PROJECT_BACKUP_PATH_INVALID');
  const destination = resolve(directory, ...path.split('/'));
  if (!destination.startsWith(resolve(directory) + sep)) throw Error('PROJECT_BACKUP_PATH_INVALID');
  return destination;
}

const projectFiles = new Set(['user-config.json', 'user-config.json.v1.backup', 'latest-run.json']);
const runFiles = new Set(['run-state.json', 'opportunity-config.json', 'results.json', 'opportunity-results.json']);
const runConfiguration = new Set(['campaign.json', 'filter-recipe.json', 'active-evaluation.json']);
const runId = /^crawl-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function isSavedProjectFile(path: string): boolean {
  if (projectFiles.has(path)) return true;
  const parts = path.split('/');
  if (parts[0] === 'filter-presets') return parts.length === 3 && parts[2]!.endsWith('.json');
  return parts[0] === 'collections' && runId.test(parts[1] ?? '') && (parts.length === 3 && runFiles.has(parts[2]!)
    || parts.length === 4 && parts[2] === 'opportunity' && runConfiguration.has(parts[3]!));
}

async function listFiles(directory: string, full: boolean, keepDeliveryHistory: boolean, signal?: AbortSignal): Promise<string[]> {
  const candidates: string[] = [];
  async function visit(path: string): Promise<void> {
    signal?.throwIfAborted();
    let entries;
    try { entries = await readdir(join(directory, path), { withFileTypes: true }); }
    catch (error) { if (missing(error)) return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || /(?:-wal|-shm|\.next|\.tmp|\.lock)$/.test(entry.name)
        || ['secrets', 'session-snapshots', 'browser-profiles.json', '.env'].includes(entry.name)) continue;
      const file = path ? path + '/' + entry.name : entry.name;
      if (entry.isDirectory() && (full || ['filter-presets', 'collections'].includes(file) || path === 'filter-presets'
        || path === 'collections' && runId.test(entry.name)
        || entry.name === 'opportunity' && /^collections\/crawl-[a-f0-9-]{36}$/u.test(path))) await visit(file);
      else if (entry.isFile() && (full || isSavedProjectFile(file)
        || keepDeliveryHistory && ['discovery.sqlite', 'project-posts.sqlite', 'retained-source-roots.json'].includes(file))) candidates.push(file);
    }
  }
  await visit('');
  // A legacy snapshot captures databases before the journals that can replay newer events.
  return candidates.sort((a, b) => Number(category(a) !== 'database') - Number(category(b) !== 'database') || a.localeCompare(b));
}

async function fingerprintFile(file: string, signal?: AbortSignal, cache?: ProjectFileHashes) {
  const before = await lstat(file);
  if (!before.isFile()) throw Error('PROJECT_BACKUP_BUSY');
  const stamp = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}:${before.ctimeMs}`;
  const cached = cache?.get(file);
  if (cached?.stamp === stamp) return { sha256: cached.sha256, size: before.size };
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024, ...(signal ? { signal } : {}) })) hash.update(chunk);
  const after = await lstat(file);
  if (!after.isFile() || stamp !== `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}`) throw Error('PROJECT_BACKUP_BUSY');
  const sha256 = hash.digest('hex');
  cache?.set(file, { stamp, sha256 });
  return { sha256, size: after.size };
}

/** Hash incrementally and keep bytes off the manifest. Only legacy SQLite files need staging. */
export async function withProjectSnapshot<T>(directory: string, work: (snapshot: ProjectSnapshot) => Promise<T>,
  options: { full?: boolean; keepDeliveryHistory?: boolean; signal?: AbortSignal; cache?: ProjectFileHashes } = {}): Promise<T> {
  const candidates = await listFiles(directory, options.full === true, options.keepDeliveryHistory === true, options.signal);
  const snapshot: ProjectSnapshot = { directory, scratch: '', files: [] };
  try {
    for (const path of candidates) {
      options.signal?.throwIfAborted();
      const kind = category(path);
      let file = safePath(directory, path);
      if (kind === 'database') {
        snapshot.scratch ||= await mkdtemp(join(tmpdir(), 'csd-snapshot-'));
        const target = safePath(snapshot.scratch, path);
        await mkdir(dirname(target), { recursive: true });
        const db = new DatabaseSync(file, { readOnly: true });
        try { await backup(db, target); } finally { db.close(); }
        file = target;
      }
      snapshot.files.push({ path, category: kind, ...await fingerprintFile(file, options.signal, kind === 'database' ? undefined : options.cache) });
    }
    snapshot.files.sort((a, b) => a.path.localeCompare(b.path));
    options.signal?.throwIfAborted();
    return await work(snapshot);
  } finally {
    if (snapshot.scratch) await rm(snapshot.scratch, { recursive: true, force: true });
  }
}

export async function readSnapshotFile(snapshot: ProjectSnapshot, file: BackupEntry, signal?: AbortSignal): Promise<Buffer> {
  const path = safePath(file.category === 'database' ? snapshot.scratch : snapshot.directory, file.path);
  const info = await lstat(path);
  if (!info.isFile() || info.size !== file.size) throw Error('PROJECT_BACKUP_BUSY');
  const content = await readFile(path, { ...(signal ? { signal } : {}) });
  if (content.length !== file.size || sha256(content) !== file.sha256) throw Error('PROJECT_BACKUP_BUSY');
  return content;
}

export async function* snapshotFiles(snapshot: ProjectSnapshot): AsyncGenerator<BackupFile> {
  for (const file of snapshot.files) {
    yield { path: file.path, category: file.category, sha256: file.sha256, content: await readSnapshotFile(snapshot, file) };
  }
}

export async function snapshotProject(directory: string): Promise<BackupFile[]> {
  return withProjectSnapshot(directory, async snapshot => {
    const files: BackupFile[] = [];
    for await (const file of snapshotFiles(snapshot)) files.push(file);
    return files;
  }, { full: true });
}

function rebasePath(value: unknown, source: string, destination: string): unknown {
  if (typeof value === 'string') {
    if (value === source || value.startsWith(source + '/') || value.startsWith(source + '\\')) return destination + value.slice(source.length).replace(/[\\/]/g, sep);
    return value;
  }
  return value;
}

function restoredContent(file: BackupFile, source: string, destination: string): Buffer {
  if (source === destination) return file.content;
  const runState = file.path === 'latest-run.json' || /^collections\/[^/]+\/run-state\.json$/.test(file.path);
  const collectorConfig = /^collections\/[^/]+\/(?:facebook|threads)(?:\/[^/]+)*\/config\.json$/.test(file.path);
  const collectorManifest = /^collections\/[^/]+\/(?:facebook|threads)(?:\/[^/]+)*\/runs\/[^/]+\/manifest\.json$/.test(file.path);
  if (!runState && !collectorConfig && !collectorManifest) return file.content;
  try {
    const value = JSON.parse(file.content.toString('utf8'));
    if (runState) value.outputDirectory = rebasePath(value.outputDirectory, source, destination);
    if (collectorConfig) value.output = rebasePath(value.output, source, destination);
    if (collectorManifest && value.config) {
      value.config.output = rebasePath(value.config.output, source, destination);
      value.config_sha256 = sha256(JSON.stringify(value.config));
    }
    return Buffer.from(JSON.stringify(value, null, 2));
  } catch { throw Error('PROJECT_BACKUP_JSON_INVALID'); }
}

/** Stage every file and verify hashes before publishing a restored directory. */
export async function restoreProject(directory: string, source: string, files: Iterable<BackupFile> | AsyncIterable<BackupFile>): Promise<string | null> {
  const staging = directory + '.restore-' + randomUUID();
  const previous = directory + '.previous-' + randomUUID();
  await mkdir(staging, { recursive: true });
  try {
    for await (const file of files) {
      if (sha256(file.content) !== file.sha256) throw Error('PROJECT_BACKUP_CORRUPT');
      const target = safePath(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, restoredContent(file, source, directory), { mode: 0o600 });
    }
    let moved = false;
    try { await rename(directory, previous); moved = true; }
    catch (error) { if (!missing(error)) throw error; }
    try { await rename(staging, directory); }
    catch (error) { if (moved) await rename(previous, directory); throw error; }
    // Keep previous local data as a recovery checkpoint outside the active project directory.
    return moved ? previous : null;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
