import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const directory=resolve(process.argv[2]);
const jsonl=p=>existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const file=join(directory,'posts.jsonl'),rows=jsonl(file),batches=jsonl(join(directory,'batches.jsonl'));
const count=(items,key)=>Object.fromEntries([...new Set(items.map(key))].sort().map(k=>[k,items.filter(r=>key(r)===k).length]));
const runs=readdirSync(join(directory,'runs')).map(id=>{
 const d=join(directory,'runs',id),manifest=JSON.parse(readFileSync(join(d,'manifest.json'),'utf8'));
 const events=jsonl(join(d,'events.jsonl')),receipt=existsSync(join(d,'receipt.json'))?JSON.parse(readFileSync(join(d,'receipt.json'),'utf8')):null;
 const starts=events.filter(e=>e.event==='START');
 return {run_id:id,started_at:manifest.started_at,ended_at:events.findLast(e=>e.event==='STOP')?.at??null,receipt_stop:receipt?.stop_reason??null,
   invocations:starts.length,initial_records:starts[0]?.existing_records,new_records:rows.filter(r=>r.first_observation.run_id===id).length,
   queries:events.filter(e=>e.event==='QUERY').map(e=>e.query),new_by_method:count(rows.filter(r=>r.first_observation.run_id===id),r=>r.first_observation.method),
   same_query_new_continuation_batches:batches.filter(b=>b.run_id===id&&b.operation==='SearchCometResultsPaginatedResultsQuery'&&b.scroll_index>0&&b.new_records>0).length,
   errors:events.filter(e=>/BARRIER|FAILED|REJECTED/.test(e.event)).map(e=>({event:e.event,code:e.code,at:e.at})),
   scrolls:events.filter(e=>e.event==='SCROLL').length};
});
const anomalies=rows.filter(r=>(r.love_count!==null&&r.reactions_total!==null&&r.love_count>r.reactions_total)||Date.parse(r.published_at)>Date.parse(r.collected_at)||typeof r.post_id!=='string');
const summary={generated_at:new Date().toISOString(),dataset_sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),unique:rows.length,
 identity_unique:new Set(rows.map(r=>r.post_id)).size,url_unique:new Set(rows.map(r=>r.observed_post_url)).size,
 parsed_observations:batches.reduce((n,b)=>n+b.parsed,0),duplicate_observations:batches.reduce((n,b)=>n+b.duplicates,0),
 visibility:count(rows,r=>r.visibility),sources:count(rows,r=>r.source_type),query:count(rows,r=>r.query),relevance:count(rows,r=>r.relevance),methods:count(rows,r=>r.first_observation.method),
 missing:Object.fromEntries(['text','source_name','source_url','published_at','reactions_total','love_count','comments_count','shares_count'].map(k=>[k,rows.filter(r=>r[k]===null||r[k]==='').length])),
 anomalies:anomalies.map(r=>r.post_id),runs};
writeFileSync(join(directory,'quality-summary.json'),JSON.stringify(summary,null,2),{flush:true});
// Deterministic representative sample, for actual reading/annotation, never auto-ACCEPT.
const sample=new Map();
for(const type of ['PAGE','GROUP','UNKNOWN'])for(const r of rows.filter(r=>r.source_type===type).sort((a,b)=>a.post_id.localeCompare(b.post_id)).slice(0,4))sample.set(r.post_id,r);
for(const q of new Set(rows.map(r=>r.query)))for(const r of rows.filter(r=>r.query===q).sort((a,b)=>a.post_id.localeCompare(b.post_id)).slice(0,2))sample.set(r.post_id,r);
for(const r of rows.filter(r=>r.visibility!=='PUBLIC'||anomalies.includes(r)))sample.set(r.post_id,r);
writeFileSync(join(directory,'audit-sample-'+summary.dataset_sha256.slice(0,12)+'.json'),JSON.stringify([...sample.values()],null,2),{flush:true});
console.log(JSON.stringify(summary,null,2));
