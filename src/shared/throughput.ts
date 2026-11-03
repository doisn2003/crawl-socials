/** Operational controls only: no classifier prompt, evidence or quality thresholds. */
export type PerformanceMode = 'STANDARD' | 'BALANCED' | 'FAST';
export const PERFORMANCE_MODES = ['STANDARD', 'BALANCED', 'FAST'] as const;
export function throughput(mode: PerformanceMode = 'BALANCED') {
  return mode === 'STANDARD' ? { windowsPerPlatform: 1, classificationWorkers: 1, modelConcurrency: 1 }
    : mode === 'FAST' ? { windowsPerPlatform: 3, classificationWorkers: 8, modelConcurrency: 16 }
      : { windowsPerPlatform: 2, classificationWorkers: 4, modelConcurrency: 8 };
}
/** Limits supplied by the user for this project/model, 2026-11-03; not universal Tier 1 limits. */
export const GEMINI_35_PROJECT_LIMITS = Object.freeze({ rpm: 4000, inputTpm: 4_000_000, rpd: 150_000, utilization: 0.8 });

export interface RequestScheduleStatus {
  active: number; queued: number; concurrency: number; configuredConcurrency: number;
  requestsLastMinute: number; inputTokensLastMinute: number; requestsToday: number; cooldownUntil: string | null;
}
