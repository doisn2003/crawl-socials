// Live, paired comparison using the shipping collectors/classifiers, one shared raw pool and cost ledger.
import { app, BaseWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runtimePaths } from '../../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../../dist/infrastructure/browser/browser-host.js';
import { createConversationStore } from '../../dist/infrastructure/storage/conversation-store.js';
import { createGeminiGateway } from '../../dist/infrastructure/llm/gemini-gateway.js';
import { developmentSpend, REBUILD_MODEL } from '../../dist/infrastructure/llm/durable-spend.js';
import { createRequestScheduler } from '../../dist/infrastructure/llm/request-scheduler.js';
import { runQueryCollectors } from '../../dist/application/query-collector.js';
import { sharedWindows } from '../../dist/application/window-scheduler.js';
import { classifyConversations } from '../../dist/application/classification-service.js';
import { evaluationContext } from '../../dist/application/evaluation-upgrade.js';
import { createCoverageExpansion } from '../../dist/application/coverage-queries.js';
import { runFacebookCollector } from '../facebook-collector.mjs';
import { runThreadsCollector } from '../threads-collector.mjs';

async function main() {
const taskDir = resolve('artifacts/piano-comparison-20261103');
if (!process.argv.includes('--live')) throw Error('LIVE_FLAG_REQUIRED');
if (existsSync(join(taskDir, 'closed-spending.json'))) throw Error('TASK_ALREADY_CLOSED');
const read = name => JSON.parse(readFileSync(join(taskDir, name), 'utf8'));
const task = read('task.json'), modes = ['STANDARD', 'QUALITY'];
const plans = Object.fromEntries(modes.map(mode => [mode, read('campaign-' + mode + '.json')]));
const contexts = Object.fromEntries(modes.map(mode => [mode, evaluationContext(plans[mode])]));
const paths = runtimePaths(app.getPath('appData'));
for (const [name, path] of Object.entries(paths)) { mkdirSync(path, { recursive: true }); app.setPath(name, path); }
app.setName('CSD'); app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (!app.requestSingleInstanceLock()) throw Error('CSD_ALREADY_RUNNING');
// Background Electron windows remain independent and authenticated; no foreground stealing.
app.on('window-all-closed', () => {});
await app.whenReady();
const output = join(paths.userData, 'data', 'comparisons', task.id); mkdirSync(output, { recursive: true });
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { flush: true });
writeFileSync(join(taskDir, 'output-path.json'), JSON.stringify({ output }));
const profiles = createBrowserProfiles(join(paths.userData, 'data'));
const host = createBrowserHost({ profiles, secrets: createElectronSecretStore(join(paths.userData, 'secrets')),
  journalDirectory: join(paths.userData, 'data', 'session-snapshots'), manualLoginEnabled: true, hidden: true, backgroundThrottling: false });
const spending = developmentSpend();
const gateway = createGeminiGateway({ directory: join(taskDir, 'model'), model: REBUILD_MODEL, spending, budgetUsd: 6,
  maxAttempts: 1, timeoutMs: 90000, scheduler: createRequestScheduler({ concurrency: 2, rpm: 60, inputTpm: 400000, rpd: 1500, minIntervalMs: 500 }) });
const store = createConversationStore(join(output, 'conversations'));
const cache = join(taskDir, 'assessment-cache'), evaluatedAt = task.startedAt;
const expand = createCoverageExpansion(taskDir, plans.STANDARD, gateway, new AbortController().signal);
const anchorQueries = [...new Set(plans.STANDARD.intent_resolution.plan.branches.filter(b => b.scope === 'CORE').map(b => b.anchor))];
const recoveredExpansion = existsSync(join(taskDir, 'recovered-expansion.json')) ? read('recovered-expansion.json').queries : [];
const decisions = Object.fromEntries(modes.map(mode => [mode, new Map(store.results(contexts[mode]).map(r => [r.snapshot.platform + ':' + r.snapshot.root_post_id, r.decision]))]));
const queue = new Map(), activeRoots = new Set(), failures = [], receipts = {}, progress = {}, costs = { STANDARD: 0, QUALITY: 0 };
let stopping = false, aiHalt = null, running = 0, captureDone = false, completed = false, lastProgress = 0;
const raw = new Map(store.snapshots().filter(s => s.post).map(s => [s.platform + ':' + s.root_post_id, s]));
const stopFile = join(output, 'STOP');
const code = e => typeof e?.code === 'string' ? e.code : /^[A-Z][A-Z0-9_]+$/.test(e?.message ?? '') ? e.message : 'TASK_FAILED';
const count = mode => [...decisions[mode]].filter(([key, d]) => d.classification === 'SUITABLE' && d.snapshot_id === raw.get(key)?.id).length;
const collectLimit = () => stopping || existsSync(stopFile) ? 'USER_STOP' : count('QUALITY') >= 1000 && count('STANDARD') >= 1000 ? 'PAIRED_TARGET_REACHED' : raw.size >= task.rawCap ? 'RAW_CAP_REACHED' : null;
function publish(force = false) {
  if (!force && Date.now() - lastProgress < 5000) return; lastProgress = Date.now();
  const s = { at: new Date().toISOString(), output, phase: completed ? 'COMPLETE' : captureDone ? 'FILTERING' : 'CRAWLING', raw: raw.size,
    queue: queue.size, running, accepted: Object.fromEntries(modes.map(m => [m, count(m)])), evaluated: Object.fromEntries(modes.map(m => [m, decisions[m].size])),
    failures: failures.length, aiHalt, resources: sharedWindows.status(), progress, cost: gateway.summary(), spending: spending.status() };
  write('status.json', s); console.log(JSON.stringify({ ...s, progress: undefined }));
}
async function evaluate(batch) {
  try {
    for (const mode of modes) {
      const result = await classifyConversations(plans[mode], batch, gateway, { evaluatedAt, maxBatchSize: 8, assessmentCacheDirectory: cache });
      for (const r of result.model_results) if (!r.cache_hit) costs[mode] += r.cost_usd ?? r.unmetered_cost_upper_usd;
      for (const d of result.decisions) { const saved = store.recordDecision(d).decision; decisions[mode].set(saved.platform + ':' + saved.root_post_id, saved); }
      store.selectTarget(contexts[mode], 1000);
      for (const f of result.failures) failures.push({ ...f, mode });
      appendFileSync(join(output, 'evaluation-batches.jsonl'), JSON.stringify({ at: new Date().toISOString(), mode,
        snapshots: batch.map(s => s.id), failures: result.failures, calls: result.model_results.map(r => ({ id: r.invocation_id, cost: r.cost_usd, cached: r.cache_hit, usage: r.usage })) }) + '\n');
      const fatal = result.failures.find(f => /MODEL_(?:GLOBAL_BUDGET|BUDGET_EXHAUSTED|CALL_LIMIT|NOT_|AUTH|HTTP_40|QUOTA|BILLING)|GEMINI_API_KEY/.test(f.code));
      if (fatal) { aiHalt = fatal.code; break; }
      // Stop a systematic transport/format defect before charging hundreds of repetitions.
      if (result.failures.length === batch.length && result.failures.some(f => /MODEL_|BATCH_INCOMPLETE/.test(f.code)) && !result.decisions.some(d => d.assessment_status === 'ASSESSED')) {
        aiHalt = 'BATCH_FAILED_' + result.failures[0].code; break;
      }
    }
  } catch (e) { aiHalt = code(e); failures.push({ code: aiHalt }); }
  finally {
    for (const s of batch) activeRoots.delete(s.platform + ':' + s.root_post_id);
    running--; publish(true); pump();
  }
}
function pump() {
  if (aiHalt || stopping) return;
  while (running < 2 && queue.size) {
    const batch = [];
    for (const [key, snapshot] of queue) {
      if (activeRoots.has(key)) continue;
      queue.delete(key); activeRoots.add(key); batch.push(snapshot); if (batch.length === 8) break;
    }
    if (!batch.length) break;
    // Avoid tiny paid requests while a page is still being ingested.
    if (batch.length < 8 && !captureDone && raw.size > 8) {
      for (const s of batch) { const key = s.platform + ':' + s.root_post_id; queue.set(key, s); activeRoots.delete(key); } break;
    }
    running++; void evaluate(batch);
  }
}
const nullable = v => typeof v === 'string' && v.trim() ? v : null;
async function ingestRows(platform, rows, provenance) {
  for (const row of rows) {
    const id = nullable(row.post_id), reply = row.entity_type === 'COMMENT' || row.is_reply === true, rootId = reply ? nullable(row.root_post_id) : id;
    const url = nullable(row.observed_post_url) ?? nullable(row.post_url), existing = rootId ? store.snapshot(platform, rootId) : null;
    const advertised = row.comments_count ?? row.replies;
    const source = ['PROFILE', 'GROUP', 'PAGE'].includes(row.source_type) ? row.source_type : 'UNKNOWN';
    const observation = { platform, entity_type: !rootId ? 'CANDIDATE' : reply ? 'COMMENT' : 'POST', entity_id: id, root_post_id: rootId,
      parent_id: nullable(row.parent_id), text: typeof row.text === 'string' ? row.text : '', observed_at: nullable(row.collected_at) ?? new Date().toISOString(),
      ...(row.published_at !== undefined ? { published_at: nullable(row.published_at) } : {}), ...(url ? { permalink: url } : {}),
      ...(nullable(row.author_name) ?? nullable(row.author_username) ? { author: { name: nullable(row.author_name) ?? nullable(row.author_username) } } : {}),
      source: { kind: source, name: nullable(row.source_name), url: nullable(row.source_url) },
      ...(Array.isArray(row.media_refs) ? { media: row.media_refs } : {}),
      provenance: { run_id: task.id, method: String(provenance.method ?? 'SEARCH'), query: String(row.query ?? provenance.query ?? ''), ...(url ? { url } : {}) },
      ...(!existing ? { coverage: { status: 'NOT_ATTEMPTED', advertised_count: typeof advertised === 'number' && advertised >= 0 ? advertised : null } } : {}) };
    const saved = store.ingest(observation, contexts.STANDARD);
    if (saved.snapshot?.post) {
      const s = saved.snapshot, key = platform + ':' + s.root_post_id; raw.set(key, s);
      if (modes.some(m => decisions[m].get(key)?.snapshot_id !== s.id)) queue.set(key, s);
    }
  }
  pump(); publish();
}
for (const [key, s] of raw) if (modes.some(m => decisions[m].get(key)?.snapshot_id !== s.id)) queue.set(key, s);
const timer = setInterval(() => publish(), 10000);
app.on('before-quit', e => { if (!completed) { e.preventDefault(); stopping = true; } });
try {
  const profilesList = await profiles.list();
  write('run-manifest.json', { task, plans, output, commentsEnrichment: false, capturedSearchRepliesIncluded: true,
    comparison: 'Same live roots and snapshot evidence; QUALITY reuses STANDARD base assessments; no quota split.' });
  pump();
  await Promise.all(['facebook', 'threads'].map(async platform => {
    const candidates = profilesList.filter(p => (p.platform ?? 'facebook') === platform && p.label === (platform === 'facebook' ? 'CSD Facebook' : 'CSD Threads'));
    if (candidates.length !== 1) throw Error('PROFILE_SELECTION_REQUIRED');
    const queries = [...new Set(plans.STANDARD.queries.filter(q => q.platforms.includes(platform)).map(q => q.text))];
    const config = { runId: task.id + '-' + platform, output: join(output, platform), queries, maxScrollsPerQuery: 3, maxMinutes: 90,
      targetNewRecords: 10000, targetTotal: 10000, settleMs: 3000, queryTaskPolicy: 'PER_QUERY_V1', windowMode: 'ALL',
      includeContextCandidates: true, modes: ['top', 'recent'], interleaveModes: true };
    receipts[platform] = await runQueryCollectors({ platform, profileId: candidates[0].id, config, resume: true,
      shouldStop: () => stopping || existsSync(stopFile), collectionLimitReason: collectLimit,
      onRecords: (rows, provenance) => ingestRows(platform, rows, provenance),
      onProgress: p => { progress[platform] = p; publish(); },
      expandQueries: async () => {
        if (aiHalt) return anchorQueries;
        try { return [...new Set([...anchorQueries, ...recoveredExpansion, ...await expand()])]; }
        catch (e) { failures.push({ code: code(e), phase: 'OPTIONAL_QUERY_EXPANSION' }); return [...anchorQueries, ...recoveredExpansion]; }
      },
      beforeNextPage: async () => { while (queue.size > 160 && !aiHalt && !collectLimit()) await new Promise(r => setTimeout(r, 200)); },
      onQueryEnd: async ({ window, query }) => {
        const state = await window.executeJavaScript('({visibility:document.visibilityState, height:document.scrollingElement.scrollHeight, textLength:document.body.innerText.length})');
        appendFileSync(join(output, 'page-diagnostics.jsonl'), JSON.stringify({ at: new Date().toISOString(), platform, query, ...state }) + '\n');
      },
    }, (child, worker) => {
      const workerHost = host.forWorker(worker);
      return (platform === 'facebook' ? runFacebookCollector : runThreadsCollector)({ ...child, host: { ...workerHost,
        async open(id) { await workerHost.open(id); for (const w of BaseWindow.getAllWindows()) if (!w.isVisible()) w.showInactive(); },
      } });
    });
    write('receipt-' + platform + '.json', receipts[platform]);
  }));
} catch (e) { failures.push({ code: code(e) }); stopping = true; }
finally {
  captureDone = true;
  try { await host.shutdown(); } catch (e) { failures.push({ code: code(e), phase: 'BROWSER_SHUTDOWN' }); }
  pump();
  while (running || queue.size && !aiHalt && !stopping) { await new Promise(r => setTimeout(r, 500)); pump(); }
  const snapshots = [...raw.values()]; write('snapshots.json', snapshots); write('failures.json', failures);
  for (const mode of modes) {
    const rows = store.results(contexts[mode]); const selection = store.selectTarget(contexts[mode], 1000);
    const targetKeys = new Set(selection.target.map(r => r.platform + ':' + r.rootId));
    const exported = rows.map(r => ({ platform: r.snapshot.platform, id: r.snapshot.root_post_id, url: r.snapshot.post?.permalink,
      text: r.snapshot.post?.text ?? '', comments: r.snapshot.comments, author: r.snapshot.post?.author,
      classification: r.decision.classification, assessment_status: r.decision.assessment_status,
      reason: r.decision.attributes?.need_summary ?? r.decision.reason_code, evidence_ids: r.decision.evidence_ids,
      attributes: r.decision.attributes, stale: r.stale,
      selection: targetKeys.has(r.snapshot.platform + ':' + r.snapshot.root_post_id) ? 'TARGET' : r.decision.classification === 'SUITABLE' && !r.stale ? 'EXTRA' : null }));
    write('results-' + mode + '.json', { mode, campaign: plans[mode], selection, rows: exported, decisions: rows });
    write('accepted-' + mode + '.json', exported.filter(r => r.classification === 'SUITABLE' && !r.stale));
  }
  write('summary.json', { task, output, receipts, raw: raw.size, accepted: Object.fromEntries(modes.map(m => [m, count(m)])),
    failures: failures.length, aiHalt, cost: gateway.summary(), incrementalFilterCosts: costs, spending: spending.status(), finishedAt: new Date().toISOString() });
  completed = true; clearInterval(timer); publish(true); store.close(); app.exit(aiHalt ? 2 : 0);
}
}
main().catch(error => { console.error('PIANO_RUN_FAILED:' + (/^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'STARTUP_ERROR')); app.exit(1); });
