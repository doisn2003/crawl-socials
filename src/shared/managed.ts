import type { ModelPrice } from '../application/ports/model-gateway.js';

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
  model: string;
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
  topupPriceVnd?: number;
}
export interface StarterOrder {
  id: string; code: string; kind: 'STARTER' | 'TOPUP'; amountVnd: number; bank: string; accountNumber: string;
  accountName: string; expiresAt: string; paid: boolean;
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
