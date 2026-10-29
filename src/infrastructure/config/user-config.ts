import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UserConfig } from '../../shared/production-api.js';

export function parseUserConfig(value: unknown): UserConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('CONFIG_INVALID');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== 'keywords,minimumPosts' || !Array.isArray(v.keywords) || v.keywords.length > 100 ||
      !Number.isSafeInteger(v.minimumPosts) || Number(v.minimumPosts) < 1 || Number(v.minimumPosts) > 3000) throw Error('CONFIG_INVALID');
  const keywords: string[] = [];
  for (const raw of v.keywords) {
    if (typeof raw !== 'string') throw Error('CONFIG_INVALID');
    const keyword = raw.normalize('NFC').trim();
    if (!keyword || keyword.length > 200 || /[\x00-\x1f\x7f]/.test(keyword)) throw Error('CONFIG_INVALID');
    if (!keywords.includes(keyword)) keywords.push(keyword);
  }
  return { keywords, minimumPosts: Number(v.minimumPosts) };
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
      const config = parseUserConfig(value); atomicJson(file, config); return config;
    },
  };
}
