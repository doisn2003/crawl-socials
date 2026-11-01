// Read-only capability probe. Raw social content stays outside the repository.
import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { runtimePaths } from '../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../dist/infrastructure/browser/browser-host.js';

const arg = name => { const i=process.argv.indexOf(name); return i<0?null:process.argv[i+1]; };
async function main() {
const out = resolve(arg('--output') || join(process.env.APPDATA,'csd-desktop','data','conversation-probe-20261030'));
if (out.startsWith(resolve(process.cwd()))) throw Error('PRIVATE_OUTPUT_REQUIRED');
mkdirSync(out,{recursive:true});
const paths=runtimePaths(app.getPath('appData'));
for(const [name,path]of Object.entries(paths)){mkdirSync(path,{recursive:true});app.setPath(name,path);}
app.setName('CSD');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if(!app.requestSingleInstanceLock()) throw Error('CSD_ALREADY_RUNNING');
app.on('window-all-closed',()=>{});
await app.whenReady();
const profiles=createBrowserProfiles(join(paths.userData,'data'));
const host=createBrowserHost({profiles,secrets:createElectronSecretStore(join(paths.userData,'secrets')),journalDirectory:join(paths.userData,'data','session-snapshots'),manualLoginEnabled:true,backgroundThrottling:false,hidden:!process.argv.includes('--visible')});
let stopping=false;
const quit=e=>{e.preventDefault();stopping=true;};app.on('before-quit',quit);

const allowed = new Set(['__typename','id','pk','code','text','message','body','caption','user','username','full_name','name','url','permalink_url','post_id','comment_id','parent_id','parent_comment','parent_comment_id','reply_to_comment','replied_to','root_post','root_post_id','root_id','reply_to_post','is_reply','is_post_unavailable','text_post_app_info','direct_reply_count','direct_replies','containing_thread','posts','post_ids','taken_at','created_time','created_time_precise','created_at','creation_time','timestamp','publish_time','count','total_count','edges','node','nodes','comments','comment_rendering_instance','replies','display_comments','feedback','owning_profile','author','thread_items','post','thread','page_info','has_next_page','has_previous_page','start_cursor','end_cursor','cursor','has_more','reply_to_author','reply_to_author_id','reply_to_post_id','media_type','image_versions2','candidates','video_versions','height','width','preview_image','attachments','attached_media','comment_parent','parent_feedback','expansion_info','is_ranked','is_viewer_muted','is_author','comment_count','reply_count']);
for(const key of ['reply_level','root_post_author','legacy_fbid','depth','comment_direct_parent','inline_expansion'])allowed.add(key);
function trim(value,depth=0){
 if(depth>14)return null;if(Array.isArray(value))return value.slice(0,100).map(v=>trim(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>allowed.has(k)).map(([k,v])=>[k,trim(v,depth+1)]));
 return typeof value==='string'?value.slice(0,16000):value;
}
function shapes(objects){const rows=[],counts={},seen=new WeakSet();let visited=0;
 const walk=(v,path,depth)=>{if(!v||typeof v!=='object'||seen.has(v)||depth>70||++visited>200000)return;seen.add(v);
 if(Array.isArray(v)){v.forEach((x,i)=>walk(x,[...path,i],depth+1));return;}
 const type=v.__typename||'';if(type)counts[type]=(counts[type]||0)+1;
 const isPost=typeof v.pk==='string'&&v.text_post_app_info;
 if(/Comment|Thread|Reply/.test(type)||isPost||path.at(-1)==='media'||v.thread_items||v.page_info&&v.edges){
  if(rows.length<500)rows.push({path,keys:Object.keys(v),info_keys:Object.keys(v.text_post_app_info||{}),value:trim(v)});
 }
 for(const[k,x]of Object.entries(v))if(!['viewer','me','notifications','tracking'].includes(k))walk(x,[...path,k],depth+1);
 };objects.forEach((v,i)=>walk(v,[i],0));return{rows,types:counts,visited};}
const decode=s=>{try{return[JSON.parse(s.replace(/^for\s*\(;;\);/,''))];}catch{return s.split(/\r?\n/).flatMap(x=>{try{return[JSON.parse(x)];}catch{return[];}});}};
const snapshotScript=String.raw`(()=>({url:location.href,text:document.body.innerText.slice(0,70000),password:!!document.querySelector('input[type="password"]'),controls:[...document.querySelectorAll('button,[role="button"]')].map(e=>({text:(e.innerText||'').trim(),label:e.getAttribute('aria-label')})).filter(x=>x.text||x.label).slice(0,160),links:[...document.querySelectorAll('a[href]')].map(e=>({text:(e.innerText||'').slice(0,120),href:e.href})).filter(x=>/comment_id|reply_comment_id|\/post\//.test(x.href)).slice(0,200)}))()`;
try{
 const supplied=arg('--config')?JSON.parse(readFileSync(arg('--config'),'utf8')):null;
 const jobs=[];
 for(const platform of ['threads','facebook']){
  if(arg('--platform')&&arg('--platform')!==platform)continue;
  if(supplied){jobs.push(...supplied.filter(x=>x.platform===platform));continue;}
  const file=join(paths.userData,'data','collections',platform==='threads'?'threads-coffee-20261029':'coffee-20261028','posts.json');
  const raw=JSON.parse(readFileSync(file,'utf8')),records=Array.isArray(raw)?raw:(raw.records||raw.posts||[]);
  const candidates=records.filter(p=>Number(p.replies??p.comments_count)>3).sort((a,b)=>Number(b.replies??b.comments_count)-Number(a.replies??a.comments_count));
  for(const p of candidates.slice(0,Number(arg('--limit')||2)))jobs.push({platform,id:p.post_id,url:p.post_url||p.observed_post_url});
 }
 const components=Object.fromEntries(['./conversation-probe.mjs','./conversation-collector.mjs','../dist/infrastructure/browser/conversation-parser.js'].map(path=>[path,existsSync(new URL(path,import.meta.url))?createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex'):null]));
 writeFileSync(join(out,'manifest.json'),JSON.stringify({started_at:new Date().toISOString(),jobs,components},null,2),{flush:true});
 for(const [idx,job]of jobs.entries()){
  if(stopping||existsSync(join(out,'STOP')))break;const profile=(await host.list()).find(p=>(p.platform||'facebook')===job.platform&&p.label===(job.platform==='threads'?'CSD Threads':'CSD Facebook'));
  if(!profile)throw Error('PROFILE_MISSING_'+job.platform);
  await host.open(profile.id);const wc=host.observerTarget(profile.id)?.contents;if(!wc)throw Error('PROFILE_UNAVAILABLE');
  wc.setBackgroundThrottling(false);
  if(process.argv.includes('--collect')) {
   const { collectConversation }=await import('./conversation-collector.mjs');
   const normalized=[];
   try {
    const receipt=await collectConversation({window:wc,platform:job.platform,root:{id:job.id,url:job.url},runId:'conversation-probe-20261030',maxComments:50,maxSteps:5,maxMs:35000,
     shouldStop:()=>stopping||existsSync(join(out,'STOP')),onObservations:async rows=>{normalized.push(...rows);appendFileSync(join(out,'observations.jsonl'),rows.map(o=>JSON.stringify(o)).join('\n')+'\n',{flush:true});}});
    const snap=await wc.executeJavaScript(snapshotScript);writeFileSync(join(out,`${idx}-${job.platform}-${job.id}-verification.json`),JSON.stringify({receipt,dom:snap,comments:normalized.filter(o=>o.entity_type==='COMMENT').map(o=>({id:o.entity_id,text_seen:snap.text.includes(o.text.slice(0,70)),parent:o.parent_id}))},null,2),{flush:true});
    appendFileSync(join(out,'receipts.jsonl'),JSON.stringify(receipt)+'\n',{flush:true});console.log(JSON.stringify(receipt));
   }finally{await host.close(profile.id);}
   continue;
  }
  wc.debugger.attach('1.3');await wc.debugger.sendCommand('Network.enable');
  const prefix=join(out,`${idx}-${job.platform}-${job.id}`),pending=new Set(),requests=new Map();let sequence=0;
  const onMessage=(_event,method,p)=>{
   if(method==='Network.responseReceived'){
    try{const u=new URL(p.response.url);if(u.hostname.endsWith(job.platform==='threads'?'threads.com':'facebook.com')&&/json|javascript|text\/plain|text\/html/.test(p.response.mimeType)&&/graphql|api/.test(u.pathname))requests.set(p.requestId,{status:p.response.status,path:u.pathname});}catch{}
   }
   if(method==='Network.loadingFinished'&&requests.has(p.requestId)){
    const meta=requests.get(p.requestId);requests.delete(p.requestId);
    if(p.encodedDataLength>12*1024*1024)return;
    const task=wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId}).then(r=>{const text=r.base64Encoded?Buffer.from(r.body,'base64').toString('utf8'):r.body;const result=shapes(decode(text));if(result.rows.length)writeFileSync(prefix+`-response-${++sequence}.json`,JSON.stringify({meta,...result},null,2),{flush:true});}).catch(()=>{});
    pending.add(task);void task.finally(()=>pending.delete(task));
   }
  };wc.debugger.on('message',onMessage);
  try{
   await wc.loadURL(job.url);await sleep(4000);
   for(let step=0;step<4;step++){
    const snap=await wc.executeJavaScript(snapshotScript);writeFileSync(prefix+`-dom-${step}.json`,JSON.stringify(snap,null,2),{flush:true});
    if(snap.password||/\/(login|checkpoint|challenge)/.test(new URL(snap.url).pathname))throw Error('ACCOUNT_BARRIER');
    if(step===0){const embedded=await wc.executeJavaScript(`[...document.querySelectorAll('script[type="application/json"]')].map(e=>e.textContent).filter(s=>s&&s.length<12000000).slice(0,200)`);writeFileSync(prefix+'-embedded.json',JSON.stringify(shapes(embedded.flatMap(decode)),null,2),{flush:true});}
    const action=await wc.executeJavaScript(String.raw`(()=>{const labels=/^(view (more|previous|all|\d+)|see (more|previous)|show repl|xem (thêm|tất cả|các|\d+)|hiển thị)/i;const kinds=/comment|repl|bình luận|trả lời|phản hồi/i;const e=[...document.querySelectorAll('button,[role="button"]')].find(e=>{const s=(e.innerText||e.getAttribute('aria-label')||'').trim();return s.length<120&&labels.test(s)&&kinds.test(s)});if(e){const label=e.innerText||e.getAttribute('aria-label');e.click();return {clicked:label}}const es=[...document.querySelectorAll('div')].filter(e=>e.clientHeight>250&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY));const sc=es.sort((a,b)=>b.clientHeight-a.clientHeight)[0]||document.scrollingElement;sc.scrollTo({top:sc.scrollHeight,behavior:'instant'});return {scroll:true};})()`);
    appendFileSync(join(out,'events.jsonl'),JSON.stringify({idx,platform:job.platform,id:job.id,step,action})+'\n',{flush:true});await sleep(2500);
   }
   await Promise.allSettled([...pending]);console.log(JSON.stringify({platform:job.platform,id:job.id,status:'CAPTURED',responses:sequence}));
  }catch(e){console.log(JSON.stringify({platform:job.platform,id:job.id,status:e.message}));}
  finally{wc.debugger.removeListener('message',onMessage);if(wc.debugger.isAttached())wc.debugger.detach();await host.close(profile.id);}
 }
}finally{await host.shutdown();app.removeListener('before-quit',quit);app.exit(0);}
}
main().catch(error=>{console.error('CONVERSATION_PROBE_FAILED:'+error.message);app.exit(1);});
