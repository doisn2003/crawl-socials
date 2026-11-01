import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { contentHash } from '../domain/conversation.js';

export interface RegisteredRetainedSourceRoot {
  id: string;
  label: string;
  canonicalPath: string;
  selectedAt: string;
}
interface StoredRoot extends RegisteredRetainedSourceRoot {
  /** Revalidated to detect a chosen symlink being redirected after selection. */
  selectedPath: string;
  identity: { dev: string; ino: string; birthtimeNs: string };
}
interface Registry { schemaVersion: 1; entries: StoredRoot[] }
const MAX_ROOTS = 32, MAX_PATH = 2048, MAX_BYTES = 256 * 1024;
const ID = /^source-root-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FILE = 'retained-source-roots.json';
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const publicEntry = ({ id, label, canonicalPath, selectedAt }: StoredRoot): RegisteredRetainedSourceRoot => ({ id, label, canonicalPath, selectedAt });
const safePath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH
  && isAbsolute(value) && !/[\x00-\x1f]/u.test(value);
const inside = (root: string, child: string) => {
  const rel = relative(root, child); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
function destination(value: string): string {
  if (!safePath(value)) throw Error('RETAINED_SOURCE_ROOT_DIRECTORY_INVALID');
  return resolve(value);
}
async function boundedJson(file: string, maximum = MAX_BYTES): Promise<unknown> {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maximum) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID');
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > maximum) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID');
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break; length += bytesRead;
    }
    if (length > maximum) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID'); }
  } finally { await handle.close(); }
}
function validate(value: unknown): Registry {
  const wrapper = value as { registry: Registry; sha256: string };
  if (!wrapper || Object.keys(wrapper).sort().join() !== 'registry,sha256' || !wrapper.registry
    || wrapper.sha256 !== contentHash(wrapper.registry)) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID');
  const registry = wrapper.registry;
  if (Object.keys(registry).sort().join() !== 'entries,schemaVersion' || registry.schemaVersion !== 1
    || !Array.isArray(registry.entries) || registry.entries.length > MAX_ROOTS) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID');
  const ids = new Set<string>(), paths = new Set<string>();
  for (const entry of registry.entries) {
    if (!entry || Object.keys(entry).sort().join() !== 'canonicalPath,id,identity,label,selectedAt,selectedPath'
      || !ID.test(entry.id) || !safePath(entry.canonicalPath) || !safePath(entry.selectedPath)
      || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 160 || /[\x00-\x1f]/u.test(entry.label)
      || typeof entry.selectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(entry.selectedAt)
      || !Number.isFinite(Date.parse(entry.selectedAt)) || !entry.identity || Object.keys(entry.identity).sort().join() !== 'birthtimeNs,dev,ino'
      || !Object.values(entry.identity).every(part => typeof part === 'string' && /^\d{1,30}$/u.test(part))
      || ids.has(entry.id) || paths.has(key(entry.canonicalPath))) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_INVALID');
    ids.add(entry.id); paths.add(key(entry.canonicalPath));
  }
  return registry;
}
async function readRegistry(directory: string): Promise<Registry> {
  try { return validate(await boundedJson(join(destination(directory), FILE))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, entries: [] }; throw error; }
}
async function inspectRoot(selectedPath: string) {
  if (!safePath(selectedPath)) throw Error('RETAINED_SOURCE_ROOT_PATH_INVALID');
  const selected = resolve(selectedPath);
  let canonicalPath: string;
  try { canonicalPath = await realpath(selected); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('RETAINED_SOURCE_ROOT_MISSING'); throw error; }
  if (!safePath(canonicalPath)) throw Error('RETAINED_SOURCE_ROOT_PATH_INVALID');
  const before = await stat(canonicalPath, { bigint: true });
  if (!before.isDirectory()) throw Error('RETAINED_SOURCE_ROOT_NOT_DIRECTORY');
  let collections: string;
  try { collections = await realpath(join(canonicalPath, 'collections')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('RETAINED_SOURCE_ROOT_COLLECTIONS_REQUIRED'); throw error; }
  if (!inside(canonicalPath, collections) || !(await stat(collections)).isDirectory()) throw Error('RETAINED_SOURCE_ROOT_COLLECTIONS_INVALID');
  const after = await stat(canonicalPath, { bigint: true });
  if (key(await realpath(selected)) !== key(canonicalPath) || before.dev !== after.dev || before.ino !== after.ino
    || (before.ino === 0n && before.birthtimeNs !== after.birthtimeNs)) throw Error('RETAINED_SOURCE_ROOT_CHANGED');
  return { selectedPath: selected, canonicalPath, identity: { dev: after.dev.toString(), ino: after.ino.toString(), birthtimeNs: after.birthtimeNs.toString() } };
}
function sameIdentity(a: StoredRoot['identity'], b: StoredRoot['identity']): boolean {
  return a.dev === b.dev && a.ino === b.ino && (a.ino !== '0' || a.birthtimeNs === b.birthtimeNs);
}
async function saveRegistry(directory: string, registry: Registry): Promise<void> {
  const file = join(directory, FILE), temporary = `${file}.${randomUUID()}.next`;
  const bytes = JSON.stringify({ registry, sha256: contentHash(registry) }, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw Error('RETAINED_SOURCE_ROOT_REGISTRY_LIMIT');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
async function withLock<T>(directory: string, work: () => Promise<T>): Promise<T> {
  const file = join(directory, 'retained-source-roots.lock'), nonce = randomUUID(), deadline = Date.now() + 2000;
  while (true) {
    try {
      const handle = await open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce })); await handle.sync(); } finally { await handle.close(); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: { pid: number; nonce: string };
      try { owner = await boundedJson(file, 4096) as { pid: number; nonce: string }; }
      catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        // Another process may have created the exclusive file but not finished
        // writing its short ownership receipt yet. Never delete an unknown lock.
        if (readError instanceof Error && readError.message === 'RETAINED_SOURCE_ROOT_REGISTRY_INVALID' && Date.now() < deadline) { await delay(25); continue; }
        throw Error('RETAINED_SOURCE_ROOT_LOCK_INVALID');
      }
      if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== 'string') throw Error('RETAINED_SOURCE_ROOT_LOCK_INVALID');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (!alive) {
        const current = await boundedJson(file, 4096) as { nonce?: string };
        if (current.nonce === owner.nonce) await unlink(file);
        continue;
      }
      if (Date.now() >= deadline) throw Error('RETAINED_SOURCE_ROOT_BUSY');
      await delay(25);
    }
  }
  try { return await work(); }
  finally {
    const owner = await boundedJson(file, 4096) as { nonce?: string };
    if (owner.nonce === nonce) await unlink(file);
  }
}

/** Register only a path obtained by the main process's explicit native folder picker. */
export async function registerRetainedSourceRoot(input: { directory: string; selectedPath: string }): Promise<RegisteredRetainedSourceRoot> {
  const directory = destination(input.directory); await mkdir(directory, { recursive: true });
  return withLock(directory, async () => {
    const inspected = await inspectRoot(input.selectedPath), registry = await readRegistry(directory);
    const existing = registry.entries.find(entry => key(entry.canonicalPath) === key(inspected.canonicalPath));
    if (existing) {
      if (!sameIdentity(existing.identity, inspected.identity)) throw Error('RETAINED_SOURCE_ROOT_CHANGED');
      // A fresh explicit selection may renew the route to the same pinned directory;
      // the opaque ID, canonical mapping and original selection timestamp never change.
      if (key(existing.selectedPath) !== key(inspected.selectedPath)) { existing.selectedPath = inspected.selectedPath; await saveRegistry(directory, registry); }
      return publicEntry(existing);
    }
    if (registry.entries.length >= MAX_ROOTS) throw Error('RETAINED_SOURCE_ROOT_LIMIT');
    const entry: StoredRoot = { ...inspected, id: 'source-root-' + randomUUID(),
      label: (basename(inspected.canonicalPath) || inspected.canonicalPath).slice(0, 160), selectedAt: new Date().toISOString() };
    registry.entries.push(entry); await saveRegistry(directory, registry); return publicEntry(entry);
  });
}

/** Pure registry read; missing external drives do not hide their registered identity. */
export async function listRegisteredRetainedSourceRoots(input: { directory: string }): Promise<RegisteredRetainedSourceRoot[]> {
  return (await readRegistry(input.directory)).entries.map(publicEntry);
}

/** Recheck the selected alias and directory identity at each use, before reading any source data. */
export async function resolveRetainedSourceRoot(input: { directory: string; sourceRootId: string }): Promise<string> {
  if (typeof input.sourceRootId !== 'string' || !ID.test(input.sourceRootId)) throw Error('RETAINED_SOURCE_ROOT_ID_INVALID');
  const entry = (await readRegistry(input.directory)).entries.find(value => value.id === input.sourceRootId);
  if (!entry) throw Error('RETAINED_SOURCE_ROOT_NOT_FOUND');
  const current = await inspectRoot(entry.selectedPath);
  if (key(current.canonicalPath) !== key(entry.canonicalPath) || !sameIdentity(current.identity, entry.identity)) throw Error('RETAINED_SOURCE_ROOT_CHANGED');
  return entry.canonicalPath;
}
