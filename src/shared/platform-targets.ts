import type { Platform } from './production-api.js';

/** Integer output targets. Rounding ties favor Threads; the remainder preserves the exact total. */
export function allocatePlatformTargets(
  totalTarget: number,
  weights: Readonly<Record<Platform, number>>,
  platforms: readonly Platform[],
): Record<Platform, number> {
  if (!Number.isSafeInteger(totalTarget) || totalTarget <= 0 || !weights || typeof weights !== 'object' || Array.isArray(weights)
      || !Number.isFinite(weights.threads) || !Number.isFinite(weights.facebook)
      || weights.threads < 0 || weights.threads > 1 || weights.facebook < 0 || weights.facebook > 1
      || Math.abs(weights.threads + weights.facebook - 1) > 1e-9
      || !Array.isArray(platforms) || platforms.length < 1 || platforms.length > 2
      || platforms.some(platform => platform !== 'facebook' && platform !== 'threads')
      || new Set(platforms).size !== platforms.length) throw Error('PLATFORM_TARGETS_INVALID');

  if (platforms.length === 1) return platforms[0] === 'threads'
    ? { threads: totalTarget, facebook: 0 }
    : { threads: 0, facebook: totalTarget };
  const threads = Math.round(totalTarget * weights.threads);
  return { threads, facebook: totalTarget - threads };
}
