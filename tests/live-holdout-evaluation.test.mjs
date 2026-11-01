import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHoldoutLeakage } from '../scripts/benchmark/audit-holdout-leakage-v2.mjs';
import { evaluateWeightedHoldout, validateHoldoutReference, evaluateTop20 } from '../scripts/benchmark/evaluate-live-holdout-v2.mjs';
const snapshot=(platform,id,text,author)=>({platform,root_post_id:id,post:{text,author:{id:author},permalink:null}});
test('leakage extension excludes prior authors/copies before sampling but does not match display names or generic short text',()=>{
 const original=Array.from({length:60},(_,i)=>'word'+i).join(' '),history=[snapshot('facebook','old',original,'author')];
 const population=[snapshot('facebook','old',original,'author'),snapshot('facebook','same-author','different fresh question','author'),
  snapshot('threads','same-text',original,'else'),snapshot('facebook','near',original+' extra new words','other'),snapshot('facebook','short','cafe học bài',undefined)];
 const result=auditHoldoutLeakage({snapshots:population},[{platform:'facebook',root_post_id:'old'}],history);
 assert.equal(result.report.aggregate.exact_root_excluded,1);assert.equal(result.report.aggregate.additional_excluded,3);
 assert.equal(result.report.aggregate.eligible_after_extension,1);assert.equal(result.report.aggregate.short_text_not_copy_tested,2);
 assert.ok(result.matches.some(m=>m.reasons.some(r=>r.reason==='NEAR_TEXT_COPY')));
});
function fixture(){const blind=[],reference=[],predictions=[];let index=0;
 for(const platform of ['facebook','threads'])for(let j=0;j<2;j++){const id=String(index++),span='span-'+id,as_of='2026-10-30T00:00:00Z';
  blind.push({sample_id:id,snapshot_id:id,platform,as_of,post:{entity_id:id},comments:[],spans:[{id:span,entity_id:id}]});
  const positive=platform==='threads'||j===0;reference.push({sample_id:id,snapshot_id:id,as_of,final_label:positive?'SUITABLE':'NOT_YET',evidence_ids:[span],action_target:positive?{type:'POST',entity_id:id}:null,rationale:'manual reason',reviewer:'fixture'});
  predictions.push({snapshot_id:id,classification:platform==='threads'&&j===1?null:'SUITABLE',assessment_status:platform==='threads'&&j===1?'PENDING':'ASSESSED'});}
 const manifest={seed:'frozen',strata:{facebook:{population_count:100,actual_sample_count:2,design_weight:50},threads:{population_count:900,actual_sample_count:2,design_weight:450}}};
 return{manifest,blind,reference,predictions};}
test('weighted metrics use eligible N/n and technical missing output remains a false negative',()=>{
 const f=fixture(),result=evaluateWeightedHoldout(f.manifest,f.blind,f.reference,f.predictions,{replicates:200});
 assert.equal(result.weighted_eligible_population.estimated_cells.tp,500);assert.equal(result.weighted_eligible_population.estimated_cells.fp,50);assert.equal(result.weighted_eligible_population.estimated_cells.fn,450);
 assert.equal(result.weighted_eligible_population.precision_known,500/550);assert.equal(result.weighted_eligible_population.recall_known,500/950);
 assert.equal(result.weighted_eligible_population.model_accepted_yield,0.55);assert.equal(result.per_platform.threads.pending_or_failed,1);
 assert.notEqual(result.weighted_eligible_population.precision_known,2/3);
});
test('unresolved reference retains weighted bounds and cannot fabricate suitable evidence',()=>{
 const f=fixture();f.reference[1].final_label='REFERENCE_UNRESOLVED';
 const result=evaluateWeightedHoldout(f.manifest,f.blind,f.reference,f.predictions,{replicates:200});
 assert.deepEqual(result.weighted_eligible_population.precision_unresolved_bounds,{lower:500/550,upper:1});
 f.reference[0].evidence_ids=['foreign'];assert.throws(()=>validateHoldoutReference(f.blind,f.reference),/EVIDENCE/);
});
test('zero variance bootstrap for noncensus is flagged rather than claiming perfect certainty; topK remains separate',()=>{
 const f=fixture();for(const r of f.reference){r.final_label='SUITABLE';r.action_target={type:'POST',entity_id:r.snapshot_id};}for(const p of f.predictions){p.classification='SUITABLE';p.assessment_status='ASSESSED';}
 const result=evaluateWeightedHoldout(f.manifest,f.blind,f.reference,f.predictions,{replicates:200});
 assert.equal(result.weighted_eligible_population.ci.precision_known.interval95,null);assert.ok(result.per_platform.facebook.precision_known_wilson95.lower<1);
 const top=evaluateTop20(f.blind,f.reference);assert.equal(top.facebook.status,'UNDERSIZED_TOP_K');assert.equal(top.facebook.precision_at_k,1);
});
