import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { STARTER_OFFER, TRIAL_OFFER } from '../shared/managed.js';
import type { Transaction } from './database.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const bad = (code = 'INPUT_INVALID') => new ApiError(400, code);
export const token = () => randomBytes(32).toString('hex');
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const tag = (secret: string, kind: string, value: string) =>
  createHmac('sha256', secret).update(kind).update('\0').update(value).digest('hex');
export const safeEqual = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  return value as Record<string, unknown>;
};
export function string(value: unknown, maximum: number, minimum = 1) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) throw bad();
  return value;
}
export function integer(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw bad();
  return value;
}
export function uuid(value: unknown) {
  const text = string(value, 36, 36).toLowerCase();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(text)) throw bad();
  return text;
}
export function hex(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw bad();
  return value;
}
export function email(value: unknown) {
  const text = string(value, 254).trim().normalize('NFC').toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(text)) throw bad('EMAIL_INVALID');
  return text;
}
export function runId(value: unknown) {
  const text = string(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw bad('RUN_ID_INVALID');
  return text;
}
export function micros(value: unknown, maximum = 10_000_000_000_000_000n) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,16})$/.test(value) || BigInt(value) > maximum) throw bad();
  return BigInt(value);
}
export const microsForUsd = (value: number) => BigInt(Math.ceil(value * 1_000_000_000));
export const TRIAL_CREDITS = BigInt(TRIAL_OFFER.credits) * 1_000_000n;
export const STARTER_CREDITS = BigInt(STARTER_OFFER.credits) * 1_000_000n;
export const TRIAL_RAW_LIMIT = TRIAL_OFFER.rawLimit;

export async function rateLimit(pool: Pool, key: string, max: number, seconds: number) {
  const { rows } = await pool.query(`INSERT INTO findlink_control.rate_buckets(bucket,hits,expires_at)
    VALUES($1,1,now()+make_interval(secs=>$2)) ON CONFLICT(bucket) DO UPDATE
    SET hits=CASE WHEN rate_buckets.expires_at<=now() THEN 1 ELSE least(rate_buckets.hits+1,1000000) END,
    expires_at=CASE WHEN rate_buckets.expires_at<=now() THEN excluded.expires_at ELSE rate_buckets.expires_at END
    RETURNING hits`, [key, seconds]);
  if (Number(rows[0]?.hits) > max) throw new ApiError(429, 'RATE_LIMITED');
}
export async function audit(db: Transaction, actor: string, action: string, target: string, details: object = {}) {
  await db.query('INSERT INTO findlink_control.audit(actor,action,target,details) VALUES($1,$2,$3,$4)',
    [actor, action, target, JSON.stringify(details)]);
}
export async function lockAccount(db: Transaction, id: string) {
  const { rows } = await db.query('SELECT * FROM findlink_control.accounts WHERE id=$1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ApiError(401, 'AUTH_REQUIRED');
  return rows[0];
}
export async function policy(db: Transaction, lock = false) {
  const { rows } = await db.query(`SELECT p.*,t.model AS route_model FROM findlink_control.policy p
    JOIN findlink_control.tariff_versions t ON t.id=p.route_id WHERE p.id=true` + (lock ? ' FOR UPDATE OF p' : ''));
  return rows[0]!;
}
