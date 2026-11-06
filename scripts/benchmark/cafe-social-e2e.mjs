// Explicit user-authorized live E2E, 2026-11-06. One cumulative USD5 envelope.
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, rmSync } from 'node:fs';
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

const dir = resolve('artifacts/cafe-social-e2e-20261106'); mkdirSync(dir, { recursive: true });
const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2), { flush: true });
const safe = e => /^[A-Z][A-Z0-9_]+$/.test(e?.code ?? e?.message ?? '') ? e.code ?? e.message : 'E2E_LOCAL_FAILURE';
const taskId = 'cafe-social-e2e-20261106';
const prompts = {
  A: 'Tìm nhu cầu tìm quán cafe chill; chia sẻ trải nghiệm đi cafe chill; thảo luận về quán cafe chill.',
  B: 'Tìm nhu cầu hẹn hò với người chưa quen; gặp gỡ và giao lưu với người lạ; tìm bạn mới hoặc bạn trò chuyện; rủ người chưa quen đi cà phê.'
};
const stages = [ ['A','CONSISTENT','LIVE',20000], ['A','STANDARD','REPLAY',1000], ['A','QUALITY','REPLAY',1000], ['B','CONSISTENT','LIVE',1000], ['B','QUALITY','REPLAY',1000] ];
let service, host, gateway, spending, timer, current = null, done = false, taskError = null, stopping = false;
const results = [], pools = {}, baseSpending = existsSync(join(dir,'task.json')) ? read('task.json').startingSpending : null;
let task;
function status(phase = 'RUNNING') {
  const value = { taskId, phase, at: new Date().toISOString(), startedAt: task?.startedAt, stage: current, results, taskError,
    cost: gateway?.summary(), spending: spending?.status(), maxTaskUsd: 5 };
  write('status.json', value); return value;
}
async function main() {
  if (!process.argv.includes('--live')) throw Error('LIVE_FLAG_REQUIRED');
  if (existsSync(join(dir,'closed-spending.json')) && !process.argv.includes('--resume')) throw Error('TASK_ALREADY_CLOSED');
  if (baseSpending && (!process.argv.includes('--resume') || !((read('status.json').taskError === 'CAMPAIGN_SEMANTIC_VALIDATION_FAILED' && !read('status.json').results.length) || (process.argv.includes('--restart-empty-collection') && read('status.json').results.every(r=>r.raw===0)) || (process.argv.includes('--restart-after-fix') && read('status.json').taskError==='USER_STOP' && read('status.json').results.length===1 && read('status.json').results[0].topic==='A')))) throw Error('EXPLICIT_RESUME_HARNESS_REQUIRED');
  if(baseSpending&&read('status.json').results.length)write('empty-collection-harness-failures-'+Date.now()+'.json',read('status.json'));
  let recoveredA=[];
  if(process.argv.includes('--restart-after-fix')){
    const archive=join(dir,'trial-before-fix-'+Date.now());mkdirSync(archive,{recursive:true});
    for(const file of ['status.json','results-A-CONSISTENT.json','plan-A-CONSISTENT.json','summary.json'])if(existsSync(join(dir,file)))copyFileSync(join(dir,file),join(archive,file));
    recoveredA=JSON.parse(readFileSync(join(archive,'results-A-CONSISTENT.json'),'utf8')).opportunity.snapshots.filter(s=>s.post);
    rmSync(join(dir,'STOP'),{force:true});
  }
  const paths = runtimePaths(app.getPath('appData'));
  for (const [name,path] of Object.entries(paths)) { mkdirSync(path,{recursive:true}); app.setPath(name,path); }
  app.setName('CSD'); app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  if (!app.requestSingleInstanceLock()) throw Error('CSD_ALREADY_RUNNING');
  app.on('window-all-closed', () => {}); await app.whenReady();
  const actualBefore = developmentSpend().status(), before = baseSpending ?? actualBefore;
  if (actualBefore.heldUsd > 0) throw Error('UNSETTLED_HISTORICAL_SPEND');
  const authFile = join(SPEND_DIRECTORY,'development-authorization.json');
  const previous = JSON.parse(readFileSync(authFile,'utf8')); if(!baseSpending)write('prior-authorization.json',previous);
  task = baseSpending ? read('task.json') : { id:taskId, startedAt:new Date().toISOString(), model:REBUILD_MODEL, prompts, stages, startingSpending:before,
    maxTaskUsd:5, maxTaskCalls:1500, requestedOrder:true, commentsEnabled:false,
    comparison:'STANDARD/QUALITY replay the same first1000 unique raw roots of topicA; QUALITY replays topicB first1000. Frozen without predicted labels.',
    authorizedBy:'User requested five ordered live E2E cases, total maximum USD5, Gmail final and 30minute updates.' };
  if(baseSpending){appendFileSync(join(dir,'prompt-revisions.jsonl'),JSON.stringify({at:new Date().toISOString(),before:task.prompts,after:prompts,reason:'Simplify original equivalent topic scope before any collection; all historical attempts remain charged'})+'\n');task.prompts=prompts;}
  write('task.json',task);
  if(baseSpending){
    const pointer=join(dir,'app-data','active-campaign-draft.json');
    if(existsSync(pointer)){write('interrupted-draft-pointer.json',JSON.parse(readFileSync(pointer,'utf8')));writeFileSync(pointer,JSON.stringify({schemaVersion:1,state:'EMPTY'}),{flush:true});}
  }
  if(baseSpending)appendFileSync(join(dir,'resume-log.jsonl'),JSON.stringify({at:new Date().toISOString(),actualBefore,originalStartingSpending:baseSpending})+'\n');
  writeFileSync(authFile,JSON.stringify({scope:'DEVELOPMENT',model:REBUILD_MODEL,totalUsd:before.measuredUsd+5,dailyUsd:before.measuredUsd+5,
    maxCalls:before.calls+1500,purpose:taskId,authorizedAt:task.startedAt,previousMeasuredUsd:before.measuredUsd,previousCalls:before.calls},null,2),{flush:true});
  spending = developmentSpend();
  gateway = createGeminiGateway({directory:join(dir,'model'),model:REBUILD_MODEL,spending,budgetUsd:5,maxAttempts:1,timeoutMs:90000,
    scheduler:createRequestScheduler({concurrency:2,rpm:60,inputTpm:400000,rpd:5000,minIntervalMs:500})});
  const profiles = createBrowserProfiles(join(paths.userData,'data'));
  host = createBrowserHost({profiles,secrets:createElectronSecretStore(join(paths.userData,'secrets')),
    journalDirectory:join(paths.userData,'data','session-snapshots'),manualLoginEnabled:true,hidden:true,backgroundThrottling:false});
  const available = await profiles.list(), selected = ['facebook','threads'].map(platform => {
    const p=available.filter(p => (p.platform??'facebook')===platform && p.label===(platform==='facebook'?'CSD Facebook':'CSD Threads'));
    if(p.length!==1)throw Error('PROFILE_SELECTION_REQUIRED'); return {platform,profileId:p[0].id};
  });
  write('profiles.json',selected);
  for(const p of selected)if(!await host.sessionStatus(p.profileId))throw Error('LOGIN_REQUIRED');
  let admission = new Set(), serial = Promise.resolve();
  const liveData=join(app.getPath('appData'),'csd-e2e-tests',taskId);write('live-data-path.json',{directory:liveData});
  service = createProductionService({directory:liveData,version:'production-v2-e2e',host,watchAfterDiscovery:false,
    prepareCampaignDraft:args=>prepareSemanticDraft({...args,gatewayFactory:()=>gateway}),
    createOpportunity:async args=>{
      const pipeline=await createOpportunityPipeline({...args,gateway,classificationWorkers:2,assessmentCacheDirectory:join(dir,'assessment-cache'),
        onProgress:p=>{args.onProgress?.(p);if(current)current.progress=p;}});
      if(current.index===1&&recoveredA.length){
        for(const platform of ['facebook','threads']){
          const rows=recoveredA.filter(s=>s.platform===platform).map(s=>({post_id:s.root_post_id,text:s.post.text,collected_at:s.observed_at,post_url:s.post.permalink,published_at:s.post.published_at,author_name:s.post.author?.name,source_type:s.post.source?.kind}));
          rows.forEach(row=>admission.add(platform+':'+row.post_id));await pipeline.ingestRows(platform,rows,{method:'RECOVERED_PRE_FIX_RAW'});
        }
      }
      return pipeline;
    },
    collectConversation:async()=>{throw Error('COMMENTS_FORBIDDEN');},
    async collect(input){
      if(current.source==='REPLAY'){
        const rows=(pools[current.topic]??[]).filter(s=>s.platform===input.platform).map(s=>({post_id:s.root_post_id,text:s.post.text,collected_at:s.observed_at,
          post_url:s.post.permalink,published_at:s.post.published_at,author_name:s.post.author?.name,source_type:s.post.source?.kind}));
        await input.onRecords?.(rows,{method:'FROZEN_RAW_REPLAY',observed_at:new Date().toISOString()});
        return {stop_reason:'SOURCE_EXHAUSTED',summary:{unique:rows.length},session_flush:'OK'};
      }
      return runQueryCollectors({...input, config:{...input.config,maxMinutes:current.topic==='A'?120:60},
        shouldStop:()=>input.shouldStop()||stopping||existsSync(join(dir,'STOP')),
        collectionLimitReason:()=>stopping?'TASK_STOP':input.collectionLimitReason?.(),
        onRecords:(rows,provenance)=>{
          const work=serial.then(async()=>{
            const kept=[];for(const row of rows){
              if(row.is_reply===true||row.entity_type==='COMMENT'||typeof row.post_id!=='string'||!row.post_id)continue;
              const key=input.platform+':'+row.post_id;
              if(!admission.has(key)){if(admission.size>=current.rawCap)continue;admission.add(key);}kept.push(row);
            }
            if(kept.length)await input.onRecords?.(kept,provenance);
          });serial=work;return work;
        }
      },(child,worker)=>(input.platform==='facebook'?runFacebookCollector:runThreadsCollector)({...child,host:host.forWorker(worker)}));
    }});
  timer=setInterval(()=>{status();if(existsSync(join(dir,'STOP'))&&!stopping){stopping=true;void service.stop();}},10000);
  status();
  for(let index=0;index<stages.length;index++){
    const [topic,mode,source,rawCap]=stages[index];admission=new Set();serial=Promise.resolve();
    const before=gateway.summary(); current={index:index+1,total:stages.length,topic,mode,source,rawCap,target:1000,startedAt:new Date().toISOString(),progress:null};status();
    service.saveConfig({schemaVersion:2,performance:'BALANCED',keywords:[],minimumPosts:1000,
      opportunity:{enabled:true,prompt:prompts[topic],brandContext:'',
        filterMode:mode,languageScope:'VIETNAMESE',totalTarget:1000,rawCap,budgetUsd:5,commentsEnabled:false}});
    const state=await service.prepareCampaign();
    if(state.campaignDraftError)throw Error(state.campaignDraftError.code);
    if(!state.campaignDraft){write('clarification-'+topic+'.json',state.campaignDialogue);throw Error('CAMPAIGN_INTENT_UNRESOLVED');}
    current.runId=state.campaignDraft.runId;write('plan-'+topic+'-'+mode+'.json',state.campaignDraft.campaign);
    await service.start({profiles:selected});await service.settled();await serial;
    const result=await service.snapshotResults(), data=result.opportunity;
    if(result.run.state==='FAILED' && !result.run.opportunity?.counts.raw){write('collector-failure-'+topic+'.json',result.run);throw Error('E2E_COLLECTOR_FAILED');}
    if(!data)throw Error('E2E_RESULTS_MISSING');
    write('results-'+topic+'-'+mode+'.json',result);
    const filtered=selectOpportunityExport(data,'SUITABLE');
    await exportOpportunityWorkbook(join(dir,topic+'-'+mode+'.xlsx'),filtered);
    const pool=data.snapshots.filter(s=>s.post).sort((a,b)=>a.observed_at.localeCompare(b.observed_at)||a.platform.localeCompare(b.platform)||a.root_post_id.localeCompare(b.root_post_id)).slice(0,1000);
    if(source==='LIVE'){pools[topic]=pool;write('raw-first1000-'+topic+'.json',pool);write('raw-first1000-'+topic+'-manifest.json',{count:pool.length,hash:createHash('sha256').update(JSON.stringify(pool)).digest('hex'),selection:'first1000 observed roots, before looking at labels'});}
    const after=gateway.summary(), p=result.run.opportunity;
    const summary={...current,finishedAt:new Date().toISOString(),runState:result.run.state,raw:p.counts.raw,accepted:p.counts.suitable,
      targetCount:p.targetCount,pending:p.counts.pending,failed:p.counts.failed,rejected:p.counts.notSuitable,byPlatform:p.byPlatform,
      modelAcceptedRate:p.counts.raw?(p.counts.suitable/p.counts.raw):null,phase:p.phase,lastError:p.lastError,
      calls:after.billable_attempts-before.billable_attempts,cacheHits:after.cache_hits-before.cache_hits,usd:after.measured_cost_usd-before.measured_cost_usd,
      rootsHash:createHash('sha256').update(JSON.stringify(data.snapshots.map(s=>s.platform+':'+s.root_post_id).sort())).digest('hex'),
      opportunityTypes:data.conversations.filter(r=>r.decision.classification==='SUITABLE').reduce((out,r)=>{for(const t of (r.decision.attributes?.opportunity_types??'').split(',').filter(Boolean))out[t]=(out[t]??0)+1;return out;},{})};
    delete summary.progress; results.push(summary);write('summary.json',{task,results,cost:after});status();
    if(stopping)throw Error('USER_STOP');
    if(p.lastError&&/MODEL_|GEMINI_API/.test(p.lastError))throw Error(p.lastError);
    if(after.remaining_usd<=0)throw Error('TASK_BUDGET_REACHED');
  }
  done=true;
}
main().catch(e=>{taskError=safe(e);console.error(taskError);}).finally(async()=>{
  if(timer)clearInterval(timer);
  try{await service?.shutdown();await host?.shutdown();}catch(e){taskError??=safe(e);}
  if(task&&spending){
    const actual=spending.status(),authFile=join(SPEND_DIRECTORY,'development-authorization.json');
    const auth=JSON.parse(readFileSync(authFile,'utf8'));
    if(auth.purpose===taskId)writeFileSync(authFile,JSON.stringify({...auth,totalUsd:actual.measuredUsd+actual.heldUsd,dailyUsd:actual.measuredUsd+actual.heldUsd,maxCalls:actual.calls,closedAt:new Date().toISOString()},null,2),{flush:true});
    write('closed-spending.json',{at:new Date().toISOString(),taskUsd:actual.measuredUsd-task.startingSpending.measuredUsd,taskHeldUsd:actual.heldUsd,taskCalls:actual.calls-task.startingSpending.calls,cumulative:actual});
  }
  if(task)status(done&&!taskError?'COMPLETE':'STOPPED');else write('launch-error-'+Date.now()+'.json',{at:new Date().toISOString(),code:taskError});app.exit(done&&!taskError?0:2);
});
