// Bounded source diagnostics, using only source URLs already saved by the collector.
// This does not classify User as PROFILE and does not open individual permalinks.
import { app } from 'electron';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { runtimePaths } from '../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../dist/infrastructure/browser/browser-host.js';
import { classifyObservedFacebookSource } from '../dist/infrastructure/browser/facebook-source-audit.js';
import { createFacebookCollectorStore } from '../dist/infrastructure/browser/facebook-collector-store.js';
async function main(){
const arg=k=>process.argv[process.argv.indexOf(k)+1];
if(!process.argv.includes('--collection'))throw Error('COLLECTION_REQUIRED');
const directory=resolve(arg('--collection'));
const limit=process.argv.includes('--limit')?Number(arg('--limit')):5;
const rel=relative(process.cwd(),directory);
if((rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))||!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('AUDIT_CONFIG_INVALID');
const rows=readFileSync(join(directory,'posts.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const sources=[...new Map(rows.filter(r=>r.source_type==='UNKNOWN'&&r.visibility==='PUBLIC'&&r.source_url).map(r=>[r.source_url,r])).values()].slice(0,limit);
const output=join(directory,'source-audit-'+Date.now()+'.jsonl');
const paths=runtimePaths(app.getPath('appData'));for(const [key,path]of Object.entries(paths)){mkdirSync(path,{recursive:true});app.setPath(key,path);}
app.setName('CSD');if(!app.requestSingleInstanceLock())app.exit(2);
app.on('window-all-closed',()=>{});
async function timed(work,ms){let t;try{return await Promise.race([work,new Promise((_,r)=>t=setTimeout(()=>r(Error('AUDIT_TIMEOUT')),ms))]);}finally{clearTimeout(t);}}
await app.whenReady();
const profiles=createBrowserProfiles(join(paths.userData,'data'));
const matches=(await profiles.list()).filter(p=>p.label===(process.argv.includes('--profile')?arg('--profile'):'CSD Facebook'));
if(matches.length!==1)throw Error('PROFILE_SELECTION_REQUIRED');
const host=createBrowserHost({profiles,secrets:createElectronSecretStore(join(paths.userData,'secrets')),journalDirectory:join(paths.userData,'data','session-snapshots'),manualLoginEnabled:true,hidden:false});
try{
 await host.open(matches[0].id);const wc=host.observerTarget(matches[0].id).contents;wc.setBackgroundThrottling(false);
 for(const r of sources){
  const url=new URL(r.source_url);if(url.origin!=='https://www.facebook.com'||url.username||url.password)throw Error('SOURCE_URL_INVALID');
  await timed(wc.loadURL(url.href),30000);await sleep(3500);
  const result=await timed(wc.executeJavaScript(`(()=>{const main=document.querySelector('[role="main"]');return {url:location.href,barrier:/checkpoint|challenge|login|recover|blocked/.test(location.pathname)||!!document.querySelector('input[type="password"]'),text:(main?.innerText||'').slice(0,12000),alerts:[...document.querySelectorAll('[role="alert"],[role="dialog"]')].map(e=>e.innerText).join(' ').slice(0,2000),blocks:[...document.querySelectorAll('script[type="application/json"]')].map(s=>s.textContent||'').filter(s=>s.length<4000000).slice(0,100)}})()`),8000);
  if(result.barrier||/temporarily blocked|try again later|quá nhiều yêu cầu|tạm thời bị chặn/i.test(result.alerts))throw Error('ACCOUNT_BARRIER');
  // Keep only candidate structural keys on objects with the observed source's name.
  const matches=[],seen=new WeakSet();let nodes=0;
  function walk(v,path=[],depth=0){if(++nodes>100000||depth>40||!v||typeof v!=='object'||seen.has(v))return;seen.add(v);
   if(v.name===r.author_name||v.name===r.source_name){const projection={};for(const[k,x]of Object.entries(v))if((k==='name'||k==='__typename'||/^(?:is_|profile_|category|delegate_page)/.test(k))&&(x===null||typeof x==='boolean'||typeof x==='number'||typeof x==='string'&&x.length<300))projection[k]=x;matches.push({path,projection,keys:Object.keys(v)});}
   for(const[k,x]of Object.entries(v))walk(x,[...path,k],depth+1);
  }
  for(const[s,b]of result.blocks.entries())try{walk(JSON.parse(b),[s]);}catch{}
  const row={at:new Date().toISOString(),source_url:r.source_url,source_name:r.author_name,example_post_id:r.post_id,observed_url:result.url,main_text:result.text.split(/\n(?:Thông tin cá nhân|Bài viết)\n/)[0].slice(0,500),matching_objects:matches.slice(0,30),document_json_sha256:createHash('sha256').update(result.blocks.join('\n')).digest('hex')};
  appendFileSync(output,JSON.stringify(row)+'\n',{flush:true});
  appendFileSync(join(directory,'source-audits.jsonl'),JSON.stringify(row)+'\n',{flush:true});
  console.log(JSON.stringify({event:'SOURCE_AUDIT',count:matches.length,classification:classifyObservedFacebookSource(row),source_index:sources.indexOf(r),output}));
 }
}catch(e){writeFileSync(output+'.error.json',JSON.stringify({at:new Date().toISOString(),error:e.message}));process.exitCode=1;}
finally{try{await timed(host.shutdown(),15000);createFacebookCollectorStore(directory).export();}catch{process.exitCode=1;}app.exit(process.exitCode||0);}
}
void main().catch(e=>{console.error('AUDIT_FAILED:'+e.message);app.exit(1);});
