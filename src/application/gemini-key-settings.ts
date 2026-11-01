import type { SecretStore } from './ports/secret-store.js';
import type { GeminiKeyStatus } from '../shared/production-api.js';
const secretId = 'gemini:api-key';
/** Main-process only; renderer receives status, never saved credential text. */
export async function createGeminiKeySettings(store: SecretStore, environment: () => string | null) {
  let saved: string | null = null, readError = false, busy = false;
  try { saved = await store.get(secretId); } catch { readError = true; }
  const current = () => saved ?? environment();
  const status = (): GeminiKeyStatus => ({ source: saved ? 'SAVED' : environment() ? 'ENVIRONMENT' : 'NONE', readError });
  return { current, status,
    async save(input: unknown): Promise<GeminiKeyStatus> {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join() !== 'key') throw Error('GEMINI_KEY_INPUT_INVALID');
      const key = (input as { key: unknown }).key;
      if (typeof key !== 'string' || key.trim().length < 20 || key.trim().length > 512 || /\s/.test(key.trim())) throw Error('GEMINI_KEY_INPUT_INVALID');
      if (busy) throw Error('GEMINI_KEY_BUSY'); busy = true;
      try { await store.set(secretId, key.trim()); saved = key.trim(); readError = false; return status(); }
      catch { throw Error('GEMINI_KEY_SAVE_FAILED'); } finally { busy = false; }
    },
    async remove(): Promise<GeminiKeyStatus> {
      if (busy) throw Error('GEMINI_KEY_BUSY'); busy = true;
      try { await store.delete(secretId); saved = null; readError = false; return status(); }
      catch { throw Error('GEMINI_KEY_DELETE_FAILED'); } finally { busy = false; }
    },
  };
}
