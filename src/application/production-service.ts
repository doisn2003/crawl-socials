import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, createUserConfigStore } from '../infrastructure/config/user-config.js';
import { isBrowserProfileId } from '../domain/browser-profile.js';
import type { BrowserProfile } from '../domain/browser-profile.js';
import type { Account, Platform, ProductionState, RunState, UserConfig } from '../shared/production-api.js';

export interface ProductionHost {
  list(): Promise<(BrowserProfile & { open: boolean; persistenceError: string | null })[]>;
  sessionStatus(id: string): Promise<boolean>;
  create(label: string, platform: Platform): Promise<BrowserProfile>;
  openLogin(id: string): Promise<void>;
}
export interface CollectorInput {
  platform: Platform; profileId: string; config: Record<string, unknown>;
  shouldStop(): boolean;
  onProgress(value: { total?: number; event?: string }): void;
}
export interface CollectorReceipt { stop_reason: string; summary: { unique: number }; session_flush?: string; }
type Row = Record<string, unknown>;
const active = (run: RunState | null) => run?.state === 'RUNNING' || run?.state === 'STOPPING';
const platformValue = (value: unknown): value is Platform => value === 'facebook' || value === 'threads';
const code = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'COLLECTION_FAILED';

export function createProductionService(input: {
  directory: string; version: string; host: ProductionHost;
  collect(value: CollectorInput): Promise<CollectorReceipt>;
}) {
  const configStore = createUserConfigStore(input.directory), latestFile = join(input.directory, 'latest-run.json');
  let run: RunState | null = null, starting = false, stopped = false, work: Promise<void> | null = null;
  const blockedProfiles = new Set<string>();
  const saveRun = () => { if (run) atomicJson(latestFile, run); };
  if (existsSync(latestFile)) {
    const saved = JSON.parse(readFileSync(latestFile, 'utf8')) as RunState;
    if (!/^crawl-[0-9a-f-]{36}$/.test(saved.id) || saved.outputDirectory !== join(input.directory, 'collections', saved.id) ||
        !Array.isArray(saved.platforms) || saved.platforms.length > 2 || saved.platforms.some(p => !platformValue(p.platform) || !isBrowserProfileId(p.profileId))) throw Error('RUN_STATE_INVALID');
    run = saved;
    if (active(run)) {
      run.state = 'INTERRUPTED'; run.finishedAt = new Date().toISOString();
      for (const item of run.platforms) if (item.state === 'RUNNING' || item.state === 'QUEUED') { item.state = 'STOPPED'; item.reason = 'APP_INTERRUPTED'; }
      rebuildResults(); saveRun();
    }
  }
  function rows(platform: Platform): Row[] {
    if (!run) return [];
    const folder = join(run.outputDirectory, platform), json = join(folder, 'posts.json'), jsonl = join(folder, 'posts.jsonl');
    // JSONL is the durable source after an interrupted run; skip only an incomplete final line.
    if (existsSync(jsonl)) {
      const text = readFileSync(jsonl, 'utf8'), lines = text.split('\n'), result: Row[] = [];
      for (const [i, line] of lines.entries()) {
        if (!line.trim()) continue;
        try { result.push(JSON.parse(line) as Row); }
        catch { if (i !== lines.length - 1 || text.endsWith('\n')) throw Error('COLLECTION_DATA_INVALID'); }
      }
      // Normal completed exports may contain source-audit enrichment; use them only when current.
      if (existsSync(json)) {
        const exported: unknown = JSON.parse(readFileSync(json, 'utf8'));
        if (Array.isArray(exported) && exported.length === result.length) return exported as Row[];
      }
      return result;
    }
    if (!existsSync(json)) return [];
    const data: unknown = JSON.parse(readFileSync(json, 'utf8'));
    if (!Array.isArray(data)) throw Error('COLLECTION_DATA_INVALID');
    return data as Row[];
  }
  function rebuildResults() {
    if (!run) return;
    run.preview = [];
    const data = { facebook: rows('facebook'), threads: rows('threads') };
    for (const item of run.platforms) {
      item.count = data[item.platform].length;
      for (const row of data[item.platform].slice(0, 3)) run.preview.push({
        platform: item.platform, post_id: String(row.post_id || ''), text: String(row.text || '').slice(0, 800),
        query: String(row.query || ''), link: String(row.observed_post_url || row.post_url || ''),
      });
    }
    atomicJson(join(run.outputDirectory, 'results.json'), { run: { id: run.id, startedAt: run.startedAt, minimumPosts: run.minimumPosts, keywords: run.keywords }, ...data });
  }
  async function accounts(): Promise<Account[]> {
    const list = await input.host.list();
    return Promise.all(list.map(async profile => {
      let authenticated = false, persistenceError = profile.persistenceError;
      try { authenticated = await input.host.sessionStatus(profile.id); }
      catch (error) { persistenceError = code(error); }
      return { id: profile.id, label: profile.label, platform: profile.platform || 'facebook', open: profile.open,
        authenticated: authenticated && !persistenceError && !blockedProfiles.has(profile.id), persistenceError };
    }));
  }
  async function getState(): Promise<ProductionState> {
    return { version: input.version, config: configStore.read(), accounts: await accounts(), run: run ? structuredClone(run) : null };
  }
  async function execute() {
    if (!run) return;
    const currentRun = run;
    try {
      // Start every selected source before awaiting completion. A source failure must
      // never release the run lock while another collector is still using its profile.
      const outcomes = await Promise.allSettled(currentRun.platforms.map(async item => {
        try {
          if (stopped) throw Error('USER_STOP');
          item.state = 'RUNNING'; saveRun();
          const output = join(currentRun.outputDirectory, item.platform);
          const config = { runId: currentRun.id + '-' + item.platform, output, queries: [...currentRun.keywords],
            maxScrollsPerQuery: item.platform === 'facebook' ? 50 : 100, maxMinutes: 240, settleMs: 3000,
            ...(item.platform === 'facebook' ? { targetNewRecords: currentRun.minimumPosts } : { targetTotal: currentRun.minimumPosts, modes: ['top', 'recent'] }) };
          mkdirSync(output, { recursive: true }); atomicJson(join(output, 'config.json'), config);
          if (!(await input.host.sessionStatus(item.profileId))) throw Error('LOGIN_REQUIRED');
          if (stopped) throw Error('USER_STOP');
          let lastSaved = 0;
          const receipt = await input.collect({ platform: item.platform, profileId: item.profileId, config, shouldStop: () => stopped,
            onProgress: value => {
              if (Number.isSafeInteger(value.total) && Number(value.total) >= 0) item.count = Number(value.total);
              if (Date.now() - lastSaved > 1500) { saveRun(); lastSaved = Date.now(); }
            } });
          item.count = rows(item.platform).length; item.reason = receipt.stop_reason;
          const regular = ['TARGET_REACHED', 'QUERY_BUDGET_COMPLETE', 'SOURCE_EXHAUSTED', 'NO_PROGRESS', 'USER_STOP', 'RUN_DEADLINE', 'WINDOW_CLOSED'];
          item.state = !regular.includes(item.reason) ? 'FAILED' : item.count >= currentRun.minimumPosts ? 'COMPLETED' : 'STOPPED';
          if (receipt.session_flush && receipt.session_flush !== 'OK') { item.state = 'FAILED'; item.reason = 'SESSION_SAVE_FAILED'; }
          if (/ACCOUNT_BARRIER|LOGIN_REQUIRED/.test(item.reason)) blockedProfiles.add(item.profileId);
        } catch (error) {
          item.reason = code(error);
          item.state = ['USER_STOP', 'RUN_DEADLINE', 'WINDOW_CLOSED'].includes(item.reason) ? 'STOPPED' : 'FAILED';
          if (/ACCOUNT_BARRIER|LOGIN_REQUIRED/.test(item.reason)) blockedProfiles.add(item.profileId);
        }
        // Read only this finished source; the other source may still be writing.
        const data = rows(item.platform);
        item.count = data.length;
        for (const row of data.slice(0, 3)) currentRun.preview.push({
          platform: item.platform, post_id: String(row.post_id || ''), text: String(row.text || '').slice(0, 800),
          query: String(row.query || ''), link: String(row.observed_post_url || row.post_url || ''),
        });
        saveRun();
      }));
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === 'rejected') {
          const item = currentRun.platforms[index]!;
          item.state = 'FAILED'; item.reason = code(outcome.reason);
        }
      }
      rebuildResults();
      run.state = run.platforms.some(p => p.state === 'FAILED') ? 'FAILED' :
        run.platforms.every(p => p.state === 'COMPLETED') ? 'COMPLETED' : 'STOPPED';
    } catch (error) {
      run.state = 'FAILED';
      for (const item of run.platforms) if (item.state === 'RUNNING' || item.state === 'QUEUED') { item.state = 'FAILED'; item.reason = code(error); }
    } finally {
      run.finishedAt = new Date().toISOString(); saveRun();
    }
  }
  return {
    getState,
    progress() {
      return run ? { id: run.id, state: run.state, minimumPosts: run.minimumPosts,
        platforms: run.platforms.map(p => ({ platform: p.platform, state: p.state, count: p.count, reason: p.reason })) } : null;
    },
    saveConfig(value: unknown): UserConfig {
      if (active(run) || starting) throw Error('COLLECTION_BUSY');
      return configStore.save(value);
    },
    async login(value: unknown) {
      if (active(run) || starting) throw Error('COLLECTION_BUSY');
      starting = true;
      try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('LOGIN_INPUT_INVALID');
      const v = value as Record<string, unknown>;
      if (!platformValue(v.platform) || !['platform', 'platform,profileId'].includes(Object.keys(v).sort().join()) ||
          (v.profileId !== undefined && !isBrowserProfileId(v.profileId))) throw Error('LOGIN_INPUT_INVALID');
      const list = await input.host.list();
      let profile = v.profileId ? list.find(p => p.id === v.profileId) : list.find(p => (p.platform || 'facebook') === v.platform);
      if (v.profileId && (!profile || (profile.platform || 'facebook') !== v.platform)) throw Error('PROFILE_NOT_FOUND');
      if (!profile) {
        const created = await input.host.create(v.platform === 'facebook' ? 'CSD Facebook' : 'CSD Threads', v.platform);
        profile = { ...created, open: false, persistenceError: null };
      }
      blockedProfiles.delete(profile.id); await input.host.openLogin(profile.id);
      } finally { starting = false; }
    },
    async start(value: unknown) {
      if (active(run) || starting) throw Error('COLLECTION_BUSY');
      starting = true;
      const previousRun = run; let launched = false;
      try {
        const config = configStore.read(); if (!config.keywords.length) throw Error('KEYWORDS_REQUIRED');
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'profiles') throw Error('COLLECTION_INPUT_INVALID');
        const selections = (value as { profiles: unknown }).profiles;
        if (!Array.isArray(selections) || selections.length < 1 || selections.length > 2) throw Error('COLLECTION_INPUT_INVALID');
        const available = await accounts(), platforms = new Set<Platform>();
        for (const item of selections) {
          if (!item || typeof item !== 'object' || Object.keys(item).sort().join() !== 'platform,profileId' ||
              !platformValue(item.platform) || !isBrowserProfileId(item.profileId) || platforms.has(item.platform)) throw Error('COLLECTION_INPUT_INVALID');
          const account = available.find(p => p.id === item.profileId && p.platform === item.platform);
          if (!account?.authenticated || account.persistenceError) throw Error('LOGIN_REQUIRED');
          platforms.add(item.platform);
        }
        const id = 'crawl-' + randomUUID();
        run = { id, state: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null,
          minimumPosts: config.minimumPosts, keywords: config.keywords, outputDirectory: join(input.directory, 'collections', id),
          platforms: selections.map(item => ({ platform: item.platform as Platform, profileId: item.profileId as string, state: 'QUEUED', count: 0, reason: null })), preview: [] };
        stopped = false; mkdirSync(run.outputDirectory, { recursive: true }); saveRun();
        work = execute(); void work.catch(() => {});
        launched = true;
        return await getState();
      } catch (error) {
        if (!launched) run = previousRun;
        throw error;
      } finally { starting = false; }
    },
    async stop() {
      stopped = true; if (active(run)) { run!.state = 'STOPPING'; saveRun(); }
      return getState();
    },
    results() {
      if (!run || active(run) || starting) throw Error('RESULTS_UNAVAILABLE');
      return { run: structuredClone(run), facebook: rows('facebook'), threads: rows('threads') };
    },
    outputDirectory() { if (!run) throw Error('RESULTS_UNAVAILABLE'); return run.outputDirectory; },
    async shutdown() { stopped = true; await work?.catch(() => {}); },
    async settled() { await work; },
  };
}
