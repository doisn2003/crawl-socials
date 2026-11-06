// Authorized A–CONSISTENT retest. This runner consumes an existing grant; it never creates one.
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimePaths } from '../../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../../dist/infrastructure/browser/browser-host.js';
import { developmentSpend, SPEND_DIRECTORY, REBUILD_MODEL } from '../../dist/infrastructure/llm/durable-spend.js';
import { createGeminiGateway } from '../../dist/infrastructure/llm/gemini-gateway.js';
import { createRequestScheduler } from '../../dist/infrastructure/llm/request-scheduler.js';
import { createProductionService } from '../../dist/application/production-service.js';
import { createOpportunityPipeline } from '../../dist/application/opportunity-pipeline.js';
import { prepareSemanticDraft } from '../../dist/application/campaign-drafts.js';
import { runQueryCollectors } from '../../dist/application/query-collector.js';
import { runFacebookCollector } from '../facebook-collector.mjs';
import { runThreadsCollector } from '../threads-collector.mjs';
import { exportOpportunityWorkbook, selectOpportunityExport } from '../../dist/infrastructure/export/opportunity-workbook.js';

const id = 'cafe-consistent-recovery-20261106';
const directory = resolve('artifacts', id), priorDirectory = resolve('artifacts/cafe-social-e2e-20261106');
mkdirSync(directory, { recursive: true });
const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const write = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { flush: true });
const authorizationPath = join(SPEND_DIRECTORY, 'development-authorization.json');
const prompt = 'Tìm nhu cầu tìm quán cafe chill; chia sẻ trải nghiệm đi cafe chill; thảo luận về quán cafe chill.';
const TARGET = 1000, RAW_CAP = 20000, MAX_MINUTES = 720, MAX_USD = 10, MAX_CALLS = 4000;
let task, spending, gateway, service, host, heartbeat, snapshotTimer, snapshotWork, lastProgress = null;
let state = 'PREPARING', error = null, stopping = false, admission = new Set(), ingestion = Promise.resolve();
let reusedRoots = new Set(), finished = false, runId = null;
const safe = value => /^[A-Z][A-Z0-9_]{1,100}$/.test(value?.code ?? value?.message ?? '') ? value.code ?? value.message : 'RECOVERY_LOCAL_FAILURE';
function status() {
  if (!task) return;
  const global = spending?.status();
  write('status.json', { id, state, at: new Date().toISOString(), startedAt: task.startedAt, runId, error,
    target: TARGET, progress: lastProgress, reusedRaw: reusedRoots.size, admittedRaw: admission.size,
    newlyDiscoveredRaw: [...admission].filter(key => !reusedRoots.has(key)).length,
    cost: gateway?.summary(), spending: global,
    taskUsd: global ? global.measuredUsd - task.startingSpending.measuredUsd : 0,
    taskCalls: global ? global.calls - task.startingSpending.calls : 0, capUsd: MAX_USD });
}
async function checkpoint() {
  if (!service || !runId || snapshotWork) return snapshotWork;
  snapshotWork = (async () => {
    const result = await service.snapshotResults();
    write('latest-results.json', result);
    lastProgress = result.run.opportunity;
    status();
  })().catch(e => appendFileSync(join(directory, 'checkpoint-errors.jsonl'), JSON.stringify({ at: new Date().toISOString(), code: safe(e) }) + '\n'))
    .finally(() => { snapshotWork = null; });
  return snapshotWork;
}
async function main() {
  if (!process.argv.includes('--live')) throw Error('LIVE_FLAG_REQUIRED');
  if (existsSync(join(directory, 'closed-spending.json'))) throw Error('TASK_ALREADY_CLOSED');
  const authorization = JSON.parse(readFileSync(authorizationPath, 'utf8'));
  if (authorization.scope !== 'DEVELOPMENT' || authorization.model !== REBUILD_MODEL
    || authorization.purpose !== id || authorization.closedAt) throw Error('TASK_AUTHORIZATION_REQUIRED');
  spending = developmentSpend();
  if (existsSync(join(directory, 'task.json'))) {
    if (!process.argv.includes('--resume')) throw Error('RESUME_FLAG_REQUIRED');
    task = read('task.json');
  } else {
    if (process.argv.includes('--resume')) throw Error('TASK_MANIFEST_REQUIRED');
    const before = spending.status();
    if (before.heldUsd) throw Error('UNSETTLED_HISTORICAL_SPEND');
    task = { id, startedAt: new Date().toISOString(), model: REBUILD_MODEL, prompt, target: TARGET, rawCap: RAW_CAP,
      maxRunMinutes: MAX_MINUTES, maxTaskUsd: MAX_USD, maxTaskCalls: MAX_CALLS, startingSpending: before,
      authorization: 'User explicitly granted USD10 for A CONSISTENT target1000 following discovery/pending fixes; multi-hour runs allowed.',
      source: 'ProductionService + real Electron collectors; retained470 raw from prior A only, no old1000 cafe delivery imported.',
      commentsEnabled: false };
    write('task.json', task);
  }
  if (task.id !== id || task.maxTaskUsd !== MAX_USD || task.prompt !== prompt
    || authorization.totalUsd > task.startingSpending.measuredUsd + MAX_USD + 1e-9
    || authorization.maxCalls > task.startingSpending.calls + MAX_CALLS) throw Error('TASK_ENVELOPE_MISMATCH');
  if (process.argv.includes('--resume')) {
    // Keep each interrupted outcome inspectable while the current output advances.
    const archive = join(directory, 'checkpoints', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(archive, { recursive: true });
    for (const name of ['status.json', 'results.json', 'summary.json', 'spending-checkpoint.json', 'A-CONSISTENT.xlsx']) {
      if (existsSync(join(directory, name))) copyFileSync(join(directory, name), join(archive, name));
    }
  }
  appendFileSync(join(directory, 'launches.jsonl'), JSON.stringify({ at: new Date().toISOString(), resume: process.argv.includes('--resume'), spending: spending.status() }) + '\n');
  const paths = runtimePaths(app.getPath('appData'));
  for (const [name, path] of Object.entries(paths)) { mkdirSync(path, { recursive: true }); app.setPath(name, path); }
  app.setName('CSD'); app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  if (!app.requestSingleInstanceLock()) throw Error('CSD_ALREADY_RUNNING');
  app.on('window-all-closed', () => {}); await app.whenReady();
  const cacheDirectory = join(directory, 'assessment-cache'); mkdirSync(cacheDirectory, { recursive: true });
  if (!existsSync(join(directory, 'retained-import.json'))) {
    const source = JSON.parse(readFileSync(join(priorDirectory, 'results-A-CONSISTENT.json'), 'utf8'));
    const snapshots = source.opportunity.snapshots.filter(snapshot => snapshot.post);
    write('retained-A.json', snapshots);
    let copied = 0;
    for (const file of readdirSync(join(priorDirectory, 'assessment-cache'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue; // Primary caches only; old QUALITY reviews are a separate comparison.
      const value = JSON.parse(readFileSync(join(priorDirectory, 'assessment-cache', file), 'utf8'));
      if (!['COMPLETE', 'FAILED', 'STARTED'].includes(value.state)) continue;
      copyFileSync(join(priorDirectory, 'assessment-cache', file), join(cacheDirectory, file)); copied++;
    }
    write('retained-import.json', { source: join(priorDirectory, 'results-A-CONSISTENT.json'), count: snapshots.length,
      sha256: createHash('sha256').update(JSON.stringify(snapshots)).digest('hex'), primaryCacheFilesCopied: copied,
      recovery: 'Legacy FAILED/STARTED keep at least one spent attempt; model costs remain in the closed prior task ledger.' });
  }
  const retained = read('retained-A.json');
  const retainedManifest = read('retained-import.json');
  if (!Array.isArray(retained) || retained.length !== retainedManifest.count
    || createHash('sha256').update(JSON.stringify(retained)).digest('hex') !== retainedManifest.sha256
    || new Set(retained.map(snapshot => snapshot.platform + ':' + snapshot.root_post_id)).size !== retained.length
    || retained.some(snapshot => !snapshot.post || snapshot.comments.length)) throw Error('RETAINED_INPUT_INVALID');
  reusedRoots = new Set(retained.map(snapshot => snapshot.platform + ':' + snapshot.root_post_id));
  admission = new Set(reusedRoots);
  gateway = createGeminiGateway({ directory: join(directory, 'model'), model: REBUILD_MODEL, spending,
    budgetUsd: MAX_USD, maxAttempts: 1, timeoutMs: 90000,
    scheduler: createRequestScheduler({ concurrency: 2, rpm: 60, inputTpm: 400000, rpd: 5000, minIntervalMs: 500 }) });
  const profiles = createBrowserProfiles(join(paths.userData, 'data'));
  host = createBrowserHost({ profiles, secrets: createElectronSecretStore(join(paths.userData, 'secrets')),
    journalDirectory: join(paths.userData, 'data/session-snapshots'), manualLoginEnabled: true, hidden: true, backgroundThrottling: false });
  const available = await profiles.list();
  const selected = ['facebook', 'threads'].map(platform => {
    const choices = available.filter(profile => (profile.platform ?? 'facebook') === platform
      && profile.label === (platform === 'facebook' ? 'CSD Facebook' : 'CSD Threads'));
    if (choices.length !== 1) throw Error('PROFILE_SELECTION_REQUIRED');
    return { platform, profileId: choices[0].id };
  });
  for (const profile of selected) if (!await host.sessionStatus(profile.profileId)) throw Error('LOGIN_REQUIRED');
  write('profiles.json', selected);
  const liveData = join(app.getPath('appData'), 'csd-e2e-tests', id);
  write('live-data-path.json', { directory: liveData });
  service = createProductionService({ directory: liveData, version: 'production-v2-discovery-recovery', host, watchAfterDiscovery: false,
    prepareCampaignDraft: args => prepareSemanticDraft({ ...args, gatewayFactory: () => gateway }),
    createOpportunity: async args => {
      const pipeline = await createOpportunityPipeline({ ...args, gateway, classificationWorkers: 2,
        assessmentCacheDirectory: cacheDirectory, maxRunMinutes: MAX_MINUTES,
        onProgress: progress => { args.onProgress?.(progress); lastProgress = progress; } });
      // Idempotent ingestion preserves snapshots on Resume; original raw remains separately inspectable.
      for (const platform of ['facebook', 'threads']) {
        const rows = retained.filter(snapshot => snapshot.platform === platform).map(snapshot => ({
          post_id: snapshot.root_post_id, text: snapshot.post.text, collected_at: snapshot.observed_at,
          post_url: snapshot.post.permalink, published_at: snapshot.post.published_at,
          author_name: snapshot.post.author?.name, source_type: snapshot.post.source?.kind }));
        await pipeline.ingestRows(platform, rows, { method: 'RETAINED_PRIOR_A_RAW' });
      }
      for (const snapshot of await pipeline.store.snapshots()) if (snapshot.post) admission.add(snapshot.platform + ':' + snapshot.root_post_id);
      return pipeline;
    },
    collectConversation: async () => { throw Error('COMMENTS_FORBIDDEN'); },
    collect: input => runQueryCollectors({ ...input,
      shouldStop: () => input.shouldStop() || stopping || existsSync(join(directory, 'STOP')),
      onRecords: (rows, provenance) => {
        const next = ingestion.then(async () => {
          const kept = [];
          for (const row of rows) {
            if (row.is_reply === true || row.entity_type === 'COMMENT' || typeof row.post_id !== 'string' || !row.post_id) continue;
            const key = input.platform + ':' + row.post_id;
            if (!admission.has(key)) { if (admission.size >= RAW_CAP) continue; admission.add(key); }
            kept.push(row);
          }
          if (kept.length) await input.onRecords?.(kept, provenance);
        }); ingestion = next; return next;
      },
    }, (child, worker) => (input.platform === 'facebook' ? runFacebookCollector : runThreadsCollector)({ ...child, host: host.forWorker(worker) })),
  });
  const saved = await service.getState();
  if (process.argv.includes('--resume') && saved.run?.opportunity) {
    runId = saved.run.id; state = 'COLLECTING'; status(); await service.resume();
  } else {
    service.saveConfig({ schemaVersion: 2, performance: 'BALANCED', keywords: [], minimumPosts: TARGET,
      opportunity: { enabled: true, prompt, brandContext: '', filterMode: 'CONSISTENT', languageScope: 'VIETNAMESE',
        totalTarget: TARGET, rawCap: RAW_CAP, budgetUsd: MAX_USD, commentsEnabled: false } });
    state = 'PLANNING'; status();
    let prepared = await service.prepareCampaign();
    if (prepared.campaignDraftError) throw Error(prepared.campaignDraftError.code);
    if (!prepared.campaignDraft) { write('clarification.json', prepared.campaignDialogue); throw Error('CAMPAIGN_INTENT_UNRESOLVED'); }
    const oldCampaign = JSON.parse(readFileSync(join(priorDirectory, 'results-A-CONSISTENT.json'), 'utf8')).opportunity.campaign;
    const fields = ['topic', 'audience', 'needs', 'participation_intents', 'research_intents', 'inclusions', 'exclusions',
      'brand_context', 'required_geographies', 'preferred_geographies', 'languages', 'max_age_days'];
    const frozenCriteria = Object.fromEntries(fields.map(field => [field, oldCampaign[field]]));
    write('comparison-criteria.json', { policy: 'Same acceptance criteria as prior A; new planner changes retrieval portfolio only.',
      generatedCriteria: Object.fromEntries(fields.map(field => [field, prepared.campaignDraft.campaign[field]])),
      frozenCriteria, sha256: createHash('sha256').update(JSON.stringify(frozenCriteria)).digest('hex') });
    prepared = await service.updateCampaign({ runId: prepared.campaignDraft.runId,
      expectedRevision: prepared.campaignDraft.revision, criteriaPatch: frozenCriteria });
    if (!prepared.campaignDraft) throw Error('COMPARISON_DRAFT_MISSING');
    if (JSON.stringify(Object.fromEntries(fields.map(field => [field, prepared.campaignDraft.campaign[field]]))) !== JSON.stringify(frozenCriteria)) throw Error('COMPARISON_CRITERIA_CHANGED');
    runId = prepared.campaignDraft.runId; write('campaign.json', prepared.campaignDraft.campaign);
    state = 'COLLECTING'; status(); await service.start({ profiles: selected });
  }
  heartbeat = setInterval(() => {
    status();
    const limits = spending.status();
    const budgetStop = limits.measuredUsd + limits.heldUsd - task.startingSpending.measuredUsd >= MAX_USD - 1e-6
      || /MODEL_(?:GLOBAL_BUDGET|BUDGET_EXHAUSTED|CALL_LIMIT)/.test(lastProgress?.lastError ?? '');
    if ((existsSync(join(directory, 'STOP')) || budgetStop) && !stopping) {
      stopping = true; error = budgetStop ? 'TASK_BUDGET_REACHED' : 'USER_STOP'; void service.stop();
    }
  }, 10000);
  snapshotTimer = setInterval(() => { void checkpoint(); }, 60000);
  await service.settled(); await ingestion; await snapshotWork;
  // Collectors may notice STOP and settle before the ten-second heartbeat does.
  if (existsSync(join(directory, 'STOP'))) { stopping = true; error ??= 'USER_STOP'; }
  const result = await service.snapshotResults(); write('results.json', result);
  lastProgress = result.run.opportunity;
  if (!result.opportunity) throw Error('RESULTS_MISSING');
  const exported = selectOpportunityExport(result.opportunity, 'SUITABLE');
  await exportOpportunityWorkbook(join(directory, 'A-CONSISTENT.xlsx'), exported);
  const snapshots = result.opportunity.snapshots.filter(snapshot => snapshot.post);
  write('raw.json', snapshots);
  const pendingBefore = new Map(JSON.parse(readFileSync(join(priorDirectory, 'results-A-CONSISTENT.json'), 'utf8')).opportunity.conversations
    .filter(row => row.decision.assessment_status !== 'ASSESSED').map(row => [row.snapshot.platform + ':' + row.snapshot.root_post_id, row.decision.reason_code]));
  const recovered = result.opportunity.conversations.filter(row => pendingBefore.has(row.snapshot.platform + ':' + row.snapshot.root_post_id));
  write('summary.json', { task, finishedAt: new Date().toISOString(), runId, runState: result.run.state, progress: lastProgress,
    reusedRaw: reusedRoots.size, totalRaw: snapshots.length,
    newRaw: snapshots.filter(snapshot => !reusedRoots.has(snapshot.platform + ':' + snapshot.root_post_id)).length,
    exportedRoots: exported.conversations.length, retainedPending: [...pendingBefore].length,
    pendingRecovery: recovered.reduce((counts, row) => { const key = row.decision.classification ?? row.decision.reason_code; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}),
    queryWorkers: result.run.platforms.map(platform => ({ platform: platform.platform, reason: platform.reason, workers: platform.workers })),
    cost: gateway.summary(), spending: spending.status(), usefulnessPrecision: null,
    caveat: 'Accepted means model selected, not independently confirmed useful. Reused470 raw is counted separately from new collection.' });
  finished = (lastProgress.targetCount ?? 0) >= TARGET;
  state = finished ? 'TARGET_REACHED' : stopping ? 'STOPPED' : 'PARTIAL'; status();
}
main().catch(e => { error = safe(e); if (/MODEL_(?:GLOBAL_BUDGET|BUDGET_EXHAUSTED|CALL_LIMIT)/.test(error)) error = 'TASK_BUDGET_REACHED';
  state = 'PAUSED_ERROR'; console.error(error); }).finally(async () => {
  if (heartbeat) clearInterval(heartbeat); if (snapshotTimer) clearInterval(snapshotTimer);
  try { await snapshotWork; await service?.shutdown(); await host?.shutdown(); } catch (e) { error ??= safe(e); }
  if (spending && task) {
    const actual = spending.status();
    write('spending-checkpoint.json', { at: new Date().toISOString(), taskUsd: actual.measuredUsd - task.startingSpending.measuredUsd,
      taskCalls: actual.calls - task.startingSpending.calls, taskHeldUsd: actual.heldUsd, cumulative: actual });
    if (finished || error === 'TASK_BUDGET_REACHED') {
      const authorization = JSON.parse(readFileSync(authorizationPath, 'utf8'));
      if (authorization.purpose === id) writeFileSync(authorizationPath, JSON.stringify({ ...authorization,
        totalUsd: actual.measuredUsd + actual.heldUsd, dailyUsd: actual.measuredUsd + actual.heldUsd,
        maxCalls: actual.calls, closedAt: new Date().toISOString() }, null, 2), { flush: true });
      write('closed-spending.json', read('spending-checkpoint.json'));
    }
    status();
  }
  app.exit(finished && !error ? 0 : 2);
});
