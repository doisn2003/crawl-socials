// Opt-in PostgreSQL integration test. Uses generated accounts and isolated local data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createProjectWorkspace } from '../dist/infrastructure/projects/workspace.js';
import { ProjectPostStore } from '../dist/infrastructure/storage/project-post-store.js';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
const directory = mkdtempSync(join(tmpdir(), 'csd-postgres-test-'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const owners = new Set(), workspaces = [];
const username = 'csd-test-' + randomUUID(), password = randomUUID();
function secrets() {
  const values = new Map();
  return { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); }, delete: async key => { values.delete(key); } };
}
async function workspace(name, secretStore = secrets()) {
  const data = join(directory, name);
  const instance = await createProjectWorkspace({ directory: data, databaseUrl: process.env.DATABASE_URL, secretStore });
  workspaces.push(instance);
  owners.add(JSON.parse(readFileSync(join(data, 'projects', 'index.json'), 'utf8')).guestId);
  return instance;
}
try {
  const savedSecrets = secrets();
  const first = await workspace('first', savedSecrets);
  const projectId = first.state().activeProjectId;
  await first.update({ id: projectId, name: 'Backup integration test' });
  writeFileSync(join(first.activeDirectory(), 'fixture.json'), JSON.stringify({ prompt: 'piano' }));
  writeFileSync(join(first.activeDirectory(), 'latest-run.json'), JSON.stringify({ outputDirectory: first.activeDirectory() }));
  const posts = new ProjectPostStore(first.activeDirectory());
  posts.observe('run-1', 'facebook', 'post-A', { text: 'fixture' }, new Date().toISOString());
  posts.observe('run-2', 'facebook', 'post-A', { text: 'fixture' }, new Date().toISOString());
  posts.close();
  const registered = await first.register({ username, password });
  owners.add(registered.user.id);
  assert.equal((await first.sync()).backup.status, 'SYNCED');
  const counts = await pool.query('SELECT count(*)::int AS count FROM csd_backup.project_posts WHERE project_id=$1', [projectId]);
  assert.equal(counts.rows[0].count, 1);
  const membership = await pool.query('SELECT previously_collected FROM csd_backup.project_run_posts WHERE project_id=$1 AND run_id=$2', [projectId, 'run-2']);
  assert.equal(membership.rows[0].previously_collected, true);
  const second = await workspace('second');
  await second.login({ username, password });
  await second.select({ id: projectId });
  assert.deepEqual(JSON.parse(readFileSync(join(second.activeDirectory(), 'fixture.json'), 'utf8')),
    { prompt: 'piano' });
  assert.equal(JSON.parse(readFileSync(join(second.activeDirectory(), 'latest-run.json'), 'utf8')).outputDirectory, second.activeDirectory());
  const restored = new ProjectPostStore(second.activeDirectory());
  assert.equal(restored.count(), 1);
  assert.equal(restored.previouslyCollected('run-2', 'facebook', 'post-A'), true);
  restored.close();
  // First device writes, then stale second-device writes must be kept local.
  writeFileSync(join(first.activeDirectory(), 'fixture.json'), JSON.stringify({ prompt: 'new-first' }));
  assert.equal((await first.sync()).backup.status, 'SYNCED');
  writeFileSync(join(second.activeDirectory(), 'fixture.json'), JSON.stringify({ prompt: 'new-second' }));
  assert.equal((await second.sync()).backup.error, 'PROJECT_BACKUP_CONFLICT');
  assert.equal(JSON.parse(readFileSync(join(second.activeDirectory(), 'fixture.json'), 'utf8')).prompt, 'new-second');
  await first.close(); workspaces.splice(workspaces.indexOf(first), 1);
  const reopened = await workspace('first', savedSecrets);
  assert.equal(reopened.state().user.id, registered.user.id);
  assert.equal(reopened.state().activeProjectId, projectId);
  const unrelated = await workspace('unrelated');
  await assert.rejects(unrelated.select({ id: projectId }));
  await assert.rejects(unrelated.login({ username, password: 'wrong' }));
  console.log('PostgreSQL register, backup, restore, dedup, conflict, restart and isolation passed.');
} catch (error) {
  console.error('PROJECT_BACKUP_SMOKE_FAILED', error instanceof assert.AssertionError ? error.message : /^[A-Z_]+$/.test(error.message ?? '') ? error.message : 'UNEXPECTED_ERROR');
  process.exitCode = 1;
} finally {
  await Promise.allSettled(workspaces.map(value => value.close()));
  const ids = [...owners];
  await pool.query('DELETE FROM csd_backup.projects WHERE owner_id=ANY($1::uuid[])', [ids]);
  await pool.query('DELETE FROM csd_backup.sessions WHERE user_id=ANY($1::uuid[])', [ids]);
  await pool.query('DELETE FROM csd_backup.users WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
}
