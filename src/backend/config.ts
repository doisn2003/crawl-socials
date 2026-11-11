import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';

export interface BackendConfig {
  databaseUrl: string;
  origin: string;
  host: string;
  port: number;
  leaseKey: KeyObject;
  identityKey: string;
  geminiKey: string | null;
  admin: { token: string; totp: string } | null;
  sepay: { secret: string; bank: string; account: string; name: string } | null;
  trustLocalProxy: boolean;
  production: boolean;
  topupPriceVnd?: number;
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw Error(name + '_REQUIRED');
  return value;
}

export function loopback(host: string) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1', '[::1]', 'localhost'].includes(host);
}

export function backendConfig(env: NodeJS.ProcessEnv): BackendConfig {
  const production = env.NODE_ENV === 'production';
  const endpoint = new URL(env.FINDLINK_PUBLIC_URL || 'http://127.0.0.1:9070');
  if (endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
    || (endpoint.protocol !== 'https:' && (production || endpoint.protocol !== 'http:' || !loopback(endpoint.hostname)))) {
    throw Error('FINDLINK_PUBLIC_URL_INVALID');
  }
  const host = env.FINDLINK_BIND || '127.0.0.1';
  const port = Number(env.FINDLINK_PORT || '9070');
  if (!isIP(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('FINDLINK_BIND_INVALID');
  const encodedKey = env.FINDLINK_LEASE_PRIVATE_KEY;
  if (production && !encodedKey) throw Error('FINDLINK_LEASE_PRIVATE_KEY_REQUIRED');
  const leaseKey = encodedKey ? createPrivateKey(Buffer.from(encodedKey, 'base64')) : generateKeyPairSync('ed25519').privateKey;
  if (leaseKey.asymmetricKeyType !== 'ed25519') throw Error('FINDLINK_LEASE_PRIVATE_KEY_INVALID');
  const identityKey = required(env, 'FINDLINK_IDENTITY_SECRET');
  if (!/^[a-f0-9]{64,128}$/i.test(identityKey)) throw Error('FINDLINK_IDENTITY_SECRET_INVALID');
  const admin = env.FINDLINK_ADMIN_TOKEN || production ? {
    token: required(env, 'FINDLINK_ADMIN_TOKEN').toLowerCase(), totp: required(env, 'FINDLINK_ADMIN_TOTP_SECRET'),
  } : null;
  if (admin && (!/^[a-f0-9]{64}$/.test(admin.token) || !/^[A-Z2-7]{32,128}$/.test(admin.totp))) {
    throw Error('FINDLINK_ADMIN_CONFIG_INVALID');
  }
  const sepay = env.FINDLINK_SEPAY_WEBHOOK_SECRET || production ? {
    secret: required(env, 'FINDLINK_SEPAY_WEBHOOK_SECRET'), bank: required(env, 'FINDLINK_SEPAY_BANK'),
    account: required(env, 'FINDLINK_SEPAY_ACCOUNT'), name: required(env, 'FINDLINK_SEPAY_ACCOUNT_NAME'),
  } : null;
  if (sepay && (sepay.secret.length < 16 || !/^\d{6,30}$/.test(sepay.account) || sepay.bank.length > 40 || sepay.name.length > 100)) {
    throw Error('FINDLINK_SEPAY_CONFIG_INVALID');
  }
  const geminiKey = production ? required(env, 'FINDLINK_GEMINI_API_KEY') : env.FINDLINK_GEMINI_API_KEY?.trim() || null;
  const topupPriceVnd = env.FINDLINK_TOPUP_PRICE_VND ? Number(env.FINDLINK_TOPUP_PRICE_VND) : undefined;
  if (topupPriceVnd !== undefined && (!Number.isSafeInteger(topupPriceVnd) || topupPriceVnd <= 0 || topupPriceVnd > 100_000_000)) throw Error('TOPUP_PRICE_INVALID');
  return { production, databaseUrl: required(env, 'DATABASE_URL'), origin: endpoint.origin, host, port,
    leaseKey, identityKey, geminiKey, admin, sepay, trustLocalProxy: env.FINDLINK_TRUST_LOCAL_PROXY === '1',
    ...(topupPriceVnd === undefined ? {} : { topupPriceVnd }) };
}

export const publicLeaseKey = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
