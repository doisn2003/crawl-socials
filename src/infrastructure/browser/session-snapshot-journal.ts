import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isBrowserProfileId } from '../../domain/browser-profile.js';
// Contains flags only, never cookie values. Durable invalidation precedes async encryption.
export function createSessionSnapshotJournal(directory: string) {
  const file = (id: string, suffix: string) => {
    if (!isBrowserProfileId(id)) throw new Error('PROFILE_INPUT_INVALID');
    return join(directory, id + '.' + suffix);
  };
  function mark(id: string, suffix: string) {
    const target = file(id, suffix);
    if (existsSync(target)) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(target, '1', { flag: 'wx', mode: 0o600, flush: true });
  }
  function clear(id: string, suffix: string) {
    try { unlinkSync(file(id, suffix)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return {
    dirty: (id: string) => existsSync(file(id, 'dirty')),
    markDirty: (id: string) => mark(id, 'dirty'),
    clearDirty: (id: string) => clear(id, 'dirty'),
    recoveryRequired: (id: string) => existsSync(file(id, 'restoring')),
    beginRestore: (id: string) => mark(id, 'restoring'),
    finishRestore: (id: string) => clear(id, 'restoring'),
  };
}
