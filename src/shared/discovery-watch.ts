export interface DiscoverySubscription {
  id: string; sourceRunId: string; label: string; enabled: boolean; intervalHours: number; monthlyTarget: number;
  /** Latest explicitly attached template. sourceRunId remains the stable customer/topic delivery scope. */
  recipeRunId?: string;
  nextRunAt: string; lastRunId: string | null; activeRunId: string | null; awaitingExport: boolean;
  lastError: string | null; deliveredThisMonth: number; deliveredTotal: number;
}
