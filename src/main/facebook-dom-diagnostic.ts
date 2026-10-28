import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInside } from '../infrastructure/config/runtime-paths.js';
import { FACEBOOK_DOM_SCRIPT } from './facebook-dom-diagnostic-script.js';

export const DOM_LIMITS = Object.freeze({ nodes: 2500, cards: 5, scriptMs: 1000, readMs: 4000, runMs: 300000,
  actions: 1, bytes: 32768, runsPerProcess: 3, rootProbes: 3, barrierProbes: 3, ancestorDepth: 8, ancestorSteps: 40 });
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const DOM_SCRIPT_SHA256 = hash(FACEBOOK_DOM_SCRIPT);
export function facebookDomCaptureMode(args: readonly string[]): 'LIVE' | 'FIXTURE' | null {
  const live = args.includes('--csd-facebook-dom-diagnostic'), fixtures = ['--csd-facebook-dom-fixture','--csd-facebook-public-candidate-fixture'].filter(flag=>args.includes(flag)),fixture=fixtures.length>0;
  const otherSmoke = args.some(value => value === '--csd-smoke' || /^--csd-[a-z-]+-smoke$/.test(value));
  if (fixtures.length>1 || (live && (fixture || otherSmoke)) || (fixture && otherSmoke)) throw new Error('DOM_DIAGNOSTIC_ARGUMENTS_INVALID');
  return fixture ? 'FIXTURE' : live ? 'LIVE' : null;
}
export type DomReason = 'STOPPED' | 'OWNER_CHANGED' | 'READ_TIMEOUT' | 'DEADLINE' | 'READ_FAILED' | 'INVALID_RESULT' | 'CLOCK_UNCERTAIN';
export interface DomTarget {
  webContentsId: number; viewGeneration: number;
  url(): string; execute(code: string): Promise<unknown>; watchLoss(callback: () => void): () => void;
}
type Links = { post: number; group: number; page: number; profile: number; facebookOther: number; external: number; unsupported: number };
const linkKeys = ['post','group','page','profile','facebookOther','external','unsupported'] as const;
const statuses = ['HEURISTIC_MATCH','POST_LINK_STRUCTURE','NO_MATCH','AUTH_REQUIRED','CHALLENGE','ACCESS_DENIED','QUERY_MISMATCH','UNSUPPORTED_ROUTE','DOM_UNAVAILABLE'] as const;
export interface DomResult {
  version: 2; status: typeof statuses[number]; route: 'SEARCH_POSTS' | 'SEARCH_TOP_MIXED' | 'SEARCH_OTHER'; queryMatched: boolean;
  visited: number; elementCount: number; textNodes: number; articleRoots: number; feedRoots: number; mainRoots: number; pageletMarkers: number;
  nodeLimit: boolean; timeLimit: boolean; links: Links;
  cards: { kind: 'ARTICLE_TAG' | 'ROLE_ARTICLE'; textNodes: number; textSize: 'EMPTY' | 'SHORT' | 'MEDIUM' | 'LARGE';
    timeHint: boolean; publicLabelHints: number; restrictedLabelHints: number; seeMoreHint: boolean; links: Links }[];
  root: { kind: 'NONE' | 'MAIN_TAG' | 'ROLE_MAIN' | 'ROLE_FEED' | 'BODY_FALLBACK'; probes: number; candidates: number; cap: 3; enumeration: 'FIRST_PER_SELECTOR'; verified: false };
  scan: 'NOT_SCANNED' | 'PARTIAL' | 'COMPLETE' | 'BARRIER_STOP'; pruned: number; barrierProbes: number; ancestorSteps: number;
  postLinkSamples: { kind: 'POST_LIKE_LINK'; depthLimit: boolean; ancestors: {
    tag: 'DIV' | 'ARTICLE' | 'SECTION' | 'MAIN' | 'A' | 'SPAN' | 'HEADER' | 'FOOTER' | 'TIME' | 'ABBR' | 'BODY' | 'UL' | 'LI' | 'OTHER';
    role: 'NONE' | 'OTHER' | 'article' | 'main' | 'feed' | 'group' | 'region' | 'list' | 'listitem' | 'link' | 'button' | 'heading';
    children: 'ZERO' | 'ONE' | 'FEW' | 'MANY'; pagelet: boolean; label: boolean; atRoot: boolean;
  }[] }[];
}
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('INVALID_RESULT'); return v as Record<string, unknown>; };
const keys = (v: Record<string, unknown>, expected: string[]) => { if (Object.keys(v).sort().join() !== expected.sort().join()) throw new Error('INVALID_RESULT'); };
const integer = (v: unknown): number => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > DOM_LIMITS.nodes) throw new Error('INVALID_RESULT'); return v; };
const bool = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error('INVALID_RESULT'); return v; };
function enumeration<T extends string>(v: unknown, choices: readonly T[]): T { if (typeof v !== 'string' || !choices.includes(v as T)) throw new Error('INVALID_RESULT'); return v as T; }
function links(v: unknown): Links { const o = obj(v); keys(o, [...linkKeys]); return Object.fromEntries(linkKeys.map(key => [key, integer(o[key])])) as Links; }
export function validateDomResult(value: unknown): DomResult {
  const o = obj(value); keys(o, ['version','status','route','queryMatched','visited','elementCount','textNodes','articleRoots','feedRoots','mainRoots','pageletMarkers','nodeLimit','timeLimit','links','cards','root','scan','pruned','barrierProbes','postLinkSamples','ancestorSteps']);
  if (o.version !== 2 || !Array.isArray(o.cards) || o.cards.length > DOM_LIMITS.cards || !Array.isArray(o.postLinkSamples) || o.postLinkSamples.length > DOM_LIMITS.cards) throw new Error('INVALID_RESULT');
  const r = obj(o.root); keys(r, ['kind','probes','candidates','cap','enumeration','verified']);
  if (r.cap !== DOM_LIMITS.rootProbes || r.enumeration !== 'FIRST_PER_SELECTOR' || r.verified !== false) throw new Error('INVALID_RESULT');
  const result: DomResult = { version: 2, status: enumeration(o.status, statuses), route: enumeration(o.route, ['SEARCH_POSTS','SEARCH_TOP_MIXED','SEARCH_OTHER']), queryMatched: bool(o.queryMatched),
    visited: integer(o.visited), elementCount: integer(o.elementCount), textNodes: integer(o.textNodes), articleRoots: integer(o.articleRoots),
    feedRoots: integer(o.feedRoots), mainRoots: integer(o.mainRoots), pageletMarkers: integer(o.pageletMarkers),
    nodeLimit: bool(o.nodeLimit), timeLimit: bool(o.timeLimit), links: links(o.links),
    root: { kind: enumeration(r.kind, ['NONE','MAIN_TAG','ROLE_MAIN','ROLE_FEED','BODY_FALLBACK']), probes: integer(r.probes), candidates: integer(r.candidates), cap: 3, enumeration: 'FIRST_PER_SELECTOR', verified: false },
    scan: enumeration(o.scan, ['NOT_SCANNED','PARTIAL','COMPLETE','BARRIER_STOP']), pruned: integer(o.pruned), barrierProbes: integer(o.barrierProbes), ancestorSteps: integer(o.ancestorSteps),
    postLinkSamples: o.postLinkSamples.map(value => {
      const s = obj(value); keys(s, ['kind','depthLimit','ancestors']);
      if (!Array.isArray(s.ancestors) || s.ancestors.length > DOM_LIMITS.ancestorDepth) throw new Error('INVALID_RESULT');
      return { kind: enumeration(s.kind, ['POST_LIKE_LINK']), depthLimit: bool(s.depthLimit), ancestors: s.ancestors.map(value => {
        const a = obj(value); keys(a, ['tag','role','children','pagelet','label','atRoot']);
        return { tag: enumeration(a.tag, ['DIV','ARTICLE','SECTION','MAIN','A','SPAN','HEADER','FOOTER','TIME','ABBR','BODY','UL','LI','OTHER']),
          role: enumeration(a.role, ['NONE','OTHER','article','main','feed','group','region','list','listitem','link','button','heading']),
          children: enumeration(a.children, ['ZERO','ONE','FEW','MANY']), pagelet: bool(a.pagelet), label: bool(a.label), atRoot: bool(a.atRoot) };
      }) };
    }), cards: o.cards.map(value => {
      const c = obj(value); keys(c, ['kind','textNodes','textSize','timeHint','publicLabelHints','restrictedLabelHints','seeMoreHint','links']);
      return { kind: enumeration(c.kind, ['ARTICLE_TAG','ROLE_ARTICLE']), textNodes: integer(c.textNodes), textSize: enumeration(c.textSize, ['EMPTY','SHORT','MEDIUM','LARGE']),
        timeHint: bool(c.timeHint), publicLabelHints: integer(c.publicLabelHints), restrictedLabelHints: integer(c.restrictedLabelHints), seeMoreHint: bool(c.seeMoreHint), links: links(c.links) };
    }) };
  if (result.cards.length > result.articleRoots || (result.status !== 'HEURISTIC_MATCH' && result.cards.length > 0) ||
    (result.status === 'HEURISTIC_MATCH' && (!result.cards.length || !result.queryMatched)) ||
    (result.status === 'POST_LINK_STRUCTURE' && !result.postLinkSamples.length) ||
    (!['HEURISTIC_MATCH','POST_LINK_STRUCTURE'].includes(result.status) && result.postLinkSamples.length > 0) ||
    (['HEURISTIC_MATCH','POST_LINK_STRUCTURE','NO_MATCH'].includes(result.status) && (result.route === 'SEARCH_OTHER' || !result.queryMatched)) ||
    result.root.probes > DOM_LIMITS.rootProbes || result.root.candidates > result.root.probes || result.barrierProbes > DOM_LIMITS.barrierProbes ||
    (result.root.kind === 'NONE' && (result.visited > 0 || result.root.candidates > 0 || result.scan !== 'NOT_SCANNED')) ||
    (result.root.kind === 'BODY_FALLBACK' && result.root.candidates !== 0) ||
    (!['NONE','BODY_FALLBACK'].includes(result.root.kind) && result.root.candidates === 0) ||
    (result.scan === 'COMPLETE' && (result.nodeLimit || result.timeLimit || result.root.kind === 'NONE')) ||
    (result.scan === 'PARTIAL' && !result.nodeLimit && !result.timeLimit) ||
    (result.scan === 'BARRIER_STOP' && !['AUTH_REQUIRED','CHALLENGE','ACCESS_DENIED'].includes(result.status)) ||
    (result.nodeLimit && result.visited !== DOM_LIMITS.nodes) || result.postLinkSamples.length > result.links.post ||
    result.ancestorSteps > DOM_LIMITS.ancestorSteps || result.ancestorSteps !== result.postLinkSamples.reduce((sum, sample) => sum + sample.ancestors.length, 0) ||
    result.elementCount + result.textNodes + result.pruned > result.visited || result.articleRoots > result.elementCount ||
    result.feedRoots > result.elementCount || result.mainRoots > result.elementCount || result.pageletMarkers > result.elementCount ||
    linkKeys.reduce((sum, key) => sum + result.links[key], 0) > result.elementCount ||
    result.cards.some(card => card.textNodes > result.textNodes || linkKeys.some(key => card.links[key] > result.links[key])) ||
    Buffer.byteLength(JSON.stringify(result)) > 16384) throw new Error('INVALID_RESULT');
  return result;
}
export function inspectDomRoute(value: string): 'OK' | 'AUTH_REQUIRED' | 'QUERY_MISMATCH' | 'UNSUPPORTED_ROUTE' {
  try { const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))) return 'UNSUPPORTED_ROUTE';
    if (/^\/(?:login(?:\.php)?|checkpoint|two_step_verification|challenge|recover)(?:\/|$)/.test(url.pathname)) return 'AUTH_REQUIRED';
    if (!/^\/search\/(?:posts|top)\/?$/.test(url.pathname)) return 'UNSUPPORTED_ROUTE';
    const q = url.searchParams.get('q');
    return url.searchParams.getAll('q').length === 1 && q !== null && q.length <= 128 && q.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase() === 'cafe hà nội' ? 'OK' : 'QUERY_MISMATCH';
  } catch { return 'UNSUPPORTED_ROUTE'; }
}
export function createDomReportSink(userData: string, workspace: string) {
  const base = realpathSync(userData), repo = realpathSync(workspace), root = join(base, 'dom-diagnostics');
  if (isInside(repo, base) || isInside(base, repo)) throw new Error('DOM_OUTPUT_ROOT_DENIED');
  if (!existsSync(root)) mkdirSync(root);
  const check = (path: string) => { if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== resolve(path) || !isInside(base, realpathSync(path))) throw new Error('DOM_OUTPUT_ROOT_DENIED'); };
  check(root);
  return (id: string) => {
    if (!/^dom-[0-9a-f-]{36}$/.test(id)) throw new Error('DOM_RUN_ID_INVALID');
    check(root); const directory = join(root, id); mkdirSync(directory); check(directory); let total = 0;
    return { directory, write(name: 'started.json' | 'result.json', value: unknown) {
      check(root); check(directory); const text = JSON.stringify(value, null, 2) + '\n';
      const bytes = Buffer.byteLength(text); if (total + bytes > DOM_LIMITS.bytes) throw new Error('DOM_OUTPUT_LIMIT');
      writeFileSync(join(directory, name), text, { encoding: 'utf8', flag: 'wx', flush: true }); total += bytes;
      return hash(text);
    } };
  };
}
export function createFacebookDomDiagnostic(input: {
  resolve: (profileId: string) => DomTarget | null; sink: ReturnType<typeof createDomReportSink>;
  mode: 'LIVE' | 'FIXTURE'; now?: () => number; mono?: () => number;
}) {
  if (!['LIVE','FIXTURE'].includes(input.mode)) throw new Error('DOM_MODE_INVALID');
  const now = input.now || Date.now, mono = input.mono || (() => performance.now());
  let busy = false, nativePending = false, runs = 0, cancel: ((reason: DomReason) => void) | null = null;
  const codeHash = hash(readFileSync(new URL('./facebook-dom-diagnostic.js', import.meta.url)));
  return { stop() { cancel?.('STOPPED'); },
    async start(profileId: string) {
      if (busy || nativePending) throw new Error('DOM_DIAGNOSTIC_BUSY');
      if (runs >= DOM_LIMITS.runsPerProcess) throw new Error('DOM_PROCESS_READ_LIMIT');
      busy = true; runs++;
      const started = now(), anchor = mono(), id = 'dom-' + randomUUID(); let actions = 0;
      let unwatch = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
      const meta = { version: 2, run_id: id, started_at: new Date(started).toISOString(), deadline_at: new Date(started + DOM_LIMITS.runMs).toISOString(),
        capture_mode: input.mode, diagnostic_only: true, benchmark_eligible: false, platform_permission: 'UNKNOWN', verified_valid_count: 0,
        query_id: 'CAFE_HA_NOI', batch: 1, script_sha256: DOM_SCRIPT_SHA256, code_sha256: codeHash, code_hash_scope: 'DOM_CONTROLLER_MODULE',
        limits: DOM_LIMITS, decision_ref: 'ADR-010', candidates_collected: 0 };
      let store: ReturnType<ReturnType<typeof createDomReportSink>> | undefined;
      let status = 'READ_FAILED', result: DomResult | null = null;
      try {
        store = input.sink(id); store.write('started.json', { ...meta, state: 'STARTED', actions: 0 });
        const target = input.resolve(profileId);
        if (!target) throw new Error('OWNER_CHANGED');
        const initialRoute = inspectDomRoute(target.url());
        if (initialRoute !== 'OK') { status = initialRoute; }
        else {
          const expectedRoute = /^\/search\/posts\/?$/.test(new URL(target.url()).pathname) ? 'SEARCH_POSTS' : 'SEARCH_TOP_MIXED';
          let revoked: DomReason | null = null;
          const aborted = new Promise<never>((_resolve, reject) => { cancel = reason => { revoked = reason; reject(new Error(reason)); }; });
          unwatch = target.watchLoss(() => cancel?.('OWNER_CHANGED'));
          timer = setTimeout(() => cancel?.('READ_TIMEOUT'), DOM_LIMITS.readMs);
          const same = () => { const current = input.resolve(profileId), url = current?.url();
            return current && url && current.webContentsId === target.webContentsId && current.viewGeneration === target.viewGeneration && inspectDomRoute(url) === 'OK' &&
              (/^\/search\/posts\/?$/.test(new URL(url).pathname) ? 'SEARCH_POSTS' : 'SEARCH_TOP_MIXED') === expectedRoute; };
          if (!same()) throw new Error('OWNER_CHANGED');
          actions = 1; nativePending = true;
          const native = Promise.resolve().then(() => {
            if (revoked || !same()) throw new Error(revoked || 'OWNER_CHANGED');
            if (now() < started) throw new Error('CLOCK_UNCERTAIN');
            const elapsed = Math.max(now() - started, mono() - anchor);
            if (elapsed >= DOM_LIMITS.runMs) throw new Error('DEADLINE');
            if (elapsed >= DOM_LIMITS.readMs) throw new Error('READ_TIMEOUT');
            return target.execute(FACEBOOK_DOM_SCRIPT);
          });
          void native.then(() => { nativePending = false; }, () => { nativePending = false; });
          const value = await Promise.race([native, aborted]);
          if (revoked) throw new Error(revoked);
          const elapsed = Math.max(now() - started, mono() - anchor);
          if (now() < started) throw new Error('CLOCK_UNCERTAIN');
          if (elapsed >= DOM_LIMITS.runMs) throw new Error('DEADLINE');
          if (elapsed >= DOM_LIMITS.readMs) throw new Error('READ_TIMEOUT');
          if (!same()) throw new Error('OWNER_CHANGED');
          result = validateDomResult(value);
          if (result.route !== expectedRoute) throw new Error('INVALID_RESULT');
          status = result.status;
        }
      } catch (error) { const safe = error instanceof Error ? error.message : '';
        status = ['STOPPED','OWNER_CHANGED','READ_TIMEOUT','DEADLINE','INVALID_RESULT','CLOCK_UNCERTAIN'].includes(safe) ? safe : 'READ_FAILED'; result = null;
      } finally { if (timer) clearTimeout(timer); try { unwatch(); } catch { status = 'READ_FAILED'; result = null; } cancel = null; busy = false; }
      const report = { ...meta, finished_at: new Date(now()).toISOString(), status, actions, result,
        semantics: 'EXPERIMENTAL_REGION_AND_LINK_ANCESTORS_NOT_POST_OR_PUBLICITY_VERIFICATION',
        missing_fields: ['IDENTITY_NOT_EXTRACTED','TEXT_NOT_COLLECTED','SOURCE_TYPE_UNVERIFIED','PUBLICITY_UNVERIFIED','RESULT_REGION_UNVERIFIED','POST_LINKS_NOT_UNIQUE','ANCESTOR_DESCENDANTS_NOT_SCANNED'],
        retention_cleanup: 'MANUAL_REQUIRED_NO_SCHEDULER', expires_at: new Date(now() + 7 * 86400000).toISOString() };
      if (!store) throw new Error('DOM_OUTPUT_FAILED');
      const sha256 = store.write('result.json', report); return { report, directory: store.directory, sha256 };
    },
  };
}
export type FacebookDomDiagnostic = ReturnType<typeof createFacebookDomDiagnostic>;
