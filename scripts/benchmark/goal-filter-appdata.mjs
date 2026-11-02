// Replay current retained snapshots; never writes to the source AppData collections.
// Labels/counts are not accuracy. Regression expectations below were frozen from the prior audit.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyConversations, opportunityRank, classifierRecipe } from '../../dist/application/classification-service.js';
import { compileGoalContract } from '../../dist/application/goal-classifier.js';
import { GOAL_FILTER_VERSION, goalDecision, canonicalEvidenceQuote } from '../../dist/domain/goal-filter.js';
import { campaignVersion } from '../../dist/domain/campaign-plan.js';
import { contentHash } from '../../dist/domain/conversation.js';
import { createCampaignModelGateway } from '../../dist/infrastructure/llm/campaign-model-gateway.js';
import { createSharedModelBudget } from '../../dist/infrastructure/llm/shared-model-budget.js';
import { resolveGeminiApiKey } from '../../dist/infrastructure/llm/gemini-gateway.js';

const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const phase=args.phase??'probe'; if(!['probe','latest','cafe','inventory'].includes(phase))throw Error('INVALID_PHASE');
const out=resolve(args.out??'artifacts/goal-filter-v3-appdata-20261102'); mkdirSync(out,{recursive:true});
const base=join(process.env.APPDATA,'csd-desktop/data/collections');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=readdirSync(base).flatMap(id=>{
  const file=join(base,id,'opportunity-results.json'); if(!existsSync(file))return[];
  const raw=readFileSync(file), data=JSON.parse(raw);
  return [{id,file,bytes:raw.length,source_sha256:digest(raw),modified:statSync(file).mtime.toISOString(),prompt:data.campaign.prompt,
    snapshots:data.snapshots.length,rows:data.conversations.length}];
}).sort((a,b)=>b.modified.localeCompare(a.modified));
const latest=catalog.slice(0,3), cafe=catalog.filter(s=>/cafe|cà phê|cà phê/iu.test(s.prompt)).sort((a,b)=>b.bytes-a.bytes)[0];
if(!cafe||latest.some(s=>s.id===cafe.id))throw Error('FOUR_DISTINCT_SOURCES_REQUIRED');
const selected=[...latest.map((s,i)=>({...s,name:['housing','property','chicken'][i]})),{...cafe,name:'cafe'}];
const recipe_hash=contentHash(classifierRecipe(GOAL_FILTER_VERSION));
const code_hash=digest(['dist/application/goal-classifier.js','dist/domain/goal-filter.js','dist/application/classification-service.js'].map(f=>readFileSync(f,'utf8')).join('\n'));
const runRoot=join(out,'runs',code_hash.slice(0,16)); mkdirSync(runRoot,{recursive:true});
writeFileSync(join(out,'inventory.json'),JSON.stringify({captured_at:new Date().toISOString(),sources:selected},null,2));
writeFileSync(join(runRoot,'manifest.json'),JSON.stringify({policy:GOAL_FILTER_VERSION,recipe_hash,code_hash,sources:selected,
  reused_from:args.reuse??null,reuse_policy:'Revalidate saved evidence against current rules and campaign. Preserve exact contracts, or proven negative decisions when every old mandatory criterion is unchanged and the contract only adds constraints with no new OR branch. Never migrate a positive across changed contracts or reuse technical failures.',
  as_of:'Each snapshot.observed_at, held constant for comparison to the saved run.',scope:'All current retained snapshots; no browser fetching; original files remain unchanged.'},null,2));
console.log(JSON.stringify({phase,runRoot,sources:selected.map(s=>({name:s.name,rows:s.rows,snapshots:s.snapshots,bytes:s.bytes}))}));
if(phase==='inventory')process.exit(0);
if(phase==='cafe' && !existsSync(join(runRoot,'latest-complete.json')))throw Error('LATEST_THREE_MUST_FINISH_BEFORE_CAFE');
let key=resolveGeminiApiKey();
if(!key)throw Error('GEMINI_KEY_REQUIRED');
const regression = {
  housing:{'3978236962096204080':'NOT_SUITABLE','3407014804672892339':'NOT_SUITABLE','1396475761161150':'NOT_SUITABLE',
    '4008581148849563177':'NOT_SUITABLE','1460078205233323':'PENDING','2922430571472391':'REVIEW'},
  property:{'29670196452585891':'SUITABLE','1635189961130044':'SUITABLE','2300601107426914':'SUITABLE','3995556626442066289':'SUITABLE'},
  chicken:{'3340085212868470':'NOT_SUITABLE','4006104236907717362':'NOT_SUITABLE','4378345315742301':'NOT_SUITABLE',
    '3170883943106246':'REVIEW','4019414225903392041':'NOT_SUITABLE','4005510553779062349':'NOT_SUITABLE','3619935910619385346':'SUITABLE'},
  cafe:{'3582236104919098693':'SUITABLE','3782813745080796676':'SUITABLE','3643163465700898150':'SUITABLE',
    '3396921203226302763':'SUITABLE','1311145487640687':'SUITABLE','3854976772697302734':'SUITABLE',
    '3989616233687278369':'SUITABLE','4016342806516758454':'NOT_SUITABLE','4008897959127115364':'NOT_SUITABLE',
    '946185510006740':'NOT_SUITABLE'}
};
const report=[];
// One process-wide request gate, including retries and secondary checks.
let nextRequestAt=0,gate=Promise.resolve(),requestInterval=Number(args.interval??4500);
const pacedFetch=async(url,options)=>{
  const turn=gate.then(async()=>{await delay(Math.max(0,nextRequestAt-Date.now()),undefined,{signal:options?.signal});nextRequestAt=Date.now()+requestInterval;});
  gate=turn.catch(()=>{});await turn;
  const response=await fetch(url,options);
  if(response.status===429){
    const body=await response.clone().json().catch(()=>null),details=body?.error?.details??[];
    for(const v of details.flatMap(d=>d.violations??[]))if(/RequestsPerMinute/iu.test(v.quotaId??'')&&Number(v.quotaValue)>0)
      requestInterval=Math.max(requestInterval,Math.ceil(60000/Number(v.quotaValue))+500);
    const retrySeconds=Number.parseFloat(details.find(d=>d.retryDelay)?.retryDelay??'60');
    nextRequestAt=Math.max(nextRequestAt,Date.now()+Math.min(120,Math.max(10,retrySeconds))*1000);
    console.log(JSON.stringify({rate_limit:details.flatMap(d=>d.violations??[]).map(v=>({metric:v.quotaMetric,id:v.quotaId,limit:v.quotaValue})),retry_seconds:retrySeconds}));
  }
  return response;
};
for(const source of phase==='cafe'?[selected[3]]:selected.slice(0,3)){
  const data=JSON.parse(readFileSync(source.file)), campaign=structuredClone(data.campaign);
  campaign.filter_version=GOAL_FILTER_VERSION;
  if(source.name==='housing'){
    campaign.prompt+='\nLàm rõ đã được người dùng xác nhận: Tìm phòng để tôi thuê. Tìm người chào cho thuê hoặc nhượng phòng, không tìm người cũng đang hỏi thuê.';
    campaign.audience=['Người chào cho thuê hoặc nhượng phòng để tôi thuê']; campaign.participation_intents=[];
  }
  const {version:_v,created_at:_at,...definition}=campaign;campaign.version=campaignVersion(definition);
  const folder=join(runRoot,source.name);mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'campaign.json'),JSON.stringify(campaign,null,2));
  const budgetUsd=Number(args.budget??6),sharedBudget=createSharedModelBudget(budgetUsd);
  const gateway=createCampaignModelGateway({directory:join(out,'model-ledgers',source.name),apiKey:key,budgetUsd,sharedBudget,
    primaryModel:'gemini-3.5-flash-lite',selectionReason:'GOAL_FILTER_REPLAY',maxAttempts:3,timeoutMs:180000,fetch:pacedFetch});
  const namespace='goal-filter-v3:'+recipe_hash;
  const priorContract=existsSync(join(folder,'contract.json'))?join(folder,'contract.json')
    :args.reuse&&/^[a-f0-9]{16}$/u.test(args.reuse)?join(out,'runs',args.reuse,source.name,'contract.json'):null;
  // A saved contract is only a candidate: the current compiler independently audits coverage before reuse.
  const candidateContract=priorContract&&existsSync(priorContract)?JSON.parse(readFileSync(priorContract,'utf8')):undefined;
  const {contract}=await compileGoalContract(campaign,gateway,{cacheNamespace:namespace,...(candidateContract?{candidateContract}:{})});
  writeFileSync(join(folder,'contract.json'),JSON.stringify(contract,null,2));
  console.log(JSON.stringify({source:source.name,goal:contract.goal,criteria:contract.criteria.length,branches:contract.branches.length,cost:gateway.summary().measured_cost_usd}));
  if(args['contract-only']==='1')continue;
  const current=new Map(data.snapshots.map(s=>[s.platform+':'+s.root_post_id,s]));
  for(const row of data.conversations)current.set(row.snapshot.platform+':'+row.snapshot.root_post_id,row.snapshot);
  const all=[...current.values()].sort((a,b)=>(a.platform+':'+a.root_post_id).localeCompare(b.platform+':'+b.root_post_id));
  const subset=phase==='probe'?all.filter(s=>Object.hasOwn(regression[source.name],s.root_post_id)):all;
  const needsEmptyCommentEnrichment=(d,s)=>d.classification==='NOT_SUITABLE'&&s?.comments.length
    &&d.goal_assessment?.candidate_entity_id===s.post?.entity_id
    &&!s.comments.some(c=>s.spans.some(p=>p.entity_id===c.entity_id&&p.text.trim().length>0));
  const file=join(folder,'decisions.jsonl'), decisions=new Map();
  if(existsSync(file))for(const line of readFileSync(file,'utf8').split('\n').filter(Boolean)){
    const d=JSON.parse(line);if(d.assessment_status!=='FAILED'&&!/^MODEL_|^CLASSIFIER_/u.test(d.reason_code)
      &&!needsEmptyCommentEnrichment(d,subset.find(s=>s.id===d.snapshot_id)))decisions.set(d.snapshot_id,d);
  }
  let reused=0,narrowedRejections=0;
  if(args.reuse){const previous=join(out,'runs',args.reuse,source.name,'decisions.jsonl');
    if(!/^[a-f0-9]{16}$/u.test(args.reuse))throw Error('INVALID_REUSE_RUN');
    if(existsSync(previous))for(const line of readFileSync(previous,'utf8').split('\n').filter(Boolean)){
      let d=JSON.parse(line);const a=d.goal_assessment,s=subset.find(s=>s.id===d.snapshot_id);
      if(!s||decisions.has(s.id)||!a||d.assessment_status==='FAILED'||/^MODEL_|^CLASSIFIER_/u.test(d.reason_code)
        ||d.campaign_version!==campaign.version||(d.reason_code==='GOAL_EXPIRED'&&!d.goal_review))continue;
      if(needsEmptyCommentEnrichment(d,s))continue;
      if(s.comments.length&&d.classification!=='SUITABLE'&&a.candidate_entity_id===s.post?.entity_id&&!d.goal_comment_review)continue;
      try{
        const changedContract=a.contract_hash!==contentHash(contract);
        let checks=a.checks;
        if(changedContract){
          // Only a stronger contract can preserve a proven rejection. Never migrate a positive,
          // an added OR branch, a removed requirement, or a changed criterion meaning.
          if(d.classification!=='NOT_SUITABLE'||d.reason_code!=='GOAL_CONSTRAINT_MISMATCH'
            ||contentHash(a.contract.branches.map(b=>b.id).sort())!==contentHash(contract.branches.map(b=>b.id).sort()))continue;
          const meaning=({id,...criterion})=>contentHash(criterion);
          const oldCriteria=new Map(a.contract.criteria.map(c=>[meaning(c),c]));
          if(a.contract.criteria.filter(c=>c.strength==='REQUIRED').some(old=>!contract.criteria.some(c=>meaning(c)===meaning(old))))continue;
          checks=contract.criteria.map(c=>{
            const old=oldCriteria.get(meaning(c)),check=old&&a.checks.find(v=>v.criterion_id===old.id);
            return check?{...check,criterion_id:c.id}:{criterion_id:c.id,status:'UNKNOWN',evidence:[]};
          });
        }
        const checked=goalDecision({snapshot_id:s.id,candidate_entity_id:a.candidate_entity_id,candidate_description:a.candidate_description,
          checks,summary:d.attributes.need_summary,speaker_role:d.attributes.speaker_role,match_type:d.attributes.observed_need,
          temporal_status:d.attributes.temporal_status,valid_until:d.valid_until,temporal_evidence:d.temporal_evidence},campaign,contract,s,d.model,d.evaluated_at);
        const scope=changedContract?null:d.goal_scope_review;
        if(scope){if(!scope.evidence.every(p=>{const span=s.spans.find(v=>v.id===p.id);return span&&canonicalEvidenceQuote(span.text,p.quote);}))continue;
          if(scope.verdict==='OUT_OF_SCOPE'){checked.classification='NOT_SUITABLE';checked.assessment_status='ASSESSED';}
          if(scope.verdict==='UNCLEAR'){checked.classification=null;checked.assessment_status='PENDING';}}
        if(checked.classification!==d.classification||checked.assessment_status!==d.assessment_status)continue;
        if(changedContract){
          if(checked.reason_code!=='GOAL_CONSTRAINT_MISMATCH')continue;
          checked.goal_review=d.goal_review;
          checked.attributes.replay_revalidated_from_contract=a.contract_hash;
          d=checked;narrowedRejections++;
        }
        decisions.set(s.id,d);appendFileSync(file,JSON.stringify(d)+'\n');reused++;
      }catch{/* Re-evaluate anything the new validator cannot verify. */}
    }
  }
  if(reused)console.log(JSON.stringify({source:source.name,revalidated_saved_decisions:reused,proved_rejections_under_stronger_contract:narrowedRejections}));
  const batchSize=Number(args.batch??8);if(!Number.isInteger(batchSize)||batchSize<1||batchSize>32)throw Error('INVALID_BATCH_SIZE');
  const pending=subset.filter(s=>!decisions.has(s.id));const batches=[];for(let i=0;i<pending.length;i+=batchSize)batches.push(pending.slice(i,i+batchSize));
  const workerCount=Number(args.workers??4);if(!Number.isInteger(workerCount)||workerCount<1||workerCount>16)throw Error('INVALID_WORKER_COUNT');
  const workers=phase==='probe'?[gateway]:Array.from({length:workerCount},(_,i)=>createCampaignModelGateway({
    directory:join(out,'model-ledgers',source.name,'worker-'+i),apiKey:key,budgetUsd,sharedBudget,
    primaryModel:'gemini-3.5-flash-lite',selectionReason:'GOAL_FILTER_REPLAY',maxAttempts:3,timeoutMs:180000,fetch:pacedFetch}));
  const totalCost=()=>{const parts=[...new Set([gateway,...workers])].map(g=>g.summary());return{
    model:gateway.summary().model,budget_usd:budgetUsd,measured_cost_usd:parts.reduce((n,s)=>n+s.measured_cost_usd,0),
    unmetered_cost_upper_usd:parts.reduce((n,s)=>n+s.unmetered_cost_upper_usd,0),reserved_usd:parts.reduce((n,s)=>n+s.reserved_usd,0),
    billable_attempts:parts.reduce((n,s)=>n+s.billable_attempts,0),cache_hits:parts.reduce((n,s)=>n+s.cache_hits,0),remaining_usd:sharedBudget.remaining()};};
  let next=0,halt=false,completed=subset.length-pending.length;
  async function worker(workerGateway){while(next<batches.length&&!halt){
    if(existsSync(join(out,'stop-after-batch'))){halt=true;break;}
    const batch=batches[next++];
    const result=await classifyConversations(campaign,batch,workerGateway,{goalContract:contract,maxBatchSize:batchSize,cacheNamespace:namespace+(args.retry?':recovery-'+args.retry:''),
      evaluationTimes:Object.fromEntries(batch.map(s=>[s.id,s.observed_at]))});
    for(const d of result.decisions){decisions.set(d.snapshot_id,d);appendFileSync(file,JSON.stringify(d)+'\n');}
    completed+=batch.length;
    const fatal=result.failures.find(f=>/^MODEL_(BUDGET|BILLING|AUTHENTICATION|KEY|PERMISSION|DAILY_QUOTA|REQUEST_INVALID|NOT_AVAILABLE)/u.test(f.code));
    if(fatal)halt=true;
    console.log(JSON.stringify({source:source.name,done:completed,total:subset.length,failures:result.failures,
      suitable:[...decisions.values()].filter(d=>d.classification==='SUITABLE').length,costUsd:totalCost().measured_cost_usd}));
  }}
  await Promise.all(workers.map(g=>worker(g)));
  const rows=subset.map(snapshot=>({snapshot,decision:decisions.get(snapshot.id),stale:false})).filter(r=>r.decision);
  rows.sort((a,b)=>{const x=opportunityRank(a.decision,a.snapshot,campaign.source_priority),y=opportunityRank(b.decision,b.snapshot,campaign.source_priority);
    for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return a.snapshot.id.localeCompare(b.snapshot.id);});
  const counts={};for(const r of rows){const label=r.decision.classification??r.decision.assessment_status;counts[label]=(counts[label]??0)+1;}
  const regressions=Object.entries(regression[source.name]??{}).map(([id,expected])=>{const d=rows.find(r=>r.snapshot.root_post_id===id)?.decision;
    const actual=d?.classification??d?.assessment_status??'MISSING';return{id,expected,actual,pass:expected==='REVIEW'?null:actual===expected};});
  const summary={source:source.name,phase,source_sha256:source.source_sha256,total:subset.length,completed:rows.length,counts,
    missing:subset.length-rows.length,regressions,cost:totalCost(),contract_hash:contentHash(contract),code_hash,
    complete:rows.length===subset.length&&!halt&&!rows.some(r=>r.decision.assessment_status==='FAILED'||/^MODEL_|^CLASSIFIER_/u.test(r.decision.reason_code)),
    caveat:'Counts are model decisions, not accuracy; regression cases are audit annotations, not user-approved ground truth.'};
  writeFileSync(join(folder,phase+'-summary.json'),JSON.stringify(summary,null,2));
  writeFileSync(join(folder,phase+'-results.json'),JSON.stringify({campaign,contract,conversations:rows,cost:summary.cost},null,2));
  const originalHash=digest(readFileSync(source.file));if(originalHash!==source.source_sha256)throw Error('SOURCE_CHANGED_DURING_REPLAY');
  report.push(summary);console.log(JSON.stringify({source:source.name,summary:{counts,complete:summary.complete,regressions}}));
  if(halt)break;
}
key='';writeFileSync(join(runRoot,phase+'-report.json'),JSON.stringify(report,null,2));
if(phase==='latest'&&report.length===3&&report.every(r=>r.complete))writeFileSync(join(runRoot,'latest-complete.json'),JSON.stringify({at:new Date().toISOString(),code_hash,recipe_hash}));
if(report.some(r=>!r.complete))process.exitCode=1;
