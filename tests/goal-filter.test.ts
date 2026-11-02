import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { classifyConversations, opportunityRank } from '../src/application/classification-service.js';
import { compileGoalContract } from '../src/application/goal-classifier.js';
import { canonicalEvidenceQuote, GOAL_FILTER_VERSION, goalDecision, goalSources, monetaryValues, validateGoalContract } from '../src/domain/goal-filter.js';
import type { GoalContract, GoalAssessment } from '../src/domain/goal-filter.js';
import { contentHash, evidenceSpans } from '../src/domain/conversation.js';
import type { ConversationEntity, ConversationSnapshot } from '../src/domain/conversation.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import { GEMINI_FLASH_LITE_PRICE } from '../src/infrastructure/llm/gemini-gateway.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import ExcelJS from 'exceljs';
import { exportOpportunityWorkbook, selectOpportunityExport } from '../src/infrastructure/export/opportunity-workbook.js';

const asOf='2026-11-02T00:00:00.000Z';
const campaign={...literalCampaign({prompt:'Tìm phòng để tôi thuê. Giá dưới 4 triệu. Ưu tiên Pháo Đài Láng.'}),filter_version:GOAL_FILTER_VERSION};
const contract:GoalContract={goal:'Tìm nguồn phòng cho thuê',branches:[{id:'b1',description:'Thuê phòng'}],criteria:[
  ...(['TOPIC','ROLE','PURPOSE'] as const).map((kind,i)=>({id:'c'+(i+1),description:kind,kind,strength:'REQUIRED' as const,branches:[],source:'PROMPT',quote:'Tìm phòng để tôi thuê',numeric_limit:null})),
  {id:'c4',description:'Giá dưới 4 triệu',kind:'PRICE',strength:'REQUIRED',branches:[],source:'PROMPT',quote:'dưới 4 triệu',numeric_limit:{operator:'LT',value:4000000,unit:'VND'}},
  {id:'c5',description:'Ưu tiên Pháo Đài Láng',kind:'LOCATION',strength:'PREFERRED',branches:[],source:'PROMPT',quote:'Ưu tiên Pháo Đài Láng',numeric_limit:null}
]};
function entity(id:string,text:string,parent:string|null=null):ConversationEntity{return {entity_id:id,root_post_id:'root',entity_type:parent?'COMMENT':'POST',
  parent_id:parent,text,observed_at:asOf,published_at:'2026-11-01T00:00:00.000Z',permalink:'https://example.test/'+id,
  author:{role:'UNKNOWN'},source:{kind:'PROFILE'},media:[],content_hash:contentHash(text)};}
function snapshot(text='Cho thuê phòng riêng. Giá 3tr5.',comments:ConversationEntity[]=[]):ConversationSnapshot{
  const post=entity('root',text);return {id:'snapshot',platform:'threads',root_post_id:'root',revision:1,content_hash:contentHash([post,comments]),
    observed_at:asOf,post,comments,coverage:{status:'NOT_ATTEMPTED',has_more:null},spans:[post,...comments].flatMap(e=>evidenceSpans(e))};
}
function assessment(s:ConversationSnapshot):GoalAssessment{return {snapshot_id:s.id,candidate_entity_id:s.post!.entity_id,candidate_description:'Phòng trong bài',
  checks:contract.criteria.filter(c=>c.strength==='REQUIRED').map(c=>({criterion_id:c.id,status:'PASS',evidence:[{id:s.spans[0]!.id,quote:s.post!.text}]})),
  summary:'Phòng cho thuê đáp ứng yêu cầu.',speaker_role:'PROVIDER',match_type:'OFFER',temporal_status:'NO_BOUNDED_REQUEST',valid_until:null,temporal_evidence:[]};}
const decide=(s:ConversationSnapshot,a=assessment(s),c=contract)=>goalDecision(a,campaign,c,s,'test',asOf);

test('confirmed current topic and research purpose survive into the classifier sources',()=>{
  const confirmed={...campaign,planner_policy:'controlled-semantic-dialogue-v1' as const,topic:'Chủ đề người dùng vừa sửa',research_intents:['Giữ quảng cáo để nghiên cứu']};
  const sources=JSON.parse(goalSources(confirmed).CRITERIA!);assert.equal(sources.topic,confirmed.topic);assert.deepEqual(sources.research_intents,confirmed.research_intents);
  assert.equal(JSON.parse(goalSources(campaign).CRITERIA!).participation_intents,undefined,'legacy inferred consumer intent is not promoted to user authority');
});

test('new policy accepts an evidenced supplier and emits only a binary final outcome',()=>{
  const s=snapshot(),d=decide(s);assert.equal(d.classification,'SUITABLE');assert.equal(d.action_target?.entity_id,'root');
  assert.equal(d.goal_assessment?.contract_hash,contentHash(contract));assert.equal(d.attributes?.speaker_role,'PROVIDER');
});
test('wrong target role is rejected even when the topic matches',()=>{
  const s=snapshot('Tôi đang tìm phòng 3 triệu.'),a=assessment(s);a.checks[1]!.status='FAIL';a.speaker_role='SEEKER';
  assert.equal(decide(s,a).classification,'NOT_SUITABLE');
});
test('missing mandatory evidence remains pending, never silently suitable or rejected',()=>{
  const s=snapshot(),a=assessment(s);a.checks.find(c=>c.criterion_id==='c3')!.status='UNKNOWN';const d=decide(s,a);
  assert.equal(d.classification,null);assert.equal(d.assessment_status,'PENDING');
});
test('a failed soft preference does not reject a valid result',()=>{
  const s=snapshot(),a=assessment(s);a.checks.push({criterion_id:'c5',status:'FAIL',evidence:[{id:s.spans[0]!.id,quote:s.post!.text}]});
  assert.equal(decide(s,a).classification,'SUITABLE');
});

test('platform preference is grounded in the prompt and ranked using source metadata without rejecting other platforms',()=>{
  const plan={...campaign,prompt:campaign.prompt+' Ưu tiên Threads.'};
  const c=validateGoalContract({...contract,platform_preferences:[{platform:'threads',source:'PROMPT',quote:'Ưu tiên Threads'}]},goalSources(plan));
  const th=snapshot(),fb={...snapshot(),platform:'facebook' as const};
  const a=goalDecision(assessment(th),plan,c,th,'test',asOf),b=goalDecision(assessment(fb),plan,c,fb,'test',asOf);
  assert.equal(a.classification,'SUITABLE');assert.equal(b.classification,'SUITABLE');
  assert.equal(a.attributes?.goal_platform_preference,100);assert.equal(b.attributes?.goal_platform_preference,0);
  assert.ok(opportunityRank(a,th)[1]!>opportunityRank(b,fb)[1]!);
  assert.throws(()=>validateGoalContract({...c,platform_preferences:[{platform:'facebook',source:'PROMPT',quote:'Ưu tiên Threads'}]},goalSources(plan)),/PLATFORM_PREFERENCE_UNGROUNDED/);
});
for(const [text,label] of [['Giá 4 triệu.','NOT_SUITABLE'],['Giá 6–7 triệu.','NOT_SUITABLE'],['Giá 3–4,5 triệu.',null],
  ['Giá từ 2 triệu.',null],['Giá 3tr5.','SUITABLE'],['Giá 3.500.000 đồng.','SUITABLE'],['Liên hệ để biết giá.',null]] as const){
  test('explicit monetary evidence enforces the user boundary: '+text,()=>assert.equal(decide(snapshot(text)).classification,label));
}
test('monetary parser does not treat telephone or street numbers as a price',()=>{
  assert.deepEqual(monetaryValues('Số 114 đường A, liên hệ 0912345678'),[]);
  assert.deepEqual(monetaryValues('Giá 3–4,5 triệu'),[3000000,4500000]);assert.deepEqual(monetaryValues('2tr7'),[2700000]);
});
test('contract rejects a fabricated source quote and a weakened strict inequality',()=>{
  const c=structuredClone(contract);c.criteria[3]!.numeric_limit!.operator='LTE';
  assert.throws(()=>validateGoalContract(c,goalSources(campaign)),/NUMERIC_OPERATOR/);
  c.criteria[3]!.quote='Không có câu này';assert.throws(()=>validateGoalContract(c,goalSources(campaign)),/UNGROUNDED/);
});
test('contract requires a meaningful branch with topic, role and purpose',()=>{
  assert.throws(()=>validateGoalContract({...contract,branches:[]},goalSources(campaign)),/CONTRACT_INVALID/);
  assert.throws(()=>validateGoalContract({...contract,criteria:contract.criteria.filter(c=>c.kind!=='ROLE')},goalSources(campaign)),/BRANCH_INCOMPLETE/);
});
test('normalized quotes recover only whitespace and case while retaining exact original text',()=>{
  assert.equal(canonicalEvidenceQuote('Nhà\n  GIÁ 3 triệu','nhà giá 3 triệu'),'Nhà\n  GIÁ 3 triệu');
  assert.equal(canonicalEvidenceQuote('Giá 6 triệu','Giá 3 triệu'),null);
  assert.equal(canonicalEvidenceQuote('trứng gà','thịt gà'),null);
  assert.equal(canonicalEvidenceQuote('tôi không chê','tôi chê'),null);
  assert.equal(canonicalEvidenceQuote('Giá **3 triệu** cho phòng','Giá 3 triệu cho phòng'),'Giá **3 triệu** cho phòng');
  assert.equal(canonicalEvidenceQuote('3**2','32'),null);
  assert.equal(canonicalEvidenceQuote('Giá **6 triệu**','Giá 3 triệu'),null);
});
test('a quote from a different sibling cannot supply evidence for the selected offer',()=>{
  const s=snapshot('Chào các bạn',[entity('c1','Cho thuê phòng 3 triệu','root'),entity('c2','Có điều hòa','root')]);
  const a=assessment(s);a.candidate_entity_id='c1';a.checks[0]!.evidence=[{id:s.spans.find(p=>p.entity_id==='c2')!.id,quote:'Có điều hòa'}];
  assert.throws(()=>decide(s,a),/PROOF_ENTITY/);
});
test('a valid offer in a comment points to that comment, not the seeker post',()=>{
  const s=snapshot('Tôi cần thuê phòng',[entity('offer','Cho thuê phòng riêng. Giá 3 triệu.','root')]),a=assessment(s);
  a.candidate_entity_id='offer';const span=s.spans.find(p=>p.entity_id==='offer')!;
  for(const c of a.checks)c.evidence=[{id:span.id,quote:span.text}];
  assert.deepEqual(decide(s,a).action_target,{entity_id:'offer',type:'COMMENT'});
});
test('original-author replies can supply details even when intermediate parents were not captured',()=>{
  const reply=entity('detail','Cho thuê phòng 3 triệu.','not-captured');reply.author.id='owner';
  const s=snapshot('Tôi cho thuê phòng',[reply]);s.post!.author.id='owner';
  const a=assessment(s);a.checks.find(c=>c.criterion_id==='c4')!.evidence=[{id:s.spans.find(p=>p.entity_id==='detail')!.id,quote:reply.text}];
  assert.equal(decide(s,a).classification,'SUITABLE');
  reply.author.id='another-owner';const other=snapshot('Tôi cho thuê phòng',[reply]);other.post!.author.id='owner';
  assert.throws(()=>decide(other,a),/PROOF_ENTITY/);
});
test('an omitted live OR branch is an incomplete model response, not evidence that it failed',()=>{
  const c=structuredClone(contract);c.branches.push({id:'b2',description:'Nhánh khác'});c.criteria[2]!.branches=['b1'];
  c.criteria.push({...c.criteria[2]!,id:'c6',branches:['b2']});const s=snapshot(),a=assessment(s);a.checks[2]!.status='FAIL';
  assert.throws(()=>decide(s,a,c),/BRANCH_UNASSESSED/);
});
test('a single matching OR branch suffices, but rejecting one does not reject an unknown alternative',()=>{
  const c=structuredClone(contract);c.branches.push({id:'b2',description:'Nhánh thay thế'});
  c.criteria.find(r=>r.id==='c3')!.branches=['b1'];c.criteria.push({...c.criteria[2]!,id:'c6',branches:['b2']});
  const s=snapshot(),a=assessment(s);a.checks.find(r=>r.criterion_id==='c3')!.status='FAIL';
  a.checks.push({criterion_id:'c6',status:'UNKNOWN',evidence:[]});
  assert.equal(decide(s,a,c).assessment_status,'PENDING');
  a.checks[a.checks.length-1]={...a.checks[0]!,criterion_id:'c6'};assert.equal(decide(s,a,c).classification,'SUITABLE');
});
test('a fully proven OR branch does not require assessing other alternatives',()=>{
  const c=structuredClone(contract);c.branches.push({id:'b2',description:'Nhánh khác'});c.criteria[2]!.branches=['b1'];
  c.criteria.push({...c.criteria[2]!,id:'c6',branches:['b2']});assert.equal(decide(snapshot(),assessment(snapshot()),c).classification,'SUITABLE');
});
test('a negated lower price bound is not misread as an upper limit',()=>{
  const c=structuredClone(contract);c.criteria[3]!.quote='không dưới 4 triệu';c.criteria[3]!.numeric_limit!.operator='GTE';
  const sources=goalSources(campaign);sources.PROMPT+=' Giá không dưới 4 triệu';assert.equal(validateGoalContract(c,sources).criteria[3]!.numeric_limit!.operator,'GTE');
});
test('old publication alone does not expire a request without a bounded deadline',()=>{
  const s=snapshot();s.post!.published_at='2023-01-01T00:00:00.000Z';const d=decide(s);
  assert.equal(d.classification,'SUITABLE');assert.equal(d.attributes?.freshness,'OLD');
});
test('a verified expired deadline is rejected and a future one is persisted',()=>{
  const s=snapshot('Cho thuê phòng 3 triệu. Chỉ nhận đến ngày 1/11/2026.'),a=assessment(s);
  a.temporal_status='EXPIRED_WINDOW';a.temporal_evidence=[{entity_id:'root',evidence_id:s.spans[0]!.id,quote:'Chỉ nhận đến ngày 1/11/2026.',published_at:s.post!.published_at!,expires_at:'2026-11-01T23:59:59.000Z'}];
  assert.equal(decide(s,a).reason_code,'GOAL_EXPIRED');
  const future=snapshot('Cho thuê phòng 3 triệu. Nhận đến ngày 3/11/2026.'),b=assessment(future);
  b.temporal_status='CURRENT_WINDOW';b.valid_until='2026-11-03T00:00:00.000Z';
  b.temporal_evidence=[{entity_id:'root',evidence_id:future.spans[0]!.id,quote:'Nhận đến ngày 3/11/2026.',published_at:future.post!.published_at!,expires_at:b.valid_until}];
  assert.equal(decide(future,b).valid_until,b.valid_until);
});
test('a root deadline cannot expire a separate comment opportunity',()=>{
  const s=snapshot('Cho thuê phòng 3 triệu đến mai',[entity('offer','Cho thuê phòng 3 triệu','root')]),a=assessment(s);
  a.candidate_entity_id='offer';a.temporal_status='EXPIRED_WINDOW';a.temporal_evidence=[{entity_id:'root',evidence_id:s.spans[0]!.id,quote:'đến mai',published_at:s.post!.published_at!,expires_at:'2026-11-02T00:00:00.000Z'}];
  assert.throws(()=>decide(s,a),/TIME_PROOF/);
});
test('a decisive role mismatch remains the reason when an unrelated deadline is also expired',()=>{
  const s=snapshot('Tôi tìm phòng 3 triệu. Chỉ nhận đến ngày 1/11/2026.'),a=assessment(s);a.checks[1]!.status='FAIL';
  a.temporal_status='BOUNDED_REQUEST';a.temporal_evidence=[{entity_id:'root',evidence_id:s.spans[0]!.id,quote:'Chỉ nhận đến ngày 1/11/2026.',
    published_at:s.post!.published_at!,expires_at:'2026-11-01T23:59:59.000Z'}];
  assert.equal(decide(s,a).reason_code,'GOAL_CONSTRAINT_MISMATCH');
});
test('an expired event does not invalidate a requested experience/research discussion',()=>{
  const s=snapshot('Phòng 3 triệu. Sự kiện chỉ đến 1/11/2026.'),a=assessment(s);a.match_type='EXPERIENCE';a.temporal_status='BOUNDED_REQUEST';
  a.temporal_evidence=[{entity_id:'root',evidence_id:s.spans[0]!.id,quote:'Sự kiện chỉ đến 1/11/2026.',published_at:s.post!.published_at!,expires_at:'2026-11-01T23:59:59.000Z'}];
  const d=decide(s,a);assert.equal(d.classification,'SUITABLE');assert.equal(d.valid_until,null);
});
test('ranking promotes evidenced preferences and publication freshness, not insertion order',()=>{
  const s=snapshot(),d=decide(s),preferred=structuredClone(d);preferred.attributes!.goal_preferred=100;
  assert.ok(opportunityRank(preferred,s)[1]!>opportunityRank(d,s)[1]!);
  const older=structuredClone(d);older.attributes!.goal_published_at=1;older.attributes!.goal_freshness=1;
  assert.ok(opportunityRank(d,s)[3]!>opportunityRank(older,s)[3]!);
});
function gateway(produce:()=>unknown):ModelGateway{return {summary:()=>({model:'test',budget_usd:1,measured_cost_usd:0,unmetered_cost_upper_usd:0,reserved_usd:0,remaining_usd:1,billable_attempts:0,cache_hits:0,cost_basis:'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE'}),
  generateJson:async()=>({value:produce(),invocation_id:'test',request_hash:'test',model:'test',model_version:null,usage:null,cost_usd:0,unmetered_cost_upper_usd:0,cache_hit:false,elapsed_ms:0,price:GEMINI_FLASH_LITE_PRICE})};}

test('independent contract coverage repairs a dropped research-ad branch and platform preference before classification',async()=>{
  const plan={...literalCampaign({prompt:'Tìm thảo luận về quán cafe. Giữ quảng cáo liên quan để nghiên cứu, ưu tiên Threads.'}),filter_version:GOAL_FILTER_VERSION};
  const narrow:GoalContract={goal:'Tìm thảo luận về quán cafe',branches:[{id:'b1',description:'Thảo luận'}],criteria:
    (['TOPIC','ROLE','PURPOSE'] as const).map((kind,i)=>({id:'c'+(i+1),description:kind,kind,strength:'REQUIRED',branches:['b1'],source:'PROMPT',quote:'Tìm thảo luận về quán cafe',numeric_limit:null}))};
  const fixed:GoalContract={...structuredClone(narrow),branches:[...narrow.branches,{id:'b2',description:'Quảng cáo liên quan để nghiên cứu'}],
    criteria:[...narrow.criteria,...(['TOPIC','ROLE','PURPOSE'] as const).map((kind,i)=>({id:'c'+(i+4),description:kind,kind,strength:'REQUIRED' as const,branches:['b2'],source:'PROMPT',quote:'Giữ quảng cáo liên quan để nghiên cứu',numeric_limit:null}))],
    platform_preferences:[{platform:'threads',source:'PROMPT',quote:'ưu tiên Threads'}]};
  const omissions=[{source:'PROMPT',quote:'Giữ quảng cáo liên quan để nghiên cứu',issue:'Thiếu nhánh quảng cáo độc lập'},
    {source:'PROMPT',quote:'ưu tiên Threads',issue:'Thiếu ưu tiên nền tảng'}];
  const queue:unknown[]=[{complete:false,omissions},fixed,{complete:true,omissions:[]}];
  const model=gateway(()=>queue.shift()),generate=model.generateJson,requests:Parameters<ModelGateway['generateJson']>[0][]=[];
  model.generateJson=async request=>{requests.push(request);return generate(request);};
  const result=await compileGoalContract(plan,model,{candidateContract:narrow});
  assert.deepEqual(result.contract,fixed);assert.deepEqual(requests.map(r=>r.purpose),[GOAL_FILTER_VERSION+':contract-coverage',GOAL_FILTER_VERSION+':contract',GOAL_FILTER_VERSION+':contract-coverage']);
  assert.deepEqual((requests[1]!.input as {validation_repair:{omissions:unknown}}).validation_repair.omissions,omissions);
});

test('an unresolved or fabricated contract omission never silently approves the candidate',async()=>{
  for(const fabricated of [false,true]){
    let audits=0;
    const model=gateway(()=>contract),generate=model.generateJson;
    model.generateJson=async request=>request.purpose.endsWith(':contract-coverage')
      ?{...await generate(request),value:{complete:false,omissions:[{source:'PROMPT',quote:fabricated?'Không có trong yêu cầu':'dưới 4 triệu',issue:'Cần sửa'}]},invocation_id:String(++audits)}
      :generate(request);
    await assert.rejects(compileGoalContract(campaign,model,{candidateContract:contract}),fabricated?/COVERAGE_UNGROUNDED/:/CONTRACT_INCOMPLETE/);
    assert.equal(audits,3,'bounded repair, no unlimited inference loop');
  }
});

test('a complete saved contract is independently audited once and preserved verbatim for replay',async()=>{
  let calls=0;const model=gateway(()=>{calls++;return {complete:true,omissions:[]};});
  const [a,b]=await Promise.all([compileGoalContract(campaign,model,{candidateContract:contract}),compileGoalContract(campaign,model,{candidateContract:contract})]);
  assert.deepEqual(a.contract,contract);assert.deepEqual(b.contract,contract);assert.equal(calls,1);
});

test('a rejected root cannot hide a matching comment, and comment uncertainty is not a negative label',async()=>{
  for(const outcome of ['SUITABLE','PENDING','API_ERROR'] as const){
    const s=snapshot('Tôi đang tìm phòng 3 triệu.',[entity('empty','','root'),entity('offer','Cho thuê phòng riêng, giá 3 triệu.','root')]);
    const root=assessment(s);root.checks[1]!.status='FAIL';root.speaker_role='SEEKER';
    const comment=assessment(s);comment.candidate_entity_id='offer';const span=s.spans.find(p=>p.entity_id==='offer')!;
    comment.checks=comment.checks.map(c=>({...c,status:outcome==='PENDING'?'UNKNOWN':'PASS',evidence:outcome==='PENDING'?[]:[{id:span.id,quote:span.text}]}));
    const model=gateway(()=>null),generate=model.generateJson;let commentRequests=0;
    model.generateJson=async request=>{
      if(request.purpose.endsWith(':scope'))return {...await generate(request),value:[{snapshot_id:s.id,candidate_entity_id:'offer',
        verdict:outcome==='PENDING'?'UNCLEAR':'IN_SCOPE',explanation:'Kiểm tra bình luận',evidence:[{id:span.id,quote:span.text}]}]};
      const commentOnly=request.system.includes('CHỈ CHỌN BÌNH LUẬN');
      if(commentOnly){commentRequests++;
        const schema=request.schema as {items:{properties:{candidate_entity_id:{enum:string[]}}}};
        assert.deepEqual(schema.items.properties.candidate_entity_id.enum,['offer']);
        if(outcome==='API_ERROR')throw new ModelGatewayError('MODEL_NETWORK_USAGE_UNKNOWN');
      }
      return {...await generate(request),value:[commentOnly?comment:root]};
    };
    const result=await classifyConversations(campaign,[s],model,{goalContract:contract,evaluatedAt:asOf}),d=result.decisions[0]!;
    assert.ok(commentRequests>0);assert.equal(d.goal_comment_review?.primary_classification,'NOT_SUITABLE');
    if(outcome==='SUITABLE'){assert.equal(d.classification,'SUITABLE');assert.deepEqual(d.action_target,{entity_id:'offer',type:'COMMENT'});}
    else{assert.equal(d.classification,null);assert.equal(d.assessment_status,'PENDING');}
    if(outcome==='API_ERROR')assert.equal(d.reason_code,'MODEL_NETWORK_USAGE_UNKNOWN');
  }
});

test('empty retained comments need enrichment without model calls or a false final rejection',async()=>{
  for(const text of ['', '   ']){
    const s=snapshot('Tôi đang tìm phòng 3 triệu.',[entity('empty',text,'root')]);
    const root=assessment(s);root.checks[1]!.status='FAIL';root.speaker_role='SEEKER';
    let calls=0;const model=gateway(()=>{assert.equal(++calls,1,'only the readable root is sent to the model');return[root];});
    const result=await classifyConversations(campaign,[s],model,{goalContract:contract,evaluatedAt:asOf}),d=result.decisions[0]!;
    assert.equal(calls,1);assert.equal(d.classification,null);assert.equal(d.assessment_status,'PENDING');
    assert.equal(d.reason_code,'CONTEXT_ENRICHMENT_REQUIRED');assert.equal(d.goal_comment_review?.primary_classification,'NOT_SUITABLE');
    assert.equal(d.goal_comment_review?.comment_assessment_status,'PENDING');assert.deepEqual(result.failures,[]);
  }
});

test('the comment review cannot return the rejected root as its comment candidate',async()=>{
  const s=snapshot('Tôi đang tìm phòng 3 triệu.',[entity('offer','Cho thuê phòng riêng, giá 3 triệu.','root')]);
  const root=assessment(s);root.checks[1]!.status='FAIL';root.speaker_role='SEEKER';
  const result=await classifyConversations(campaign,[s],gateway(()=>[root]),{goalContract:contract,evaluatedAt:asOf});
  assert.equal(result.decisions[0]!.classification,null);assert.equal(result.decisions[0]!.reason_code,'CLASSIFIER_COMMENT_TARGET_INVALID');
});
test('a malformed batch remains failed rather than manufacturing a binary answer',async()=>{
  const s=snapshot(),result=await classifyConversations(campaign,[s],gateway(()=>[]),{goalContract:contract,goalReview:false});
  assert.equal(result.decisions[0]!.assessment_status,'FAILED');assert.equal(result.decisions[0]!.classification,null);
});
test('repair diagnostics themselves tolerate a malformed checks structure',async()=>{
  const s=snapshot(),result=await classifyConversations(campaign,[s],gateway(()=>[{...assessment(s),checks:{invalid:true}}]),{goalContract:contract,goalReview:false});
  assert.equal(result.decisions[0]!.assessment_status,'FAILED');assert.equal(result.decisions[0]!.classification,null);
});
test('repair identifies the exact unsupported PASS/FAIL criterion for the model',async()=>{
  const s=snapshot();let calls=0,repair:unknown;
  const model=gateway(()=>{const a=assessment(s);if(++calls===1)a.checks[0]!.evidence=[];return[a];}),generate=model.generateJson;
  model.generateJson=async request=>{repair=(request.input as {validation_repair?:unknown}).validation_repair;return generate(request);};
  const result=await classifyConversations(campaign,[s],model,{goalContract:contract,goalReview:false,evaluatedAt:asOf});
  assert.equal(result.decisions[0]!.classification,'SUITABLE');assert.equal((repair as {issues:{missing_evidence:{criterion_id:string}[]}[]}).issues[0]!.missing_evidence[0]!.criterion_id,'c1');
});
test('a proven required contradiction can reject despite a broken unneeded quote, never accept',async()=>{
  const s=snapshot();for(const mismatch of [true,false]){
    const a=assessment(s);if(mismatch)a.checks[1]!.status='FAIL';a.checks[3]!.evidence[0]!.quote='Giá không có trong bài';
    const result=await classifyConversations(campaign,[s],gateway(()=>[a]),{goalContract:contract,goalReview:false,evaluatedAt:asOf}),d=result.decisions[0]!;
    assert.equal(d.classification,mismatch?'NOT_SUITABLE':null);
    if(mismatch){assert.equal(d.goal_assessment!.checks[3]!.status,'UNKNOWN');assert.equal(d.attributes?.discarded_unsupported_checks,'c4');
      assert.ok(!JSON.stringify(d.goal_assessment!.checks).includes('Giá không có trong bài'));}
    else assert.equal(d.assessment_status,'FAILED');
  }
});
test('provider failure never becomes a negative business label',async()=>{
  const s=snapshot(),result=await classifyConversations(campaign,[s],gateway(()=>{throw new ModelGatewayError('MODEL_AUTHENTICATION_FAILED');}),{goalContract:contract,goalReview:false});
  assert.equal(result.decisions[0]!.classification,null);assert.equal(result.failures[0]!.code,'MODEL_AUTHENTICATION_FAILED');
});
test('independent review can turn an unsupported positive into pending',async()=>{
  const s=snapshot();let calls=0;const result=await classifyConversations(campaign,[s],gateway(()=>{const a=assessment(s);
    if(++calls===3)return[{snapshot_id:s.id,candidate_entity_id:'root',verdict:'IN_SCOPE',explanation:'Đúng hướng, còn thiếu điều kiện',evidence:[{id:s.spans[0]!.id,quote:s.post!.text}]}];
    if(calls>1)a.checks.find(c=>c.criterion_id==='c3')!.status='UNKNOWN';return[a];}),{goalContract:contract,evaluatedAt:asOf});
  assert.equal(calls,3);assert.equal(result.decisions[0]!.assessment_status,'PENDING');assert.equal(result.decisions[0]!.goal_review?.primary_classification,'SUITABLE');
});

test('whole-context review distinguishes wrong purpose from a missing attribute',async()=>{
  const s=snapshot();let calls=0;const result=await classifyConversations(campaign,[s],gateway(()=>{
    if(++calls===1){const a=assessment(s);a.checks[2]!.status='UNKNOWN';return[a];}
    return[{snapshot_id:s.id,candidate_entity_id:'root',verdict:'OUT_OF_SCOPE',explanation:'Mục đích thực tế khác yêu cầu',evidence:[{id:s.spans[0]!.id,quote:s.post!.text}]}];
  }),{goalContract:contract,evaluatedAt:asOf});
  assert.equal(result.decisions[0]!.classification,'NOT_SUITABLE');assert.equal(result.decisions[0]!.reason_code,'GOAL_SCOPE_MISMATCH');
});

test('whole-context review can reject a literal-looking match without erasing its audit trail',async()=>{
  const s=snapshot();let calls=0;
  const result=await classifyConversations(campaign,[s],gateway(()=>++calls<3?[assessment(s)]:[{snapshot_id:s.id,candidate_entity_id:'root',
    verdict:'OUT_OF_SCOPE',explanation:'Ví dụ kiểm tra bước kiểm định ngữ cảnh.',evidence:[{id:s.spans[0]!.id,quote:s.post!.text}]}]),{goalContract:contract,evaluatedAt:asOf});
  const d=result.decisions[0]!;assert.equal(calls,3);assert.equal(d.classification,'NOT_SUITABLE');assert.equal(d.action_target,null);
  assert.equal(d.reason_code,'GOAL_SCOPE_MISMATCH');assert.ok(d.goal_assessment);assert.equal(d.goal_scope_review?.verdict,'OUT_OF_SCOPE');
});

test('scope review cannot publish a positive with fabricated supporting text',async()=>{
  const s=snapshot();let calls=0;
  const result=await classifyConversations(campaign,[s],gateway(()=>++calls<3?[assessment(s)]:[{snapshot_id:s.id,candidate_entity_id:'root',
    verdict:'IN_SCOPE',explanation:'Đúng mục tiêu',evidence:[{id:s.spans[0]!.id,quote:'Câu không tồn tại'}]}]),{goalContract:contract,evaluatedAt:asOf});
  assert.equal(result.decisions[0]!.classification,null);assert.equal(result.failures[0]!.code,'CLASSIFIER_SCOPE_EVIDENCE_INVALID');
});
test('scope review ignores extra unrequested entities but rejects conflicting answers for the actual target',async()=>{
  const s=snapshot();
  for(const conflicting of [false,true]){let calls=0;const result=await classifyConversations(campaign,[s],gateway(()=>{
    if(++calls<3)return[assessment(s)];
    const item={snapshot_id:s.id,candidate_entity_id:'root',verdict:'IN_SCOPE',explanation:'Đúng mục tiêu',evidence:[{id:s.spans[0]!.id,quote:s.post!.text}]};
    return[item,{...item,candidate_entity_id:conflicting?'root':'unrequested',verdict:'OUT_OF_SCOPE'}];
  }),{goalContract:contract,evaluatedAt:asOf});assert.equal(result.decisions[0]!.classification,conflicting?null:'SUITABLE');}
});

test('invalid interpreted deadline is a validation error, not an unhandled date conversion',()=>{
  const s=snapshot(),a=assessment(s);a.temporal_status='BOUNDED_REQUEST';a.temporal_evidence=[{entity_id:'root',evidence_id:s.spans[0]!.id,
    quote:s.post!.text,published_at:s.post!.published_at!,expires_at:'not-a-date'}];
  assert.throws(()=>decide(s,a),/CLASSIFIER_GOAL_TIME_INVALID/);
});

test('binary workbook includes the selected comment and criterion evidence, and groups legacy negatives',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'csd-goal-export-'));
  try{
    const s=snapshot('Tôi đang tìm phòng',[entity('offer','Cho thuê phòng riêng giá 3 triệu','root')]),a=assessment(s);a.candidate_entity_id='offer';
    a.checks.forEach(c=>{c.evidence=[{id:s.spans.find(p=>p.entity_id==='offer')!.id,quote:s.comments[0]!.text}];});
    const d={...decide(s,a),id:'decision',platform:s.platform,root_post_id:s.root_post_id,snapshot_revision:s.revision,created_at:asOf};
    const data={campaign,progress:{},cost:{},snapshots:[s],decisions:[d],conversations:[{snapshot:s,decision:d,stale:false}]};
    const path=join(directory,'result.xlsx');await exportOpportunityWorkbook(path,data);
    const book=new ExcelJS.Workbook();await book.xlsx.readFile(path);const evidence=book.getWorksheet('GoalEvidence')!;
    assert.equal(evidence.rowCount,5);assert.equal(evidence.getCell('F2').value,'offer');assert.equal(evidence.getCell('G2').value,s.comments[0]!.text);
    assert.equal(evidence.getCell('H2').value,s.comments[0]!.permalink);assert.match(String(evidence.getCell('N2').value),/3 triệu/);
    const old={...d,classification:'NOT_YET' as const};assert.equal(selectOpportunityExport({...data,conversations:[{snapshot:s,decision:old,stale:false}]},'NOT_SUITABLE').conversations.length,1);
  }finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\csd-goal-export-')||resolve(directory).startsWith(resolve(tmpdir())+'/csd-goal-export-'));rmSync(directory,{recursive:true,force:true});}
});
test('SQLite count/filter and rank agree with binary decisions while keeping legacy history readable',()=>{
  const directory=mkdtempSync(join(tmpdir(),'csd-goal-filter-')),store=createConversationStore(directory,{now:()=>new Date(asOf)});
  const context={campaign_id:campaign.campaign_id,campaign_version:campaign.version,filter_version:GOAL_FILTER_VERSION};
  try{
    for(const [id,amount,published]of [['a','3 triệu','2026-11-01T00:00:00.000Z'],['b','3 triệu','2024-01-01T00:00:00.000Z'],['c','6 triệu','2026-11-01T00:00:00.000Z']]){
      store.ingest({platform:'threads',entity_type:'POST',entity_id:id!,root_post_id:id!,parent_id:null,text:'Cho thuê phòng '+amount,published_at:published!,observed_at:asOf,provenance:{run_id:'test',method:'FIXTURE'}},context);
      const s=store.snapshot('threads',id!)!,a=assessment(s);store.recordDecision(goalDecision(a,campaign,contract,s,'test',asOf));
    }
    assert.deepEqual(store.results(context,{classification:'SUITABLE',ranked:true}).map(r=>r.snapshot.root_post_id),['a','b']);
    assert.equal(store.results(context,{classification:'NOT_SUITABLE'}).length,1);
    const stats=store.stats(context);assert.equal(stats.suitable,2);assert.equal(stats.not_yet+stats.unrelated,1);
  }finally{store.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\csd-goal-filter-')||resolve(directory).startsWith(resolve(tmpdir())+'/csd-goal-filter-'));rmSync(directory,{recursive:true,force:true});}
});
