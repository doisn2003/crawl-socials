import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runtimePaths } from '../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../dist/infrastructure/browser/browser-host.js';
import { createProductionService } from '../dist/application/production-service.js';
import { createOpportunityPipeline } from '../dist/application/opportunity-pipeline.js';
import { createCampaignModelGateway } from '../dist/infrastructure/llm/campaign-model-gateway.js';
import { runThreadsCollector } from './threads-collector.mjs';
import { runFacebookCollector } from './facebook-collector.mjs';
import { collectConversation, resolveThreadsReplyRoot } from './conversation-collector.mjs';
import { parseOpportunityRunnerOptions, selectOpportunityRunnerProfiles } from './opportunity-runner-options.mjs';

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const code = error => error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'CAMPAIGN_FAILED';
let host, service, timer, finishing = false;
async function main() {
  const configPath = argument('--config');
  if (!configPath && !process.argv.includes('--resume')) throw Error('CAMPAIGN_CONFIG_REQUIRED');
  const config = configPath ? JSON.parse(readFileSync(resolve(configPath), 'utf8')) : null;
  const options = parseOpportunityRunnerOptions(config);
  const appData = app.getPath('appData'), paths = runtimePaths(appData);
  for (const [name, directory] of Object.entries(paths)) { mkdirSync(directory, { recursive: true }); app.setPath(name, directory); }
  app.setName('TrendLink');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  if (!app.requestSingleInstanceLock()) throw Error('CSD_ALREADY_RUNNING');
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => { if (!finishing) { event.preventDefault(); void service?.stop(); } });
  await app.whenReady();
  const directory = join(paths.userData, 'data');
  const profiles = createBrowserProfiles(directory);
  host = createBrowserHost({ profiles, secrets: createElectronSecretStore(join(paths.userData, 'secrets')),
    journalDirectory: join(directory, 'session-snapshots'), manualLoginEnabled: true, backgroundThrottling: false });
  service = createProductionService({ directory, version: app.getVersion(), host, collectConversation, resolveThreadsReplyRoot, watchAfterDiscovery: false,
    createOpportunity(value) { return createOpportunityPipeline({ ...value, ...(config?.seedQueries?.length ? { seedQueries: config.seedQueries } : {}),
      ...(options.maxRunMinutes === undefined ? {} : { maxRunMinutes: options.maxRunMinutes }),
      ...(config?.primaryModel ? { gateway: createCampaignModelGateway({ directory: join(value.directory, 'opportunity'), budgetUsd: value.config.budgetUsd,
        primaryModel: config.primaryModel, selectionReason: config.modelChangeReason ?? 'EXPLICIT_MODEL_SELECTION' }) } : {}) }); },
    async withConversationWindow(profileId, work) {
      if (!(await host.sessionStatus(profileId))) throw Error('LOGIN_REQUIRED');
      try { await host.open(profileId); const target = host.observerTarget(profileId); if (!target) throw Error('PROFILE_UNAVAILABLE'); await work(target.contents); }
      finally { await host.close(profileId); }
    },
    collect(value) { return (value.platform === 'threads' ? runThreadsCollector : runFacebookCollector)({ ...value, host }); } });
  let state = await service.getState();
  if (process.argv.includes('--resume')) state = await service.resume();
  else {
    service.saveConfig({ ...state.config, schemaVersion: 2, opportunity: config.opportunity });
    const selected = selectOpportunityRunnerProfiles(state.accounts, options.profiles);
    state = await service.start({ profiles: selected });
  }
  const output = state.run.outputDirectory;
  const runtime = { app_data: appData, user_data: paths.userData, user_data_real: realpathSync(paths.userData),
    session_data: paths.sessionData, session_data_real: realpathSync(paths.sessionData), data_directory: directory,
    data_directory_real: realpathSync(directory), output_real: realpathSync(output) };
  if (process.argv.includes('--resume') && existsSync(join(output, 'STOP'))) renameSync(join(output, 'STOP'), join(output, 'STOP.ack-' + Date.now()));
  writeFileSync(join(output, 'runner.json'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString(), total_target: state.run.opportunity?.totalTarget, runtime_paths: runtime }, null, 2), { flush: true });
  console.log(JSON.stringify({ event: 'STARTED', run_id: state.run.id, output, runtime_paths: runtime }));
  timer = setInterval(() => {
    if (existsSync(join(output, 'STOP'))) { void service.stop(); return; }
    const progress = service.progress(), opportunity = progress?.opportunity;
    console.log(JSON.stringify({ event: 'PROGRESS', state: progress?.state, raw: progress?.platforms.map(p => ({ platform: p.platform, count: p.count, state: p.state })),
      ...(opportunity ? { suitable: opportunity.counts.suitable, classified_pending: opportunity.counts.pending, comments: opportunity.counts.comments,
        threads: opportunity.byPlatform.threads.suitable, facebook: opportunity.byPlatform.facebook.suitable,
        model_usd: opportunity.costUsd, cost_upper_usd: opportunity.costUpperUsd, phase: opportunity.phase, error: opportunity.lastError } : {}) }));
  }, 10000);
  await service.settled(); clearInterval(timer);
  const results = await service.snapshotResults();
  writeFileSync(join(output, 'campaign-results.json'), JSON.stringify(results, null, 2), { flush: true });
  console.log(JSON.stringify({ event: 'FINISHED', state: results.run.state, opportunity: results.run.opportunity ? {
    counts: results.run.opportunity.counts, byPlatform: results.run.opportunity.byPlatform, costUsd: results.run.opportunity.costUsd,
  } : null }));
  await service.shutdown(); await host.shutdown(); finishing = true;
  app.exit(results.run.state === 'COMPLETED' ? 0 : 2);
}
main().catch(async error => {
  if (timer) clearInterval(timer);
  console.error(code(error));
  try { await service?.shutdown(); await host?.shutdown(); } catch { /* Safe failure already reported. */ }
  finishing = true; app.exit(1);
});
