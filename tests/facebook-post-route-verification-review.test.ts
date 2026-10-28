import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {setImmediate as tick} from 'node:timers/promises';
import {createFacebookPostRouteVerification} from '../src/main/facebook-post-route-verification.js';
import type {PostRouteTarget,PostNavigationEvent} from '../src/main/facebook-post-route-verification.js';
import type {CurrentPostObservation,createPublicCandidateSink} from '../src/main/facebook-public-candidate.js';
import {inspectCurrentGroupPostRoute} from '../src/main/facebook-public-candidate-fields.js';

// Synthetic main-process collaborators only; no Electron/profile/filesystem artifact access.
const route='https://www.facebook.com/groups/987/?multi_permalinks=90071992547409931234';
const body='REVIEW_SYNTHETIC_CAFE_BODY [NUMBER]',digest=(s:string)=>createHash('sha256').update(s).digest('hex');
type ReadResult=Awaited<ReturnType<Parameters<typeof createFacebookPostRouteVerification>[0]['read']>>;
function harness(){
  let url=route,generation=9,webContentsId=21,viewGeneration=3,wall=Date.now(),mono=0,reads=0,navs=0,stops=0;
  const losses=new Set<()=>void>(),events=new Set<(event:PostNavigationEvent)=>void>();
  const written=new Map<string,Map<string,unknown>>();
  const sink:ReturnType<typeof createPublicCandidateSink>=id=>{
    const files=new Map<string,unknown>();written.set(id,files);
    return{directory:'REVIEW_MEMORY_ONLY',write(name,value){assert.equal(files.has(name),false);const serialized=JSON.stringify(value);files.set(name,JSON.parse(serialized));return digest(serialized);}};
  };
  const observation=():CurrentPostObservation=>({profile_id:'review-profile',web_contents_id:21,view_generation:3,run_id:'candidate-'+randomUUID(),capture_mode:'FIXTURE',candidate_file_sha256:digest(randomUUID()),summary_sha256:digest(randomUUID()),context_hint:inspectCurrentGroupPostRoute(route)!,text:body,text_status:'VISIBLE_SNIPPET'});
  const result=(r:CurrentPostObservation):ReadResult=>({summary:{status:'SAMPLES_READY',run_id:r.run_id,candidate_file_sha256:r.candidate_file_sha256},directory:'REVIEW_MEMORY_ONLY',sha256:r.summary_sha256} as unknown as ReadResult);
  const emit=(event:PostNavigationEvent)=>{for(const callback of [...events])callback(event);};
  let navigation=async()=>{emit({kind:'START',url:route});generation++;emit({kind:'COMMIT',url:route});};
  let reading=async()=>{const r=observation();engine.observe(r);return result(r);};
  const target:PostRouteTarget={webContentsId:21,viewGeneration:3,url:()=>url,documentGeneration:()=>generation,
    execute:async()=>{throw Error('REVIEW_MUST_USE_FIXED_READER_CALLBACK');},
    navigateObservedRoute:async requested=>{assert.equal(requested,route);navs++;await navigation();},
    watchLoss(callback){losses.add(callback);return()=>{losses.delete(callback);};},
    watchNavigation(callback){events.add(callback);return()=>{events.delete(callback);};}};
  const engine=createFacebookPostRouteVerification({resolve:profile=>profile==='review-profile'?{...target,webContentsId,viewGeneration}:null,
    read:async profile=>{assert.equal(profile,'review-profile');reads++;return reading();},stopRead:()=>{stops++;},sink,mode:'FIXTURE',now:()=>wall,mono:()=>mono});
  return{engine,observation,result,emit,written,anchor(){const r=observation();engine.observe(r);return r;},
    onNavigate(fn:()=>Promise<void>){navigation=fn;},onRead(fn:()=>Promise<ReadResult>){reading=fn;},
    setUrl(value:string){url=value;},commit(){generation++;},replaceOwner(){webContentsId++;},replaceView(){viewGeneration++;},
    lose(){for(const callback of [...losses])callback();},advanceMono(ms:number){mono+=ms;},backward(){wall--;},
    get reads(){return reads;},get navs(){return navs;},get stops(){return stops;},get listeners(){return events.size+losses.size;}};
}
async function withHarness(work:(h:ReturnType<typeof harness>)=>Promise<void>){const h=harness();try{await work(h);}finally{h.engine.dispose();assert.equal(h.listeners,0);}}

test('review route verification: anchor invalidation survives away-return and owner/view/document replacement',async()=>{
  for(const mode of ['away-return','owner','view','document','wrong-profile'])await withHarness(async h=>{
    h.anchor();if(mode==='away-return'){h.setUrl(route.replace('/987/','/654/'));h.lose();h.setUrl(route);}
    if(mode==='owner')h.replaceOwner();if(mode==='view')h.replaceView();if(mode==='document')h.commit();
    const actual=await h.engine.start(mode==='wrong-profile'?'another-profile':'review-profile');
    assert.equal(actual.summary.result,'INCONCLUSIVE',mode);assert.equal(h.navs,0,mode);assert.equal(h.reads,0,mode);
  });
});

test('review route verification: missing, duplicate and out-of-order commit cannot start a fresh read',async()=>{
  for(const mode of ['missing','duplicate','out-of-order','same-document'])await withHarness(async h=>{
    h.anchor();h.onNavigate(async()=>{
      if(mode==='out-of-order'){h.commit();h.emit({kind:'COMMIT',url:route});h.emit({kind:'START',url:route});return;}
      h.emit({kind:'START',url:route});if(mode==='same-document'){h.emit({kind:'SAME_DOCUMENT',url:route});return;}
      if(mode==='missing')return;h.commit();h.emit({kind:'COMMIT',url:route});h.emit({kind:'COMMIT',url:route});
    });
    const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'INCONCLUSIVE',mode);assert.equal(h.reads,0,mode);assert.equal(actual.summary.read_count,0,mode);
  });
});

test('review route verification: real navigation after qualifying callback still revokes the pending read',async()=>{
  for(const kind of ['START','COMMIT','REDIRECT','SAME_DOCUMENT','OWNER_LOST'] as const)await withHarness(async h=>{
    h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);h.emit(kind==='OWNER_LOST'?{kind}:{kind,url:kind==='SAME_DOCUMENT'?route+'&ref=changed':route});return h.result(r);});
    const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'INCONCLUSIVE',kind);assert.equal(h.stops,1,kind);
    assert.equal(actual.summary.verified_valid_count,0);assert.equal(actual.summary.full_text_verified,false);
  });
});

test('review route verification: qualifying callback must bind exactly to fresh returned run and both hashes',async()=>{
  for(const mode of ['run','summary-hash','payload-hash','missing','wrong-capture'])await withHarness(async h=>{
    h.anchor();h.onRead(async()=>{const r=h.observation(),returned=h.result(r);
      if(mode==='wrong-capture')r.capture_mode='LIVE';if(mode!=='missing')h.engine.observe(r);
      if(mode==='run')returned.summary.run_id='candidate-'+randomUUID();if(mode==='summary-hash')returned.sha256=digest('different summary');
      if(mode==='payload-hash')returned.summary.candidate_file_sha256=digest('different payload');return returned;
    });
    const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'INCONCLUSIVE',mode);assert.equal(actual.summary.reason,'INSUFFICIENT_FRESH_EVIDENCE',mode);
  });
});

test('review route verification: Stop fences unfinished navigation/read and rejects late callback as a new anchor',async()=>{
  for(const phase of ['navigation','read'])await withHarness(async h=>{
    h.anchor();let settle=()=>{};
    if(phase==='navigation')h.onNavigate(()=>new Promise<void>(resolve=>{settle=resolve;}));
    else h.onRead(()=>new Promise<ReadResult>(resolve=>{settle=()=>resolve(h.result(h.observation()));}));
    const pending=h.engine.start('review-profile');await tick();h.engine.stop();const stopped=await pending;
    assert.equal(stopped.summary.result,'INCONCLUSIVE');assert.equal(stopped.summary.reason,'STOPPED');
    h.engine.observe(h.observation());await assert.rejects(()=>h.engine.start('review-profile'),/BUSY/);
    settle();await tick();const next=await h.engine.start('review-profile');assert.equal(next.summary.reason,'NO_ANCHOR');assert.equal(h.reads,phase==='read'?1:0);
  });
});

test('review route verification: matched evidence is immutable, sanitized and does not promote diagnostic validity',()=>withHarness(async h=>{
  const anchor=h.anchor(),original=JSON.stringify(anchor),actual=await h.engine.start('review-profile');
  assert.equal(actual.summary.result,'REOPEN_MATCH');assert.equal(h.navs,1);assert.equal(h.reads,1);assert.equal(JSON.stringify(anchor),original);
  const summary=JSON.stringify(actual.summary);for(const value of [route,body,anchor.context_hint.post_id,anchor.profile_id])assert.equal(summary.includes(value),false,value);
  assert.equal(Object.values(actual.summary).includes(anchor.context_hint.group_id),false);
  assert.equal(actual.summary.platform_permission,'UNKNOWN');assert.equal(actual.summary.verified_valid_count,0);assert.equal(actual.summary.benchmark_eligible,false);
  assert.equal(actual.summary.anchor_hint_verification,'UNVERIFIED');assert.equal(actual.summary.canonical_permalink_verification,'UNVERIFIED');assert.equal(actual.summary.source_verification,'UNVERIFIED');assert.equal(actual.summary.full_text_verified,false);
  const payload=h.written.get(actual.summary.run_id)?.get('candidates.json') as {anchor:{context_hint:{verification:string};body_sha256:string};reopened:{body_sha256:string}};
  assert.equal(payload.anchor.context_hint.verification,'UNVERIFIED');assert.equal(payload.anchor.body_sha256,digest(body));assert.equal(payload.reopened.body_sha256,digest(body));
  assert.equal(JSON.stringify(payload).includes(body),false);assert.equal((await h.engine.start('review-profile')).summary.reason,'NO_ANCHOR');
}));

test('review route events: exact same-document event after fresh commit while loading preserves comparison',()=>withHarness(async h=>{
  h.anchor();h.onNavigate(async()=>{h.emit({kind:'START',url:route});h.commit();h.emit({kind:'COMMIT',url:route});h.emit({kind:'SAME_DOCUMENT',url:route});});
  const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'REOPEN_MATCH');assert.equal(h.reads,1);assert.equal(h.stops,0);
}));

test('review route events: exact same-document event during fresh read preserves comparison',()=>withHarness(async h=>{
  h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);h.emit({kind:'SAME_DOCUMENT',url:route});return h.result(r);});
  const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'REOPEN_MATCH');assert.equal(h.reads,1);assert.equal(h.stops,0);
}));

test('review route events: same-document exemption requires exact URLs, same owner and expected generation',async()=>{
  for(const mode of ['event-mismatch','current-mismatch','away-return','generation','owner','subframe-main-url'])await withHarness(async h=>{
    h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);
      const changed=route+'&ref=synthetic-tracking';
      if(mode==='current-mismatch'||mode==='subframe-main-url')h.setUrl(changed);
      if(mode==='generation')h.commit();if(mode==='owner')h.replaceOwner();
      h.emit({kind:'SAME_DOCUMENT',url:['current-mismatch','generation','owner','subframe-main-url'].includes(mode)?route:changed,mainFrame:mode!=='subframe-main-url'});
      if(mode==='away-return')h.emit({kind:'SAME_DOCUMENT',url:route});
      h.setUrl(route);return h.result(r);
    });
    const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'INCONCLUSIVE',mode);assert.equal(h.stops,1,mode);
  });
});

test('review route events: trace permits sixteen entries and fails closed on the seventeenth without unbounded output',async()=>{
  for(const count of [14,15,50])await withHarness(async h=>{
    h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);for(let i=0;i<count;i++)h.emit({kind:'SAME_DOCUMENT',url:route,source:'DID_NAVIGATE_IN_PAGE',mainFrame:true});if(count>14)h.engine.stop();return h.result(r);});
    const actual=await h.engine.start('review-profile');assert.equal(actual.summary.version,2);assert.equal(actual.summary.event_trace.length,16);
    assert.equal(actual.summary.event_trace_overflow,count>14);assert.equal(actual.summary.result,count>14?'INCONCLUSIVE':'REOPEN_MATCH');
    if(count>14){assert.equal(actual.summary.reason,'EVENT_TRACE_LIMIT');assert.equal(actual.summary.first_cancellation?.cause,'TRACE_OVERFLOW');assert.equal(h.stops,1);}
    else{assert.equal(actual.summary.first_cancellation,null);assert.equal(h.stops,0);}
    for(const entry of actual.summary.event_trace){assert.deepEqual(Object.keys(entry).sort(),['kind','event','phase','frame','url_equality','current_url_equality','owner','generation_delta','decision'].sort());}
    const serialized=JSON.stringify(actual.summary.event_trace);for(const secret of [route,body,'review-profile','90071992547409931234'])assert.equal(serialized.includes(secret),false);
  });
});

test('review route events: first URL cancellation remains sticky through return, redirect and Stop',()=>withHarness(async h=>{
  h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);
    h.emit({kind:'SAME_DOCUMENT',url:route+'&ref=private-synthetic-query',source:'DID_NAVIGATE_IN_PAGE',mainFrame:true});
    h.emit({kind:'SAME_DOCUMENT',url:route,source:'DID_NAVIGATE_IN_PAGE',mainFrame:true});h.emit({kind:'REDIRECT',url:route,source:'DID_REDIRECT_NAVIGATION',mainFrame:true});h.engine.stop();return h.result(r);
  });
  const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'INCONCLUSIVE');assert.equal(actual.summary.reason,'ROUTE_CHANGED');
  assert.deepEqual(actual.summary.first_cancellation,{reason:'ROUTE_CHANGED',cause:'URL_CHANGED',phase:'READING',event_index:2});
  assert.equal(actual.summary.event_trace[2]?.decision,'CANCEL');assert.equal(actual.summary.event_trace[3]?.decision,'AFTER_CANCEL');assert.equal(actual.summary.event_trace[4]?.decision,'AFTER_CANCEL');
  assert.equal(JSON.stringify(actual.summary).includes('private-synthetic-query'),false);assert.equal(h.stops,1);
}));

const frameEvent:PostNavigationEvent={kind:'SAME_DOCUMENT',url:'about:blank#PRIVATE_SYNTHETIC_FRAME_VALUE',source:'DID_NAVIGATE_IN_PAGE',mainFrame:false};
test('review subframe history: event after main commit while loading preserves the owned main document',()=>withHarness(async h=>{
  h.anchor();h.onNavigate(async()=>{h.emit({kind:'START',url:route});h.commit();h.emit({kind:'COMMIT',url:route});h.emit(frameEvent);});
  const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'REOPEN_MATCH');assert.equal(h.reads,1);assert.equal(h.stops,0);
  assert.equal(actual.summary.event_trace[2]?.frame,'SUBFRAME');assert.equal(actual.summary.event_trace[2]?.decision,'NO_OP');
  assert.equal(actual.summary.event_trace[2]?.url_equality,'NOT_APPLICABLE');assert.equal(actual.summary.event_trace[2]?.current_url_equality,'EXACT');assert.equal(actual.summary.event_trace[2]?.generation_delta,1);
  assert.equal(JSON.stringify(actual.summary).includes('PRIVATE_SYNTHETIC_FRAME_VALUE'),false);
}));

test('review subframe history: event during fresh read preserves the main body and hints without reading the frame',()=>withHarness(async h=>{
  const anchor=h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);h.emit(frameEvent);return h.result(r);});
  const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'REOPEN_MATCH');assert.equal(h.navs,1);assert.equal(h.reads,1);assert.equal(h.stops,0);
  assert.equal(actual.summary.anchor_body_sha256,digest(anchor.text));assert.equal(actual.summary.reopened_body_sha256,digest(anchor.text));
  assert.equal(actual.summary.event_trace[2]?.url_equality,'NOT_APPLICABLE');assert.equal(actual.summary.event_trace[2]?.phase,'READING');
  assert.equal(actual.summary.first_cancellation,null);assert.equal(JSON.stringify(actual.summary).includes('PRIVATE_SYNTHETIC_FRAME_VALUE'),false);
}));

test('review subframe history: changed main URL, owner, view or document cannot be exempted by a child event',async()=>{
  for(const mode of ['main-url','owner','view','generation','away-return'])await withHarness(async h=>{
    h.anchor();h.onRead(async()=>{const r=h.observation();h.engine.observe(r);
      if(mode==='main-url'||mode==='away-return')h.setUrl(route+'&ref=changed');if(mode==='owner')h.replaceOwner();if(mode==='view')h.replaceView();if(mode==='generation')h.commit();
      h.emit(frameEvent);if(mode==='away-return'){h.setUrl(route);h.emit(frameEvent);}return h.result(r);
    });
    const actual=await h.engine.start('review-profile');assert.equal(actual.summary.result,'INCONCLUSIVE',mode);assert.equal(h.stops,1,mode);assert.equal(actual.summary.event_trace[2]?.decision,'CANCEL',mode);
  });
});
