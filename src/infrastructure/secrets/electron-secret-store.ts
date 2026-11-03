import { safeStorage } from 'electron';
import { createEncryptedSecretStore } from './encrypted-secret-store.js';
export function createElectronSecretStore(directory: string) {
  return createEncryptedSecretStore(directory, {
    // This release targets Windows; never silently fall back to basic_text/plaintext.
    available: async () => process.platform === 'win32' && await safeStorage.isAsyncEncryptionAvailable(),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: value => safeStorage.decryptStringAsync(value),
  });
}
