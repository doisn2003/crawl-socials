// Exercise the shipped ASAR planner with the reported failure; all transport is synthetic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const archive = resolve(option('asar', 'release/win-unpacked/resources/app.asar'));
const baseline = option('baseline', '');
const output = resolve(option('out', 'artifacts/r12-planner-hotfix'));
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url),
    '--asar=' + archive, '--baseline=' + baseline, '--out=' + output], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, logs); console.log(logs.trim());
} else {
  const { app } = await import('electron');
  const root = mkdtempSync(join(tmpdir(), 'csd-packaged-planner-hotfix-'));
  app.setPath('userData', join(root, 'electron')); app.setPath('sessionData', join(root, 'sessions'));
  process.env.USERPROFILE = root;
  let liveCalls = 0;
  globalThis.fetch = async () => { liveCalls++; throw Error('LIVE_NETWORK_FORBIDDEN'); };
  const timer = setTimeout(() => { console.error('HOTFIX_SMOKE_TIMEOUT'); app.exit(1); }, 30000);
  app.whenReady().then(async () => { try {
    const load = file => import(pathToFileURL(join(archive, 'dist', file)).href);
    const { prepareSemanticDraft, resolveDraftForStart } = await load('application/campaign-drafts.js');
    const { createCampaignModelGateway } = await load('infrastructure/llm/campaign-model-gateway.js');
    const { FIELDS } = await load('domain/semantic-keywords.mjs');
    const { plannerRecipeHash } = await load('application/compile-campaign.js');
    const { contentHash } = await load('domain/conversation.js');
    let sameRecipe = null;
    if (baseline) {
      const oldSource = readFileSync(join(resolve(baseline), 'dist/domain/semantic-keywords.mjs'), 'utf8');
      const old = await import('data:text/javascript;base64,' + Buffer.from(oldSource).toString('base64'));
      const hash = contentHash({ planner_policy: 'controlled-semantic-dialogue-v1', version: 'campaign-planner-v2.0.0-semantic-dialogue',
        system: old.EXPERIMENT_SYSTEM, schema: old.EXPERIMENT_SCHEMA, validator: old.VALIDATOR });
      sameRecipe = hash === plannerRecipeHash('controlled-semantic-dialogue-v1'); assert.equal(sameRecipe, true);
    }
    const prompt = 'Tìm các bài viết có liên quan tới từ khóa piano coffee, piano giá rẻ, coffee piano, cà phê piano, cà phê có piano, piano live, học piano, học piano giá rẻ, piano giá rẻ, trung tâm piano, dạy piano, cho mượn piano...';
    const role = 'Người dùng tìm kiếm địa điểm cà phê, dịch vụ học/dạy piano và mua bán đàn piano';
    const quote = 'học piano, học piano giá rẻ, trung tâm piano, dạy piano, cho mượn piano';
    const config = { enabled: true, filterMode: 'STANDARD', languageScope: 'VIETNAMESE', prompt, brandContext: '',
      totalTarget: 10, rawCap: 30, budgetUsd: 3, commentsEnabled: false };
    let fixtureCalls = 0;
    const gatewayFactory = options => createCampaignModelGateway({ ...options, mockTransport: true, apiKey: 'synthetic-key',
      minRequestIntervalMs: 0, maxAttempts: 1, fetch: async () => {
        fixtureCalls++;
        const value = { state: 'READY', intent_revision: 1, understanding: prompt, target_roles: [role], constraints: [],
          intent: Object.keys(FIELDS).map(field => ({ field, value: field === 'target_roles' ? role : 'Chưa đặt giới hạn',
            status: field === 'target_roles' ? 'CONFIRMED' : 'UNSPECIFIED', evidence: field === 'target_roles' ? [{ source: 'PROMPT', quote }] : [] })),
          branches: [{ id: 'piano', label: 'Piano', anchor: 'piano', source: 'PROMPT', quote: 'piano', scope: 'CORE', reason: 'Chủ đề gốc' }],
          queries: [{ text: 'piano', branch_id: 'piano', kind: 'EXACT', anchor: 'piano', rationale: 'Chủ đề gốc', risk: 'MEDIUM' }],
          questions: [], unresolved_fields: [], unconfirmed_assumptions: [], caveats: [], improvements: [] };
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300, totalTokenCount: 1300 } }), { status: 200 });
      } });
    const directory = join(root, 'data');
    const draft = await prepareSemanticDraft({ directory, config, gatewayFactory }); assert.ok('campaign' in draft);
    assert.equal(draft.source.plannerRecovery, 'EXPLICIT_USER_TOPIC_LIST');
    assert.equal(draft.criteria.queries.length, 11); assert.deepEqual(draft.criteria.audience, []);
    assert.ok(draft.criteria.queries.some(q => q.text === 'piano giá rẻ'));
    assert.deepEqual(draft.criteria.languages, ['vi']); assert.deepEqual(draft.criteria.required_geographies, []);
    const reopened = await prepareSemanticDraft({ directory, config, gatewayFactory, resumeRunId: draft.runId });
    assert.equal(reopened.revision, draft.revision); assert.equal(fixtureCalls, 1);
    assert.equal(resolveDraftForStart({ directory, runId: draft.runId, expectedRevision: draft.revision,
      expectedConfigHash: draft.configHash }).campaign.version, draft.campaign.version);
    assert.equal(liveCalls, 0);
    const report = { passed: true, version: JSON.parse(readFileSync(join(archive, 'package.json'), 'utf8')).version,
      actualAsarModules: true, userPromptAndReportedRoleEvidence: true, uniqueKeywords: 11, unrestrictedAuthors: true,
      restartWithoutReplanning: true, startPlanVerified: true, baselinePlannerRecipePreserved: sameRecipe,
      fixtureCalls, liveApiCalls: liveCalls, isolatedData: true };
    mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'planner-hotfix-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); clearTimeout(timer); app.quit();
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); } });
}
