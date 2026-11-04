import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FILTER_MODES } from '../../shared/filter-policy.js';
import { PERFORMANCE_MODES } from '../../shared/throughput.js';
import type { OpportunityConfig, UserConfig } from '../../shared/production-api.js';

export function parseOpportunityConfig(value: unknown): OpportunityConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('CONFIG_INVALID');
  const v = value as Record<string, unknown>;
  const modern = v.filterMode !== undefined;
  const off = v.filterMode === 'OFF';
  if ((modern ? !FILTER_MODES.includes(v.filterMode as never) || Object.keys(v).filter(k => !['filterMode', 'threadsShare', 'languageScope'].includes(k)).sort().join() !== 'brandContext,budgetUsd,commentsEnabled,enabled,prompt,rawCap,totalTarget' : Object.keys(v).sort().join() !== 'brandContext,budgetUsd,commentsEnabled,enabled,prompt,rawCap,threadsShare,totalTarget') ||
      (v.languageScope !== undefined && v.languageScope !== 'VIETNAMESE' && v.languageScope !== 'PROMPT') ||
      typeof v.enabled !== 'boolean' || typeof v.commentsEnabled !== 'boolean' ||
      typeof v.prompt !== 'string' || v.prompt.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.prompt) ||
      typeof v.brandContext !== 'string' || v.brandContext.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.brandContext) ||
      !Number.isSafeInteger(v.totalTarget) || Number(v.totalTarget) < 1 || Number(v.totalTarget) > 3000 ||
      !Number.isSafeInteger(v.rawCap) || Number(v.rawCap) < Number(v.totalTarget) || Number(v.rawCap) > 10000 ||
      (!modern && v.threadsShare !== 0.7 && v.threadsShare !== 0.8) ||
      typeof v.budgetUsd !== 'number' || !Number.isFinite(v.budgetUsd) || (off ? v.budgetUsd !== 0 : v.budgetUsd <= 0) || v.budgetUsd > 30 ||
      (v.enabled && !off && !v.prompt.trim())) throw Error('CONFIG_INVALID');
  return { enabled: v.enabled, prompt: v.prompt.normalize('NFC').trim(), brandContext: v.brandContext.normalize('NFC').trim(),
    totalTarget: Number(v.totalTarget), ...(modern ? { filterMode: v.filterMode as NonNullable<OpportunityConfig['filterMode']> } : { threadsShare: v.threadsShare as 0.7 | 0.8 }), rawCap: Number(v.rawCap), budgetUsd: v.budgetUsd,
    commentsEnabled: v.commentsEnabled, ...(v.languageScope === undefined ? {} : { languageScope: v.languageScope as NonNullable<OpportunityConfig['languageScope']> }) };
}

export function parseUserConfig(value: unknown): UserConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('CONFIG_INVALID');
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).filter(key => key !== 'performance' && key !== 'spendLimits' && key !== 'filterPercent').sort().join();
  if (v.filterPercent !== undefined && (!Number.isSafeInteger(v.filterPercent) || Number(v.filterPercent) < 0 || Number(v.filterPercent) > 100)) throw Error('CONFIG_INVALID');
  if (v.spendLimits !== undefined) {
    const s = v.spendLimits as Record<string, unknown>;
    if (!s || typeof s !== 'object' || Array.isArray(s) || !['dailyUsd,totalUsd', 'dailyUsd,maxCalls,totalUsd'].includes(Object.keys(s).sort().join())
      || ![s.totalUsd, s.dailyUsd].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000)
      || (s.maxCalls !== undefined && (!Number.isSafeInteger(s.maxCalls) || Number(s.maxCalls) < 0))) throw Error('CONFIG_INVALID');
  }
  if (v.performance !== undefined && !PERFORMANCE_MODES.includes(v.performance as never)) throw Error('CONFIG_INVALID');
  const versionTwo = keys === 'keywords,minimumPosts,opportunity,schemaVersion' && v.schemaVersion === 2;
  if ((!versionTwo && keys !== 'keywords,minimumPosts') || !Array.isArray(v.keywords) || v.keywords.length > 100 ||
      !Number.isSafeInteger(v.minimumPosts) || Number(v.minimumPosts) < 1 || Number(v.minimumPosts) > 3000) throw Error('CONFIG_INVALID');
  const keywords: string[] = [];
  for (const raw of v.keywords) {
    if (typeof raw !== 'string') throw Error('CONFIG_INVALID');
    const keyword = raw.normalize('NFC').trim();
    if (!keyword || keyword.length > 200 || /[\x00-\x1f\x7f]/.test(keyword)) throw Error('CONFIG_INVALID');
    if (!keywords.includes(keyword)) keywords.push(keyword);
  }
  const limits = v.spendLimits as Record<string, number> | undefined;
  // Normalize legacy settings without touching the durable spending history.
  return { ...(v.filterPercent === undefined ? {} : { filterPercent: Number(v.filterPercent) }), ...(limits === undefined ? {} : { spendLimits: { totalUsd: limits.totalUsd!, dailyUsd: limits.dailyUsd! } }), ...(v.performance === undefined ? {} : { performance: v.performance as NonNullable<UserConfig['performance']> }), keywords, minimumPosts: Number(v.minimumPosts), ...(versionTwo ? { schemaVersion: 2 as const, opportunity: parseOpportunityConfig(v.opportunity) } : {}) };
}

export function atomicJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.next', JSON.stringify(value, null, 2), { flush: true, mode: 0o600 });
  renameSync(file + '.next', file);
}

export function createUserConfigStore(directory: string) {
  const file = join(directory, 'user-config.json');
  return {
    read(): UserConfig {
      if (!existsSync(file)) return { keywords: [], minimumPosts: 1000 };
      try { return parseUserConfig(JSON.parse(readFileSync(file, 'utf8'))); }
      catch { throw Error('CONFIG_READ_FAILED'); }
    },
    save(value: unknown): UserConfig {
      const config = parseUserConfig(value);
      // Preserve the last legacy configuration before the first explicit upgrade.
      if (config.schemaVersion === 2 && existsSync(file) && !existsSync(file + '.v1.backup')) {
        const previous = parseUserConfig(JSON.parse(readFileSync(file, 'utf8')));
        if (!previous.schemaVersion) copyFileSync(file, file + '.v1.backup');
      }
      atomicJson(file, config); return config;
    },
  };
}
