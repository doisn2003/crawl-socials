export interface DiscoverySubscription {
  id: string; sourceRunId: string; label: string; enabled: boolean; intervalHours: number; monthlyTarget: number;
  /** Latest explicitly attached template. sourceRunId remains the stable customer/topic delivery scope. */
  recipeRunId?: string;
  nextRunAt: string; lastRunId: string | null; activeRunId: string | null; awaitingExport: boolean;
  lastError: string | null; deliveredThisMonth: number; deliveredTotal: number;
}
export interface DiscoveryWatchApi {
  list(): Promise<DiscoverySubscription[]>;
  create(input: { sourceRunId: string; label: string; intervalHours?: number; monthlyTarget?: number }): Promise<DiscoverySubscription[]>;
  setEnabled(input: { id: string; enabled: boolean }): Promise<DiscoverySubscription[]>;
  attachRecipe(input: { id: string; sourceRunId: string }): Promise<DiscoverySubscription[]>;
  runNow(input: { id: string }): Promise<DiscoverySubscription[]>;
}
