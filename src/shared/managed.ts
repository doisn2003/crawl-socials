import type { ModelPrice } from '../application/ports/model-gateway.js';

export const CREDITS_PER_USD = 1000;
export const STARTER_OFFER = { priceVnd: 23_000_000, credits: 50_000 } as const;
export const TRIAL_OFFER = { credits: 100, days: 14, rawLimit: 1000 } as const;
export const TOPUP_CREDITS = 10_000;
export const MANAGED_MODELS = ['gemini-3.1-flash-lite', 'deepseek-flash'] as const;
export type ManagedModel = typeof MANAGED_MODELS[number];
export const isManagedModel = (value: unknown): value is ManagedModel => MANAGED_MODELS.some(model => model === value);

export type ManagedScope = 'PLAN' | 'COLLECT' | 'COLLECT_AI' | 'ASSESS';

export interface ManagedLease {
  id: string;
  accountId: string;
  deviceId: string;
  epoch: number;
  runId: string;
  projectId: string;
  scope: ManagedScope;
  issuedAt: number;
  expiresAt: number;
  model: ManagedModel;
  route: number;
  price: ModelPrice;
  rawRemaining: number | null;
}
export interface SignedLease { lease: ManagedLease; signature: string }
export interface ManagedStatus {
  state: 'GUEST' | 'INACTIVE' | 'TRIAL' | 'STARTER' | 'UNAVAILABLE';
  reason: string | null;
  available: string;
  held: string;
  spent: string;
  until: string | null;
  rawRemaining: number | null;
  verified: boolean;
  updateReady?: boolean;
  preview?: true;
  checkoutAvailable?: boolean;
  topupPriceVnd?: number;
}
export interface StarterOrder {
  id: string; code: string; kind: 'STARTER' | 'TOPUP'; amountVnd: number; bank: string; accountNumber: string;
  accountName: string; expiresAt: string; paid: boolean;
  test?: true;
  startsAt?: string;
  endsAt?: string;
}
export interface CreditEntry {
  id: string;
  action: 'GRANT' | 'HOLD' | 'CHARGE' | 'RELEASE' | 'REFUND' | 'REVOKE';
  amount: string;
  at: string;
}
export interface ManagedApi {
  status(): Promise<ManagedStatus | null>;
  activateTrial(): Promise<ManagedStatus>;
  buyStarter(): Promise<StarterOrder>;
  buyCredits(): Promise<StarterOrder>;
  orderStatus(input: { id: string }): Promise<StarterOrder>;
  wallet(): Promise<ManagedStatus & { ledger: CreditEntry[] }>;
  recover(input: { code: string; password: string }): Promise<void>;
  installUpdate(): Promise<void>;
}
