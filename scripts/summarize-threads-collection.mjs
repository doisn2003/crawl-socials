import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const directory=resolve(process.argv[2]||'');
const lines=file=>existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
const rows=lines(join(directory,'posts.jsonl')),batches=lines(join(directory,'batches.jsonl'));
const batchIds=new Set(batches.map(b=>b.batch_id));
const runDirs=readdirSync(join(directory,'runs'),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>join(directory,'runs',d.name));
const events=runDirs.flatMap(d=>lines(join(d,'events.jsonl'))),verification=runDirs.flatMap(d=>lines(join(d,'verification.jsonl')));
const starts=events.filter(e=>e.event==='START'),stops=events.filter(e=>e.event==='STOP');
const normUrl=r=>`https://www.threads.com/@${r.author_username}/post/${r.shortcode}`;
const report={checked_at:new Date().toISOString(),unique:rows.length,
 duplicate_ids:rows.length-new Set(rows.map(r=>r.post_id)).size,duplicate_shortcodes:rows.length-new Set(rows.map(r=>r.shortcode)).size,
 duplicate_urls:rows.length-new Set(rows.map(r=>r.post_url)).size,
 invalid_records:rows.filter(r=>r.platform!=='threads'||typeof r.post_id!=='string'||!/^\d+$/.test(r.post_id)||!r.text?.trim()||r.post_url!==normUrl(r)||!Number.isFinite(Date.parse(r.collected_at))).length,
 future_publication_times:rows.filter(r=>r.published_at&&Date.parse(r.published_at)>Date.parse(r.collected_at)).length,
 missing_batch_references:rows.filter(r=>!batchIds.has(r.first_observation.batch_id)).length,
 queries:Object.fromEntries([...new Set(rows.map(r=>r.query))].map(q=>[q,rows.filter(r=>r.query===q).length])),
 modes:Object.fromEntries(['top','recent'].map(m=>[m,rows.filter(r=>r.search_mode===m).length])),
 visibility:Object.fromEntries(['PUBLIC_PROFILE','PRIVATE_PROFILE','UNKNOWN'].map(v=>[v,rows.filter(r=>r.visibility===v).length])),
 batches:batches.length,parsed_observations:batches.reduce((n,b)=>n+b.parsed,0),duplicate_observations:batches.reduce((n,b)=>n+b.duplicates,0),
 new_from_continuation:batches.filter(b=>b.method==='BROWSER_RESPONSE'&&b.scroll_index>0).reduce((n,b)=>n+b.new_records,0),
 dom_permalink_matched_ids:new Set(verification.flatMap(v=>v.permalink_matches||[])).size,
 dom_text_prefix_matched_ids:new Set(verification.flatMap(v=>v.text_prefix_matches||[])).size,
 scrolls:events.filter(e=>e.event==='YIELD').length,
 first_start:starts[0]?.at,last_stop:stops.at(-1)?.at,
 invocations:starts.map(s=>({run_id:s.run_id,started_at:s.at,existing_records:s.existing_records,code_sha256:s.code_sha256})),
 stops:stops.map(s=>({run_id:s.run_id,at:s.at,reason:s.stop_reason,total:s.total,session_flush:s.session_flush})),
 account_barriers:events.filter(e=>['HTTP_BARRIER','GRAPHQL_BARRIER'].includes(e.event)).length,
 sha256:createHash('sha256').update(readFileSync(join(directory,'posts.jsonl'))).digest('hex'),
 content_review:'NOT_REQUESTED',full_text_review:'NOT_PERFORMED'};
writeFileSync(join(directory,'validation.json'),JSON.stringify(report,null,2),{flush:true});console.log(JSON.stringify(report,null,2));
if(report.duplicate_ids||report.duplicate_shortcodes||report.duplicate_urls||report.invalid_records||report.missing_batch_references)process.exitCode=1;
