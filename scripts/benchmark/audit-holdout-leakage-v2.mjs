#!/usr/bin/env node
/** Label-blind leakage checks. Reads snapshot content/identity only, never decisions. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const VERSION='holdout-leakage-v2.0.0', PLATFORMS=['facebook','threads'];
const ROOT=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const key=r=>JSON.stringify([r.platform,r.root_post_id??r.post_id]);
const validRoot=r=>r&&PLATFORMS.includes(r.platform)&&typeof(r.root_post_id??r.post_id)==='string'&&(r.root_post_id??r.post_id).length>0;
export function normalizeLeakageText(text){return String(text??'').normalize('NFKC').toLocaleLowerCase('vi').replace(/https?:\/\/\S+/gu,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/gu,' ').trim();}
const shingles=text=>{const words=text.split(' '),result=new Set();for(let i=0;i+5<=words.length;i++)result.add(words.slice(i,i+5).join(' '));return result;};
function authors(row){
 const post=row.post??row,platform=row.platform,keys=new Set();
 if(post.author?.id)keys.add(platform+':id:'+String(post.author.id));
 if(platform==='threads'&&row.author_username)keys.add('threads:handle:'+String(row.author_username).replace(/^@/u,'').toLowerCase());
 try{const u=new URL(post.permalink??row.url??row.post_url??row.observed_post_url),parts=u.pathname.split('/').filter(Boolean);
  if(platform==='threads'&&/^@[^/]+$/u.test(parts[0]??'')&&parts[1]==='post')keys.add('threads:handle:'+parts[0].slice(1).toLowerCase());
  if(platform==='facebook'&&parts[1]==='posts'&&parts[0]&&!['groups','pages','share','watch','reel'].includes(parts[0].toLowerCase()))keys.add('facebook:'+(/^\d+$/u.test(parts[0])?'id:':'handle:')+parts[0].toLowerCase());
 }catch{/* Missing/unsupported URL is missing identity, never display-name matching. */}
 return [...keys];
}
function texts(row){const post=row.post??row;return [...new Set([post.text,row.text_original].filter(v=>typeof v==='string'&&v.trim()).map(normalizeLeakageText))];}
export function historicalExposure(exclusionRecords,historyRecords){
 if(!exclusionRecords.every(validRoot))throw Error('EXCLUSION_ID_INVALID');
 const exposed=new Map(exclusionRecords.map(r=>[key(r),{platform:r.platform,root_post_id:r.root_post_id??r.post_id,texts:new Set(),authors:new Set(),matched:false}]));
 for(const row of historyRecords){if(!validRoot(row))continue;const prior=exposed.get(key(row));if(!prior)continue;prior.matched=true;for(const t of texts(row))prior.texts.add(t);for(const a of authors(row))prior.authors.add(a);}
 return exposed;
}
export function auditHoldoutLeakage(input,exclusionRecords,historyRecords){
 const data=Array.isArray(input?.snapshots)?input:input?.opportunity;
 if(!data||!Array.isArray(data.snapshots))throw Error('FROZEN_EXPORT_REQUIRED');
 const exposed=historicalExposure(exclusionRecords,historyRecords),priorAuthor=new Map(),exact=new Map(),index=new Map(),variants=[];
 for(const [root,r]of exposed){for(const author of r.authors){const matches=priorAuthor.get(author)??new Set();matches.add(root);priorAuthor.set(author,matches);}
  for(const text of r.texts){const words=text.split(' ');if(text.length<40||words.length<8)continue;const previous=exact.get(text)??new Set();previous.add(root);exact.set(text,previous);
   const set=shingles(text),id=variants.length;variants.push({root,set});for(const token of set){const rows=index.get(token)??[];rows.push(id);index.set(token,rows);}}}
 const extended=new Map([...exposed.values()].map(r=>[key(r),{platform:r.platform,root_post_id:r.root_post_id}])),matches=[];
 const stats={input_population:0,exact_root_excluded:0,additional_excluded:0,author_overlap_roots:0,exact_text_overlap_roots:0,near_text_overlap_roots:0,
  missing_author_identity:0,missing_post_text:0,short_text_not_copy_tested:0,eligible_after_extension:0};
 const byPlatform=Object.fromEntries(PLATFORMS.map(p=>[p,structuredClone(stats)]));
 const populationAuthors=new Map(),populationTexts=new Map(),seen=new Set();
 for(const row of data.snapshots){if(!validRoot(row)||seen.has(key(row)))throw Error('POPULATION_ID_INVALID');seen.add(key(row));const s=byPlatform[row.platform];s.input_population++;
  if(exposed.has(key(row))){s.exact_root_excluded++;continue;}
  const reasons=[],a=authors(row),t=texts(row);if(!a.length)s.missing_author_identity++;if(!t.length)s.missing_post_text++;
  for(const author of a){const roots=populationAuthors.get(author)??new Set();roots.add(key(row));populationAuthors.set(author,roots);if(priorAuthor.has(author))reasons.push({reason:'PRIOR_AUTHOR_IDENTITY',identity:author,prior_roots:[...priorAuthor.get(author)]});}
  let tested=false;for(const text of t){if(text.length<40||text.split(' ').length<8)continue;tested=true;const roots=populationTexts.get(text)??new Set();roots.add(key(row));populationTexts.set(text,roots);
   if(exact.has(text)){reasons.push({reason:'NORMALIZED_EXACT_TEXT',text_sha256:hash(text),prior_roots:[...exact.get(text)]});continue;}
   const set=shingles(text),shared=new Map();for(const token of set)for(const id of index.get(token)??[])shared.set(id,(shared.get(id)??0)+1);
   for(const [id,intersection]of shared){const prior=variants[id],ratio=Math.min(set.size,prior.set.size)/Math.max(set.size,prior.set.size);
    if(intersection<3||ratio<0.7)continue;const jaccard=intersection/(set.size+prior.set.size-intersection),containment=intersection/Math.min(set.size,prior.set.size);
    if(jaccard>=0.85||containment>=0.90)reasons.push({reason:'NEAR_TEXT_COPY',prior_roots:[prior.root],jaccard,containment,length_ratio:ratio,text_sha256:hash(text)});}}
  if(!tested)s.short_text_not_copy_tested++;
  if(reasons.length){extended.set(key(row),{platform:row.platform,root_post_id:row.root_post_id});matches.push({platform:row.platform,root_post_id:row.root_post_id,reasons});s.additional_excluded++;
   if(reasons.some(r=>r.reason==='PRIOR_AUTHOR_IDENTITY'))s.author_overlap_roots++;if(reasons.some(r=>r.reason==='NORMALIZED_EXACT_TEXT'))s.exact_text_overlap_roots++;if(reasons.some(r=>r.reason==='NEAR_TEXT_COPY'))s.near_text_overlap_roots++;}
  else s.eligible_after_extension++;
 }
 const aggregate=Object.fromEntries(Object.keys(stats).map(k=>[k,PLATFORMS.reduce((n,p)=>n+byPlatform[p][k],0)]));
 const historyByPlatform=Object.fromEntries(PLATFORMS.map(p=>{const rows=[...exposed.values()].filter(r=>r.platform===p);return[p,{exposed_roots:rows.length,matched_history:rows.filter(r=>r.matched).length,
  missing_text:rows.filter(r=>!r.texts.size).length,missing_author_identity:rows.filter(r=>!r.authors.size).length,has_stable_author_id:rows.filter(r=>[...r.authors].some(a=>a.includes(':id:'))).length,has_url_or_username_identity:rows.filter(r=>[...r.authors].some(a=>a.includes(':handle:'))).length}];}));
 return {exclusions:[...extended.values()].sort((a,b)=>key(a).localeCompare(key(b))),matches,
  report:{version:VERSION,selection_is_label_blind:true,original_exclusion_count:exposed.size,extended_exclusion_count:extended.size,aggregate,by_platform:byPlatform,historical_metadata:historyByPlatform,
   method:{author:'Same platform exact stable ID, or URL/Threads username handle; no display-name matching. Handles can change.',text:'NFKC lowercase, URL removal, punctuation/whitespace normalization; accents and numbers preserved.',minimum_copy_text:'40 normalized characters and8 tokens',near_copy:'5-token shingles; Jaccard>=0.85 OR containment>=0.90, shingle-count ratio>=0.70, at least3 shared shingles',scope:'Only prior-exposed roots seed exclusion extension; newly excluded roots are not recursively added as training exposure.'},
   within_nonexact_frame:{repeated_author_groups:[...populationAuthors.values()].filter(s=>s.size>1).length,exact_copy_groups:[...populationTexts.values()].filter(s=>s.size>1).length,policy:'Reported, not collapsed: infer only to this eligible root-post population, not unseen authors or the whole network.'},
   limitations:['Missing historical author identity prevents a complete author-disjoint claim.','Short text and paraphrases beyond the stated threshold are not proven independent.','Known root exclusion list completeness is assumed; no private messages or unrelated sources searched.','Extended exclusions change the estimand to the remaining eligible population; report counts and weights.']}};
}
function records(file){const bytes=fs.readFileSync(file),value=file.endsWith('.jsonl')?bytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse):JSON.parse(bytes.toString('utf8'));
 return{bytes,rows:Array.isArray(value)?value:Array.isArray(value.snapshots)?value.snapshots:value.opportunity?.snapshots??[]};}
function outside(destination){const resolved=path.resolve(destination);let ancestor=resolved;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);const final=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,resolved)),relative=path.relative(ROOT,final);if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('OUTPUT_MUST_BE_EXTERNAL');return resolved;}
export function freezeLeakageAudit(options){const input=fs.readFileSync(options.input),excluded=records(options.excludeIds),historical=[];
 const sources=options.history.map(file=>{const value=records(file);historical.push(...value.rows);return{path:path.resolve(file),sha256:hash(value.bytes),rows:value.rows.length};});
 const result=auditHoldoutLeakage(JSON.parse(input.toString('utf8')),excluded.rows,historical),dir=outside(options.output);
 if(fs.existsSync(dir)&&fs.readdirSync(dir).length)throw Error('FROZEN_OUTPUT_EXISTS');fs.mkdirSync(dir,{recursive:true});
 const exclusionBytes=result.exclusions.map(r=>JSON.stringify(r)).join('\n')+'\n';
 const report={...result.report,input:{path:path.resolve(options.input),sha256:hash(input)},exclusion_input:{path:path.resolve(options.excludeIds),sha256:hash(excluded.bytes)},historical_sources:sources,extended_exclusions_sha256:hash(exclusionBytes)};
 for(const[file,value]of[['exclusions-extended.jsonl',exclusionBytes],['matches-private.jsonl',result.matches.map(r=>JSON.stringify(r)).join('\n')+'\n'],['report.json',JSON.stringify(report,null,2)+'\n']])fs.writeFileSync(path.join(dir,file),value,{flag:'wx',flush:true,mode:0o600});
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const options={history:[]};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!v)throw Error('ARGUMENT_REQUIRED');if(k==='--history')options.history.push(v);else if(k==='--input')options.input=v;else if(k==='--exclude-ids')options.excludeIds=v;else if(k==='--output')options.output=v;else throw Error('ARGUMENT_INVALID');}console.log(JSON.stringify(freezeLeakageAudit(options)));}catch(error){console.error(JSON.stringify({error_code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:'LEAKAGE_AUDIT_FAILED'}));process.exitCode=1;}}
