export interface CampaignSummary {
  name: string;
  keywords: string[];
  preferredPlaces: string[];
  sources: { type: 'PAGE' | 'PUBLIC_GROUP' | 'PUBLIC_PERSONAL'; minimum: number | null }[];
  target: number;
  maxHours: number;
  historicalPostsAllowed: boolean;
  expansionAllowed: boolean;
}
export interface AppInfo {
  product: 'FindLink';
  fullName: 'FindLink';
  version: string;
  mode: 'OFFLINE_BOOTSTRAP';
  campaign: CampaignSummary;
  benchmarkReady: false;
}
export interface OfflineCheckResult {
  captureMode: 'FIXTURE';
  configurationValid: true;
  benchmarkEligible: false;
  verifiedValidUniquePosts: 0;
}
export interface DesktopApi {
  getInfo(): Promise<AppInfo>;
  runOfflineCheck(): Promise<OfflineCheckResult>;
  probe: {
    config(): Promise<ProbeConfiguration>;
    start(input: { profileId: string }): Promise<ProbeViewStatus>;
    stop(): Promise<ProbeViewStatus>;
    status(): Promise<ProbeViewStatus>;
  };
  profiles: {
    list(): Promise<{ manualLoginEnabled: boolean; profiles: ProfileSummary[] }>;
    create(input: { label: string; platform?: 'facebook' | 'threads' }): Promise<void>;
    open(input: { profileId: string }): Promise<void>;
    close(input: { profileId: string }): Promise<void>;
    openLogin(input: { profileId: string }): Promise<void>;
  };
}
export interface ProfileSummary {
  platform?: 'facebook' | 'threads';
  id: string; label: string; createdAt: string;
  accountBinding: { status: 'UNVERIFIED'; accountId: null; revision: 0 };
  open: boolean; persistenceError: string | null;
}
export interface ProbeConfiguration {
  available: boolean; captureMode: 'FIXTURE' | null; liveAvailable: false;
  facebookDriver: 'NOT_IMPLEMENTED'; parser: 'NOT_IMPLEMENTED'; queries: string[];
  limits: { wallMs: number; actions: number; batchesPerQuery: number; candidates: number; storageBytes: number;
    operatorMs: number; retriesPerBatch: number; noProgressBatches: number; segmentMs: number; diagnosticRecords: number };
  resume: 'UNSUPPORTED_NEW_ID_REQUIRED';
}
export interface ProbeViewStatus {
  state: 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED'; runId: string | null;
  captureMode: 'FIXTURE' | null; startedAt: string | null; deadlineAt: string | null;
  reason: string | null; counters: { actions: number; batches: number[]; retries: number; segments: number;
    diagnosticCaptures: number; capturedBodyBytes: number; candidates: number | null; operatorMs: number; externalCostVnd: 0 };
  persistedBytes: number; verifiedValidUniquePosts: 0;
  sourceCounts: { PAGE: null; PUBLIC_GROUP: null; PUBLIC_PERSONAL: null }; outputRef: string | null;
}
