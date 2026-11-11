import type { ProjectBackupStore, RemoteProject } from '../projects/postgres.js';
import { readSnapshotFile, sha256 } from '../projects/snapshot.js';
import { ManagedHttpError, type ManagedClient } from './client.js';

interface Entry { path: string; category: string; sha256: string; size: number }

export function createHttpBackupStore(client: ManagedClient): ProjectBackupStore {
  function owner(id: string) {
    if (client.identity()?.id !== id) throw Error('PROJECT_AUTH_EXPIRED');
  }
  async function call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof ManagedHttpError) {
        if (error.code.startsWith('PROJECT_')) throw Error(error.code);
        if (error.code === 'INVITE_INVALID' || error.code === 'INVITE_REQUIRED') throw Error('PROJECT_INVITE_REQUIRED');
        if (error.code === 'DEVICE_LIMIT_REACHED' || error.code === 'DEVICE_REVOKED') throw Error('PROJECT_' + error.code);
        if (error.status === 401) throw Error('PROJECT_AUTH_EXPIRED');
        if (/^(TRIAL_|ENTITLEMENT_|SUBSCRIPTION_REQUIRED)/.test(error.code)) throw Error('PROJECT_BACKUP_READ_ONLY');
      }
      throw error;
    }
  }

  return {
    async ensureGuest() { /* Commercial guests keep projects on their device. */ },
    async authenticate(input, register) {
      return call(async () => {
        const user = await client.login(input, register);
        return { ...user, token: user.id };
      });
    },
    async session() {
      if (!client.identity()) return null;
      return call(() => client.json('/v1/auth/session'));
    },
    async revoke() { await client.logout(); },
    async claim(guestId, secret, userId) {
      owner(userId);
      await call(() => client.json('/v1/projects/claim', { method: 'POST', json: { guestId, secret } }));
    },
    async list(ownerId) {
      owner(ownerId);
      return call(() => client.json<RemoteProject[]>('/v1/projects'));
    },
    async *files(ownerId, id, revision) {
      owner(ownerId);
      const root = '/v1/projects/' + id;
      const files = await call(() => client.json<Entry[]>(root + '/manifest?revision=' + revision));
      for (const file of files) {
        const res = await call(() => client.request(root + '/file?revision=' + revision + '&path=' + encodeURIComponent(file.path), { timeout: 120_000 }));
        const content = Buffer.from(await res.arrayBuffer());
        if (content.length !== file.size || sha256(content) !== file.sha256) throw Error('PROJECT_BACKUP_CORRUPT');
        yield { path: file.path, category: file.category, sha256: file.sha256, content };
      }
    },
    async upload({ ownerId, deviceId: _device, ...metadata }, snapshot, signal) {
      owner(ownerId);
      return call(async () => {
        const cancel = signal ? { signal } : {};
        const plan = await client.json<{ revision: number | null; stage: string | null; missing: string[] }>('/v1/projects/backups', {
          method: 'POST', timeout: 30_000, json: { ...metadata, files: snapshot.files }, ...cancel,
        });
        if (plan.revision !== null) return plan.revision;
        if (!plan.stage) throw Error('PROJECT_BACKUP_STAGE_INCOMPLETE');
        const paths = new Map(snapshot.files.map(f => [f.path,f]));
        const root = '/v1/projects/backups/' + plan.stage;
        for (const path of plan.missing) {
          const entry = paths.get(path);
          if (!entry) throw Error('PROJECT_BACKUP_STAGE_INCOMPLETE');
          const content = await readSnapshotFile(snapshot, entry, signal);
          await client.json(root + '/file?path=' + encodeURIComponent(path), { method: 'PUT', bytes: content, timeout: 120_000, ...cancel });
        }
        const result = await client.json<{ revision: number }>(root + '/commit', { method: 'POST', timeout: 120_000, ...cancel });
        return result.revision;
      });
    },
    async close() {},
  };
}
