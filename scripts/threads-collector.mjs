import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runtimePaths } from '../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../dist/infrastructure/browser/browser-host.js';
import { createOwnedObserverResolver } from '../dist/infrastructure/browser/electron-observer-target.js';
import { createResponseObserverManager } from '../dist/infrastructure/browser/response-observer.js';
import { parseThreadsSearch } from '../dist/infrastructure/browser/threads-search-parser.js';
import { createThreadsCollectorStore } from '../dist/infrastructure/browser/threads-collector-store.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
async function timed(work,ms,code){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]);}finally{clearTimeout(timer);}}
const bounded=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export async function runThreadsCollector({config,host,profileId,onProgress=()=>{},shouldStop=()=>false,resume=false}){
 if(!/^[a-z0-9][a-z0-9-]{2,80}$/.test(config.runId)||!Array.isArray(config.queries)||!config.queries.length||config.queries.length>100||config.queries.some(q=>typeof q!=='string'||!q.trim()||q.length>200)||!bounded(config.maxScrollsPerQuery,0,200)||!bounded(config.maxMinutes,1,240)||!bounded(config.targetTotal,1,10000)||!bounded(config.settleMs,2000,15000))throw Error('CONFIG_INVALID');
 const directory=resolve(config.output),rel=relative(resolve(process.cwd()),directory);
 if(!isAbsolute(config.output)||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)))throw Error('OUTPUT_MUST_BE_OUTSIDE_WORKSPACE');
 const runDirectory=join(directory,'runs',config.runId);mkdirSync(runDirectory,{recursive:true});
 const manifestPath=join(runDirectory,'manifest.json'),fingerprint=hash(JSON.stringify(config));
 let manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
 if(manifest&&manifest.config_sha256!==fingerprint)throw Error('RUN_CONFIG_CHANGED');
 if(!manifest){manifest={run_id:config.runId,started_at:new Date().toISOString(),config_sha256:fingerprint,config};writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{flush:true});}
 const store=createThreadsCollectorStore(directory),deadline=Date.parse(manifest.started_at)+config.maxMinutes*60000;
 if(store.count>=config.targetTotal)return {run_id:config.runId,stop_reason:'TARGET_REACHED',new_this_run:store.records().filter(r=>r.first_observation.run_id===config.runId).length,elapsed_ms:Date.now()-Date.parse(manifest.started_at),session_flush:'OK',summary:store.export()};
 if(Date.now()>deadline)throw Error('RUN_DEADLINE_EXPIRED_USE_NEW_RUN_ID');
 const stopPath=join(runDirectory,'STOP');if(existsSync(stopPath)){if(resume)renameSync(stopPath,stopPath+'.ack-'+Date.now());else throw Error('RUN_STOPPED_USE_RESUME');}
 const checkpointPath=join(runDirectory,'checkpoint.json');
 let checkpoint=existsSync(checkpointPath)?JSON.parse(readFileSync(checkpointPath,'utf8')):{job_index:0,batch_sequence:0};
 const jobs=(config.modes||['top','recent']).flatMap(mode=>config.queries.map(query=>({query,mode})));
 if(jobs.some(j=>!['top','recent'].includes(j.mode)))throw Error('SEARCH_MODE_INVALID');
 let active=null,jobIndex=checkpoint.job_index,scrollIndex=0,epoch=0,closing=false,stopReason=null,observer=null,observerStarted=0,reads=0,lastNext=null,lastEmbedded=null;
 const initial=store.count,pending=new Map(),requestInfo=new Map(),operations=new Map(),readers=new Set();
 const event=value=>{const row={at:new Date().toISOString(),...value,total:store.count};appendFileSync(join(runDirectory,'events.jsonl'),JSON.stringify(row)+'\n',{flush:true});writeFileSync(join(runDirectory,'status.json'),JSON.stringify(row,null,2));onProgress({event:row.event,total:store.count,new_this_run:store.count-initial,...(typeof row.query==='string'?{query:row.query}:{}),...(Number.isInteger(row.job_index)?{job_index:row.job_index}:{}),...(typeof row.stop_reason==='string'?{stop_reason:row.stop_reason}:{})});};
 const check=()=>{if(stopReason)throw Error(stopReason);if(shouldStop()||existsSync(stopPath))throw Error('USER_STOP');if(Date.now()>deadline)throw Error('RUN_DEADLINE');};
 check();
 const profile=(await host.list()).find(p=>p.id===profileId&&p.platform==='threads');
 if(!profile||profile.persistenceError)throw Error('PROFILE_SELECTION_REQUIRED');
 let wc,manager,onRequest,profileClosed=false;
 try {
 await host.open(profile.id);const target=host.observerTarget(profile.id);
 if(!target)throw Error('PROFILE_UNAVAILABLE');
 wc=target.contents;wc.setBackgroundThrottling(false);
 const execute=script=>timed(wc.executeJavaScript(script),10000,'RENDERER_TIMEOUT');
 manager=createResponseObserverManager({resolveOwned:createOwnedObserverResolver(host),urlAllowed:url=>{try{return new URL(url).origin==='https://www.threads.com';}catch{return false;}},resourceTypes:['XHR','Fetch'],mimeTypes:['application/json','text/plain','text/html','text/javascript'],limits:{maxBodyBytes:12*1024*1024,maxBufferedBytes:32*1024*1024,maxTotalCapturedBytes:96*1024*1024,maxPendingRequests:100,maxResults:100,maxCapturedResponses:200,maxRunMs:60000,requestTimeoutMs:30000,commandTimeoutMs:5000}});
 const current=()=>{const t=host.observerTarget(profile.id);if(!t||t.webContentsId!==target.webContentsId||t.viewGeneration!==target.viewGeneration)throw Error('OWNER_CHANGED');};
 async function snapshot(){
  current();
  const s=await execute(`({url:location.href,text:document.body.innerText.slice(0,30000),login:!!document.querySelector('input[type="password"]'),alerts:[...document.querySelectorAll('[role="alert"],[role="dialog"]')].map(e=>e.innerText).join(' ').slice(0,3000),links:[...document.querySelectorAll('a[href*="/post/"]')].map(e=>e.href)})`);
  if(/login|checkpoint|challenge/.test(new URL(s.url).pathname)||s.login||/try again later|too many requests|temporarily blocked|tạm thời bị chặn/i.test(s.alerts))throw Error('ACCOUNT_BARRIER');
  if(active&&(new URL(s.url).searchParams.get('q')!==active.query||new URL(s.url).pathname!=='/search'))throw Error('NAVIGATION_CHANGED');return s;
 }
 async function persist(objects,method,digest,info){
  if(!active||closing||info&&info.epoch!==epoch)return;
  current();
  const parsed=parseThreadsSearch(objects,{query:active.query,mode:active.mode,collectedAt:new Date().toISOString(),method});
  if(!parsed.connections){if(info?.operation?.includes('Search'))event({event:'SEARCH_SHAPE_UNSUPPORTED',operation:info.operation,root_keys:objects.map(o=>Object.keys(o?.data||{}))});return;}
  if(method==='BROWSER_RESPONSE'||lastNext===null)lastNext=parsed.has_next_page;
  const batchId=`${config.runId}-${++checkpoint.batch_sequence}`;
  const provenance={run_id:config.runId,batch_id:batchId,query_index:jobIndex,scroll_index:scrollIndex,method,response_sha256:digest,operation:info?.operation??null,request_id:info?.id??null};
  const saved=store.persist(parsed.records,provenance);store.checkpoint(runDirectory,{...checkpoint,job_index:jobIndex});
  event({event:'BATCH',...provenance,...saved,has_next_page:parsed.has_next_page,skipped:parsed.skipped});
  const s=await snapshot();
  appendFileSync(join(runDirectory,'verification.jsonl'),JSON.stringify({batch_id:batchId,dom_sha256:hash(s.text),permalink_matches:parsed.records.filter(r=>s.links.includes(r.post_url)).map(r=>r.post_id),text_prefix_matches:parsed.records.filter(r=>s.text.includes(r.text.slice(0,60))).map(r=>r.post_id)})+'\n',{flush:true});
 }
 onRequest=(_e,method,p,child)=>{
  if(closing||child||method!=='Network.requestWillBeSent')return;
  let url;try{url=new URL(p.request?.url);}catch{return;}
  if(url.origin!=='https://www.threads.com'||!url.pathname.includes('graphql'))return;
  const requestEpoch=epoch;
  const task=(async()=>{let body=p.request.postData;if(!body&&p.request.hasPostData){try{body=(await wc.debugger.sendCommand('Network.getRequestPostData',{requestId:p.requestId})).postData;}catch{}}
   const name=new URLSearchParams(body||'').get('fb_api_req_friendly_name');const operation=name&&/^[A-Za-z0-9_]{1,200}$/.test(name)?name:null;
   requestInfo.set(p.requestId,{id:p.requestId,epoch:requestEpoch,operation});while(requestInfo.size>500)requestInfo.delete(requestInfo.keys().next().value);
   if(operation)operations.set(operation,(operations.get(operation)||0)+1);
   if(operation?.includes('Search'))event({event:'SEARCH_REQUEST',operation,job_index:jobIndex,scroll_index:scrollIndex});
  })();pending.set(p.requestId,task);void task.finally(()=>pending.delete(p.requestId)).catch(()=>{stopReason='REQUEST_CAPTURE_FAILED';});
 };
 wc.debugger.on('message',onRequest);
 const decode=body=>{const text=Buffer.from(body).toString('utf8').replace(/^for\s*\(;;\);/,'');try{return [JSON.parse(text)];}catch{return text.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}};
 async function attach(){
  if(observer&&Date.now()-observerStarted<45000&&observer.snapshot().state==='ATTACHED')return;
  manager.stopAll();observer=await manager.attach(target,'LIVE');observerStarted=Date.now();const handle=observer;
  const reader=(async()=>{while(!closing){const read=await handle.read(1000);if(closing||read.kind==='END')break;if(read.kind!=='EVENT')continue;const e=read.event;
   if(e.kind!=='BODY'){event({event:'OBSERVER',code:e.code});continue;}
   reads++;try{if(pending.has(e.transportRequestId))await pending.get(e.transportRequestId);const info=requestInfo.get(e.transportRequestId);
    if(!info||info.epoch!==epoch||!info.operation?.includes('Search'))continue;
    if([401,403,429].includes(e.status)){stopReason='ACCOUNT_BARRIER';event({event:'HTTP_BARRIER',status:e.status});continue;}
    const objects=decode(e.body),errors=JSON.stringify(objects.flatMap(o=>o?.errors||o?.error||[]));
    if(/rate.?limit|challenge|checkpoint|login required|temporarily blocked/i.test(errors)){stopReason='ACCOUNT_BARRIER';event({event:'GRAPHQL_BARRIER',response_sha256:hash(e.body)});continue;}
    await persist(objects,'BROWSER_RESPONSE',hash(e.body),info);
   }catch(e){stopReason=e.message==='ACCOUNT_BARRIER'?'ACCOUNT_BARRIER':'CAPTURE_FAILED';event({event:'CAPTURE_FAILED',code:stopReason});}finally{reads--;requestInfo.delete(e.transportRequestId);}
  }})().catch(()=>{stopReason='OBSERVER_READER_FAILED';});
  readers.add(reader);void reader.finally(()=>readers.delete(reader));
 }
 async function embedded(){const strings=await execute(`(()=>{let n=0;const a=[];for(const s of document.querySelectorAll('script[type="application/json"]')){const t=s.textContent||'';n+=t.length;if(n>24000000||a.length>=200)throw Error('EMBEDDED_LIMIT');a.push(t);}return a;})()`);const digest=hash(strings.join('\n'));if(digest===lastEmbedded)return;lastEmbedded=digest;await persist(strings.flatMap(s=>{try{return[JSON.parse(s)];}catch{return[];}}),'EMBEDDED_DOCUMENT_JSON',digest,null);}
 async function drain(){for(let n=0;n<100&&(reads||pending.size);n++)await sleep(100);if(reads)throw Error('CAPTURE_DRAIN_TIMEOUT');}
 try{
  event({event:'START',run_id:config.runId,existing_records:initial,profile_platform:profile.platform,code_sha256:hash(readFileSync(new URL(import.meta.url))),component_hashes:Object.fromEntries(['../dist/infrastructure/browser/threads-search-parser.js','../dist/infrastructure/browser/threads-collector-store.js','../dist/infrastructure/browser/browser-host.js'].map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))]))});
  for(let ji=checkpoint.job_index;ji<jobs.length;ji++){
   check();await drain();active=jobs[ji];jobIndex=ji;epoch++;scrollIndex=0;lastNext=null;lastEmbedded=null;await attach();
   const url=new URL('https://www.threads.com/search');url.searchParams.set('q',active.query);url.searchParams.set('serp_type','default');if(active.mode==='recent')url.searchParams.set('filter','recent');
   event({event:'QUERY',job_index:ji,...active});await timed(wc.loadURL(url.href),30000,'NAVIGATION_TIMEOUT');await sleep(config.settleMs);check();await snapshot();await embedded();let noProgress=0;
   for(let scroll=1;scroll<=config.maxScrollsPerQuery;scroll++){
    check();if(store.count>=config.targetTotal)break;if(lastNext===false){event({event:'SOURCE_EXHAUSTED',job_index:ji});break;}
    await attach();scrollIndex=scroll;const count=store.count,batches=checkpoint.batch_sequence;
    const geometry=await execute(`(()=>{const root=document.scrollingElement;const candidates=[...document.querySelectorAll('main,[role="main"],div')].filter(e=>e.clientHeight>250&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY));const e=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0]||root;const before=e.scrollTop;e.scrollTo({top:e.scrollHeight,behavior:'instant'});return {before,after:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,root:e===root};})()`);
    await sleep(config.settleMs);check();await snapshot();await embedded();await drain();const gained=store.count-count;noProgress=checkpoint.batch_sequence>batches?0:noProgress+1;
    event({event:'YIELD',job_index:ji,scroll_index:scroll,new_records:gained,no_progress:noProgress,...geometry});
    if(noProgress>=4){event({event:'NO_PROGRESS',job_index:ji});break;}
   }
   await drain();check();checkpoint={...checkpoint,job_index:ji+1};store.checkpoint(runDirectory,checkpoint);
   if(store.count>=config.targetTotal&&ji>=config.queries.length-1){stopReason='TARGET_REACHED';break;}
  }
  stopReason??='QUERY_BUDGET_COMPLETE';
 }catch(e){stopReason=e.message;}
 finally{
  try{await drain();}catch{stopReason='CAPTURE_DRAIN_TIMEOUT';}active=null;closing=true;manager.stopAll();wc.debugger.removeListener('message',onRequest);let sessionFlush='OK';
  try{await timed(Promise.allSettled([...readers,...pending.values()]),12000,'CAPTURE_DRAIN_TIMEOUT');await timed(host.close(profile.id),15000,'SESSION_FLUSH_TIMEOUT');profileClosed=true;}catch{sessionFlush='FAILED';}
  const receipt={run_id:config.runId,stop_reason:stopReason,new_this_run:store.records().filter(r=>r.first_observation.run_id===config.runId).length,new_this_invocation:store.count-initial,elapsed_ms:Date.now()-Date.parse(manifest.started_at),session_flush:sessionFlush,summary:store.export(),operations:Object.fromEntries(operations),checkpoint,content_review:'NOT_REQUESTED'};
  writeFileSync(join(runDirectory,'receipt.json'),JSON.stringify(receipt,null,2),{flush:true});event({event:'STOP',...receipt});
  return receipt;
 }
 } finally {
  active=null;closing=true;manager?.stopAll();
  if(wc&&onRequest)wc.debugger.removeListener('message',onRequest);
  if(!profileClosed)await timed(host.close(profile.id),15000,'SESSION_FLUSH_TIMEOUT');
 }
}

async function main(){
 const configPath=arg('--config');if(!configPath)throw Error('CONFIG_REQUIRED');
 const config=JSON.parse(readFileSync(resolve(configPath),'utf8'));
 const paths=runtimePaths(app.getPath('appData'));
 for(const [name,path]of Object.entries(paths)){mkdirSync(path,{recursive:true});app.setPath(name,path);}
 app.setName('CSD');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
 if(!app.requestSingleInstanceLock())throw Error('CSD_ALREADY_RUNNING');
 let stopping=false,finished=false;
 const onClosed=()=>{stopping=true;};
 const onQuit=e=>{if(!finished){e.preventDefault();stopping=true;}};
 app.on('window-all-closed',onClosed);app.on('before-quit',onQuit);
 await app.whenReady();
 const profiles=createBrowserProfiles(join(paths.userData,'data'));
 const matches=(await profiles.list()).filter(p=>p.platform==='threads'&&p.label===(config.profileLabel||'CSD Threads'));
 if(matches.length>1)throw Error('PROFILE_AMBIGUOUS');
 const profile=matches[0]||await profiles.create(config.profileLabel||'CSD Threads','threads');
 const host=createBrowserHost({profiles,secrets:createElectronSecretStore(join(paths.userData,'secrets')),journalDirectory:join(paths.userData,'data','session-snapshots'),manualLoginEnabled:true,backgroundThrottling:false});
 let receipt;
 try{
  const {ensureThreadsLogin}=await import('./threads-login.mjs');
  await host.open(profile.id);const wc=host.observerTarget(profile.id)?.contents;if(!wc)throw Error('PROFILE_UNAVAILABLE');
  await timed(ensureThreadsLogin(wc,resolve('.env'),script=>timed(wc.executeJavaScript(script),10000,'RENDERER_TIMEOUT')),45000,'LOGIN_TIMEOUT');
  receipt=await runThreadsCollector({config,host,profileId:profile.id,resume:process.argv.includes('--resume'),shouldStop:()=>stopping,onProgress:value=>console.log(JSON.stringify(value))});
 }finally{await host.shutdown();finished=true;app.removeListener('window-all-closed',onClosed);app.removeListener('before-quit',onQuit);}
 app.exit(receipt.stop_reason==='ACCOUNT_BARRIER'?3:receipt.session_flush==='OK'&&['TARGET_REACHED','QUERY_BUDGET_COMPLETE','USER_STOP','RUN_DEADLINE','WINDOW_CLOSED'].includes(receipt.stop_reason)?0:1);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('THREADS_COLLECTOR_FAILED:'+e.message);app.exit(1);});
