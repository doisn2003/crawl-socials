import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { writeProjectBackup, type ProjectUpload } from '../infrastructure/projects/postgres.js';
import type { CsdProject } from '../shared/projects.js';
import type { Principal } from './auth.js';
import { ApiError, bad, hash, hex, integer, lockAccount, policy, record, string, uuid } from './core.js';
import { transaction, type Transaction } from './database.js';
import { requireAction } from './entitlements.js';

export const MAX_BACKUP_FILE = 128 * 1024 * 1024;
const maxBytesPaid = 5 * 1024 ** 3;
const maxBytesTrial = 512 * 1024 ** 2;
const categories = ['database','assessment','model-evidence','raw','result','recipe','state'];
interface Entry { path: string; category: string; sha256: string; size: number }
type Row = Record<string, any>;

export function backupPath(value: unknown) {
  const path = string(value, 1024);
  const parts = path.split('/');
  if (parts.some(part => !part || part.length > 255 || /[\\:<>|"*?\x00-\x1f]/.test(part) ||
    /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
    /^(?:\.env(?:\.|$)|secrets$|credentials|cookies(?:\.|$)|session-snapshots$|browser-profiles\.json$|csd-project-auth$)/i.test(part))) {
    throw bad('PROJECT_BACKUP_PATH_INVALID');
  }
  return path;
}

function date(value: unknown) {
  const text = string(value, 40);
  const d = new Date(text);
  if (!Number.isFinite(+d) || d.toISOString() !== text) throw bad('PROJECT_BACKUP_DATE_INVALID');
  return text;
}

function project(value: unknown): CsdProject {
  const p = record(value);
  const avatar = p.avatar === null ? null : string(p.avatar, 3_000_000);
  if (avatar && !/^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(avatar)) throw bad('PROJECT_AVATAR_INVALID');
  return { id: uuid(p.id), name: string(p.name, 200), avatar, createdAt: date(p.createdAt), updatedAt: date(p.updatedAt) };
}

function ownedProject(row: Row | undefined, owner: string, revision: number) {
  if (!row || row.owner_id !== owner || row.deleted_at) throw new ApiError(404, 'PROJECT_NOT_FOUND');
  if (Number(row.revision) !== revision) throw new ApiError(409, 'PROJECT_BACKUP_CONFLICT');
}

async function quota(db: Transaction, actor: Principal, metadata: ProjectUpload, manifest: Entry[]) {
  const account = await lockAccount(db, actor.accountId);
  const access = await requireAction(db, actor, await policy(db), 'COLLECT', { lockedAccount: account });
  const projectRows = await db.query(`SELECT id,deleted_at FROM csd_backup.projects WHERE owner_id=$1 AND deleted_at IS NULL`,
    [actor.accountId]);
  const maxProjects = access.funding === 'TRIAL' ? 1 : 5;
  if (!metadata.deletedAt && !projectRows.rows.some(row => row.id === metadata.project.id) && projectRows.rowCount! >= maxProjects) {
    throw new ApiError(403, 'PROJECT_LIMIT_REACHED');
  }
  const { rows } = await db.query(`SELECT coalesce(sum(octet_length(f.content)),0)::text AS bytes
    FROM csd_backup.project_files f JOIN csd_backup.projects p ON p.id=f.project_id
    WHERE p.owner_id=$1 AND p.id<>$2`, [actor.accountId, metadata.project.id]);
  const size = manifest.reduce((total, entry) => total + entry.size, 0);
  if (BigInt(rows[0].bytes) + BigInt(size) > BigInt(access.funding === 'TRIAL' ? maxBytesTrial : maxBytesPaid)) {
    throw new ApiError(413, 'PROJECT_BACKUP_QUOTA');
  }
}

export function createBackup(pool: Pool) {
  async function list(actor: Principal) {
    const { rows } = await pool.query('SELECT * FROM csd_backup.projects WHERE owner_id=$1 ORDER BY created_at,id', [actor.accountId]);
    return rows.map(row => ({ id: row.id, name: row.name, avatar: row.avatar, createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(), ownerId: row.owner_id, revision: Number(row.revision), fingerprint: row.fingerprint,
      sourceDirectory: row.source_directory, deletedAt: row.deleted_at?.toISOString() ?? null }));
  }

  async function manifest(actor: Principal, id: string, revision: number) {
    return transaction(pool, async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const p = (await db.query('SELECT owner_id,deleted_at,revision FROM csd_backup.projects WHERE id=$1', [id])).rows[0];
      ownedProject(p, actor.accountId, revision);
      return (await db.query(`SELECT path,category,sha256,octet_length(content) AS size
        FROM csd_backup.project_files WHERE project_id=$1 ORDER BY path`, [id])).rows as Entry[];
    });
  }

  async function file(actor: Principal, id: string, revision: number, path: string) {
    return transaction(pool, async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const p = (await db.query('SELECT owner_id,deleted_at,revision FROM csd_backup.projects WHERE id=$1', [id])).rows[0];
      ownedProject(p, actor.accountId, revision);
      const f = (await db.query('SELECT content FROM csd_backup.project_files WHERE project_id=$1 AND path=$2', [id, path])).rows[0];
      if (!f) throw new ApiError(404, 'PROJECT_FILE_NOT_FOUND');
      return f.content as Buffer;
    });
  }

  async function start(actor: Principal, value: unknown) {
    const request = record(value), p = project(request.project);
    const revision = integer(request.revision, 0, Number.MAX_SAFE_INTEGER - 1);
    const deletedAt = request.deletedAt === null ? null : date(request.deletedAt);
    const sourceDirectory = string(request.sourceDirectory, 2048);
    if (!Array.isArray(request.files) || request.files.length > 15_000) throw bad('PROJECT_BACKUP_MANIFEST_INVALID');
    const files = request.files.map((value): Entry => {
      const f = record(value), category = string(f.category, 30);
      if (!categories.includes(category)) throw bad('PROJECT_BACKUP_MANIFEST_INVALID');
      return { path: backupPath(f.path), category, sha256: hex(f.sha256), size: integer(f.size, 0, MAX_BACKUP_FILE) };
    }).sort((a, b) => a.path.localeCompare(b.path));
    if (new Set(files.map(f => f.path.toLowerCase())).size !== files.length) throw bad('PROJECT_BACKUP_MANIFEST_INVALID');
    const fingerprint = hash(JSON.stringify({ name: p.name, avatar: p.avatar, deletedAt, files: files.map(f => [f.path,f.sha256]) }));
    if (fingerprint !== request.fingerprint) throw bad('PROJECT_BACKUP_HASH_INVALID');
    const metadata = { ownerId: actor.accountId, deviceId: actor.deviceId, project: p, revision, fingerprint, sourceDirectory, deletedAt };

    return transaction(pool, async db => {
      await quota(db, actor, metadata, files);
      const existing = (await db.query('SELECT owner_id,revision,fingerprint FROM csd_backup.projects WHERE id=$1', [p.id])).rows[0];
      if (existing && existing.owner_id !== actor.accountId) throw new ApiError(403, 'PROJECT_ACCESS_DENIED');
      if (existing && existing.fingerprint === fingerprint) return { revision: Number(existing.revision), stage: null, missing: [] };
      if (Number(existing?.revision ?? 0) !== revision) throw new ApiError(409, 'PROJECT_BACKUP_CONFLICT');
      const old = (await db.query('SELECT id,metadata,fingerprint,project_id FROM findlink_control.backup_stages WHERE account_id=$1 AND expires_at>now()',
        [actor.accountId])).rows[0];
      const same = old && old.project_id === p.id && old.fingerprint === fingerprint && old.metadata.revision === revision
        && old.metadata.deviceId === actor.deviceId;
      const stage = same ? old.id as string : randomUUID();
      if (!same) {
        await db.query('DELETE FROM findlink_control.backup_stages WHERE account_id=$1', [actor.accountId]);
        await db.query(`INSERT INTO findlink_control.backup_stages(id,account_id,project_id,fingerprint,metadata,manifest)
          VALUES($1,$2,$3,$4,$5,$6)`, [stage, actor.accountId, p.id, fingerprint, JSON.stringify(metadata), JSON.stringify(files)]);
      }
      const known = (await db.query('SELECT path,sha256 FROM csd_backup.project_files WHERE project_id=$1', [p.id])).rows;
      const hashes = new Map(known.map(row => [row.path, row.sha256]));
      const staged = new Set((await db.query('SELECT path FROM findlink_control.backup_stage_files WHERE stage_id=$1', [stage])).rows.map(row => row.path));
      return { revision: null, stage, missing: files.filter(f => hashes.get(f.path) !== f.sha256 && !staged.has(f.path)).map(f => f.path) };
    });
  }

  async function getStage(db: Transaction, actor: Principal, id: string) {
    const stage = (await db.query(`SELECT * FROM findlink_control.backup_stages WHERE id=$1 AND account_id=$2 AND expires_at>now() FOR UPDATE`,
      [id, actor.accountId])).rows[0];
    if (!stage || stage.metadata.deviceId !== actor.deviceId) throw new ApiError(404, 'PROJECT_BACKUP_STAGE_EXPIRED');
    return stage;
  }

  async function write(actor: Principal, id: string, path: string, bytes: Buffer) {
    return transaction(pool, async db => {
      const account = await lockAccount(db, actor.accountId);
      await requireAction(db, actor, await policy(db), 'COLLECT', { lockedAccount: account });
      const stage = await getStage(db, actor, id);
      const f = (stage.manifest as Entry[]).find(entry => entry.path === path);
      if (!f || f.size !== bytes.length || hash(bytes) !== f.sha256) throw bad('PROJECT_BACKUP_HASH_INVALID');
      await db.query(`INSERT INTO findlink_control.backup_stage_files(stage_id,path,content) VALUES($1,$2,$3)
        ON CONFLICT(stage_id,path) DO NOTHING`, [id, path, bytes]);
    });
  }

  async function commit(actor: Principal, id: string) {
    return transaction(pool, async db => {
      // All paths that mutate stages take the account lock first.
      await lockAccount(db, actor.accountId);
      const stage = await getStage(db, actor, id);
      const metadata = stage.metadata as ProjectUpload, files = stage.manifest as Entry[];
      await quota(db, actor, metadata, files);
      const revision = await writeProjectBackup(db, metadata, files, async entry => {
        const blob = (await db.query('SELECT content FROM findlink_control.backup_stage_files WHERE stage_id=$1 AND path=$2',
          [id, entry.path])).rows[0]?.content as Buffer | undefined;
        if (!blob || hash(blob) !== entry.sha256) throw new ApiError(409, 'PROJECT_BACKUP_STAGE_INCOMPLETE');
        return blob;
      });
      await db.query('DELETE FROM findlink_control.backup_stages WHERE id=$1', [id]);
      return { revision };
    });
  }

  return {
    list, manifest, file, start, write, commit,
    async claim(actor: Principal, value: unknown) {
      const body = record(value), guest = uuid(body.guestId), proof = hash(hex(body.secret));
      return transaction(pool, async db => {
        await lockAccount(db, actor.accountId);
        await db.query(`UPDATE csd_backup.projects SET owner_id=$1 WHERE owner_id=$2
          AND EXISTS(SELECT 1 FROM csd_backup.users WHERE id=$2 AND username IS NULL AND guest_secret_hash=$3)`,
          [actor.accountId, guest, proof]);
      });
    },
  };
}
