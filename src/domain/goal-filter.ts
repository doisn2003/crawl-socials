import { isAssessmentTime, validateConversationDecision } from './conversation-decision.js';
import type { ConversationDecisionInput, ConversationTemporalEvidence } from './conversation-decision.js';
import type { CampaignPlan } from './campaign-plan.js';
import { contentHash } from './conversation.js';
import type { ConversationSnapshot } from './conversation.js';

export const GOAL_FILTER_VERSION = 'goal-evidence-v3.0.0';
export type CriterionStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export interface GoalCriterion {
  id: string; description: string; kind: 'TOPIC' | 'ROLE' | 'PURPOSE' | 'LOCATION' | 'PRICE' | 'ATTRIBUTE' | 'TIME' | 'EXCLUSION';
  strength: 'REQUIRED' | 'PREFERRED'; branches: string[]; source: string; quote: string;
  numeric_limit: { operator: 'LT' | 'LTE' | 'GT' | 'GTE' | 'EQ'; value: number; unit: 'VND' } | null;
}
export interface GoalContract {
  goal: string; branches: { id: string; description: string }[]; criteria: GoalCriterion[];
  /** Soft source preferences use collected platform metadata, never invented post quotations. */
  platform_preferences?: { platform: 'threads' | 'facebook'; source: string; quote: string }[];
}
export interface GoalCheck { criterion_id: string; status: CriterionStatus; evidence: { id: string; quote: string }[] }
export interface GoalAssessment {
  snapshot_id: string; candidate_entity_id: string; candidate_description: string; checks: GoalCheck[]; summary: string;
  speaker_role: 'SEEKER' | 'PROVIDER' | 'PARTICIPANT' | 'UNKNOWN';
  match_type: 'REQUEST' | 'OFFER' | 'EXPERIENCE' | 'DISCUSSION' | 'RESEARCH';
  temporal_status: 'NO_BOUNDED_REQUEST' | 'BOUNDED_REQUEST' | 'CURRENT_WINDOW' | 'EXPIRED_WINDOW' | 'UNKNOWN';
  valid_until?: string | null; temporal_evidence: ConversationTemporalEvidence[];
}

/** Formatting/case only; return original literal text, never remove words, accents, numbers or negation. */
export function canonicalEvidenceQuote(text: string, quote: string): string | null {
  if (!quote.trim()) return null;
  if (text.includes(quote)) return quote;
  const formatting=new Set<number>();
  for(const marker of ['**','__']){
    const positions:number[]=[];
    for(let at=text.indexOf(marker);at>=0;at=text.indexOf(marker,at+2)){
      // Exponentiation/identifiers inside a token are content, not emphasis.
      if(!(/[\p{L}\p{N}]/u.test(text[at-1]??'')&&/[\p{L}\p{N}]/u.test(text[at+2]??'')))positions.push(at);
    }
    for(const at of positions.slice(0,positions.length-positions.length%2)){formatting.add(at);formatting.add(at+1);}
  }
  const needle = quote.replace(/\s+/gu,' ').trim().toLowerCase();
  let normalized = ''; const starts: number[] = [], ends: number[] = [];
  for (let i=0;i<text.length;) {
    if(formatting.has(i)){i++;continue;}
    const start=i, point=String.fromCodePoint(text.codePointAt(i)!); i+=point.length;
    if (/\s/u.test(point)) { if(normalized.endsWith(' ')){ends[ends.length-1]=i;continue;}
      normalized+=' ';starts.push(start);ends.push(i);
    } else { const lower=point.toLowerCase(); normalized+=lower; for(let j=0;j<lower.length;j++){starts.push(start);ends.push(i);} }
  }
  const at=normalized.indexOf(needle);return at<0?null:text.slice(starts[at],ends[at+needle.length-1]);
}

/** Explicit monetary literals only. Never interpret bare numbers, addresses or phone numbers as prices. */
export function monetaryValues(text: string): number[] {
  const value = text.toLowerCase().normalize('NFKC');
  const result: number[] = [];
  const pattern = /(\d+(?:[.,]\d+)*)\s*(triệu đồng|triệu|tr(?:iệu)?|tỷ|ty|nghìn|ngàn|k|vnd|vnđ|đồng|đ)(\d)?(?![\p{L}\p{N}])/gu;
  for (const match of value.matchAll(pattern)) {
    const unit = match[2]!, scale = /^(tr|triệu)/u.test(unit) ? 1e6 : /^(tỷ|ty)/u.test(unit) ? 1e9 : /^(k|nghìn|ngàn)/u.test(unit) ? 1e3 : 1;
    const raw = match[1]!, number = scale === 1 ? Number(raw.replace(/[.,]/gu, '')) : Number(raw.replace(',', '.'));
    if (!Number.isFinite(number)) continue;
    const amount = number * scale + (match[3] && scale > 1 ? Number(match[3]) * scale / 10 : 0);
    result.push(amount);
    // A shared unit in an explicit range: "3–4 triệu" means both endpoints, not only four.
    const before = value.slice(0, match.index);
    const range = /(\d+(?:[.,]\d+)?)\s*[-–—]\s*$/u.exec(before);
    if (range) result.push(Number(range[1]!.replace(',', '.')) * scale);
  }
  return [...new Set(result)].sort((a,b)=>a-b);
}

export function goalSources(campaign: CampaignPlan): Record<string, string> {
  const intent = campaign.intent_resolution?.input;
  return { PROMPT: campaign.prompt, CONTEXT: campaign.brand_context ?? '',
    ANSWER: intent?.answers.map(a=>a.answer || a.raw_text).join('\n') ?? '',
    EDIT: intent?.edits.map(e=>e.value).join('\n') ?? '',
    CRITERIA: JSON.stringify({ ...(campaign.planner_policy==='controlled-semantic-dialogue-v1'
      ? {topic:campaign.topic,participation_intents:campaign.participation_intents,research_intents:campaign.research_intents}:{}),
      audience: campaign.audience, needs: campaign.needs, inclusions: campaign.inclusions,
      exclusions: campaign.exclusions, required_geographies: campaign.required_geographies,
      preferred_geographies: campaign.preferred_geographies, max_age_days: campaign.max_age_days, languages: campaign.languages }) };
}
export function validateGoalContract(value: unknown, sources: Record<string,string>): GoalContract {
  const c = structuredClone(value) as GoalContract;
  if (!c || typeof c.goal !== 'string' || !c.goal.trim() || c.goal.length > 800 || !Array.isArray(c.branches)
    || !c.branches.length || c.branches.length > 8 || !Array.isArray(c.criteria) || !c.criteria.length || c.criteria.length > 30) throw Error('GOAL_CONTRACT_INVALID');
  const ids = new Set(c.branches.map(b=>b.id));
  if (ids.size !== c.branches.length || c.branches.some(b=>!/^b\d+$/u.test(b.id) || !b.description?.trim())) throw Error('GOAL_BRANCH_INVALID');
  if(c.platform_preferences!==undefined){
    if(!Array.isArray(c.platform_preferences)||c.platform_preferences.length>2
      ||new Set(c.platform_preferences.map(p=>p?.platform)).size!==c.platform_preferences.length)throw Error('GOAL_PLATFORM_PREFERENCE_INVALID');
    for(const p of c.platform_preferences){
      if(!p||!['threads','facebook'].includes(p.platform)||typeof p.quote!=='string'||typeof sources[p.source]!=='string')throw Error('GOAL_PLATFORM_PREFERENCE_INVALID');
      const quote=canonicalEvidenceQuote(sources[p.source]!,p.quote);
      if(!quote||!(p.platform==='threads'?/\bthreads?\b/iu:/\bfacebook\b|\bfb\b/iu).test(quote))throw Error('GOAL_PLATFORM_PREFERENCE_UNGROUNDED');
      p.quote=quote;
    }
  }
  if (new Set(c.criteria.map(r=>r.id)).size !== c.criteria.length) throw Error('GOAL_CRITERION_DUPLICATE');
  for (const r of c.criteria) {
    if (typeof r.quote==='string') {
      const own=typeof sources[r.source]==='string'?canonicalEvidenceQuote(sources[r.source]!,r.quote):null;
      if(own)r.quote=own;
      else {
        // Correct an unambiguous source-label error, retaining the exact supplied text and its actual authority.
        const matches=Object.entries(sources).flatMap(([source,text])=>{const quote=canonicalEvidenceQuote(text,r.quote);return quote?[{source,quote}]:[];});
        if(matches.length===1){r.source=matches[0]!.source;r.quote=matches[0]!.quote;}
      }
    }
    if (!/^c\d+$/u.test(r.id) || !r.description?.trim() || !['TOPIC','ROLE','PURPOSE','LOCATION','PRICE','ATTRIBUTE','TIME','EXCLUSION'].includes(r.kind)
      || !['REQUIRED','PREFERRED'].includes(r.strength) || !Array.isArray(r.branches) || r.branches.some(id=>!ids.has(id))
      || !r.quote?.trim() || !sources[r.source]?.includes(r.quote)) throw Error('GOAL_CRITERION_UNGROUNDED');
    if (r.numeric_limit && (r.numeric_limit.unit !== 'VND' || !['LT','LTE','GT','GTE','EQ'].includes(r.numeric_limit.operator)
      || !Number.isFinite(r.numeric_limit.value) || !monetaryValues(r.quote).includes(r.numeric_limit.value))) throw Error('GOAL_NUMERIC_LIMIT_UNGROUNDED');
    if (r.numeric_limit && ((/không\s+dưới/iu.test(r.quote) ? r.numeric_limit.operator!=='GTE' : /dưới/iu.test(r.quote) && r.numeric_limit.operator!=='LT')
      || (/không quá|tối đa/iu.test(r.quote) && r.numeric_limit.operator!=='LTE'))) throw Error('GOAL_NUMERIC_OPERATOR_INVALID');
  }
  for (const id of ids) {
    const required = c.criteria.filter(r=>r.strength==='REQUIRED' && (!r.branches.length || r.branches.includes(id)));
    if (!required.some(r=>r.kind==='TOPIC') || !required.some(r=>r.kind==='ROLE') || !required.some(r=>r.kind==='PURPOSE')) throw Error('GOAL_BRANCH_INCOMPLETE');
    if (['TOPIC','ROLE','PURPOSE'].some(kind=>required.filter(r=>r.kind===kind).length!==1)) throw Error('GOAL_BRANCH_DUPLICATE_CORE');
  }
  return structuredClone(c);
}

function numericStatus(limit: NonNullable<GoalCriterion['numeric_limit']>, checks: GoalCheck['evidence']): CriterionStatus {
  const values = checks.flatMap(e=>monetaryValues(e.quote));
  if (!values.length) return 'UNKNOWN';
  const min = Math.min(...values), max = Math.max(...values);
  const compare = (v:number) => limit.operator==='LT' ? v<limit.value : limit.operator==='LTE' ? v<=limit.value
    : limit.operator==='GT' ? v>limit.value : limit.operator==='GTE' ? v>=limit.value : v===limit.value;
  if (!compare(min) && !compare(max)) return 'FAIL';
  if (!compare(min) || !compare(max)) return 'UNKNOWN';
  // Open-ended advertised ranges are not an exact available price below a ceiling.
  if (checks.some(e=>/(?:từ|trở lên|trở xuống|đổ xuống|khoảng|tầm|[<>])/iu.test(e.quote))) return 'UNKNOWN';
  return 'PASS';
}

/** A binary result is derived from evidence checks, not a model's proposed label or score. */
export function goalDecision(value: unknown, campaign: CampaignPlan, contract: GoalContract, snapshot: ConversationSnapshot,
  model: string, evaluatedAt: string): ConversationDecisionInput {
  const a = structuredClone(value) as GoalAssessment;
  if (!a || a.snapshot_id!==snapshot.id || typeof a.summary!=='string' || !a.summary.trim() || a.summary.length>800
    || typeof a.candidate_description!=='string' || a.candidate_description.length>500 || !Array.isArray(a.checks) || a.checks.length>30
    || !['SEEKER','PROVIDER','PARTICIPANT','UNKNOWN'].includes(a.speaker_role)
    || !['REQUEST','OFFER','EXPERIENCE','DISCUSSION','RESEARCH'].includes(a.match_type)) throw Error('CLASSIFIER_GOAL_ITEM_INVALID');
  const entities = [snapshot.post,...snapshot.comments].filter(e=>e!==null);
  const target = entities.find(e=>e.entity_id===a.candidate_entity_id);
  if (!target || !isAssessmentTime(evaluatedAt)) throw Error('CLASSIFIER_GOAL_TARGET_INVALID');
  const evidenceIds = new Set<string>(), checked = new Map<string,GoalCheck>();
  // A comment may inherit context from its actual ancestor chain; never from a sibling's offer.
  const allowed = new Set([target.entity_id]); let parent = target.parent_id;
  while (parent && !allowed.has(parent)) { allowed.add(parent); parent = entities.find(e=>e.entity_id===parent)?.parent_id ?? null; }
  if (target.entity_type==='COMMENT' && snapshot.post) allowed.add(snapshot.post.entity_id);
  // Explicit original-author replies can clarify the selected offer. Names alone are not identity proof.
  if (target.author.id) for (const e of entities) if (e.author.id===target.author.id) {
    if (target.entity_type==='POST' && e.entity_type==='COMMENT' && e.root_post_id===target.entity_id) { allowed.add(e.entity_id); continue; }
    let ancestor=e.parent_id; const visited=new Set<string>();
    while(ancestor&&!visited.has(ancestor)){if(ancestor===target.entity_id){allowed.add(e.entity_id);break;}
      visited.add(ancestor);ancestor=entities.find(n=>n.entity_id===ancestor)?.parent_id??null;}
  }
  for (const original of a.checks) {
    const rule = contract.criteria.find(r=>r.id===original.criterion_id);
    if (!rule || checked.has(rule.id) || !['PASS','FAIL','UNKNOWN'].includes(original.status) || !Array.isArray(original.evidence)
      || original.evidence.length>3 || (original.status!=='UNKNOWN' && !original.evidence.length)) throw Error('CLASSIFIER_GOAL_CHECK_INVALID');
    const check = structuredClone(original);
    for (const proof of check.evidence) {
      const span = snapshot.spans.find(s=>s.id===proof.id);
      if (!span || !allowed.has(span.entity_id)) throw Error('CLASSIFIER_GOAL_PROOF_ENTITY_INVALID');
      if (typeof proof.quote!=='string' || proof.quote.length>700) throw Error('CLASSIFIER_GOAL_PROOF_INVALID');
      const literal=canonicalEvidenceQuote(span.text,proof.quote);
      if (!literal) throw Error('CLASSIFIER_GOAL_PROOF_QUOTE_INVALID');
      proof.quote=literal;
      evidenceIds.add(proof.id);
    }
    if (rule.numeric_limit && check.status!=='UNKNOWN') check.status = numericStatus(rule.numeric_limit,check.evidence);
    checked.set(rule.id,check);
  }
  const branchStates = contract.branches.map(branch=> {
    const rules = contract.criteria.filter(r=>r.strength==='REQUIRED' && (!r.branches.length || r.branches.includes(branch.id)));
    return { id:branch.id, state: rules.some(r=>checked.get(r.id)?.status==='FAIL') ? 'FAIL'
      : rules.every(r=>checked.get(r.id)?.status==='PASS') ? 'PASS' : 'UNKNOWN' };
  });
  if(!branchStates.some(b=>b.state==='PASS')&&branchStates.some(b=>b.state==='UNKNOWN'&&contract.criteria.some(r=>
    r.strength==='REQUIRED'&&(!r.branches.length||r.branches.includes(b.id))&&!checked.has(r.id))))throw Error('CLASSIFIER_GOAL_BRANCH_UNASSESSED');
  let state = branchStates.some(b=>b.state==='PASS') ? 'PASS' : branchStates.every(b=>b.state==='FAIL') ? 'FAIL' : 'UNKNOWN';
  let reason = state==='PASS' ? 'GOAL_MATCH' : state==='FAIL' ? 'GOAL_CONSTRAINT_MISMATCH' : 'GOAL_EVIDENCE_REQUIRED';
  const actionable=a.match_type==='REQUEST'||a.match_type==='OFFER';
  if (a.temporal_status==='BOUNDED_REQUEST' && a.temporal_evidence?.length) {
    const earliest=Math.min(...a.temporal_evidence.map(p=>Date.parse(p.expires_at)));
    if (!Number.isFinite(earliest)) throw Error('CLASSIFIER_GOAL_TIME_INVALID');
    a.temporal_status=earliest<=Date.parse(evaluatedAt)?'EXPIRED_WINDOW':'CURRENT_WINDOW';
    a.valid_until=a.temporal_status==='CURRENT_WINDOW'?new Date(earliest).toISOString():null;
  }
  if (a.valid_until===undefined) a.valid_until=null;
  if (!['NO_BOUNDED_REQUEST','CURRENT_WINDOW','EXPIRED_WINDOW','UNKNOWN'].includes(a.temporal_status)
    || !Array.isArray(a.temporal_evidence) || a.temporal_evidence.length>2) throw Error('CLASSIFIER_GOAL_TIME_INVALID');
  if (a.temporal_status==='CURRENT_WINDOW' || a.temporal_status==='EXPIRED_WINDOW') {
    if (!a.temporal_evidence.length || a.temporal_evidence.some(p=>p.entity_id!==target.entity_id)) throw Error('CLASSIFIER_GOAL_TIME_PROOF_REQUIRED');
    for (const p of a.temporal_evidence) {
      const span=snapshot.spans.find(s=>s.id===p.evidence_id), quote=span&&typeof p.quote==='string'?canonicalEvidenceQuote(span.text,p.quote):null;
      if(!quote)throw Error('CLASSIFIER_GOAL_TIME_PROOF_REQUIRED');p.quote=quote;evidenceIds.add(p.evidence_id);
    }
    const times = a.temporal_evidence.map(p=>Date.parse(p.expires_at));
    if (times.some(t=>!Number.isFinite(t))) throw Error('CLASSIFIER_GOAL_TIME_INVALID');
    if (a.temporal_status==='EXPIRED_WINDOW') {
      if (Math.min(...times)>Date.parse(evaluatedAt) || a.valid_until!==null) throw Error('CLASSIFIER_GOAL_TIME_CONTRADICTION');
      if(actionable&&state!=='FAIL'){state='FAIL';reason='GOAL_EXPIRED';}
    } else if (!isAssessmentTime(a.valid_until) || Date.parse(a.valid_until)!==Math.min(...times) || Date.parse(a.valid_until)<=Date.parse(evaluatedAt)) throw Error('CLASSIFIER_GOAL_TIME_CONTRADICTION');
  } else if (a.temporal_evidence.length || a.valid_until!==null) throw Error('CLASSIFIER_GOAL_TIME_CONTRADICTION');
  if (state==='PASS' && actionable && a.temporal_status==='UNKNOWN') { state='UNKNOWN'; reason='GOAL_TIME_EVIDENCE_REQUIRED'; }
  if (state==='PASS' && campaign.max_age_days!==null) {
    if (!target.published_at || !Number.isFinite(Date.parse(target.published_at))) { state='UNKNOWN'; reason='GOAL_TIME_EVIDENCE_REQUIRED'; }
    else if (Date.parse(evaluatedAt)-Date.parse(target.published_at)>campaign.max_age_days*86400000) { state='FAIL'; reason='GOAL_AGE_LIMIT'; }
  }
  if (state==='PASS' && !snapshot.spans.some(s=>s.entity_id===target.entity_id && evidenceIds.has(s.id))) throw Error('CLASSIFIER_GOAL_ACTION_PROOF_REQUIRED');
  const acceptedBranch = branchStates.find(b=>b.state==='PASS')?.id;
  const preferred = contract.criteria.filter(r=>r.strength==='PREFERRED' && (!r.branches.length || (acceptedBranch && r.branches.includes(acceptedBranch))));
  const platforms=contract.platform_preferences??[],platformIndex=platforms.findIndex(p=>p.platform===snapshot.platform);
  const platformScore=platformIndex<0?0:(platforms.length-platformIndex)/platforms.length;
  const preferenceCount=preferred.length+(platforms.length?1:0);
  const published = target.published_at ? Date.parse(target.published_at) : NaN;
  const age = Number.isFinite(published) ? Math.max(0,(Date.parse(evaluatedAt)-published)/86400000) : null;
  const missing = contract.criteria.filter(r=>r.strength==='REQUIRED' && checked.get(r.id)?.status==='UNKNOWN'
    && (!r.branches.length || branchStates.some(b=>b.state==='UNKNOWN'&&r.branches.includes(b.id))));
  const summary = reason==='GOAL_EVIDENCE_REQUIRED' ? 'Chưa đủ bằng chứng: '+missing.map(r=>r.description).slice(0,4).join('; ')
    : reason==='GOAL_TIME_EVIDENCE_REQUIRED' ? 'Chưa xác định được thời hạn hoặc ngày đăng của nhu cầu.'
    : reason==='GOAL_AGE_LIMIT' ? 'Bài vượt giới hạn tuổi bài đã được yêu cầu.'
    : reason==='GOAL_EXPIRED' ? 'Thời hạn của nhu cầu được trích dẫn đã kết thúc.' : a.summary;
  const decision: ConversationDecisionInput = { campaign_id:campaign.campaign_id,campaign_version:campaign.version,filter_version:campaign.filter_version,
    snapshot_id:snapshot.id,classification:state==='PASS'?'SUITABLE':state==='FAIL'?'NOT_SUITABLE':null,
    assessment_status:state==='UNKNOWN'?'PENDING':'ASSESSED', reason_code:reason, evidence_ids:[...evidenceIds],model,
    evaluated_at:evaluatedAt,valid_until:state==='PASS'&&actionable?a.valid_until:null,temporal_evidence:a.temporal_evidence,
    action_target:state==='PASS'?{entity_id:target.entity_id,type:target.entity_type}:null,
    goal_assessment:{contract_hash:contentHash(contract),contract:structuredClone(contract),candidate_entity_id:target.entity_id,candidate_description:a.candidate_description,
      checks:[...checked.values()],branches:branchStates},
    attributes:{ need_summary:summary, speaker_role:a.speaker_role,observed_need:a.match_type,temporal_status:a.temporal_status,
      goal_policy:3,goal_preferred:preferenceCount?Math.round(100*(preferred.filter(r=>checked.get(r.id)?.status==='PASS').length+platformScore)/preferenceCount):0,
      ...(platforms.length?{goal_platform:snapshot.platform,goal_platform_preference:Math.round(100*platformScore)}:{}),
      goal_actionability:a.match_type==='REQUEST'||a.match_type==='OFFER'?3:a.match_type==='RESEARCH'?0:2,
      goal_published_at:Number.isFinite(published)?published:0, goal_age_days:age,
      goal_freshness:age===null?0:age<=7?3:age<=30?2:1,
      freshness:age===null?'UNKNOWN':age<=30?'CURRENT':'OLD',
      brand_fit:state==='PASS'?'ALIGNED':state==='FAIL'?'MISMATCH':'UNKNOWN',participation_context:'UNKNOWN' } };
  validateConversationDecision(decision,snapshot); return decision;
}
