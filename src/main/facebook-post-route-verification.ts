import { createHash,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DomTarget } from './facebook-dom-diagnostic.js';
import { inspectCurrentGroupPostRoute,redactCandidateText } from './facebook-public-candidate-fields.js';
import type { CurrentPostObservation,createPublicCandidateSink,createFacebookPublicCandidateProbe } from './facebook-public-candidate.js';
import { FACEBOOK_CURRENT_POST_SCRIPT } from './facebook-public-candidate-script.js';

const eventSources=['DID_START_NAVIGATION','DID_NAVIGATE','DID_NAVIGATE_IN_PAGE','DID_REDIRECT_NAVIGATION','DESTROYED','RENDER_PROCESS_GONE','DEVTOOLS_OPENED'] as const;
export type PostNavigationEvent=({kind:'START'|'COMMIT'|'REDIRECT'|'SAME_DOCUMENT';url:string}|{kind:'OWNER_LOST'})&{source?:typeof eventSources[number];mainFrame?:boolean};
type CancelCause='STOP'|'TIMEOUT'|'OWNER_LOSS'|'OWNER_CHECK'|'REDIRECT'|'URL_CHANGED'|'SAME_DOCUMENT_GENERATION_CHANGED'|'FULL_NAVIGATION_DURING_READ'|'EXTRA_START'|'COMMIT_CHANGED'|'SUBFRAME_HISTORY'|'TRACE_OVERFLOW'|'UNKNOWN_EVENT'|'READER_RESULT'|'CHECK';
type EventTrace={kind:PostNavigationEvent['kind']|'UNKNOWN';event:typeof eventSources[number]|'UNSPECIFIED';phase:'IDLE'|'NAVIGATING'|'READING';frame:'MAIN'|'SUBFRAME'|'NOT_APPLICABLE';url_equality:'EXACT'|'DIFFERENT'|'NOT_APPLICABLE';current_url_equality:'EXACT'|'DIFFERENT'|'UNKNOWN';owner:'SAME'|'CHANGED';generation_delta:0|1|'OTHER'|'UNKNOWN';decision:'EXPECTED'|'NO_OP'|'CANCEL'|'AFTER_CANCEL'};
type Cancellation={reason:string;cause:CancelCause;phase:'IDLE'|'NAVIGATING'|'READING';event_index:number|null};
export interface PostRouteTarget extends DomTarget {
  documentGeneration():number;
  navigateObservedRoute(route:string):Promise<void>;
  watchNavigation(callback:(event:PostNavigationEvent)=>void):()=>void;
}
type ReadResult=Awaited<ReturnType<ReturnType<typeof createFacebookPublicCandidateProbe>['start']>>;
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sameHint=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const cleanRecord=(r:CurrentPostObservation,mode:'LIVE'|'FIXTURE')=>{
  const hint=inspectCurrentGroupPostRoute(r.context_hint?.observed_route);
  return r.capture_mode===mode&&/^candidate-[0-9a-f-]{36}$/.test(r.run_id)&&[r.candidate_file_sha256,r.summary_sha256].every(s=>/^[0-9a-f]{64}$/.test(s))&&
    !!hint&&sameHint(hint,r.context_hint)&&typeof r.text==='string'&&r.text.length>0&&r.text.length<=800&&r.text===redactCandidateText(r.text)&&['VISIBLE_SNIPPET','TRUNCATED'].includes(r.text_status);
};
export function createFacebookPostRouteVerification(input:{resolve:(profileId:string)=>PostRouteTarget|null;read:(profileId:string)=>Promise<ReadResult>;stopRead:()=>void;sink:ReturnType<typeof createPublicCandidateSink>;mode:'LIVE'|'FIXTURE';now?:()=>number;mono?:()=>number}){
  if(!['LIVE','FIXTURE'].includes(input.mode))throw new Error('VERIFICATION_MODE_INVALID');
  const now=input.now||Date.now,mono=input.mono||(()=>performance.now()),codeHash=hash(readFileSync(new URL('./facebook-post-route-verification.js',import.meta.url)));
  let anchor:{record:CurrentPostObservation;generation:number}|null=null,anchorUnwatch=()=>{},busy=false,pending=false,disposed=false,runs=0,cancel:((reason:string,cause?:CancelCause,eventIndex?:number)=>void)|null=null;
  let fresh:CurrentPostObservation|null=null,stage:'IDLE'|'NAVIGATING'|'READING'='IDLE',operationProfile:string|null=null;
  const clearAnchor=()=>{anchor=null;const detach=anchorUnwatch;anchorUnwatch=()=>{};detach();};
  function observe(record:CurrentPostObservation){
    if(disposed||(pending&&!busy))return;
    if(!cleanRecord(record,input.mode))return;
    const target=input.resolve(record.profile_id);if(!target||target.webContentsId!==record.web_contents_id||target.viewGeneration!==record.view_generation||!sameHint(inspectCurrentGroupPostRoute(target.url()),record.context_hint))return;
    const copy={...record,context_hint:{...record.context_hint}};
    if(busy){if(stage==='READING'&&record.profile_id===operationProfile)fresh=copy;return;}
    clearAnchor();anchor={record:copy,generation:target.documentGeneration()};anchorUnwatch=target.watchLoss(clearAnchor);
    if(!sameHint(inspectCurrentGroupPostRoute(target.url()),record.context_hint))clearAnchor();
  }
  return{observe,clearAnchor,stop(){clearAnchor();cancel?.('STOPPED');},dispose(){disposed=true;clearAnchor();cancel?.('STOPPED');},async start(profileId:string){
    if(disposed)throw new Error('VERIFICATION_DISPOSED');if(busy||pending)throw new Error('VERIFICATION_BUSY');if(runs>=3)throw new Error('VERIFICATION_PROCESS_LIMIT');busy=true;runs++;operationProfile=profileId;fresh=null;
    const chosen=anchor;clearAnchor();const id='candidate-'+randomUUID(),started=now(),startMono=mono();
    let store:ReturnType<ReturnType<typeof createPublicCandidateSink>>|undefined,unwatch=()=>{},timer:ReturnType<typeof setTimeout>|undefined,revoked:string|null=null,navigationCount=0,readCount=0,starts=0,commits=0,freshDocument=false,freshRead:ReadResult|null=null;
    let result:'REOPEN_MATCH'|'REOPEN_MISMATCH'|'INCONCLUSIVE'='INCONCLUSIVE',reason='NO_ANCHOR';
    const eventTrace:EventTrace[]=[];let traceOverflow=false,firstCancellation:Cancellation|null=null;
    const rememberCancellation=(why:string,cause:CancelCause,eventIndex:number|null=null)=>{if(!firstCancellation)firstCancellation={reason:why,cause,phase:stage,event_index:eventIndex};};
    const meta={version:2,run_id:id,operation:'OBSERVED_ROUTE_VERIFICATION',capture_mode:input.mode,started_at:new Date(started).toISOString(),diagnostic_only:true,benchmark_eligible:false,platform_permission:'UNKNOWN',verified_valid_count:0,canonical_permalink_verification:'UNVERIFIED',source_verification:'UNVERIFIED',anchor_hint_verification:'UNVERIFIED',decision_ref:'ADR-015',script_sha256:hash(FACEBOOK_CURRENT_POST_SCRIPT),code_sha256:codeHash,code_hash_scope:'POST_ROUTE_VERIFICATION_MODULE',limits:{navigationMs:10000,readMs:4000,scriptMs:1000,nodes:2500,textChars:800,candidates:1,navigations:1,reads:1,runMs:300000,bytes:32768,combinedStartsPerProcess:3,eventTrace:16}};
    try{
      store=input.sink(id);store.write('started.json',{...meta,state:'STARTED'});
      if(!chosen||chosen.record.profile_id!==profileId)throw new Error('NO_ANCHOR');
      const record=chosen.record,target=input.resolve(profileId),expected=record.context_hint.observed_route;
      const owner=()=>{const current=input.resolve(profileId);return !!current&&current.webContentsId===record.web_contents_id&&current.viewGeneration===record.view_generation;};
      if(!target||!owner()||target.documentGeneration()!==chosen.generation)throw new Error('OWNER_CHANGED');
      if(!sameHint(inspectCurrentGroupPostRoute(target.url()),record.context_hint))throw new Error('ROUTE_CHANGED');
      const check=(phaseStart:number,phaseMono:number,limit:number,timeout:string)=>{if(now()<started)throw new Error('CLOCK_UNCERTAIN');if(Math.max(now()-started,mono()-startMono)>=300000)throw new Error('DEADLINE');if(Math.max(now()-phaseStart,mono()-phaseMono)>=limit)throw new Error(timeout);if(revoked)throw new Error(revoked);if(!owner())throw new Error('OWNER_CHANGED');};
      const aborted=new Promise<never>((_resolve,reject)=>{cancel=(why,cause,eventIndex)=>{if(revoked)return;revoked=why;rememberCancellation(why,cause||(why==='STOPPED'?'STOP':why.endsWith('_TIMEOUT')?'TIMEOUT':'CHECK'),eventIndex??null);if(stage==='READING')input.stopRead();reject(new Error(why));};});void aborted.catch(()=>{});
      stage='NAVIGATING';unwatch=target.watchNavigation(event=>{
        if(eventTrace.length>=16){traceOverflow=true;cancel?.('EVENT_TRACE_LIMIT','TRACE_OVERFLOW');return;}
        let owned=false,currentEquality:EventTrace['current_url_equality']='UNKNOWN',generation:EventTrace['generation_delta']='UNKNOWN';
        try{owned=owner();currentEquality=target.url()===expected?'EXACT':'DIFFERENT';const delta=target.documentGeneration()-chosen.generation;generation=delta===0?0:delta===1?1:'OTHER';}catch{}
        const kind:EventTrace['kind']=['START','COMMIT','REDIRECT','SAME_DOCUMENT','OWNER_LOST'].includes(event.kind)?event.kind:'UNKNOWN';
        const trace:EventTrace={kind,event:eventSources.includes(event.source as typeof eventSources[number])?event.source!:'UNSPECIFIED',phase:stage,frame:kind==='OWNER_LOST'?'NOT_APPLICABLE':event.mainFrame===false?'SUBFRAME':'MAIN',url_equality:kind==='OWNER_LOST'||event.mainFrame===false?'NOT_APPLICABLE':'url' in event&&event.url===expected?'EXACT':'DIFFERENT',current_url_equality:currentEquality,owner:owned?'SAME':'CHANGED',generation_delta:generation,decision:revoked?'AFTER_CANCEL':'EXPECTED'};eventTrace.push(trace);if(revoked)return;
        const reject=(why:string,cause:CancelCause)=>{trace.decision='CANCEL';cancel?.(why,cause,eventTrace.length-1);};
        if(kind==='UNKNOWN'){reject('INVALID_RESULT','UNKNOWN_EVENT');return;}
        if(kind==='OWNER_LOST'){reject('OWNER_CHANGED','OWNER_LOSS');return;}
        if(!owned){reject('OWNER_CHANGED','OWNER_CHECK');return;}
        // A subframe history URL never identifies the post. Only the owned main context can do so.
        if(trace.frame==='SUBFRAME'){
          if(kind!=='SAME_DOCUMENT'){reject('OWNER_CHANGED','SUBFRAME_HISTORY');return;}
          if(currentEquality!=='EXACT'){reject('ROUTE_CHANGED','URL_CHANGED');return;}
          if(!((commits===0&&generation===0)||(commits===1&&generation===1))){reject('DOCUMENT_CHANGED','SAME_DOCUMENT_GENERATION_CHANGED');return;}
          trace.decision='NO_OP';return;
        }
        if(kind==='REDIRECT'){reject('ROUTE_CHANGED','REDIRECT');return;}
        if(trace.url_equality!=='EXACT'){reject('ROUTE_CHANGED','URL_CHANGED');return;}
        if(kind==='SAME_DOCUMENT'){
          if(currentEquality!=='EXACT'){reject('ROUTE_CHANGED','URL_CHANGED');return;}
          if(!((commits===0&&generation===0)||(commits===1&&generation===1))){reject('DOCUMENT_CHANGED','SAME_DOCUMENT_GENERATION_CHANGED');return;}
          trace.decision='NO_OP';return;
        }
        if(kind==='START'){if(stage!=='NAVIGATING')reject('ROUTE_CHANGED','FULL_NAVIGATION_DURING_READ');else if(++starts!==1)reject('ROUTE_CHANGED','EXTRA_START');}
        if(kind==='COMMIT'){if(stage!=='NAVIGATING'||++commits!==1||starts!==1||generation!==1)reject('DOCUMENT_CHANGED','COMMIT_CHANGED');}
      });
      timer=setTimeout(()=>cancel?.('NAVIGATION_TIMEOUT'),10000);const navStart=now(),navMono=mono();pending=true;
      const navigation=Promise.resolve().then(()=>{check(navStart,navMono,10000,'NAVIGATION_TIMEOUT');navigationCount=1;return target.navigateObservedRoute(expected);});void navigation.then(()=>{pending=false;},()=>{pending=false;});
      await Promise.race([navigation,aborted]);check(navStart,navMono,10000,'NAVIGATION_TIMEOUT');clearTimeout(timer);timer=undefined;
      if(starts!==1||commits!==1||target.documentGeneration()!==chosen.generation+1)throw new Error('NO_FRESH_DOCUMENT');
      if(!sameHint(inspectCurrentGroupPostRoute(target.url()),record.context_hint))throw new Error('ROUTE_CHANGED');freshDocument=true;
      stage='READING';const readStart=now(),readMono=mono();timer=setTimeout(()=>cancel?.('READ_TIMEOUT'),4000);pending=true;
      const read=Promise.resolve().then(()=>{check(readStart,readMono,4000,'READ_TIMEOUT');readCount=1;return input.read(profileId);});void read.then(()=>{pending=false;},()=>{pending=false;});
      freshRead=await Promise.race([read,aborted]);check(readStart,readMono,4000,'READ_TIMEOUT');
      if(target.documentGeneration()!==chosen.generation+1)throw new Error('DOCUMENT_CHANGED');
      if(!sameHint(inspectCurrentGroupPostRoute(target.url()),record.context_hint))throw new Error('ROUTE_CHANGED');
      if(freshRead.summary.status!=='SAMPLES_READY')throw new Error(freshRead.summary.status);
      // observe() only receives a qualifying, durably written completion from the fixed reader.
      const reopened=fresh as CurrentPostObservation|null;
      if(!reopened||reopened.run_id===record.run_id||reopened.run_id!==freshRead.summary.run_id||reopened.summary_sha256!==freshRead.sha256||reopened.candidate_file_sha256!==freshRead.summary.candidate_file_sha256||reopened.web_contents_id!==record.web_contents_id||reopened.view_generation!==record.view_generation)throw new Error('INSUFFICIENT_FRESH_EVIDENCE');
      if(!sameHint(reopened.context_hint,record.context_hint))throw new Error('ROUTE_CHANGED');
      if(reopened.text!==record.text||hash(reopened.text)!==hash(record.text)){result='REOPEN_MISMATCH';reason='BODY_CHANGED';}
      else if(reopened.text_status!==record.text_status)reason='TEXT_QUALITY_CHANGED';
      else{result='REOPEN_MATCH';reason='MATCHED';}
    }catch(error){const why=error instanceof Error?error.message:'';reason=['NO_ANCHOR','OWNER_CHANGED','ROUTE_CHANGED','DOCUMENT_CHANGED','NO_FRESH_DOCUMENT','STOPPED','NAVIGATION_TIMEOUT','READ_TIMEOUT','DEADLINE','CLOCK_UNCERTAIN','INSUFFICIENT_FRESH_EVIDENCE','AUTH_REQUIRED','CHALLENGE','ACCESS_DENIED','UNSUPPORTED_OVERLAY','BARRIER_SCAN_INCOMPLETE','NO_PUBLIC_CANDIDATE','INVALID_RESULT','EVENT_TRACE_LIMIT'].includes(why)?why:'OPERATION_FAILED';result='INCONCLUSIVE';if(stage!=='IDLE')rememberCancellation(reason,freshRead&&freshRead.summary.status!=='SAMPLES_READY'?'READER_RESULT':'CHECK');}
    finally{if(timer)clearTimeout(timer);try{unwatch();}catch{result='INCONCLUSIVE';reason='OPERATION_FAILED';}cancel=null;busy=false;stage='IDLE';operationProfile=null;}
    if(!store)throw new Error('VERIFICATION_OUTPUT_FAILED');
    const observed=fresh as CurrentPostObservation|null,ref=(r:CurrentPostObservation)=>({run_id:r.run_id,candidate_file_sha256:r.candidate_file_sha256,summary_sha256:r.summary_sha256,context_hint:r.context_hint,body_sha256:hash(r.text),text_status:r.text_status,body_chars:r.text.length}),expires=new Date(now()+7*86400000).toISOString();
    const traceSummary:{event_trace:EventTrace[];event_trace_overflow:boolean;first_cancellation:Cancellation|null}={event_trace:eventTrace,event_trace_overflow:traceOverflow,first_cancellation:firstCancellation};
    const payloadHash=store.write('candidates.json',{version:2,run_id:id,operation:meta.operation,capture_mode:input.mode,expires_at:expires,result,reason,...traceSummary,owner_context:chosen?{profile_id:chosen.record.profile_id,web_contents_id:chosen.record.web_contents_id,view_generation:chosen.record.view_generation,anchor_document_generation:chosen.generation,reopened_document_generation:freshDocument?chosen.generation+1:null}:null,anchor:chosen?ref(chosen.record):null,reopened:observed?ref(observed):null,fresh_read_ref:freshRead?{run_id:freshRead.summary.run_id,summary_sha256:freshRead.sha256,candidate_file_sha256:freshRead.summary.candidate_file_sha256}:null,full_text_verified:false});
    const summary={...meta,finished_at:new Date(now()).toISOString(),result,reason,...traceSummary,navigation_count:navigationCount,read_count:readCount,fresh_document:freshDocument,anchor_run_id:chosen?.record.run_id||null,anchor_body_sha256:chosen?hash(chosen.record.text):null,anchor_candidate_file_sha256:chosen?.record.candidate_file_sha256||null,anchor_summary_sha256:chosen?.record.summary_sha256||null,fresh_read_run_id:freshRead?.summary.run_id||null,fresh_read_summary_sha256:freshRead?.sha256||null,fresh_read_candidate_file_sha256:freshRead?.summary.candidate_file_sha256||null,reopened_body_sha256:observed?hash(observed.text):null,anchor_text_status:chosen?.record.text_status||null,reopened_text_status:observed?.text_status||null,full_text_verified:false,verification_file_sha256:payloadHash,expires_at:expires,retention_cleanup:'MANUAL_REQUIRED_NO_SCHEDULER'};
    const sha256=store.write('summary.json',summary);fresh=null;return{summary,directory:store.directory,sha256};
  }};
}
