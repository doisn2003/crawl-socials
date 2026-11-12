import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { isManagedModel } from '../shared/managed.js';
import type { BackendConfig } from './config.js';
import { ApiError, tag } from './core.js';
import type { Transaction } from './database.js';
import { MODEL_PROVIDERS, type ModelProvider } from './model-providers.js';

const nonceSize = 12;
const authTagSize = 16;
const context = 'findlink:account-provider-keys:v1';
const cipherKey = (config: BackendConfig) => Buffer.from(hkdfSync('sha256', Buffer.from(config.identityKey, 'hex'), '', context, 32));
const associatedData = (accountId: string, provider: ModelProvider) => Buffer.from(JSON.stringify([accountId, provider]));

export function trialCredential(config: BackendConfig, model: unknown) {
  if (model === 'gemini-3.1-flash-lite') return config.trialGeminiKey;
  if (model === 'deepseek-flash') return config.trialDeepseekKey ?? null;
  return null;
}

export const credentialTag = (config: BackendConfig, key: string) => tag(config.identityKey, 'account-provider-key', key);
export function trialCredentialTags(config: BackendConfig) {
  return [config.trialGeminiKey, config.trialDeepseekKey].flatMap(key => key ? [credentialTag(config, key)] : []);
}

export function encryptCredential(config: BackendConfig, accountId: string, provider: ModelProvider, key: string) {
  const nonce = randomBytes(nonceSize);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(config), nonce);
  cipher.setAAD(associatedData(accountId, provider));
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

export async function requireModelCredential(db: Transaction, config: BackendConfig, accountId: string, funding: 'TRIAL' | 'PAID', model: unknown) {
  if (!isManagedModel(model)) throw new ApiError(503, 'MODEL_NOT_AUTHORIZED');
  if (funding === 'TRIAL') {
    const key = trialCredential(config, model);
    if (!key) throw new ApiError(503, 'MODEL_NOT_AUTHORIZED');
    return key;
  }
  const provider = MODEL_PROVIDERS[model];
  const { rows: [row] } = await db.query<{ encrypted_key: Buffer }>(`SELECT encrypted_key FROM findlink_control.model_credentials
    WHERE account_id=$1 AND provider=$2 AND NOT (key_tag=ANY($3::text[]))`, [accountId, provider, trialCredentialTags(config)]);
  if (!row) throw new ApiError(503, 'MODEL_ACCOUNT_KEY_REQUIRED');
  const value = row.encrypted_key;
  try {
    const decipher = createDecipheriv('aes-256-gcm', cipherKey(config), value.subarray(0, nonceSize));
    decipher.setAAD(associatedData(accountId, provider));
    decipher.setAuthTag(value.subarray(nonceSize, nonceSize + authTagSize));
    return Buffer.concat([decipher.update(value.subarray(nonceSize + authTagSize)), decipher.final()]).toString('utf8');
  } catch {
    throw new ApiError(503, 'MODEL_ACCOUNT_KEY_REQUIRED');
  }
}
