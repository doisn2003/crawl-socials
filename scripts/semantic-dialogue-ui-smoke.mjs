// Isolated Electron renderer smoke: no account profiles, API keys or network calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const output = resolve(process.argv[2] || 'artifacts/semantic-dialogue-ui'); await mkdir(output, { recursive: true });
const temporaryBase = await realpath(tmpdir()), temporary = await mkdtemp(join(temporaryBase, 'csd-semantic-ui-'));
const config = { filterMode: 'STANDARD', enabled: true, prompt: 'Tìm người mua bán đàn piano', brandContext: '', totalTarget: 10, rawCap: 30, budgetUsd: 3, commentsEnabled: false };
const cost = { measuredUsd: .003, unknownUpperUsd: 0, reservedUsd: 0 };
const question = { id: 'who', target_field: 'target_roles', type: 'single_select', prompt: 'Bạn muốn tìm người hỏi mua hay người rao bán đàn piano?',
  options: [{ id: 'buyer', label: 'Người đang hỏi mua' }, { id: 'seller', label: 'Người đang rao bán' }], required: true, reason: 'Lựa chọn này quyết định loại bài được nhận.' };
const intent = Object.keys({ target_roles: 0, purpose: 0, include: 0, exclude: 0, topics: 0, geography: 0, time: 0 })
  .map(field => ({ field, value: 'Chưa rõ', status: field === 'target_roles' ? 'UNRESOLVED' : 'UNSPECIFIED', evidence: [] }));
const dialogue = { runId: 'fixture-run', revision: 'revision-1', config, configHash: 'fixture', cost,
  input: { stage: 'S2', revision: 1, prompt: config.prompt, context: '', seeds: [], answers: [], edits: [] },
  plan: { state: 'NEEDS_CLARIFICATION', understanding: 'Cần làm rõ đối tượng mua hoặc bán đàn piano.', intent_revision: 1, intent, questions: [question] } };
const initial = { version: '0.3.0-rc.5', config: { schemaVersion: 2, keywords: [], minimumPosts: 10, opportunity: config }, accounts: [], run: null, campaignDialogue: dialogue };
const criteria = { topic: 'Đàn piano', audience: ['Người hỏi mua đàn piano'], needs: ['Mua đàn'], participation_intents: [], research_intents: [], inclusions: ['Người hỏi mua'],
  exclusions: ['Người rao bán'], brand_context: null, required_geographies: [], preferred_geographies: [], languages: [], source_priority: ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'],
  queries: [{ text: 'cần mua đàn piano', family: 'BROAD', platforms: ['threads', 'facebook'] }], assumptions: [], max_age_days: null,
  watch: { enabled: true, revisit_hours: [2, 8, 24], ttl_hours: 72, max_attempts: 3 } };
const ready = { ...initial, campaignDialogue: { ...dialogue, revision: 'revision-2', input: { ...dialogue.input, revision: 2 },
  plan: { ...dialogue.plan, state: 'READY', understanding: 'Tìm người đang hỏi mua đàn piano.', intent_revision: 2, questions: [], intent: intent.map(f => f.field === 'target_roles' ? { ...f, value: 'Người hỏi mua đàn piano', status: 'CONFIRMED' } : f) } },
  campaignDraft: { runId: 'fixture-run', revision: 'draft-2', status: 'DRAFT', supported: true, config, configHash: 'fixture', cost, criteria,
    criteriaCapabilities: { extendedClassificationCriteria: true } } };
const preload = `const {contextBridge}=require('electron');let state=${JSON.stringify(initial)},last=null;const ready=${JSON.stringify(ready)};
contextBridge.exposeInMainWorld('csd',{getState:async()=>state,saveConfig:async config=>{state.config=config;return config},prepareCampaign:async()=>state,
continueCampaign:async request=>{last=request;if(!request.answers?.some(a=>a.raw_text||a.selected_option_ids.length))throw Error('CAMPAIGN_ANSWER_INVALID');state=ready;return state},
listRetainedSources:async()=>({sources:[],issues:[]}),geminiKey:{status:async()=>({source:'NONE'})},cooler:{get:async()=>false,set:async()=>false}});
contextBridge.exposeInMainWorld('semanticSmoke',{last:()=>last,showResults:()=>{const counts={raw:4,comments:2,suitable:1,notSuitable:2,notYet:1,unrelated:1,pending:1,failed:0};
state={...state,campaignDialogue:null,campaignDraft:null,run:{id:'fixture-results',state:'COMPLETED',startedAt:'2026-11-02T00:00:00Z',finishedAt:'2026-11-02T00:01:00Z',minimumPosts:1,keywords:['cần mua đàn piano'],outputDirectory:'fixture',platforms:[{platform:'threads',count:4,state:'COMPLETED',reason:'TARGET_MET'}],preview:[],
opportunity:{campaignId:'fixture-results',totalTarget:1,threadsShare:.8,counts,byPlatform:{threads:counts,facebook:{...counts,suitable:0}},costUsd:0,costUpperUsd:0,usageUnknown:0,budgetUsd:3,phase:'COMPLETED',lastError:null,evaluationPolicy:'GOAL_EVIDENCE',
preview:[{platform:'threads',rootId:'offer',classification:'SUITABLE',text:'Cho thuê phòng 3 triệu',link:'',reason:'Đúng nguồn phòng cần tìm',evidence:[],observedAt:'2026-11-02T00:00:00Z',coverage:'NOT_ATTEMPTED',conditions:[{label:'Giá dưới 4 triệu',status:'PASS',evidence:['3 triệu']}]},
{platform:'threads',rootId:'seeker',classification:'NOT_SUITABLE',text:'Tôi cũng đang tìm phòng',link:'',reason:'Sai vai trò cần tìm',evidence:[],observedAt:'2026-11-02T00:00:00Z',coverage:'NOT_ATTEMPTED'},
{platform:'threads',rootId:'old-negative',classification:'NOT_YET',text:'Bản ghi cũ được gộp khi xem',link:'',reason:'Không đáp ứng',evidence:[],observedAt:'2026-11-02T00:00:00Z',coverage:'NOT_ATTEMPTED'}]}}};},showOff:()=>{const o=state.run.opportunity;state={...state,run:{...state.run,opportunity:{...o,filterMode:'OFF',resultPolicy:'GLOBAL_FIRST_QUALIFIED',budgetUsd:0,totalTarget:3,targetCount:3,extraCount:1,
counts:{...o.counts,raw:4,suitable:0,notSuitable:0,notYet:0,unrelated:0,pending:4},preview:[{...o.preview[0],classification:'UNASSESSED',reason:'Chưa đánh giá · Không dùng AI',conditions:undefined}]}}};}});`;
const main = `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(temporary, 'user-data'))});
app.whenReady().then(async()=>{let window;try{
window=new BrowserWindow({show:false,width:1100,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(temporary, 'preload.cjs'))}}});
window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error(event.message)}});
await window.loadFile(${JSON.stringify(join(workspace, 'dist/renderer/index.html'))});
const run=code=>window.webContents.executeJavaScript(code);const until=async code=>{for(let n=0;n<100;n++){if(await run(code))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI_TIMEOUT:'+code)};
await until("!document.getElementById('campaign-dialogue').hidden");
assert.equal(await run("document.querySelectorAll('#campaign-dialogue input:checked').length"),0);
await run("document.querySelector('#campaign-dialogue form').requestSubmit()");
await until("document.body.innerText.includes('Hãy trả lời các câu hỏi bắt buộc')");
await run("const field=document.querySelector('#campaign-dialogue textarea');field.value='Chỉ tìm người hỏi mua đàn piano';field.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#campaign-dialogue form').requestSubmit()");
await until("document.querySelector('#criteria-queries').value==='cần mua đàn piano'");
assert.equal((await run('window.semanticSmoke.last()')).answers[0].raw_text,'Chỉ tìm người hỏi mua đàn piano');
assert.equal(await run("document.querySelector('#criteria-audience').disabled"),false);
await run("document.getElementById('campaign-plan-editor').open=true");
assert.equal(await run("document.querySelector('#criteria-queries').offsetParent!==null"),true);
await run("document.getElementById('campaign-dialogue').scrollIntoView({block:'start',behavior:'instant'})");
await new Promise(resolve=>setTimeout(resolve,150));
fs.writeFileSync(${JSON.stringify(join(output, 'dialogue-ready.png'))},(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
await run('window.semanticSmoke.showResults()');
await until("document.querySelector('#opportunity-cards').innerText.includes('Cho thuê phòng 3 triệu')");
assert.deepEqual(await run("Array.from(document.querySelectorAll('[data-result-group]'),b=>b.dataset.resultGroup)"),['SUITABLE','NOT_SUITABLE']);
await run("document.querySelector('#opportunity-cards details').open=true");
assert.equal(await run("document.querySelector('#opportunity-cards').innerText.includes('Đạt · Giá dưới 4 triệu')"),true);
await run("document.querySelector('[data-result-group=NOT_SUITABLE]').click()");
assert.equal(await run("document.querySelectorAll('#opportunity-cards article').length"),2);
assert.equal(await run("document.querySelector('[data-result-group=NOT_SUITABLE]').getAttribute('aria-pressed')"),'true');
assert.equal(await run("document.querySelector('[data-result-group=SUITABLE]').getAttribute('aria-pressed')"),'false');
assert.equal(await run("document.querySelector('#opportunity-summary').innerText.includes('1 đang chờ')"),true);
// Hidden Electron windows can pause CSS transitions; capture the settled tab styles.
await run("document.querySelectorAll('[data-result-group]').forEach(button=>button.style.transition='none')");
await run("document.getElementById('opportunity-results').scrollIntoView({block:'start',behavior:'instant'})");
await new Promise(resolve=>setTimeout(resolve,250));
fs.writeFileSync(${JSON.stringify(join(output, 'binary-results.png'))},(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
await run('window.semanticSmoke.showOff()');
await until("document.querySelector('#result-count').innerText.includes('3 / 3 BÀI CHƯA ĐÁNH GIÁ')");
assert.equal(await run("Array.from(document.querySelectorAll('[data-result-group]')).every(b=>b.hidden)"),true);
assert.equal(await run("document.querySelector('#opportunity-cards').innerText.includes('Chưa đánh giá')"),true);
assert.equal(await run("document.querySelector('#opportunity-summary').innerText.includes('1 bài bổ sung')"),true);
await run("var slider=document.querySelector('#filter-mode');slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}))");
await until("document.querySelector('#model-budget').disabled && !document.querySelector('#legacy-config').hidden");
assert.equal(await run("document.querySelector('#filter-mode-help').innerText.includes('0 USD API')"),true);
await run("var reuse=document.querySelector('#off-saved-queries');reuse.value='previous-run';reuse.dispatchEvent(new Event('change',{bubbles:true}))");
await until("document.querySelector('#keywords').value==='cần mua đàn piano'");
await run("document.getElementById('opportunity-results').scrollIntoView({block:'start',behavior:'instant'})");
fs.writeFileSync(${JSON.stringify(join(output, 'off-results.png'))},(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
await run("var slider=document.querySelector('#filter-mode');slider.value='2';slider.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#spending-controls').open=true;document.querySelector('#filter-mode').scrollIntoView({block:'start',behavior:'instant'})");
await until("document.querySelector('#filter-mode-help').innerText.includes('Chất lượng')");
assert.equal(await run("document.querySelector('#spend-total').value"),'0');
fs.writeFileSync(${JSON.stringify(join(output, 'filter-controls.png'))},(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
assert.deepEqual(errors,[]);fs.writeFileSync(${JSON.stringify(join(output, 'ui-smoke.json'))},JSON.stringify({passed:true,noPreselectedAnswer:true,requiredAnswerError:true,freeTextSubmission:true,readyQueriesVisible:true,twoResultGroups:true,legacyNegativeMerged:true,pendingSeparate:true,criterionEvidenceVisible:true,offPreview:true,offNoVerdictTabs:true,extrasVisible:true,filterSlider:true,zeroInitialSpendLimit:true,offReusesSavedQueries:true,rendererErrors:errors},null,2));
window.destroy();app.exit(0);
}catch(error){console.error(error.message);window?.destroy();app.exit(1)}});`;
try {
  await writeFile(join(temporary, 'preload.cjs'), preload); await writeFile(join(temporary, 'main.cjs'), main);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [join(temporary, 'main.cjs')], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let error = ''; child.stderr.on('data', value => { error = (error + value).slice(-4000); });
  const timeout = setTimeout(() => child.kill(), 30000);
  try { const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); }); assert.equal(code, 0, error); }
  finally { clearTimeout(timeout); }
  console.log(await readFile(join(output, 'ui-smoke.json'), 'utf8'));
} finally { assert.equal(dirname(temporary), temporaryBase); await rm(temporary, { recursive: true, force: true }); }
