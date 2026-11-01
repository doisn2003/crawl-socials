#!/usr/bin/env node
/** Evaluate a frozen, independently labeled probability sample. No model/network calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateOpportunitySample, wilson } from './evaluate-opportunity-v2.mjs';
const LABELS=['SUITABLE','NOT_YET','UNRELATED','REFERENCE_UNRESOLVED'],PLATFORMS=['facebook','threads'];
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const readLines=file=>fs.readFileSync(file,'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const blank=()=>({tp:0,fp:0,fn:0,tn:0,unknown_accepted:0,unknown_other:0,accepted:0,pending:0,total:0});
function rowCounts(reference,prediction){const c=blank(),accepted=prediction?.classification==='SUITABLE'&&prediction?.assessment_status==='ASSESSED';c.total=1;c.accepted=Number(accepted);c.pending=Number(prediction?.assessment_status!=='ASSESSED');
 if(reference.final_label==='REFERENCE_UNRESOLVED')c[accepted?'unknown_accepted':'unknown_other']=1;
 else if(reference.final_label==='SUITABLE')c[accepted?'tp':'fn']=1;else c[accepted?'fp':'tn']=1;return c;}
const ratio=(a,b)=>b?a/b:null;
function ratios(c){return{precision_known:ratio(c.tp,c.tp+c.fp),recall_known:ratio(c.tp,c.tp+c.fn),model_accepted_yield:ratio(c.accepted,c.total),confirmed_suitable_yield:ratio(c.tp,c.total),
 precision_unresolved_bounds:c.accepted?{lower:c.tp/c.accepted,upper:(c.tp+c.unknown_accepted)/c.accepted}:null,
 recall_unresolved_bounds:{lower:ratio(c.tp,c.tp+c.fn+c.unknown_other),upper:ratio(c.tp+c.unknown_accepted,c.tp+c.fn+c.unknown_accepted)},
 suitable_yield_unresolved_bounds:c.total?{lower:c.tp/c.total,upper:(c.tp+c.unknown_accepted)/c.total}:null};}
function add(target,values,weight=1){for(const k of Object.keys(target))target[k]+=values[k]*weight;return target;}
function random(seed){let state=parseInt(sha(seed).slice(0,8),16)||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
const quantile=(ordered,p)=>{const at=(ordered.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);return ordered[lo]+(ordered[hi]-ordered[lo])*(at-lo);};

export function validateHoldoutReference(blind,reference){
 if(blind.length!==reference.length)throw Error('REFERENCE_COUNT_MISMATCH');
 const byId=new Map(blind.map(r=>[r.snapshot_id,r])),seen=new Set();
 for(const r of reference){const s=byId.get(r.snapshot_id);if(!s||seen.has(r.snapshot_id)||r.sample_id!==s.sample_id||r.as_of!==s.as_of)throw Error('REFERENCE_IDENTITY_MISMATCH');seen.add(r.snapshot_id);
  if(!LABELS.includes(r.final_label)||typeof r.rationale!=='string'||!r.rationale.trim()||typeof r.reviewer!=='string'||!r.reviewer.trim())throw Error('REFERENCE_LABEL_INVALID');
  if(!Array.isArray(r.evidence_ids)||r.evidence_ids.some(id=>!s.spans.some(p=>p.id===id))||new Set(r.evidence_ids).size!==r.evidence_ids.length)throw Error('REFERENCE_EVIDENCE_INVALID');
  if(r.final_label==='SUITABLE'){const target=r.action_target;if(!target||!['POST','COMMENT'].includes(target.type)||!r.evidence_ids.length)throw Error('REFERENCE_SUITABLE_TARGET_REQUIRED');
   const entity=target.type==='POST'?s.post:s.comments.find(c=>c.entity_id===target.entity_id);
   if(entity?.entity_id!==target.entity_id||!s.spans.some(p=>p.entity_id===target.entity_id&&r.evidence_ids.includes(p.id)))throw Error('REFERENCE_TARGET_EVIDENCE_INVALID');}}
}

/** Horvitz-Thompson cell totals and ratio metrics; two strata, weights N_h/n_h. */
export function evaluateWeightedHoldout(manifest,blind,reference,predictions,options={}){
 validateHoldoutReference(blind,reference);
 const pred=new Map(predictions.map(p=>[p.snapshot_id,p]));if(pred.size!==predictions.length)throw Error('DUPLICATE_PREDICTION');
 if(predictions.some(p=>!blind.some(s=>s.snapshot_id===p.snapshot_id)))throw Error('PREDICTION_OUTSIDE_SAMPLE');
 const ref=new Map(reference.map(r=>[r.snapshot_id,r])),byId=new Map(blind.map(r=>[r.snapshot_id,r]));
 const strata={};
 for(const platform of PLATFORMS){const rows=blind.filter(r=>r.platform===platform),s=manifest.strata[platform],N=s.population_count,n=rows.length;
  if(!Number.isSafeInteger(N)||N<n||n!==s.actual_sample_count||(N>0&&!n)||Math.abs((s.design_weight??0)-(n?N/n:0))>1e-9)throw Error('STRATUM_WEIGHT_INVALID');
  strata[platform]={N,n,rows:rows.map(r=>rowCounts(ref.get(r.snapshot_id),pred.get(r.snapshot_id)))};}
 const total=blank();for(const s of Object.values(strata))for(const c of s.rows)add(total,c,s.N/s.n);
 const perPlatform=evaluateOpportunitySample(reference,predictions,id=>byId.get(id)?.platform);
 for(const platform of PLATFORMS){const p=perPlatform[platform],s=strata[platform];p.inference_scope='ELIGIBLE_FROZEN_PLATFORM_POPULATION_AFTER_EXCLUSIONS';p.release_gate='DESCRIPTIVE_REFERENCE_ESTIMATE_NOT_AUTOMATIC_RELEASE_APPROVAL';
  p.population_count=s.N;p.design_weight=s.n?s.N/s.n:null;p.recall_known_wilson95=wilson(p.tp,p.tp+p.fn);p.model_accepted_yield_wilson95=wilson(p.accepted,s.n);
  p.confirmed_suitable_yield=ratio(p.tp,s.n);p.confirmed_suitable_yield_wilson95=wilson(p.tp,s.n);}
 const replicates=options.replicates??4000;if(!Number.isInteger(replicates)||replicates<200||replicates>20000)throw Error('BOOTSTRAP_COUNT_INVALID');
 const rng=random(options.seed??(manifest.seed+':rescaled-bootstrap-v1')),samples={precision_known:[],recall_known:[],model_accepted_yield:[],confirmed_suitable_yield:[]};
 const canBootstrap=Object.values(strata).every(s=>s.n>=2||s.n===s.N),census=Object.values(strata).every(s=>s.n===s.N);
 if(canBootstrap)for(let b=0;b<replicates;b++){const estimate=blank();for(const s of Object.values(strata)){if(!s.n)continue;const original=blank();for(const c of s.rows)add(original,c,1/s.n);
   const replicate=blank();if(s.n===s.N)add(replicate,original);else{for(let j=0;j<s.n-1;j++)add(replicate,s.rows[Math.floor(rng()*s.n)],1/(s.n-1));const scale=Math.sqrt(1-s.n/s.N);for(const k of Object.keys(replicate))replicate[k]=original[k]+scale*(replicate[k]-original[k]);}
   add(estimate,replicate,s.N);}const r=ratios(estimate);for(const k of Object.keys(samples))if(Number.isFinite(r[k]))samples[k].push(r[k]);}
 const intervals={};for(const[k,values]of Object.entries(samples)){values.sort((a,b)=>a-b);const degenerate=values.length&&values.at(-1)-values[0]<1e-12;
  intervals[k]={interval95:values.length>=replicates*0.95&&(!degenerate||census)?{lower:quantile(values,0.025),upper:quantile(values,0.975)}:null,
   valid_replicates:values.length,status:!canBootstrap?'STRATUM_TOO_SMALL':degenerate&&!census?'BOUNDARY_OR_ZERO_VARIANCE_USE_PLATFORM_WILSON':values.length<replicates*0.95?'UNSTABLE_DENOMINATOR':'APPROXIMATE_REPLICATION_INTERVAL'};}
 return{reference_status:'INDEPENDENT_AGENT_REFERENCE_NOT_HUMAN_GOLD',per_platform:perPlatform,weighted_eligible_population:{estimated_cells:total,...ratios(total),ci:intervals,
  weighting:'N_h/n_h over eligible Facebook and Threads roots; unequal sample strata never pooled unweighted.',ci_method:'Rao-Wu-style rescaled stratified bootstrap: n_h-1 draws with replacement, mean deviations scaled by sqrt(1-n_h/N_h), percentile interval; reference error not included.',replicates},
  gate:{status:reference.some(r=>r.final_label==='REFERENCE_UNRESOLVED')?'UNRESOLVED_REFERENCE_PRESENT':'REFERENCE_COMPLETE_REQUIRES_REVIEW',
   precision_point_target:0.90,recall_point_target:0.85,per_platform:Object.fromEntries(PLATFORMS.map(p=>[p,{precision_point_meets:perPlatform[p].precision_known_reference>=0.90,recall_point_meets:perPlatform[p].recall_known_reference>=0.85,
    precision_lower95_meets:(perPlatform[p].precision_known_wilson95?.lower??-1)>=0.90,recall_lower95_meets:(perPlatform[p].recall_known_wilson95?.lower??-1)>=0.85}]))}};
}

export function evaluateTop20(blind,reference){validateHoldoutReference(blind,reference);const labels=new Map(reference.map(r=>[r.snapshot_id,r.final_label]));return Object.fromEntries(PLATFORMS.map(platform=>{const rows=blind.filter(r=>r.platform===platform),tp=rows.filter(r=>labels.get(r.snapshot_id)==='SUITABLE').length,unknown=rows.filter(r=>labels.get(r.snapshot_id)==='REFERENCE_UNRESOLVED').length;
 return[platform,{reviewed:rows.length,requested_k:20,tp,unresolved:unknown,precision_at_k:ratio(tp,rows.length),unresolved_bounds:rows.length?{lower:tp/rows.length,upper:(tp+unknown)/rows.length}:null,
  status:rows.length===20?'COMPLETE_TOP20':'UNDERSIZED_TOP_K',inference:'Census of the frozen displayed topK; descriptive only, no population recall or probability-sample weighting.'}];}));}

function frozenBundle(dir){const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));const rows={};for(const[k,field,fallback]of[['blind','blinded_reference','top20-blinded-reference.jsonl'],['predictions','predictions','top20-predictions.jsonl']]){const f=manifest.files[field]??{...manifest.files[fallback],name:fallback},bytes=fs.readFileSync(path.join(dir,f.name));if(sha(bytes)!==f.sha256)throw Error('FROZEN_FILE_HASH_MISMATCH');rows[k]=bytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);}return{manifest,...rows};}
function costReport(exported){const data=exported.snapshots?exported:exported.opportunity,c=data.cost;if(!c)return{status:'MISSING_COST'};const parts=c.models??c.components??[c],current=(data.conversations??[]).filter(v=>!v.stale&&v.decision?.assessment_status==='ASSESSED'),accepted=current.filter(v=>v.decision.classification==='SUITABLE').length;
 const known=c.measured_cost_usd,upper=known+c.unmetered_cost_upper_usd+c.reserved_usd;
 if(![known,upper].every(v=>Number.isFinite(v)&&v>=0))throw Error('COST_INVALID');
 return{model_accepted_count:accepted,full_campaign_measured_cost_usd:known,full_campaign_cost_upper_usd:upper,models:parts,
  measured_cost_per1000_model_accepted:accepted?known*1000/accepted:null,upper_cost_per1000_model_accepted:accepted?upper*1000/accepted:null,
  decision_model_counts:current.reduce((out,v)=>(out[v.decision.model]=(out[v.decision.model]??0)+1,out),{}),
  scope:'Whole frozen campaign, including excluded roots, retries and mixed-model stages. Cost per model-accepted record is not cost per confirmed good record. No causal model-quality comparison.'};}
export function evaluateFrozenHoldout(options){const bundle=frozenBundle(options.sample),referenceBytes=fs.readFileSync(options.reference),reference=referenceBytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
 const inputBytes=fs.readFileSync(bundle.manifest.input.path);if(sha(inputBytes)!==bundle.manifest.input.sha256)throw Error('EXPORT_CHANGED_AFTER_SAMPLING');
 const output={version:'live-holdout-evaluation-v2.0.0',sample_manifest_sha256:sha(fs.readFileSync(path.join(options.sample,'manifest.json'))),reference_sha256:sha(referenceBytes),
  ...evaluateWeightedHoldout(bundle.manifest,bundle.blind,reference,bundle.predictions),cost:costReport(JSON.parse(inputBytes.toString('utf8'))),
  limitations:['Recall is within the observed eligible crawl population and captured conversation context, not network-wide discovery recall.','Unresolved reference rows retain bounds; annotation correctness is not included in statistical intervals.','Per-platform Wilson intervals are binomial approximations; weighted intervals use the declared finite-population rescaled bootstrap.','No tuning or model switching based on this holdout is included in its quality claim.']};
 if(options.leakageReport){const leak=JSON.parse(fs.readFileSync(options.leakageReport,'utf8'));if(leak.input.sha256!==bundle.manifest.input.sha256||leak.extended_exclusions_sha256!==bundle.manifest.exclusion_input?.sha256)throw Error('LEAKAGE_AUDIT_SAMPLE_MISMATCH');output.leakage_audit=leak;}
 else output.leakage_audit={status:'NOT_PROVIDED'};
 if(options.top20&&options.top20Reference){const top=frozenBundle(options.top20);if((top.manifest.source_export_sha256??top.manifest.input?.sha256)!==bundle.manifest.input.sha256)throw Error('TOP20_EXPORT_MISMATCH');output.top20=evaluateTop20(top.blind,readLines(options.top20Reference));output.top20_manifest=top.manifest;}
 const resolved=path.resolve(options.output),root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));let ancestor=path.dirname(resolved);while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);const canonical=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,resolved)),rel=path.relative(root,canonical);if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('OUTPUT_MUST_BE_EXTERNAL');
 fs.mkdirSync(path.dirname(resolved),{recursive:true});fs.writeFileSync(resolved,JSON.stringify(output,null,2)+'\n',{flag:'wx',flush:true,mode:0o600});return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const options={};const keys={'--sample':'sample','--reference':'reference','--output':'output','--leakage-report':'leakageReport','--top20':'top20','--top20-reference':'top20Reference'};for(let i=2;i<process.argv.length;i+=2){if(!keys[process.argv[i]]||!process.argv[i+1])throw Error('ARGUMENT_INVALID');options[keys[process.argv[i]]]=process.argv[i+1];}const result=evaluateFrozenHoldout(options);console.log(JSON.stringify({event:'live_holdout_evaluated',gate:result.gate,weighted:result.weighted_eligible_population,cost:result.cost}));}catch(error){console.error(JSON.stringify({error_code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:'HOLDOUT_EVALUATION_FAILED'}));process.exitCode=1;}}
