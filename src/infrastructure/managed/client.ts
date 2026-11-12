import { randomBytes } from 'node:crypto';
import type { SecretStore } from '../../application/ports/secret-store.js';

export interface ManagedRelease {
  origin: string;
  leasePublicKey?: string;
  updateUrl?: string;
  updatePublisher?: string;
  manualUpdate?: true;
  testOnly?: true;
}
export interface ManagedIdentity { id: string; username: string }
interface Tokens { accessToken: string; refreshToken: string; expiresIn: number; deviceId: string }
interface Login extends Tokens, ManagedIdentity {}
interface Saved { user: ManagedIdentity; tokens: Tokens }

export class ManagedHttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const sessionKey = 'findlink-managed-session-v1';
const deviceKeyName = 'findlink-managed-device-v1';
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function managedOrigin(value: string, development = false) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && ['127.0.0.1','[::1]','localhost'].includes(url.hostname)))) {
    throw Error('MANAGED_ORIGIN_INVALID');
  }
  return url.origin;
}

export async function createManagedClient(options: { release: ManagedRelease; secrets: SecretStore; development?: boolean; transport?: typeof fetch }) {
  const origin = managedOrigin(options.release.origin, options.development);
  const transport = options.transport ?? fetch;
  let deviceKey = await options.secrets.get(deviceKeyName);
  if (!hex(deviceKey)) {
    deviceKey = randomBytes(32).toString('hex');
    await options.secrets.set(deviceKeyName, deviceKey);
  }
  let saved: Saved | null = null;
  try {
    const contents = await options.secrets.get(sessionKey);
    const value = contents ? JSON.parse(contents) as Saved : null;
    if (value?.user.id && value.user.username && hex(value.tokens.accessToken) && hex(value.tokens.refreshToken)) saved = value;
  } catch { /* A locally readable project can still open without a cloud session. */ }
  let refreshing: Promise<void> | null = null;

  async function response(path: string, input: { method?: string; json?: unknown; bytes?: Buffer; timeout?: number; signal?: AbortSignal },
    access?: string) {
    if (!path.startsWith('/v1/') || path.startsWith('//')) throw Error('MANAGED_PATH_INVALID');
    const headers: Record<string, string> = { 'X-FindLink-Device': deviceKey! };
    if (access) headers.Authorization = 'Bearer ' + access;
    let body: string | Uint8Array<ArrayBuffer> | undefined;
    if (input.bytes) {
      headers['Content-Type'] = 'application/octet-stream';
      body = new Uint8Array(input.bytes);
    } else if (input.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(input.json);
    }
    const timeout = AbortSignal.timeout(input.timeout ?? 8000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      return await transport(origin + path, { method: input.method ?? 'GET', headers, ...(body === undefined ? {} : { body }),
        signal, redirect: 'error', cache: 'no-store' });
    } catch { throw new ManagedHttpError('BACKEND_UNAVAILABLE', 0); }
  }

  async function checked(res: Response) {
    if (res.ok) return res;
    const value = await res.json().catch(() => null) as { code?: unknown } | null;
    const code = typeof value?.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(value.code) ? value.code : 'BACKEND_UNAVAILABLE';
    throw new ManagedHttpError(code, res.status);
  }

  async function refresh() {
    if (refreshing) return refreshing;
    const prior = saved;
    if (!prior) throw new ManagedHttpError('AUTH_REQUIRED', 401);
    refreshing = (async () => {
      const res = await checked(await response('/v1/auth/refresh', { method: 'POST', json: { refreshToken: prior.tokens.refreshToken } }));
      const tokens = await res.json() as Tokens;
      if (saved !== prior) throw new ManagedHttpError('AUTH_REQUIRED', 401);
      await options.secrets.set(sessionKey, JSON.stringify({ user: prior.user, tokens }));
      saved = { user: prior.user, tokens };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function request(path: string, input: Parameters<typeof response>[1] = {}, authenticated = true) {
    const access = authenticated ? saved?.tokens.accessToken : undefined;
    if (authenticated && !access) throw new ManagedHttpError('AUTH_REQUIRED', 401);
    const res = await response(path, input, access);
    if (res.status !== 401 || !authenticated) return checked(res);
    await res.body?.cancel().catch(() => {});
    if (access === saved?.tokens.accessToken) await refresh();
    return checked(await response(path, input, saved?.tokens.accessToken));
  }

  const json = async <T>(path: string, input: Parameters<typeof response>[1] = {}, authenticated = true) =>
    await (await request(path, input, authenticated)).json() as T;

  return {
    origin, release: options.release, json, request,
    identity: () => saved?.user ?? null,
    deviceId: () => saved?.tokens.deviceId ?? null,
    async login(input: { username: string; password: string; invite?: string }, register: boolean) {
      const result = await json<Login>('/v1/auth/' + (register ? 'register' : 'login'), { method: 'POST', json: input }, false);
      const user = { id: result.id, username: result.username };
      const tokens: Tokens = { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn, deviceId: result.deviceId };
      await options.secrets.set(sessionKey, JSON.stringify({ user, tokens }));
      saved = { user, tokens };
      return user;
    },
    async logout() {
      try { if (saved) await json('/v1/auth/logout', { method: 'POST' }); }
      finally { saved = null; await options.secrets.delete(sessionKey); }
    },
  };
}

export type ManagedClient = Awaited<ReturnType<typeof createManagedClient>>;
