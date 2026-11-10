// Main-process collector. Browser session stays inside Electron; raw payloads stay in memory.
import { app } from 'electron';
import { profilesByLabel } from '../dist/domain/browser-profile.js';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createDiscoveryFrontier, extendWarmSlice, createDiscoveryDiagnostics, settleDiscoveryPage } from './discovery-frontier.mjs';
import { runtimePaths } from '../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../dist/infrastructure/browser/browser-host.js';
import { createOwnedObserverResolver } from '../dist/infrastructure/browser/electron-observer-target.js';
import { createResponseObserverManager } from '../dist/infrastructure/browser/response-observer.js';
import { parseFacebookEmbeddedSearch } from '../dist/infrastructure/browser/facebook-search-embedded-parser.js';
import { createFacebookCollectorStore } from '../dist/infrastructure/browser/facebook-collector-store.js';

const hash=v=>createHash('sha256').update(v).digest('hex');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const bounded=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
async function timed(work,ms,code){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),ms);})]);}finally{clearTimeout(timer);}}
export async function runFacebookCollector({config,host,profileId,onProgress=()=>{},shouldStop=()=>false,resume=false,recoverStalled=true,onRecords=null,onQueryEnd=null,beforeNextPage=null,collectionLimitReason=null,continueQuerySlice=null}){
 if(!/^[a-z0-9][a-z0-9-]{2,80}$/.test(config.runId)||!Array.isArray(config.queries)||!config.queries.length||config.queries.length>240||config.queries.some(q=>typeof q!=='string'||!q.trim()||q.length>200)||!bounded(config.maxScrollsPerQuery,0,50)||!bounded(config.maxMinutes,1,1440)||!bounded(config.targetNewRecords,1,config.includeContextCandidates===true?50000:5000)||!bounded(config.settleMs,2000,15000)||(config.maxReplayPages!==undefined&&!bounded(config.maxReplayPages,1,2000))||(config.warmPageLimit!==undefined&&!bounded(config.warmPageLimit,1,200)))throw new Error('CONFIG_INVALID');
 const directory=resolve(config.output),rel=relative(resolve(process.cwd()),directory);
 if(!isAbsolute(config.output)||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)))throw new Error('OUTPUT_MUST_BE_OUTSIDE_WORKSPACE');
 const runDirectory=join(directory,'runs',config.runId);mkdirSync(runDirectory,{recursive:true});
 const fingerprint=hash(JSON.stringify(config));
 const manifestPath=join(runDirectory,'manifest.json');
 let manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
 if(manifest&&manifest.config_sha256!==fingerprint)throw new Error('RUN_CONFIG_CHANGED');
 if(!manifest){manifest={run_id:config.runId,started_at:new Date().toISOString(),config_sha256:fingerprint,config,platform_permission:'UNKNOWN'};writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{flush:true});}
 const deadline=Date.parse(manifest.started_at)+config.maxMinutes*60000;
 if(existsSync(join(runDirectory,'STOP'))){if(resume)renameSync(join(runDirectory,'STOP'),join(runDirectory,'STOP.ack-'+Date.now()));else throw new Error('RUN_STOPPED_USE_RESUME');}
 const store=createFacebookCollectorStore(directory),checkpointPath=join(runDirectory,'checkpoint.json');
 const priorReceipt=join(runDirectory,'receipt.json');
 if(existsSync(priorReceipt)&&['TARGET_REACHED','QUERY_BUDGET_COMPLETE'].includes(JSON.parse(readFileSync(priorReceipt,'utf8')).stop_reason)
   &&!(config.includeContextCandidates===true&&resume&&JSON.parse(readFileSync(priorReceipt,'utf8')).stop_reason==='QUERY_BUDGET_COMPLETE'))return {...JSON.parse(readFileSync(priorReceipt,'utf8')),summary:store.export()};
 if(Date.now()>deadline)throw new Error('RUN_DEADLINE_EXPIRED_USE_NEW_RUN_ID');
 let checkpoint=existsSync(checkpointPath)?JSON.parse(readFileSync(checkpointPath,'utf8')):{query_index:0,scroll_index:0,batch_sequence:0};
 const frontier=config.includeContextCandidates===true?createDiscoveryFrontier({platform:'facebook',runId:config.runId,jobs:config.queries.map(query=>({query})),pageBudget:config.maxScrollsPerQuery,checkpoint,checkpointExisted:existsSync(checkpointPath),maxReplayPages:config.maxReplayPages}):null;
 const saveCheckpoint=()=>{if(frontier)checkpoint={...checkpoint,discovery_frontier:frontier.snapshot()};store.checkpoint(runDirectory,checkpoint);};
 const initialRunRecords=store.records().filter(r=>r.first_observation.run_id===config.runId).length;
 let newThisRun=initialRunRecords,activeQuery=null,activeQueryIndex=checkpoint.query_index,scrollIndex=0,stopReason=null,closing=false,captureAdmission=true,observer=null,observerStarted=0,activeReads=0,lastHasNext=null,lastEmbeddedHash=null;
 const pending=new Map(),requestInfo=new Map(),operations=new Map(),readers=new Set(),queryDiagnostics=[];let diagnostics=createDiscoveryDiagnostics(),lastDiagnosis=null,lastGeometry=null;
 const event=value=>{const row={at:new Date().toISOString(),...value};appendFileSync(join(runDirectory,'events.jsonl'),JSON.stringify(row)+'\n',{flush:true});writeFileSync(join(runDirectory,'status.json'),JSON.stringify({...row,total:store.count,new_this_run:newThisRun},null,2));onProgress({event:row.event,total:store.count,...(typeof row.replaying==='boolean'?{replaying:row.replaying}:{}),new_this_run:newThisRun,...(typeof row.query==='string'?{query:row.query}:{}),...(Number.isInteger(row.query_index)?{query_index:row.query_index}:{}),...(typeof row.stop_reason==='string'?{stop_reason:row.stop_reason}:{})});};
 const externalStop=()=>shouldStop()||existsSync(join(runDirectory,'STOP'))||Date.now()>deadline;
 const check=()=>{if(Date.now()>deadline)throw new Error('RUN_DEADLINE');if(shouldStop()||existsSync(join(runDirectory,'STOP')))throw new Error('USER_STOP');if(stopReason)throw new Error(stopReason);const limit=collectionLimitReason?.();if(limit)throw Error(limit);};
 check();
 const profile=(await host.list()).find(p=>p.id===profileId&&p.platform!=='threads');
 if(!profile||profile.persistenceError)throw new Error('PROFILE_SELECTION_REQUIRED');
 let wc,manager,onRequest,profileClosed=false;
 try {
 await host.open(profile.id);const target=host.observerTarget(profile.id);
 if(!target)throw new Error('PROFILE_UNAVAILABLE');
 wc=target.contents;
 const execute=script=>timed(wc.executeJavaScript(script),15000,'RENDERER_TIMEOUT');
 wc.setBackgroundThrottling(false);
 manager=createResponseObserverManager({resolveOwned:createOwnedObserverResolver(host),urlAllowed:url=>{try{const u=new URL(url);return u.origin==='https://www.facebook.com'&&u.pathname.startsWith('/api/graphql/');}catch{return false;}},resourceTypes:['XHR','Fetch'],mimeTypes:['application/json','text/plain','text/html','text/javascript'],limits:{maxBodyBytes:8*1024*1024,maxBufferedBytes:32*1024*1024,maxTotalCapturedBytes:64*1024*1024,maxPendingRequests:100,maxResults:100,maxCapturedResponses:150,maxRunMs:60000,requestTimeoutMs:30000,commandTimeoutMs:5000}});
 const current=()=>{const t=host.observerTarget(profile.id);if(!t||t.webContentsId!==target.webContentsId||t.viewGeneration!==target.viewGeneration)throw new Error('OWNER_CHANGED');};
 const snapshotScript=`(()=>{const root=document.scrollingElement;const main=document.querySelector('[role="main"]');const text=main?.innerText||'';const login=!!document.querySelector('input[type="password"]');const path=location.pathname;const barrier=/checkpoint|challenge|login|recover|blocked/.test(path)||login;const visible=[...document.querySelectorAll('[role="alert"],[role="dialog"]')].map(e=>e.innerText).join(' ').slice(0,3000);return {url:location.href,title:document.title,ready:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),barrier,alert:visible,scrollY,root:{tag:root?.tagName,top:root?.scrollTop,height:root?.scrollHeight,client:root?.clientHeight},mainText:text.slice(0,22000),scrollers:[...document.querySelectorAll('main,[role="main"],[role="feed"]')].filter(e=>e.clientHeight>300&&e.scrollHeight>e.clientHeight+200&&/auto|scroll/.test(getComputedStyle(e).overflowY)).slice(0,8).map(e=>({tag:e.tagName,role:e.getAttribute('role'),height:e.scrollHeight,client:e.clientHeight,top:e.scrollTop})),blocks:[...document.querySelectorAll('script[type="application/json"]')].length}})()`;
 async function snapshot(){current();const s=await execute(snapshotScript);if(s.barrier||/temporarily blocked|try again later|quá nhiều yêu cầu|tạm thời bị chặn/i.test(s.alert)){stopReason='ACCOUNT_BARRIER';event({event:'BARRIER',path:new URL(s.url).pathname});throw new Error(stopReason);}if(activeQuery&&new URL(s.url).searchParams.get('q')!==activeQuery)throw new Error('NAVIGATION_CHANGED');return s;}
 async function persist(objects,method,responseHash,info){
  if(!activeQuery||closing)return;current();
  let parsed;
  try{parsed=parseFacebookEmbeddedSearch(objects,{query:activeQuery,collectedAt:new Date().toISOString(),documentUrl:wc.getURL(),extractionMethod:method,includeContextCandidates:config.includeContextCandidates===true});}
  catch(e){diagnostics.add('unsupported_responses');event({event:'PARSER_REJECTED',method,code:e.message});return;}
  if(!parsed.connections){if(info?.operation?.includes('Search'))diagnostics.add('unsupported_responses');return;}
  diagnostics.add('parsed_batches');diagnostics.add('parsed_records',parsed.records.length);
  if(method==='BROWSER_RESPONSE'||lastHasNext===null)lastHasNext=parsed.has_next_page;
  for(const skipped of parsed.skipped)if(skipped.observed_post_url)appendFileSync(join(runDirectory,'parser-candidates.jsonl'),JSON.stringify({at:new Date().toISOString(),query:activeQuery,...skipped})+'\n',{flush:true});
  const batchId=`${config.runId}-${++checkpoint.batch_sequence}`;
  const provenance={run_id:config.runId,batch_id:batchId,query_index:activeQueryIndex,scroll_index:scrollIndex,method,response_sha256:responseHash,operation:info?.operation??null,transport_request_id:info?.id??null};
  if(onRecords)await onRecords(parsed.records,{...provenance,platform:'facebook',observed_at:new Date().toISOString()});
  const saved=store.persist(parsed.records,provenance);newThisRun+=saved.new_records;diagnostics.add('new_roots',saved.new_records);
  checkpoint={...checkpoint,query_index:activeQueryIndex,scroll_index:scrollIndex};saveCheckpoint();
  event({event:'BATCH',...provenance,...saved,has_next_page:parsed.has_next_page,skipped:parsed.skipped.map(s=>s.reason)});
  const s=await snapshot();const norm=v=>v.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
  const matches=parsed.records.filter(r=>{const prefix=norm(r.text).slice(0,40);return prefix.length>0&&norm(s.mainText).includes(prefix);}).map(r=>r.post_id);
  writeFileSync(join(runDirectory,batchId+'-verification.json'),JSON.stringify({batch_id:batchId,dom_text_sha256:hash(s.mainText),prefix_length:40,matched_ids:matches,parsed:parsed.records.length,source_method:method},null,2),{flush:true});
 }
 function decode(bytes){const text=Buffer.from(bytes).toString('utf8').replace(/^for\s*\(;;\);/,'');try{return [JSON.parse(text)];}catch{return text.split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}}
 onRequest=(_e,method,p,child)=>{
  if(closing||!captureAdmission||child||method!=='Network.requestWillBeSent'||!p.request?.url.startsWith('https://www.facebook.com/api/graphql/'))return;
  const request=p.request,query=activeQuery,queryIndex=activeQueryIndex;
  const task=(async()=>{
   let body=request.postData;if(!body&&request.hasPostData){try{body=(await wc.debugger.sendCommand('Network.getRequestPostData',{requestId:p.requestId})).postData;}catch{}}
   const form=new URLSearchParams(body||''),operation=form.get('fb_api_req_friendly_name');
   const safeName=operation&&/^[A-Za-z0-9_]{1,200}$/.test(operation)?operation:null;
   // Credentials/postData are needed only to identify the observed operation, never for replay.
   requestInfo.set(p.requestId,{id:p.requestId,query,queryIndex,operation:safeName});
   while(requestInfo.size>500)requestInfo.delete(requestInfo.keys().next().value);
   if(safeName)operations.set(safeName,(operations.get(safeName)||0)+1);
   if(safeName?.includes('Search')&&query===activeQuery)diagnostics.add('search_requests');
   event({event:'REQUEST',request_id:p.requestId,operation:safeName,has_body:!!body,body_bytes:body?.length??0,query_index:queryIndex});
  })().catch(()=>{stopReason='REQUEST_OBSERVER_FAILED';});pending.set(p.requestId,task);void task.finally(()=>pending.delete(p.requestId));
 };
 wc.debugger.on('message',onRequest);
 async function attach(){
  if(observer&&Date.now()-observerStarted<45000&&observer.snapshot().state==='ATTACHED'){observer.resumeRequests?.();captureAdmission=true;return;}
  if(observer?.snapshot().state==='ATTACHED')await drain(true);
  manager.stopAll();captureAdmission=true;observer=await manager.attach(target,'LIVE');observerStarted=Date.now();const handle=observer;
  const reader=(async()=>{while(!closing){const read=await handle.read(1000);if(closing||read.kind==='END')break;if(read.kind!=='EVENT')continue;const e=read.event;
   if(e.kind!=='BODY'){event({event:'OBSERVER',code:e.code,snapshot:handle.snapshot()});continue;}
   activeReads++;try{
    if(pending.has(e.transportRequestId))await pending.get(e.transportRequestId);
    const info=requestInfo.get(e.transportRequestId);
    if(info&&info.query!==activeQuery)continue;
    if(info?.operation?.includes('Search'))diagnostics.add('response_bodies');
    const objects=decode(e.body);
    if(info?.operation==='SearchCometResultsPaginatedResultsQuery'){
     const errors=objects.flatMap(o=>o&&(o.errors||o.error)?[o.errors||o.error]:[]);
     const text=JSON.stringify(errors);
     if(errors.length&&/checkpoint|challenge|rate.?limit|temporarily blocked|access denied|not logged|login required|quá nhiều|tạm thời bị chặn/i.test(text)){stopReason='ACCOUNT_BARRIER';event({event:'GRAPHQL_BARRIER',response_sha256:hash(e.body)});continue;}
     if(e.status===429||e.status===403||e.status===401){stopReason='ACCOUNT_BARRIER';event({event:'HTTP_BARRIER',status:e.status});continue;}
    }
    await persist(objects,'BROWSER_RESPONSE',hash(e.body),info||{id:e.transportRequestId});
   }catch(e){stopReason=e.message==='ACCOUNT_BARRIER'?'ACCOUNT_BARRIER':'CAPTURE_FAILED';event({event:'CAPTURE_FAILED',code:e.message});}finally{activeReads--;requestInfo.delete(e.transportRequestId);}
  }})().catch(()=>{stopReason='OBSERVER_READER_FAILED';});
  readers.add(reader);void reader.finally(()=>readers.delete(reader));
 }
 async function embedded(){
  const strings=await execute(`(()=>{let n=0;const a=[];for(const s of document.querySelectorAll('script[type="application/json"]')){const t=s.textContent||'';n+=t.length;if(n>16000000||a.length>=200)throw Error('EMBEDDED_SIZE_LIMIT');a.push(t);}return a;})()`);
  const digest=hash(strings.join('\n'));if(digest===lastEmbeddedHash)return;lastEmbeddedHash=digest;
  const objects=strings.flatMap(s=>{try{return [JSON.parse(s)];}catch{return [];}});await persist(objects,'EMBEDDED_DOCUMENT_JSON',digest,null);
 }
 async function drain(finish=false){
  // Normal pages need a persistence barrier, not an idle social feed.
  // Handoff freezes only NEW requests; all previously admitted bodies still drain.
  if(finish){captureAdmission=false;observer?.pauseRequests?.();}
  let quiet=0;
  for(let n=0;n<(finish?350:120);n++){
   const state=observer?.snapshot();
   const busy=activeReads||pending.size||(finish?(state?.pendingRequests??0):0)||(state?.queuedResults??0)||(state?.activeReads??0);
   quiet=busy?0:quiet+1;if(quiet>=2)return;
   await sleep(100);
  }
  throw new Error('CAPTURE_DRAIN_TIMEOUT');
 }
 async function close(){closing=true;activeQuery=null;manager.stopAll();if(!wc.isDestroyed())wc.debugger.removeListener('message',onRequest);await timed(Promise.allSettled([...readers,...pending.values()]),12000,'CAPTURE_DRAIN_TIMEOUT');await timed(host.close(profile.id),60000,'SESSION_FLUSH_TIMEOUT');profileClosed=true;}
 const started=Date.now();
 try{
  event({event:'START',run_id:config.runId,resumed:initialRunRecords>0,existing_records:store.count,code_hashes:{entry:hash(readFileSync(new URL(import.meta.url))),parser:hash(readFileSync(new URL('../dist/infrastructure/browser/facebook-search-embedded-parser.js',import.meta.url))),store:hash(readFileSync(new URL('../dist/infrastructure/browser/facebook-collector-store.js',import.meta.url)))}});
  const queryIndices=frontier?frontier.indices({resume,recoverStalled}):config.queries.map((_,index)=>index).filter(index=>index>=checkpoint.query_index);
  for(const qi of queryIndices){
   check();if(beforeNextPage)await beforeNextPage();check();const slice=frontier?.begin(qi)??{allowed:true,replayDepth:0,maxScroll:config.maxScrollsPerQuery};
   if(frontier){checkpoint={...checkpoint,query_index:qi,scroll_index:0};saveCheckpoint();}
   if(!slice.allowed){event({event:slice.reason??'REPLAY_BUDGET_REACHED',query_index:qi,replay_depth:slice.replayDepth});continue;}
   diagnostics=createDiscoveryDiagnostics();lastDiagnosis=null;lastGeometry=null;activeQuery=config.queries[qi];activeQueryIndex=qi;scrollIndex=0;lastHasNext=null;lastEmbeddedHash=null;await attach();
   const url=new URL('https://www.facebook.com/search/top');url.searchParams.set('q',activeQuery);url.searchParams.set('filters','eyJycF9hdXRob3I6MCI6IntcIm5hbWVcIjpcIm1lcmdlZF9wdWJsaWNfcG9zdHNcIixcImFyZ3NcIjpcIlwifSJ9');
   event({event:'QUERY',query_index:qi,query:activeQuery});await timed(wc.loadURL(url.href),30000,'NAVIGATION_TIMEOUT');await sleep(config.settleMs);check();
   const before=await snapshot();event({event:'VIEW',query_index:qi,...before,mainText:undefined,alert:undefined});await embedded();
   let noProgress=slice.emptyPages??0,queryStop='PAGE_BUDGET_REACHED';
   for(let scroll=1;scroll<=slice.maxScroll;scroll++){
    check();if(beforeNextPage)await beforeNextPage();check();if(newThisRun>=config.targetNewRecords&&qi>=Math.min(1,config.queries.length-1))break;
    if(lastHasNext===false){queryStop='NATIVE_END_OBSERVED';event({event:'SOURCE_EXHAUSTED',query_index:qi});break;}
    await attach();scrollIndex=scroll;const count=store.count,beforeDiagnostics=diagnostics.snapshot();diagnostics.add('scrolls');
    const geometry=await execute(`(()=>{const root=document.scrollingElement;const scrollable=e=>e.clientHeight>300&&e.scrollHeight>e.clientHeight+200&&/auto|scroll/.test(getComputedStyle(e).overflowY);const primary=[...document.querySelectorAll('[role="main"],[role="feed"],main')].filter(scrollable);const candidates=primary.length?primary:root.scrollHeight>root.clientHeight+100?[]:[...document.querySelectorAll('div')].filter(scrollable);const e=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0]||root;const before=e.scrollTop;e.scrollTo({top:e.scrollHeight,behavior:'instant'});return {tag:e.tagName,role:e.getAttribute('role'),before,after:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,root:e===root};})()`);
    event({event:'SCROLL',query_index:qi,scroll_index:scroll,...geometry});
    await settleDiscoveryPage({settleMs:config.settleMs,sleep,check,diagnostics,count:()=>store.count,beforeCount:count,
     pending:()=>observer?.snapshot().pendingRequests??0,refresh:async()=>{await snapshot();await embedded();await drain();}});
    const gained=store.count-count;noProgress=gained?0:scroll<=slice.replayDepth?noProgress:noProgress+1;
    if(frontier){check();frontier.page(qi,scroll,gained);saveCheckpoint();}
    lastDiagnosis=diagnostics.diagnose(beforeDiagnostics,{gained,hasNext:lastHasNext,pendingRequests:observer?.snapshot().pendingRequests??0});lastGeometry=geometry;
    event({event:'YIELD',query_index:qi,scroll_index:scroll,new_records:gained,no_progress:noProgress,replaying:scroll<=slice.replayDepth,
     diagnosis:lastDiagnosis,diagnostics:diagnostics.snapshot()});
    if(scroll>slice.replayDepth&&noProgress>=3&&geometry.after>=geometry.height-geometry.client-10){queryStop='NO_PROGRESS';break;}
    if(extendWarmSlice(slice,{currentScroll:scroll,gained,pageBudget:config.maxScrollsPerQuery,warmPageLimit:config.warmPageLimit,maxReplayPages:config.maxReplayPages,canContinue:!onQueryEnd&&!!continueQuerySlice?.()}))event({event:'WARM_SLICE',query_index:qi,scroll_index:scroll,max_scroll:slice.maxScroll});
   }
   await drain(true);check();
   if(frontier)frontier.finish(qi,lastHasNext===false?'NATIVE_END_OBSERVED':queryStop);
   queryDiagnostics.push({query:activeQuery,reason:lastHasNext===false?'NATIVE_END_OBSERVED':queryStop,has_next_page:lastHasNext,last_diagnosis:lastDiagnosis,last_scroll:lastGeometry,...diagnostics.snapshot()});
   checkpoint={...checkpoint,query_index:qi+1,scroll_index:0};saveCheckpoint();
   if(onQueryEnd){const completedQuery=activeQuery;activeQuery=null;manager.stopAll();await timed(Promise.allSettled([...readers,...pending.values()]),12000,'CAPTURE_DRAIN_TIMEOUT');wc.debugger.removeListener('message',onRequest);try{await onQueryEnd({window:wc,profileId:profile.id,platform:'facebook',query:completedQuery,shouldStop:externalStop});}finally{if(!wc.isDestroyed())wc.debugger.on('message',onRequest);}check();}
   if(newThisRun>=config.targetNewRecords&&qi>=Math.min(1,config.queries.length-1)){stopReason='TARGET_REACHED';break;}
  }
  stopReason??=frontier?.stopReason()??'QUERY_BUDGET_COMPLETE';
 }catch(e){stopReason=e.message;}
 finally{
  try{await drain(true);}catch{stopReason='CAPTURE_DRAIN_TIMEOUT';}activeQuery=null;
  let sessionFlush='OK';try{await close();}catch(e){sessionFlush=e.message;}
  const summary=store.export();
  const receipt={run_id:config.runId,stop_reason:stopReason,new_this_run:newThisRun,elapsed_ms:Date.now()-Date.parse(manifest.started_at),invocation_ms:Date.now()-started,session_flush:sessionFlush,summary,operations:Object.fromEntries(operations),diagnostics:queryDiagnostics,checkpoint,platform_permission:'UNKNOWN',benchmark_pass:false};
  writeFileSync(join(runDirectory,'receipt.json'),JSON.stringify(receipt,null,2),{flush:true});event({event:'STOP',...receipt});
  return receipt;
 }
 } finally {
  closing=true;activeQuery=null;manager?.stopAll();
  if(wc&&onRequest&&!wc.isDestroyed())wc.debugger.removeListener('message',onRequest);
  if(!profileClosed)await timed(host.close(profile.id),60000,'SESSION_FLUSH_TIMEOUT');
 }
}

async function main(){
 const configPath=arg('--config');if(!configPath)throw new Error('CONFIG_REQUIRED');
 const config=JSON.parse(readFileSync(resolve(configPath),'utf8'));
 const paths=runtimePaths(app.getPath('appData'));
 for(const [name,path]of Object.entries(paths)){mkdirSync(path,{recursive:true});app.setPath(name,path);}
 app.setName('FindLink');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
 if(!app.requestSingleInstanceLock())throw new Error('CSD_ALREADY_RUNNING');
 let stopping=false,finished=false;
 const onClosed=()=>{stopping=true;};
 const onQuit=e=>{if(!finished){e.preventDefault();stopping=true;}};
 app.on('window-all-closed',onClosed);app.on('before-quit',onQuit);
 await app.whenReady();
 const profiles=createBrowserProfiles(join(paths.userData,'data'));
 const matches=profilesByLabel((await profiles.list()).filter(p=>p.platform!=='threads'), config.profileLabel || 'FindLink Facebook');
 if(matches.length!==1)throw new Error('PROFILE_SELECTION_REQUIRED');
 const host=createBrowserHost({profiles,secrets:createElectronSecretStore(join(paths.userData,'secrets')),journalDirectory:join(paths.userData,'data','session-snapshots'),manualLoginEnabled:true,hidden:false});
 let receipt;
 try{receipt=await runFacebookCollector({config,host,profileId:matches[0].id,resume:process.argv.includes('--resume'),shouldStop:()=>stopping,onProgress:value=>console.log(JSON.stringify(value))});}
 finally{await host.shutdown();finished=true;app.removeListener('window-all-closed',onClosed);app.removeListener('before-quit',onQuit);}
 const normal=['TARGET_REACHED','QUERY_BUDGET_COMPLETE','SOURCE_EXHAUSTED','REPLAY_BUDGET_REACHED','USER_STOP','RUN_DEADLINE','WINDOW_CLOSED'];
 app.exit(receipt.stop_reason==='ACCOUNT_BARRIER'?3:receipt.session_flush==='OK'&&normal.includes(receipt.stop_reason)?0:1);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('COLLECTOR_START_FAILED:'+error.message);app.exit(1);});
