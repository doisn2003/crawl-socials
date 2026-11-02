// Local, source-backed review artifacts. No model calls and no writes to AppData.
import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {contentHash} from '../../dist/domain/conversation.js';
import {exportOpportunityWorkbook} from '../../dist/infrastructure/export/opportunity-workbook.js';

const base=resolve(process.argv[2]??'artifacts/goal-filter-v3-appdata-20261102');
const runId=process.argv[3];if(!/^[a-f0-9]{16}$/u.test(runId??''))throw Error('RUN_ID_REQUIRED');
const run=join(base,'runs',runId),manifest=JSON.parse(readFileSync(join(run,'manifest.json')));
const output=join(base,'report');mkdirSync(output,{recursive:true});
const digest=b=>createHash('sha256').update(b).digest('hex');
const count=items=>items.reduce((m,k)=>(m[k]=(m[k]??0)+1,m),{});
const label=d=>d?.classification??d?.assessment_status??'UNASSESSED';
const folded=d=>['NOT_YET','UNRELATED'].includes(label(d))?'NOT_SUITABLE':label(d);
const reports=[],review=[];
for(const source of manifest.sources){
  const phase=source.name==='cafe'?'cafe':'latest',file=join(run,source.name,phase+'-results.json');
  if(!existsSync(file))continue;
  const raw=readFileSync(source.file);if(digest(raw)!==source.source_sha256)throw Error('ORIGINAL_SOURCE_CHANGED');
  const original=JSON.parse(raw),results=JSON.parse(readFileSync(file)),summary=JSON.parse(readFileSync(join(run,source.name,phase+'-summary.json')));
  const previous=new Map(original.conversations.map(r=>[r.snapshot.platform+':'+r.snapshot.root_post_id,r.decision]));
  const rows=results.conversations;
  const transitions=count(rows.map(r=>folded(previous.get(r.snapshot.platform+':'+r.snapshot.root_post_id))+' → '+label(r.decision)));
  const old=count(rows.map(r=>label(previous.get(r.snapshot.platform+':'+r.snapshot.root_post_id))));
  const groups=[['top_suitable',rows.filter(r=>r.decision.classification==='SUITABLE').slice(0,8)],
    ['recovered',rows.filter(r=>r.decision.classification==='SUITABLE'&&previous.get(r.snapshot.platform+':'+r.snapshot.root_post_id)?.classification!=='SUITABLE').slice(0,5)],
    ['rejected_old_positive',rows.filter(r=>r.decision.classification==='NOT_SUITABLE'&&previous.get(r.snapshot.platform+':'+r.snapshot.root_post_id)?.classification==='SUITABLE').slice(0,5)],
    ['pending',rows.filter(r=>r.decision.assessment_status==='PENDING').slice(0,3)]];
  const seen=new Set();
  for(const [selection,items]of groups)for(const row of items){if(seen.has(row.snapshot.id))continue;seen.add(row.snapshot.id);
    const s=row.snapshot,d=row.decision,target=[s.post,...s.comments].find(e=>e?.entity_id===(d.goal_assessment?.candidate_entity_id??s.root_post_id));
    review.push({source:source.name,selection,root:s.root_post_id,snapshot:s.id,previous:label(previous.get(s.platform+':'+s.root_post_id)),current:label(d),
      text:target?.text??s.post?.text??'',link:target?.permalink??s.post?.permalink??'',reason:d.attributes?.need_summary??d.reason_code,
      conditions:d.goal_assessment?.checks.map(check=>({criterion:d.goal_assessment.contract.criteria.find(c=>c.id===check.criterion_id)?.description,...check})),scope:d.goal_scope_review??null});
  }
  const decisions=rows.map(r=>({...r.decision,id:'replay-'+contentHash(r.decision),platform:r.snapshot.platform,root_post_id:r.snapshot.root_post_id,
    snapshot_revision:r.snapshot.revision}));
  const exportData={campaign:results.campaign,progress:{counts:summary.counts},cost:results.cost,snapshots:rows.map(r=>r.snapshot),decisions,
    conversations:rows.map((r,i)=>({...r,decision:decisions[i]})),watermark:{captured_at:statSync(file).mtime.toISOString(),
      semantics:'Replay artifact generated at this time. Each evaluated_at is frozen to the original snapshot observation time. No live availability verification.'},
    retained_input:{source_id:source.id,sha256:source.source_sha256,original_unchanged:true},ranking:{policy:'goal-evidence-rank-v3',code_hash:manifest.code_hash}};
  await exportOpportunityWorkbook(join(output,source.name+'.xlsx'),exportData);
  writeFileSync(join(output,source.name+'.json'),JSON.stringify(exportData));
  reports.push({...summary,old_three_labels:old,label_only_collapse:count(rows.map(r=>folded(previous.get(r.snapshot.platform+':'+r.snapshot.root_post_id)))),
    transitions,pending_reasons:count(rows.filter(r=>r.decision.assessment_status==='PENDING').map(r=>r.decision.reason_code)),
    technical_errors:count(rows.filter(r=>r.decision.assessment_status==='FAILED'||/^MODEL_|^CLASSIFIER_/u.test(r.decision.reason_code)).map(r=>r.decision.reason_code)),
    contract:results.contract,source_id:source.id,source_bytes:source.bytes,original_unchanged:true});
}
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):e.name==='model-ledger.jsonl'?[join(dir,e.name)]:[]);
const usage=[];
for(const source of manifest.sources){const dir=join(base,'model-ledgers',source.name);if(!existsSync(dir))continue;
  const starts=new Map(),finishes=new Map();
  for(const file of files(dir))for(const line of readFileSync(file,'utf8').split('\n').filter(Boolean)){const event=JSON.parse(line);
    if(event.type==='START')starts.set(event.invocation_id,event);else finishes.set(event.invocation_id,event);}
  usage.push({source:source.name,attempts:starts.size,successful_calls:[...finishes.values()].filter(e=>e.result).length,
    measured_token_price_usd:[...finishes.values()].reduce((n,e)=>n+(e.cost_usd??0),0),
    unknown_upper_usd:[...finishes.values()].reduce((n,e)=>n+(e.unmetered_cost_upper_usd??0),0)+[...starts].filter(([id])=>!finishes.has(id)).reduce((n,[,e])=>n+e.reserved_usd,0)});
}
const report={generated_at:new Date().toISOString(),run:runId,policy:manifest.policy,code_hash:manifest.code_hash,recipe_hash:manifest.recipe_hash,
  reports,usage,usage_note:'Token-price estimates across ALL probes/retries/workers, not a provider invoice. Free Tier limits were observed. Interrupted in-flight calls remain in the unknown upper bound.',
  methodology:'Current retained snapshots; three newest result files by mtime plus largest cafe result file by bytes. No sampling for replay. Manual regression annotations are not user-approved ground truth. Historical posts are assessed as of original observation, not verified for current availability.',
  comparison_note:'Collapsing old NOT_YET and UNRELATED labels only changes display. All changes in accepted rows below come from re-evaluating goal/evidence, not renaming labels.'};
writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(output,'manual-review-candidates.json'),JSON.stringify(review,null,2));
console.log(JSON.stringify({sources:reports.map(r=>({source:r.source,total:r.total,counts:r.counts,complete:r.complete})),usage,review_candidates:review.length,output},null,2));
