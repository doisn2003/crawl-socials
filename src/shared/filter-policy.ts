export const FILTER_MODES = ['OFF', 'CONSISTENT', 'STANDARD', 'QUALITY'] as const;
export type FilterMode = typeof FILTER_MODES[number];
export const FILTER_VERSIONS = { OFF: 'unassessed-v1', CONSISTENT: 'opportunity-posts-consistent-v1', STANDARD: 'opportunity-posts-standard-v1', QUALITY: 'opportunity-posts-quality-v1' } as const;
export const POST_FILTER_VERSIONS = [FILTER_VERSIONS.CONSISTENT, FILTER_VERSIONS.STANDARD, FILTER_VERSIONS.QUALITY] as readonly string[];
export const GLOBAL_RESULT_POLICY = 'GLOBAL_FIRST_QUALIFIED';
export function filterModeAtPercent(percent: number): FilterMode {
  return percent <= 10 ? 'OFF' : percent <= 49 ? 'CONSISTENT' : percent <= 90 ? 'STANDARD' : 'QUALITY';
}
export const FILTER_DEFAULT_PERCENT: Record<FilterMode, number> = { OFF: 0, CONSISTENT: 25, STANDARD: 50, QUALITY: 100 };

export function restoreFilterPercent(percent: number | undefined, mode?: FilterMode): number {
  if (percent === undefined) return FILTER_DEFAULT_PERCENT[mode ?? 'CONSISTENT'];
  // Percent-only Portable 5.3 settings used three bands. New settings also save the named mode.
  const savedMode = mode ?? (percent <= 20 ? 'OFF' : percent <= 80 ? 'STANDARD' : 'QUALITY');
  return filterModeAtPercent(percent) === savedMode ? percent : FILTER_DEFAULT_PERCENT[savedMode];
}
