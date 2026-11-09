import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import type { SecretStore } from '../../application/ports/secret-store.js';
import type { CsdProject, ProjectWorkspaceState } from '../../shared/projects.js';
import { atomicJson } from '../config/user-config.js';
import { createPostgresBackup, type ProjectBackupStore } from './postgres.js';
import { restoreProject, sha256, snapshotProject } from './snapshot.js';

interface LocalProject extends CsdProject {
  ownerId: string;
  revision: number;
  lastFingerprint: string | null;
  deletedAt: string | null;
}
interface WorkspaceIndex {
  schemaVersion: 1;
  deviceId: string;
  guestId: string;
  guestSecret: string;
  activeProjectId: string;
  projects: LocalProject[];
  migrationPending?: boolean;
}
const timestamp = () => new Date().toISOString();
const errorCode = (error: unknown) => error instanceof Error && /^PROJECT_[A-Z_]+$/.test(error.message) ? error.message : 'PROJECT_DATABASE_UNAVAILABLE';

function projectFields(input: { name: string; avatar?: string | null }): { name: string; avatar: string | null } {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw Error('PROJECT_NAME_INVALID');
  const avatar = input.avatar ?? null;
  if (avatar !== null && (typeof avatar !== 'string' || avatar.length > 3_000_000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(avatar))) throw Error('PROJECT_AVATAR_INVALID');
  return { name: input.name.trim().normalize('NFC'), avatar };
}

export async function createProjectWorkspace(input: { directory: string; databaseUrl?: string | undefined; backupStore?: ProjectBackupStore; secretStore?: SecretStore }) {
  const root = join(input.directory, 'projects');
  const indexFile = join(root, 'index.json');
  mkdirSync(root, { recursive: true });
  let index: WorkspaceIndex;
  if (existsSync(indexFile)) {
    index = JSON.parse(readFileSync(indexFile, 'utf8')) as WorkspaceIndex;
    if (index.schemaVersion !== 1 || !Array.isArray(index.projects)) throw Error('PROJECT_INDEX_INVALID');
  } else {
    index = { schemaVersion: 1, deviceId: randomUUID(), guestId: randomUUID(), guestSecret: randomBytes(32).toString('hex'), activeProjectId: '', projects: [], migrationPending: true };
  }
  let user: ProjectWorkspaceState['user'] = null;
  let sessionToken: string | null = null;
  const remote = input.backupStore ?? (input.databaseUrl ? createPostgresBackup(input.databaseUrl) : null);
  let backup: ProjectWorkspaceState['backup'] = { configured: remote !== null, status: remote ? 'PENDING' : 'LOCAL', lastSyncAt: null, error: null };
  let queue = Promise.resolve();
  const ownerId = () => user?.id ?? index.guestId;
  const save = () => atomicJson(indexFile, index);
  function directory(project: LocalProject): string { return join(root, project.id, 'data'); }
  function find(id: string): LocalProject {
    const project = index.projects.find(entry => entry.id === id && entry.ownerId === ownerId() && !entry.deletedAt);
    if (!project) throw Error('PROJECT_NOT_FOUND');
    return project;
  }
  function createLocal(value: { name: string; avatar?: string | null }): LocalProject {
    const now = timestamp();
    const project: LocalProject = { id: randomUUID(), ...projectFields(value), createdAt: now, updatedAt: now, ownerId: ownerId(), revision: 0, lastFingerprint: null, deletedAt: null };
    mkdirSync(directory(project), { recursive: true });
    index.projects.push(project);
    index.activeProjectId = project.id;
    save();
    return project;
  }
  function ensureActive(): void {
    const available = index.projects.filter(project => project.ownerId === ownerId() && !project.deletedAt);
    if (!available.length) { createLocal({ name: 'Project mới' }); return; }
    if (!available.some(project => project.id === index.activeProjectId)) index.activeProjectId = available[0]!.id;
    save();
  }
  function state(): ProjectWorkspaceState {
    return { projects: index.projects.filter(project => project.ownerId === ownerId() && !project.deletedAt).map(({ id, name, avatar, createdAt, updatedAt }) => ({ id, name, avatar, createdAt, updatedAt })),
      activeProjectId: index.activeProjectId, user: user ? { ...user } : null, backup: { ...backup } };
  }
  function pending(): void { backup.status = remote ? 'PENDING' : 'LOCAL'; backup.error = null; }
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.then(() => {}, () => {});
    return next;
  }
  async function capture(project: LocalProject) {
    const files = await snapshotProject(directory(project));
    const fingerprint = sha256(JSON.stringify({ name: project.name, avatar: project.avatar, deletedAt: project.deletedAt,
      files: files.map(file => [file.path, file.sha256]) }));
    return { files, fingerprint };
  }
  async function push(): Promise<void> {
    if (!remote) return;
    if (!user) await remote.ensureGuest(index.guestId, index.guestSecret);
    else if (!sessionToken || (await remote.session(sessionToken))?.id !== user.id) throw Error('PROJECT_AUTH_EXPIRED');
    for (const project of index.projects.filter(project => project.ownerId === ownerId())) {
      const snapshot = await capture(project);
      if (snapshot.fingerprint === project.lastFingerprint && project.revision > 0) continue;
      project.revision = await remote.upload({ ownerId: ownerId(), deviceId: index.deviceId, project, revision: project.revision,
        fingerprint: snapshot.fingerprint, sourceDirectory: directory(project), deletedAt: project.deletedAt, files: snapshot.files });
      project.lastFingerprint = snapshot.fingerprint;
      save();
    }
  }
  async function pull(): Promise<void> {
    if (!remote) return;
    if (user && (!sessionToken || (await remote.session(sessionToken))?.id !== user.id)) throw Error('PROJECT_AUTH_EXPIRED');
    const projects = await remote.list(ownerId());
    for (const project of projects) {
      let local = index.projects.find(entry => entry.id === project.id && entry.ownerId === ownerId());
      if (local && local.revision === project.revision) continue;
      if (local) {
        const snapshot = await capture(local);
        if (snapshot.fingerprint !== local.lastFingerprint) throw Error('PROJECT_BACKUP_CONFLICT');
      }
      const isNew = !local;
      local ??= { ...project, lastFingerprint: null };
      if (!project.deletedAt) {
        const files = await remote.files(ownerId(), project.id, project.revision);
        restoreProject(directory(local), project.sourceDirectory, files);
      }
      Object.assign(local, project);
      local.lastFingerprint = (await capture(local)).fingerprint;
      if (isNew) index.projects.push(local);
      save();
    }
    ensureActive();
  }
  async function sync(options: { pull?: boolean } = {}): Promise<ProjectWorkspaceState> {
    if (!remote) return state();
    backup.status = 'SYNCING'; backup.error = null;
    try {
      if (!user) await remote.ensureGuest(index.guestId, index.guestSecret);
      if (options.pull) await pull();
      await push();
      backup = { configured: true, status: 'SYNCED', error: null, lastSyncAt: timestamp() };
    } catch (error) { backup.status = 'ERROR'; backup.error = errorCode(error); }
    return state();
  }
  async function authenticate(credentials: { username: string; password: string }, register: boolean): Promise<ProjectWorkspaceState> {
    if (!remote) throw Error('PROJECT_DATABASE_NOT_CONFIGURED');
    try {
      const authenticated = await remote.authenticate(credentials, register);
      const existingRemote = await remote.list(authenticated.id);
      // Flush guest data before changing ownership. A failure remains retryable locally.
      if (!user) {
        // Recover a previous ownership transfer interrupted before local index publication.
        for (const project of index.projects.filter(entry => entry.ownerId === index.guestId && existingRemote.some(remoteProject => remoteProject.id === entry.id))) project.ownerId = authenticated.id;
        if (existingRemote.some(project => !project.deletedAt)) {
          for (const project of index.projects.filter(entry => entry.ownerId === index.guestId && entry.revision === 0 && entry.name === 'Dữ liệu CSD hiện có')) {
            if ((await snapshotProject(directory(project))).length === 0) index.projects.splice(index.projects.indexOf(project), 1);
          }
        }
        await push();
        await remote.claim(index.guestId, index.guestSecret, authenticated.id);
        for (const project of index.projects.filter(entry => entry.ownerId === index.guestId)) project.ownerId = authenticated.id;
      }
      user = { id: authenticated.id, username: authenticated.username };
      sessionToken = authenticated.token;
      await input.secretStore?.set('csd-project-auth', JSON.stringify({ user, token: sessionToken }));
      if (existingRemote.some(project => !project.deletedAt)) index.activeProjectId = existingRemote.find(project => !project.deletedAt)!.id;
      save();
      await pull();
      ensureActive();
      backup = { configured: true, status: 'SYNCED', error: null, lastSyncAt: timestamp() };
      return state();
    } catch (error) {
      backup.status = 'ERROR'; backup.error = errorCode(error);
      ensureActive();
      throw Error(backup.error);
    }
  }
  if (index.migrationPending || index.projects.length === 0) {
    const migrated = index.projects[0] ?? createLocal({ name: 'Dữ liệu CSD hiện có' });
    // Only application-generated data moves into a project. Browser sessions and keys stay machine-local.
    const names = ['user-config.json', 'user-config.json.v1.backup', 'latest-run.json', 'active-campaign-draft.json', 'collections', 'filter-presets', 'assessment-cache', 'retained-source-roots.json'];
    for (const name of names) {
      const source = join(input.directory, name);
      if (existsSync(source)) cpSync(source, join(directory(migrated), name), { recursive: true, force: true });
    }
    if (existsSync(join(input.directory, 'discovery.sqlite'))) {
      const db = new DatabaseSync(join(input.directory, 'discovery.sqlite'), { readOnly: true });
      try { await sqliteBackup(db, join(directory(migrated), 'discovery.sqlite')); } finally { db.close(); }
    }
    const files = await snapshotProject(directory(migrated));
    if (files.length) restoreProject(directory(migrated), input.directory, files);
    index.migrationPending = false; save();
  }
  if (input.secretStore) {
    try {
      const saved = await input.secretStore.get('csd-project-auth');
      if (saved) {
        const value = JSON.parse(saved) as { user: NonNullable<ProjectWorkspaceState['user']>; token: string };
        if (value.user?.id && value.user.username && value.token) { user = value.user; sessionToken = value.token; }
      }
    } catch { backup.status = 'ERROR'; backup.error = 'PROJECT_SESSION_READ_FAILED'; }
  }
  ensureActive();
  return {
    state,
    activeDirectory: () => directory(find(index.activeProjectId)),
    markDirty: pending,
    create: (value: { name: string; avatar?: string | null }) => serial(async () => { createLocal(value); pending(); return state(); }),
    update: (value: { id: string; name: string; avatar?: string | null }) => serial(async () => {
      const project = find(value.id);
      Object.assign(project, projectFields({ name: value.name, avatar: value.avatar === undefined ? project.avatar : value.avatar }), { updatedAt: timestamp() });
      save(); pending(); return state();
    }),
    remove: (value: { id: string }) => serial(async () => {
      const project = find(value.id); project.deletedAt = timestamp(); project.updatedAt = project.deletedAt;
      ensureActive(); save(); pending(); return state();
    }),
    select: (value: { id: string }) => serial(async () => { find(value.id); index.activeProjectId = value.id; save(); return state(); }),
    register: (value: { username: string; password: string }) => serial(() => authenticate(value, true)),
    login: (value: { username: string; password: string }) => serial(() => authenticate(value, false)),
    logout: () => serial(async () => {
      await sync();
      if (remote && sessionToken) await remote.revoke(sessionToken).catch(() => {});
      await input.secretStore?.delete('csd-project-auth');
      user = null; sessionToken = null; ensureActive(); pending(); return state();
    }),
    sync: (options: { pull?: boolean } = {}) => serial(() => sync(options)),
    close: async () => { await queue; await remote?.close(); },
  };
}
