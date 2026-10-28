import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isBrowserProfileId, profileLabel } from '../../domain/browser-profile.js';
import type { BrowserProfile } from '../../domain/browser-profile.js';
import type { BrowserProfiles } from '../../application/ports/browser-profiles.js';

export function createBrowserProfiles(directory: string): BrowserProfiles {
  const file = join(directory, 'browser-profiles.json');
  let tail = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work); tail = result.then(() => {}, () => {}); return result;
  };
  async function read(): Promise<BrowserProfile[]> {
    try {
      const bytes = await readFile(file);
      if (bytes.length > 128 * 1024) throw new Error();
      const data = JSON.parse(bytes.toString('utf8'));
      if (data?.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 50) throw new Error();
      const ids = new Set<string>();
      for (const item of data.profiles) {
        if (!item || !isBrowserProfileId(item.id) || ids.has(item.id) || profileLabel(item.label) !== item.label ||
          typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) ||
          item.accountBinding?.status !== 'UNVERIFIED' || item.accountBinding.accountId !== null || item.accountBinding.revision !== 0 ||
          Object.keys(item).sort().join() !== 'accountBinding,createdAt,id,label' ||
          Object.keys(item.accountBinding).sort().join() !== 'accountId,revision,status') throw new Error();
        ids.add(item.id);
      }
      return data.profiles as BrowserProfile[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('PROFILE_STORE_INVALID');
    }
  }
  return {
    list: () => serial(read),
    get: id => serial(async () => {
      if (!isBrowserProfileId(id)) throw new Error('PROFILE_INPUT_INVALID');
      const profile = (await read()).find(item => item.id === id);
      if (!profile) throw new Error('PROFILE_NOT_FOUND');
      return profile;
    }),
    create: label => serial(async () => {
      label = profileLabel(label);
      const profiles = await read();
      if (profiles.length >= 50) throw new Error('PROFILE_LIMIT_REACHED');
      const item: BrowserProfile = { id: 'csd-' + randomUUID(), label, createdAt: new Date().toISOString(),
        accountBinding: { status: 'UNVERIFIED', accountId: null, revision: 0 } };
      profiles.push(item);
      await mkdir(directory, { recursive: true });
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, profiles }), { mode: 0o600, flag: 'wx', flush: true });
        await rename(temporary, file);
      } catch { throw new Error('PROFILE_SAVE_FAILED'); }
      finally { await unlink(temporary).catch(() => {}); }
      return structuredClone(item);
    }),
  };
}
