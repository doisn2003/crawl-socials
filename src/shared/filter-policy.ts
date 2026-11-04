export const FILTER_MODES = ['OFF', 'STANDARD', 'QUALITY'] as const;
export type FilterMode = typeof FILTER_MODES[number];
export const FILTER_VERSIONS = { OFF: 'unassessed-v1', STANDARD: 'coverage-standard-v1', QUALITY: 'coverage-quality-v1' } as const;
export const GLOBAL_RESULT_POLICY = 'GLOBAL_FIRST_QUALIFIED';
export function filterModeAtPercent(percent: number): FilterMode {
  return percent <= 20 ? 'OFF' : percent <= 80 ? 'STANDARD' : 'QUALITY';
}
export const FILTER_DEFAULT_PERCENT: Record<FilterMode, number> = { OFF: 0, STANDARD: 50, QUALITY: 100 };
