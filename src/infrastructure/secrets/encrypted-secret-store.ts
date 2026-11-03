import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretStore } from '../../application/ports/secret-store.js';
export interface SecretCipher {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
export function createEncryptedSecretStore(directory: string, cipher: SecretCipher): SecretStore {
  let tail = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work); tail = result.then(() => {}, () => {}); return result;
  };
  const fileFor = (key: string) => {
    if (!/^[a-z][a-z0-9:_-]{0,160}$/.test(key)) throw new Error('SECRET_KEY_INVALID');
    return join(directory, createHash('sha256').update(key).digest('hex') + '.bin');
  };
  async function requireCipher() {
    try { if (await cipher.available()) return; } catch { /* No plaintext fallback on OS/backend failure. */ }
    throw new Error('SECRET_PROTECTION_UNAVAILABLE');
  }
  async function save(file: string, value: string) {
    if (Buffer.byteLength(value) > 2 * 1024 * 1024) throw new Error('SECRET_TOO_LARGE');
    const encrypted = await cipher.encrypt(value);
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error();
    await mkdir(directory, { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600, flush: true });
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  return {
    get: key => serial(async () => {
      const file = fileFor(key); await requireCipher();
      let encrypted;
      try { encrypted = await readFile(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new Error('SECRET_READ_FAILED');
      }
      try {
        if (encrypted.length > 3 * 1024 * 1024) throw new Error();
        const decoded = await cipher.decrypt(encrypted);
        if (decoded.shouldReEncrypt) await save(file, decoded.result);
        return decoded.result;
      } catch { throw new Error('SECRET_READ_FAILED'); }
    }),
    set: (key, value) => serial(async () => {
      const file = fileFor(key); await requireCipher();
      try { await save(file, value); } catch { throw new Error('SECRET_WRITE_FAILED'); }
    }),
    delete: key => serial(async () => {
      const file = fileFor(key); await requireCipher();
      try { await unlink(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('SECRET_DELETE_FAILED'); }
    }),
  };
}
