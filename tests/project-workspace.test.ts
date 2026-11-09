import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createProjectWorkspace } from '../src/infrastructure/projects/workspace.js';
import { passwordHash, passwordMatches, type ProjectBackupStore, type RemoteProject } from '../src/infrastructure/projects/postgres.js';
import { restoreProject, safePath, sha256, snapshotProject, type BackupFile } from '../src/infrastructure/projects/snapshot.js';
import type { SecretStore } from '../src/application/ports/secret-store.js';

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); }, delete: async key => { values.delete(key); } };
}
function memoryCloud(): ProjectBackupStore & { stored: Map<string, RemoteProject>; uploads: number } {
  const stored = new Map<string, RemoteProject>();
  const files = new Map<string, BackupFile[]>();
  const users = new Map<string, { id: string; username: string; password: string }>();
  const tokens = new Map<string, { id: string; username: string }>();
  const guests = new Map<string, string>();
  return {
    stored, uploads: 0,
    async ensureGuest(id, secret) {
      if (guests.has(id)) assert.equal(guests.get(id), secret);
      guests.set(id, secret);
    },
    async authenticate(input, register) {
      let user = users.get(input.username);
      if (register) {
        if (user) throw Error('PROJECT_USERNAME_EXISTS');
        user = { id: randomUUID(), username: input.username, password: input.password }; users.set(input.username, user);
      }
      if (!user || user.password !== input.password) throw Error('PROJECT_AUTH_FAILED');
      const token = randomUUID(); tokens.set(token, { id: user.id, username: user.username });
      return { id: user.id, username: user.username, token };
    },
    async session(token) { return tokens.get(token) ?? null; },
    async revoke(token) { tokens.delete(token); },
    async claim(id, secret, userId) {
      assert.equal(guests.get(id), secret);
      for (const project of stored.values()) if (project.ownerId === id) project.ownerId = userId;
    },
    async list(ownerId) { return [...stored.values()].filter(project => project.ownerId === ownerId).map(project => ({ ...project })); },
    async files(ownerId, id, revision) {
      const project = stored.get(id);
      assert.equal(project?.ownerId, ownerId);
      if (project?.revision !== revision) throw Error('PROJECT_BACKUP_CONFLICT');
      return files.get(id)!.map(file => ({ ...file, content: Buffer.from(file.content) }));
    },
    async upload(input) {
      this.uploads++;
      const existing = stored.get(input.project.id);
      if (existing && existing.ownerId !== input.ownerId) throw Error('PROJECT_ACCESS_DENIED');
      if (existing && existing.revision !== input.revision) {
        if (existing.fingerprint === input.fingerprint) return existing.revision;
        throw Error('PROJECT_BACKUP_CONFLICT');
      }
      stored.set(input.project.id, { ...input.project, ownerId: input.ownerId, revision: input.revision + 1,
        fingerprint: input.fingerprint, sourceDirectory: input.sourceDirectory, deletedAt: input.deletedAt });
      files.set(input.project.id, input.files.map(file => ({ ...file, content: Buffer.from(file.content) })));
      return input.revision + 1;
    },
    async close() {},
  };
}

test('project CRUD isolates state and delete keeps a usable active project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-crud-'));
  try {
    const workspace = await createProjectWorkspace({ directory: root });
    const first = workspace.state().activeProjectId;
    writeFileSync(join(workspace.activeDirectory(), 'user-config.json'), JSON.stringify({ prompt: 'piano' }));
    await workspace.create({ name: 'Du lịch', avatar: 'data:image/png;base64,YQ==' });
    const second = workspace.state().activeProjectId;
    assert.notEqual(second, first);
    assert.equal((await snapshotProject(workspace.activeDirectory())).length, 0);
    await workspace.select({ id: first });
    assert.equal(JSON.parse(readFileSync(join(workspace.activeDirectory(), 'user-config.json'), 'utf8')).prompt, 'piano');
    await workspace.update({ id: first, name: 'Đàn' });
    await workspace.remove({ id: first });
    assert.equal(workspace.state().activeProjectId, second);
    await assert.rejects(workspace.select({ id: first }), /PROJECT_NOT_FOUND/);
    await workspace.remove({ id: second });
    assert.equal(workspace.state().projects.length, 1);
    assert.equal(workspace.state().backup.status, 'LOCAL');
    await workspace.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy migration captures WAL and rebases run paths while preserving source files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-migrate-'));
  const database = new DatabaseSync(join(root, 'discovery.sqlite'));
  try {
    database.exec("PRAGMA journal_mode=WAL; CREATE TABLE test(value TEXT); INSERT INTO test VALUES('committed WAL');");
    writeFileSync(join(root, 'latest-run.json'), JSON.stringify({ outputDirectory: join(root, 'collections', 'crawl-fixture') }));
    writeFileSync(join(root, 'browser-profiles.json'), 'private');
    const workspace = await createProjectWorkspace({ directory: root });
    const destination = workspace.activeDirectory();
    const copied = new DatabaseSync(join(destination, 'discovery.sqlite'), { readOnly: true });
    assert.equal(copied.prepare('SELECT value FROM test').get()!.value, 'committed WAL'); copied.close();
    assert.equal(JSON.parse(readFileSync(join(destination, 'latest-run.json'), 'utf8')).outputDirectory, join(destination, 'collections', 'crawl-fixture'));
    assert.equal(JSON.parse(readFileSync(join(root, 'latest-run.json'), 'utf8')).outputDirectory, join(root, 'collections', 'crawl-fixture'));
    assert.ok(!(await snapshotProject(destination)).some(file => file.path === 'browser-profiles.json'));
    await workspace.close();
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
});

test('login restores all files on a new machine, keeps identity on restart and scopes logout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-cloud-'));
  const cloud = memoryCloud(), secrets = memorySecrets();
  try {
    const first = await createProjectWorkspace({ directory: join(root, 'one'), backupStore: cloud });
    const id = first.state().activeProjectId;
    await first.update({ id, name: 'Piano' });
    writeFileSync(join(first.activeDirectory(), 'latest-run.json'), JSON.stringify({ outputDirectory: join(first.activeDirectory(), 'collections', 'crawl-fixture') }));
    assert.equal((await first.register({ username: 'person', password: 'simple' })).user?.username, 'person');
    const second = await createProjectWorkspace({ directory: join(root, 'two'), backupStore: cloud, secretStore: secrets });
    await second.login({ username: 'person', password: 'simple' });
    assert.equal(second.state().activeProjectId, id);
    assert.equal(second.state().projects.length, 1);
    assert.equal(JSON.parse(readFileSync(join(second.activeDirectory(), 'latest-run.json'), 'utf8')).outputDirectory, join(second.activeDirectory(), 'collections', 'crawl-fixture'));
    await second.close();
    const restarted = await createProjectWorkspace({ directory: join(root, 'two'), backupStore: cloud, secretStore: secrets });
    assert.equal(restarted.state().user?.username, 'person');
    assert.equal(restarted.state().activeProjectId, id);
    await restarted.logout();
    assert.equal(restarted.state().user, null);
    assert.ok(restarted.state().projects.every(project => project.id !== id));
    await restarted.close(); await first.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('backup retries are idempotent and conflicting devices preserve their local data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-conflict-'));
  const cloud = memoryCloud();
  try {
    const first = await createProjectWorkspace({ directory: join(root, 'one'), backupStore: cloud });
    await first.register({ username: 'person', password: 'simple' });
    const second = await createProjectWorkspace({ directory: join(root, 'two'), backupStore: cloud });
    await second.login({ username: 'person', password: 'simple' });
    const before = cloud.uploads;
    await first.sync(); await first.sync();
    assert.equal(cloud.uploads, before);
    writeFileSync(join(first.activeDirectory(), 'result.json'), JSON.stringify({ version: 1 }));
    assert.equal((await first.sync()).backup.status, 'SYNCED');
    writeFileSync(join(second.activeDirectory(), 'result.json'), JSON.stringify({ version: 2 }));
    assert.equal((await second.sync()).backup.error, 'PROJECT_BACKUP_CONFLICT');
    assert.equal(JSON.parse(readFileSync(join(second.activeDirectory(), 'result.json'), 'utf8')).version, 2);
    assert.equal((await second.sync({ pull: true })).backup.error, 'PROJECT_BACKUP_CONFLICT');
    await first.close(); await second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('snapshot rejects traversal and corrupt files and excludes machine secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-snapshot-'));
  try {
    mkdirSync(join(root, 'secrets')); writeFileSync(join(root, 'secrets', 'key.bin'), 'secret');
    writeFileSync(join(root, '.env'), 'secret'); writeFileSync(join(root, 'public.json'), '{}');
    assert.deepEqual((await snapshotProject(root)).map(file => file.path), ['public.json']);
    assert.throws(() => safePath(root, '../escape'), /PROJECT_BACKUP_PATH_INVALID/);
    assert.throws(() => restoreProject(join(root, 'restored'), root, [{ path: 'x', category: 'state', sha256: sha256('expected'), content: Buffer.from('wrong') }]), /PROJECT_BACKUP_CORRUPT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('passwords use salted scrypt hashes with exact comparisons', () => {
  const one = passwordHash('simple'), two = passwordHash('simple');
  assert.notEqual(one, two);
  assert.ok(passwordMatches('simple', one));
  assert.ok(!passwordMatches('different', one));
  assert.ok(!passwordMatches('simple', 'invalid'));
});

test('restore rebases operational paths and preserves hashed evidence bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-hashes-'));
  try {
    const source = join(root, 'source'), target = join(root, 'target');
    const collector = 'collections/run-one/facebook';
    mkdirSync(join(source, collector, 'runs', 'collector-one'), { recursive: true });
    const config = { output: join(source, collector), runId: 'collector-one' };
    writeFileSync(join(source, collector, 'config.json'), JSON.stringify(config));
    writeFileSync(join(source, collector, 'runs', 'collector-one', 'manifest.json'), JSON.stringify({ config, config_sha256: sha256(JSON.stringify(config)) }));
    const evidence = JSON.stringify({ source_location: { canonical_data_directory: source }, sha256: 'immutable-digest' }, null, 4);
    const journal = '{ "source": ' + JSON.stringify(source) + ', "sequence": 1 }\r\n';
    writeFileSync(join(source, 'retained-import.json'), evidence);
    writeFileSync(join(source, 'conversation-events.jsonl'), journal);
    restoreProject(target, source, await snapshotProject(source));
    assert.equal(readFileSync(join(target, 'retained-import.json'), 'utf8'), evidence);
    assert.equal(readFileSync(join(target, 'conversation-events.jsonl'), 'utf8'), journal);
    const restoredConfig = JSON.parse(readFileSync(join(target, collector, 'config.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(target, collector, 'runs', 'collector-one', 'manifest.json'), 'utf8'));
    assert.equal(restoredConfig.output, join(target, collector));
    assert.deepEqual(manifest.config, restoredConfig);
    assert.equal(manifest.config_sha256, sha256(JSON.stringify(restoredConfig)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed remote download can be retried and an expired session cannot pull files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-project-retry-'));
  const cloud = memoryCloud(), secrets = memorySecrets();
  try {
    const first = await createProjectWorkspace({ directory: join(root, 'one'), backupStore: cloud });
    const id = first.state().activeProjectId;
    writeFileSync(join(first.activeDirectory(), 'result.json'), '{"saved":true}');
    await first.register({ username: 'person', password: 'simple' });
    const second = await createProjectWorkspace({ directory: join(root, 'two'), backupStore: cloud, secretStore: secrets });
    const readFiles = cloud.files.bind(cloud);
    cloud.files = async () => { throw Error('temporary transport failure'); };
    await assert.rejects(second.login({ username: 'person', password: 'simple' }), /PROJECT_DATABASE_UNAVAILABLE/);
    assert.ok(!second.state().projects.some(project => project.id === id));
    cloud.files = readFiles;
    await second.login({ username: 'person', password: 'simple' });
    assert.equal(second.state().activeProjectId, id);
    assert.equal(JSON.parse(readFileSync(join(second.activeDirectory(), 'result.json'), 'utf8')).saved, true);
    const saved = JSON.parse((await secrets.get('csd-project-auth'))!);
    await cloud.revoke(saved.token);
    cloud.list = async () => { throw Error('LIST_MUST_NOT_RUN'); };
    assert.equal((await second.sync({ pull: true })).backup.error, 'PROJECT_AUTH_EXPIRED');
    await first.close(); await second.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
