import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import type { CsdProject } from '../../shared/projects.js';
import { PROJECT_SCHEMA_SQL } from './schema.js';
import { sha256, type BackupFile } from './snapshot.js';

export interface RemoteProject extends CsdProject {
  ownerId: string; revision: number; fingerprint: string; sourceDirectory: string; deletedAt: string | null;
}
export interface ProjectBackupStore {
  ensureGuest(id: string, secret: string): Promise<void>;
  authenticate(input: { username: string; password: string; invite?: string }, register: boolean): Promise<{ id: string; username: string; token: string }>;
  session(token: string): Promise<{ id: string; username: string } | null>;
  revoke(token: string): Promise<void>;
  claim(guestId: string, secret: string, userId: string): Promise<void>;
  list(ownerId: string): Promise<RemoteProject[]>;
  files(ownerId: string, id: string, revision: number): Promise<BackupFile[]>;
  upload(input: { ownerId: string; deviceId: string; project: CsdProject; revision: number; fingerprint: string; sourceDirectory: string; deletedAt: string | null; files: BackupFile[] }): Promise<number>;
  close(): Promise<void>;
}

export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordMatches(password: string, encoded: string): boolean {
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}

export function createPostgresBackup(databaseUrl: string): ProjectBackupStore {
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000 });
  // Network and connection-string failures are translated by the workspace boundary.
  pool.on('error', () => {});
  let migration: Promise<void> | null = null;
  async function migrate(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('csd_backup_schema',0))");
      await client.query(PROJECT_SCHEMA_SQL);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  const ready = () => migration ??= migrate().catch(error => { migration = null; throw error; });
  async function sessionFor(user: { id: string; username: string }) {
    const token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO csd_backup.sessions(token_hash,user_id) VALUES($1,$2)', [sha256(token), user.id]);
    return { ...user, token };
  }
  return {
    async ensureGuest(id, secret) {
      await ready();
      await pool.query('INSERT INTO csd_backup.users(id, guest_secret_hash) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [id, sha256(secret)]);
      const result = await pool.query('SELECT id FROM csd_backup.users WHERE id=$1 AND guest_secret_hash=$2', [id, sha256(secret)]);
      if (result.rowCount !== 1) throw Error('PROJECT_AUTH_FAILED');
    },
    async authenticate(input, register) {
      await ready();
      const username = input.username.trim().normalize('NFC').toLowerCase();
      if (!username || username.length > 200 || !input.password || input.password.length > 1024) throw Error('PROJECT_AUTH_INPUT_INVALID');
      if (register) {
        try {
          const user = { id: randomUUID(), username };
          await pool.query('INSERT INTO csd_backup.users(id,username,password_hash) VALUES($1,$2,$3)', [user.id, username, passwordHash(input.password)]);
          return sessionFor(user);
        } catch (error) { if ((error as { code?: string }).code === '23505') throw Error('PROJECT_USERNAME_EXISTS'); throw error; }
      }
      const result = await pool.query('SELECT id,username,password_hash FROM csd_backup.users WHERE username=$1', [username]);
      const row = result.rows[0] as { id: string; username: string; password_hash: string } | undefined;
      // Equalize the costly hash path for absent users.
      if (!row) { passwordHash(input.password); throw Error('PROJECT_AUTH_FAILED'); }
      if (!passwordMatches(input.password, row.password_hash)) throw Error('PROJECT_AUTH_FAILED');
      return sessionFor({ id: row.id, username: row.username });
    },
    async session(token) {
      await ready();
      const result = await pool.query(`SELECT u.id,u.username FROM csd_backup.sessions s JOIN csd_backup.users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha256(token)]);
      return result.rows[0] ?? null;
    },
    async revoke(token) { await ready(); await pool.query('DELETE FROM csd_backup.sessions WHERE token_hash=$1', [sha256(token)]); },
    async claim(guestId, secret, userId) {
      await ready();
      await pool.query(`UPDATE csd_backup.projects SET owner_id=$1 WHERE owner_id=$2
        AND EXISTS(SELECT 1 FROM csd_backup.users WHERE id=$2 AND guest_secret_hash=$3)`, [userId, guestId, sha256(secret)]);
    },
    async list(ownerId) {
      await ready();
      const rows = await pool.query('SELECT * FROM csd_backup.projects WHERE owner_id=$1 ORDER BY created_at,id', [ownerId]);
      return rows.rows.map(row => ({ id: row.id, name: row.name, avatar: row.avatar, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
        ownerId: row.owner_id, revision: Number(row.revision), fingerprint: row.fingerprint, sourceDirectory: row.source_directory, deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null }));
    },
    async files(ownerId, id, revision) {
      await ready();
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const project = await client.query('SELECT revision FROM csd_backup.projects WHERE owner_id=$1 AND id=$2', [ownerId,id]);
        if (!project.rows[0] || Number(project.rows[0].revision) !== revision) throw Error('PROJECT_BACKUP_CONFLICT');
        const rows = await client.query('SELECT path,category,sha256,content FROM csd_backup.project_files WHERE project_id=$1', [id]);
        await client.query('COMMIT');
        return rows.rows as BackupFile[];
      } catch(error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    async upload(input) {
      await ready();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const contents = new Map(input.files.map(file => [file.path, file.content]));
        const revision = await writeProjectBackup(client, input, input.files, async file => contents.get(file.path)!);
        await client.query('COMMIT');
        return revision;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}

export type ProjectUpload = Omit<Parameters<ProjectBackupStore['upload']>[0], 'files'>;
export type BackupManifestEntry = Omit<BackupFile, 'content'>;

/** Apply a revision with the caller's transaction. Only changed blobs are read. */
export async function writeProjectBackup(client: PoolClient, input: ProjectUpload, files: BackupManifestEntry[],
  readContent: (file: BackupManifestEntry) => Promise<Buffer>) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.project.id]);
  const existing = await client.query('SELECT owner_id,revision,fingerprint FROM csd_backup.projects WHERE id=$1 FOR UPDATE', [input.project.id]);
  const row = existing.rows[0];
  if (row && row.owner_id !== input.ownerId) throw Error('PROJECT_ACCESS_DENIED');
  if (row && Number(row.revision) !== input.revision) {
    if (row.fingerprint === input.fingerprint) { return Number(row.revision); }
    throw Error('PROJECT_BACKUP_CONFLICT');
  }
  if (!row && input.revision !== 0) throw Error('PROJECT_BACKUP_CONFLICT');
  const revision = input.revision + 1;
  await client.query(`INSERT INTO csd_backup.projects(id,owner_id,name,avatar,created_at,updated_at,deleted_at,revision,fingerprint,source_directory,device_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
      revision=excluded.revision,fingerprint=excluded.fingerprint,source_directory=excluded.source_directory,device_id=excluded.device_id,backed_up_at=now()`,
    [input.project.id,input.ownerId,input.project.name,input.project.avatar,input.project.createdAt,input.project.updatedAt,input.deletedAt,revision,input.fingerprint,input.sourceDirectory,input.deviceId]);
  const manifest = await client.query('SELECT path,sha256 FROM csd_backup.project_files WHERE project_id=$1', [input.project.id]);
  const hashes = new Map(manifest.rows.map(row => [String(row.path), String(row.sha256)]));
  const changedFiles = files.filter(file => hashes.get(file.path) !== file.sha256);
  const paths = files.map(file => file.path);
  await client.query('DELETE FROM csd_backup.project_files WHERE project_id=$1 AND NOT(path=ANY($2::text[]))', [input.project.id, paths]);
  await client.query('DELETE FROM csd_backup.project_records WHERE project_id=$1 AND NOT(record_key=ANY($2::text[]))', [input.project.id, paths]);
  for (const file of changedFiles) {
    const content = await readContent(file);
    await client.query(`INSERT INTO csd_backup.project_files(project_id,path,category,sha256,content) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(project_id,path) DO UPDATE SET category=excluded.category,sha256=excluded.sha256,content=excluded.content,updated_at=now()
      WHERE csd_backup.project_files.sha256<>excluded.sha256`, [input.project.id,file.path,file.category,file.sha256,content]);
    if (file.path.endsWith('.json')) {
      let payload: unknown;
      try { payload = JSON.parse(content.toString('utf8')); } catch { continue; }
      await client.query(`INSERT INTO csd_backup.project_records(project_id,kind,record_key,payload) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(project_id,kind,record_key) DO UPDATE SET payload=excluded.payload`, [input.project.id,file.category,file.path,JSON.stringify(payload)]);
    }
  }
  const canonical = changedFiles.find(file => file.path === 'project-posts.sqlite');
  if (canonical) {
    const temporary = join(tmpdir(), 'csd-posts-' + randomUUID() + '.sqlite');
    writeFileSync(temporary, await readContent(canonical), { mode: 0o600 });
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(temporary, { readOnly: true, allowExtension: false });
      database.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
      await client.query('DELETE FROM csd_backup.project_posts WHERE project_id=$1', [input.project.id]);
      const posts = database.prepare('SELECT * FROM posts').all().map(post => ({ ...post, payload: JSON.parse(String(post.payload)), assessment: post.assessment ? JSON.parse(String(post.assessment)) : null }));
      await client.query(`INSERT INTO csd_backup.project_posts(project_id,platform,root_id,first_run_id,first_seen_at,last_seen_at,payload,assessment)
        SELECT $1,platform,root_id,first_run_id,first_seen_at,last_seen_at,payload,assessment
        FROM jsonb_to_recordset($2::jsonb) AS p(platform text,root_id text,first_run_id text,first_seen_at timestamptz,last_seen_at timestamptz,payload jsonb,assessment jsonb)`, [input.project.id, JSON.stringify(posts)]);
      const memberships = database.prepare('SELECT * FROM run_posts').all().map(row => ({ ...row, previously_collected: row.previously_collected === 1 }));
      await client.query(`INSERT INTO csd_backup.project_run_posts(project_id,run_id,platform,root_id,previously_collected)
        SELECT $1,run_id,platform,root_id,previously_collected
        FROM jsonb_to_recordset($2::jsonb) AS r(run_id text,platform text,root_id text,previously_collected boolean)`, [input.project.id, JSON.stringify(memberships)]);
    } finally { database?.close(); rmSync(temporary, { force: true }); }
  }
  return revision;
}
