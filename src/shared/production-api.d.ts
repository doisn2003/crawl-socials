export type Platform = 'facebook' | 'threads';
export interface UserConfig { keywords: string[]; minimumPosts: number; }
export interface Account {
  id: string; label: string; platform: Platform; authenticated: boolean;
  open: boolean; persistenceError: string | null;
}
export interface PlatformRun {
  platform: Platform; profileId: string;
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED';
  count: number; reason: string | null;
}
export interface PostPreview { platform: Platform; post_id: string; text: string; query: string; link: string; }
export interface RunState {
  id: string; state: 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'STOPPED' | 'FAILED' | 'INTERRUPTED';
  startedAt: string; finishedAt: string | null; minimumPosts: number; keywords: string[];
  outputDirectory: string; platforms: PlatformRun[]; preview: PostPreview[];
}
export interface ProductionState { version: string; config: UserConfig; accounts: Account[]; run: RunState | null; }
export interface ProductionApi {
  cooler: {
    get(): Promise<boolean>;
    set(input: { enabled: boolean }): Promise<boolean>;
  };
  getState(): Promise<ProductionState>;
  saveConfig(input: UserConfig): Promise<UserConfig>;
  login(input: { platform: Platform; profileId?: string }): Promise<void>;
  start(input: { profiles: { platform: Platform; profileId: string }[] }): Promise<ProductionState>;
  stop(): Promise<ProductionState>;
  exportResults(input: { format: 'json' | 'xlsx' }): Promise<{ canceled: boolean; path: string | null }>;
  openOutput(): Promise<void>;
}
export type CoolerProgress = (Pick<RunState, 'id' | 'state' | 'minimumPosts'> & { platforms: Omit<PlatformRun, 'profileId'>[] }) | null;
