import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';

export interface BackupFile { path: string; category: string; sha256: string; content: Buffer; }
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

/** Each database uses SQLite's online backup API, including committed WAL data. */
export async function snapshotProject(directory: string): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  const candidates: string[] = [];
  function visit(current: string): void {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      if (/(?:-wal|-shm|\.next|\.tmp|\.lock)$/.test(entry.name) || ['secrets', 'session-snapshots', 'browser-profiles.json', '.env'].includes(entry.name)) continue;
      const file = join(current, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile()) continue;
      candidates.push(file);
    }
  }
  visit(directory);
  // Journals must include at least the events represented by their database snapshots.
  // Readers replay journal entries newer than the copied database on recovery.
  candidates.sort((a, b) => Number(category(a) !== 'database') - Number(category(b) !== 'database') || a.localeCompare(b));
  for (const file of candidates) {
    const path = relative(directory, file).split(sep).join('/');
    let content: Buffer;
    if (category(path) === 'database') {
      const temporary = join(tmpdir(), 'csd-snapshot-' + randomUUID() + '.sqlite');
      const db = new DatabaseSync(file, { readOnly: true });
      try { await backup(db, temporary); content = readFileSync(temporary); }
      finally { db.close(); rmSync(temporary, { force: true }); }
    } else {
      const before = statSync(file);
      content = readFileSync(file);
      const after = statSync(file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('PROJECT_BACKUP_BUSY');
    }
    files.push({ path, category: category(path), sha256: sha256(content), content });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
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
export function restoreProject(directory: string, source: string, files: BackupFile[]): void {
  const staging = directory + '.restore-' + randomUUID();
  const previous = directory + '.previous-' + randomUUID();
  mkdirSync(staging, { recursive: true });
  try {
    for (const file of files) {
      if (sha256(file.content) !== file.sha256) throw Error('PROJECT_BACKUP_CORRUPT');
      const target = safePath(staging, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, restoredContent(file, source, directory), { mode: 0o600 });
    }
    if (existsSync(directory)) renameSync(directory, previous);
    try { renameSync(staging, directory); }
    catch (error) { if (existsSync(previous)) renameSync(previous, directory); throw error; }
    // Keep previous local data as a recovery checkpoint outside the active project directory.
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
}
