import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID,createHash } from 'node:crypto';
import { runInNewContext,createContext,runInContext } from 'node:vm';
import { mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { SEARCH_OPEN_ELIGIBILITY_COUNTERS,SEARCH_OPEN_PREFLIGHT_DEFAULTS,SEARCH_OPEN_SETUP,SEARCH_OPEN_FINISH,SEARCH_OPEN_URL_INTERACTIVE_ROLES } from '../src/main/facebook-search-post-open-script-hooks.js';
import { createFacebookSearchPostOpen,validateSearchPostOpenScan } from '../src/main/facebook-search-post-open.js';
import { createPublicCandidateSink } from '../src/main/facebook-public-candidate.js';
import type { CurrentPostObservation } from '../src/main/facebook-public-candidate.js';
import type { PostNavigationEvent,PostRouteTarget } from '../src/main/facebook-post-route-verification.js';
import { classifySearchTimestampHref,inspectCurrentGroupPostRoute,classifySearchTargetKind,resolveObservedGroupQueryHref } from '../src/main/facebook-public-candidate-fields.js';
import { FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,FACEBOOK_CURRENT_POST_SCRIPT,FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,FACEBOOK_SEARCH_POST_CLICK_SCRIPT,FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT } from '../src/main/facebook-public-candidate-script.js';
const search='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i',post='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234',hash=(s:string)=>createHash('sha256').update(s).digest('hex');
type Read=Awaited<ReturnType<Parameters<typeof createFacebookSearchPostOpen>[0]['read']>>;
function scan(phase:'DISCOVER'|'CLICK',status=phase==='DISCOVER'?'TARGETS_READY':'CLICK_DISPATCHED'){
  const base=JSON.parse(JSON.stringify(runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,{URL,location:{href:'https://www.facebook.com/unsupported'},performance:{now:()=>0}})));
  Object.assign(base,{status:'SAMPLES_READY',route:'SEARCH_TOP_MIXED',root:'FEED_IN_MAIN',visited:50,examined:1});base.barriers.state='CLEAR';Object.assign(base.selection,{firstFeedFound:true,feedLandmarks:true,feedExamined:1});
  base.samples=[{boundary:'FEED_CHILD_HEADER_PUBLIC_OPTIONAL_TIME',boundary_verified:false,public_signal:'DIRECT_PUBLIC_LABEL',source_type:'UNKNOWN',post_id:null,permalink:null,published_at:null,text:'SEARCH_BODY',text_status:'VISIBLE_SNIPPET',contacts_redacted:false,missing_fields:['BOUNDARY_HEURISTIC','SOURCE_TYPE_UNVERIFIED','PUBLICITY_NOT_INDEPENDENTLY_VERIFIED','PERMALINK_NOT_IN_DOM','TEMPORAL_NOT_OBSERVED'],metadata:{headings:1,temporal:0,publicLabels:1,restrictedLabels:0,messageRegions:1,links:{post:0,group:0,profile:0,other:1,external:0},timeTag:false,abbr:false,ariaTemporal:false,temporalStatus:'MISSING',headerProof:'HEADING_PUBLIC',auxiliaryTextOmitted:false}}];
  base.searchOpen={version:5,phase,status,targets:['TARGETS_READY','CLICK_DISPATCHED','STALE_TARGET'].includes(status)?[{index:0,href_kind:'SEARCH_PLACEHOLDER',timestamp_proof:'UNIQUE_HEADER_PLACEHOLDER'}]:[],click_count:status==='CLICK_DISPATCHED'?1:0,selected_index:status==='CLICK_DISPATCHED'?0:null,qualified_headers:1,no_timestamp_headers:status==='NO_ELIGIBLE_TIMESTAMP'?1:0,ambiguous_headers:status==='AMBIGUOUS_TIMESTAMP'?1:0,eligibility:{counters:Object.fromEntries(SEARCH_OPEN_ELIGIBILITY_COUNTERS.map(key=>[key,0])),shapes:[],shapes_truncated:false}};return base;
}
function harness(root:string,urlMode=false){
  const destination=urlMode?observedUrl:post,navigationUrls:string[]=[];const data=join(root,'data'),workspace=join(root,'workspace');mkdirSync(data);mkdirSync(workspace);let url=search,generation=0,owner=5,reads=0,stopReads=0,now=Date.now(),mono=0;const listeners=new Set<(event:PostNavigationEvent)=>void>(),calls:string[]=[];
  const emit=(event:PostNavigationEvent)=>{for(const cb of listeners)cb(event);};
  let navigate:()=>Promise<void>=async()=>{emit({kind:'START',url:destination});generation++;url=destination;emit({kind:'COMMIT',url:destination});};
  let execute:(code:string)=>Promise<unknown>=async code=>{if(urlMode){assert.ok([FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT].includes(code));return observedScan(code===FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT?'DISCOVER':'REVALIDATE');}if(code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT)return scan('DISCOVER');assert.equal(code,FACEBOOK_SEARCH_POST_CLICK_SCRIPT);emit({kind:'SAME_DOCUMENT',url:post});url=post;emit({kind:'SAME_DOCUMENT',url:post});return scan('CLICK');};
  const observation=():CurrentPostObservation=>({profile_id:'profile',web_contents_id:5,view_generation:1,run_id:'candidate-'+randomUUID(),capture_mode:'FIXTURE',candidate_file_sha256:hash('payload'),summary_sha256:hash(randomUUID()),context_hint:inspectCurrentGroupPostRoute(destination)!,text:'OPENED_BODY [EMAIL]',text_status:'VISIBLE_SNIPPET'});
  const result=(r:CurrentPostObservation,status='SAMPLES_READY')=>({summary:{run_id:r.run_id,status,candidate_file_sha256:r.candidate_file_sha256},sha256:r.summary_sha256,directory:'synthetic'}) as unknown as Read;
  let read:()=>Promise<Read>=async()=>{const r=observation();engine.observe(r);return result(r);};
  const target:PostRouteTarget={webContentsId:5,viewGeneration:1,url:()=>url,documentGeneration:()=>generation,watchLoss:()=>()=>{},execute:code=>{calls.push(code);return execute(code);},navigateObservedRoute:async value=>{if(!urlMode)throw new Error('MUST_NEVER_LOAD_PLACEHOLDER');assert.equal(value,destination);navigationUrls.push(value);await navigate();},watchNavigation:cb=>{listeners.add(cb);return()=>{listeners.delete(cb);};}};
  const engine=createFacebookSearchPostOpen({resolve:()=>({...target,webContentsId:owner}),read:()=>{reads++;return read();},stopRead:()=>{stopReads++;},sink:createPublicCandidateSink(data,workspace),mode:'FIXTURE',...(urlMode?{strategy:'OBSERVED_URL' as const}:{}),now:()=>now,mono:()=>mono});
  return{engine,emit,observation,result,calls,navigationUrls,setNavigate(fn:typeof navigate){navigate=fn;},setExecute(fn:typeof execute){execute=fn;},setRead(fn:typeof read){read=fn;},setUrl(value:string){url=value;},replace(){owner++;},commit(){generation++;},advance(ms:number){now+=ms;mono+=ms;},get reads(){return reads;},get stopReads(){return stopReads;},get listeners(){return listeners.size;}};
}
async function setup(work:(c:ReturnType<typeof harness>)=>Promise<void>,urlMode=false){const root=mkdtempSync(join(tmpdir(),'csd-search-open-'));const c=harness(root,urlMode);try{await work(c);}finally{c.engine.dispose();assert.ok(resolve(root).startsWith(resolve(tmpdir(),'csd-search-open-')));rmSync(root,{recursive:true,force:true});}}
test('search timestamp href classifier accepts observed placeholders/posts but rejects actions, scope and origins',()=>{
  assert.equal(classifySearchTimestampHref('https://www.facebook.com/search/top?__cft__[0]=synthetic&__tn__=synthetic',search),'SEARCH_PLACEHOLDER');assert.equal(classifySearchTimestampHref('/groups/123/posts/90071992547409931234/',search),'OBSERVED_POST');
  for(const href of ['javascript:void(0)','data:text/html,x','https://www.facebook.com.attacker.test/search/top','/groups/123/','/profile.php?id=42','/photo.php?fbid=42','/search/top?q=unrelated','/search/top?__tn__=a&__tn__=b','/search/top?unknown=scope','/search/posts?__tn__=a','/search/top#target',''])assert.equal(classifySearchTimestampHref(href,search),null,href);
});
test('base fixed scripts retain accepted hashes and opening scripts are separate fixed code',()=>{
  assert.equal(hash(FACEBOOK_CURRENT_POST_SCRIPT),'4fc5c408ec5a3fcd2542d0e208b7b5abf03dab6e09251d2fe28dc46fcaf60ed4');assert.equal(hash(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT),'7106e613788fd249bedb637d7c6fbee277df55deed3602aa87c5f6bd3be912e6');assert.notEqual(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,FACEBOOK_SEARCH_POST_CLICK_SCRIPT);
});
test('only the observed three-letter fragment family is accepted on guarded same-search placeholders',()=>{
  const base='https://www.facebook.com/search/top?q=cafe%20H%C3%A0%20N%E1%BB%99i&filters=BASE_ONLY';
  for(const fragment of ['#?abc','#?xyz'])assert.equal(classifySearchTimestampHref('/search/top?__cft__[0]='+('x'.repeat(198))+'&__tn__=abcdef'+fragment,base),'SEARCH_PLACEHOLDER');
  for(const fragment of ['#target','#?ab','#?abcd','#?ABC','#?ab1','#?a-c','#?%61bc','#%3Fabc','#?abc/','#?abc?','#?abc%0A'])assert.equal(classifySearchTimestampHref('/search/top?__tn__=abcdef'+fragment,base),null,fragment);
  for(const href of ['https://m.facebook.com/search/top?__tn__=a#?abc','https://www.facebook.com.attacker.test/search/top#?abc','http://www.facebook.com/search/top#?abc','/search/posts?__tn__=a#?abc','/search/top?q=unrelated#?abc','/search/top?unknown=scope#?abc','/search/top?filters=scope#?abc','/search/top?__tn__=a&__tn__=b#?abc','/search/top?multi_permalinks=123#?abc','/groups/123/posts/456/#?abc','/groups/123/permalink/456/#?abc','/groups/123/?multi_permalinks=456#?abc'])assert.equal(classifySearchTimestampHref(href,base),null,href);
  assert.equal(classifySearchTimestampHref('/groups/123/posts/456/',base),'OBSERVED_POST');
});
test('opening validator rejects extra selectors/URLs, ambiguous phase/indices and forged click flags',()=>{
  const valid=scan('DISCOVER');assert.equal(validateSearchPostOpenScan(valid,'DISCOVER').opening.targets[0]?.timestamp_proof,'UNIQUE_HEADER_PLACEHOLDER');
  for(const changed of [{...valid,searchOpen:{...valid.searchOpen,selector:'PRIVATE'}},{...valid,searchOpen:{...valid.searchOpen,targets:[{...valid.searchOpen.targets[0],url:post}]}},{...valid,searchOpen:{...valid.searchOpen,click_count:1}},{...valid,searchOpen:{...valid.searchOpen,targets:Array.from({length:6},(_,index)=>({...valid.searchOpen.targets[0],index}))}},{...valid,searchOpen:{...valid.searchOpen,targets:[{...valid.searchOpen.targets[0],index:1}]}},{...valid,searchOpen:{...valid.searchOpen,targets:[{...valid.searchOpen.targets[0],href_kind:'OBSERVED_POST'}]}}])assert.throws(()=>validateSearchPostOpenScan(changed,'DISCOVER'),/INVALID_RESULT/);
});
test('one bound click yields an observed SPA route and one fixed post read, without loading a placeholder',()=>setup(async c=>{
  const value=await c.engine.start('profile');assert.equal(value.summary.result,'OPENED_POST_SAMPLE');assert.equal(value.summary.click_count,1);assert.equal(value.summary.post_read_count,1);assert.deepEqual(c.calls,[FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,FACEBOOK_SEARCH_POST_CLICK_SCRIPT]);assert.equal(c.reads,1);assert.equal(c.listeners,0);
  assert.equal(value.summary.verified_valid_count,0);assert.equal(value.summary.candidate_verification,'UNVERIFIED');assert.equal(value.summary.full_text_verified,false);for(const secret of [search,post,'90071992547409931234','OPENED_BODY','profile'])assert.equal(JSON.stringify(value).includes(secret),false);
  const proof=JSON.parse(readFileSync(join(value.directory,'candidates.json'),'utf8'));assert.equal(proof.observed_post_route.observed_route,post);assert.equal(proof.observed_post_route.verification,'UNVERIFIED');assert.ok(proof.post_read.run_id);assert.ok(proof.post_read.body_sha256);
}));
test('no reliable/ambiguous target, stale replacement and malformed discovery perform no confirmed click/read',async()=>{for(const mode of ['NO_ELIGIBLE_TIMESTAMP','AMBIGUOUS_TIMESTAMP','STALE_TARGET','INVALID_RESULT'])await setup(async c=>{
  c.setExecute(async code=>{if(mode==='INVALID_RESULT')return{};return code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT?scan('DISCOVER',mode==='STALE_TARGET'?'TARGETS_READY':mode):scan('CLICK','STALE_TARGET');});const value=await c.engine.start('profile');assert.equal(value.summary.result,'INCONCLUSIVE');assert.equal(value.summary.reason,mode);assert.equal(value.summary.click_count,0);assert.equal(c.reads,0);
});});
test('owner, main route or generation change before click, and navigation before arming, stop at discovery',async()=>{for(const mode of ['owner','route','generation','pre-navigation'])await setup(async c=>{
  c.setExecute(async code=>{assert.equal(code,FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT);if(mode==='owner')c.replace();if(mode==='route')c.setUrl(search+'&ref=changed');if(mode==='generation')c.commit();if(mode==='pre-navigation'){c.setUrl(post);c.emit({kind:'SAME_DOCUMENT',url:post});}return scan('DISCOVER');});const value=await c.engine.start('profile');assert.equal(value.summary.result,'INCONCLUSIVE');assert.equal(value.summary.click_attempt_count,0);assert.equal(c.calls.length,1);assert.equal(c.reads,0);
});});
test('full-document click transition needs its own start/commit and remains a single read',()=>setup(async c=>{
  c.setExecute(async code=>{if(code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT)return scan('DISCOVER');c.emit({kind:'START',url:post});c.commit();c.setUrl(post);c.emit({kind:'COMMIT',url:post});return scan('CLICK');});const value=await c.engine.start('profile');assert.equal(value.summary.result,'OPENED_POST_SAMPLE');assert.equal(c.reads,1);
}));
test('unsupported destinations, redirects, raw-route swaps and extra full navigation never reach a post read',async()=>{for(const mode of ['unsupported','redirect','alias','extra-start'])await setup(async c=>{
  c.setExecute(async code=>{if(code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT)return scan('DISCOVER');if(mode==='unsupported')c.emit({kind:'SAME_DOCUMENT',url:search+'#placeholder'});if(mode==='redirect')c.emit({kind:'REDIRECT',url:post});if(mode==='alias'){c.emit({kind:'SAME_DOCUMENT',url:post});c.setUrl(post+'&ref=changed');c.emit({kind:'SAME_DOCUMENT',url:post+'&ref=changed'});}if(mode==='extra-start'){c.emit({kind:'START',url:post});c.emit({kind:'START',url:post});}return scan('CLICK');});const value=await c.engine.start('profile');assert.equal(value.summary.result,'INCONCLUSIVE');assert.equal(c.reads,0);
});});
test('Stop during discovery/click/read drops late return and retains native execution capacity until settlement',async()=>{for(const mode of ['discovery','click','read'])await setup(async c=>{
  let finish:(value:unknown)=>void=()=>{};if(mode==='discovery')c.setExecute(()=>new Promise(resolve=>{finish=resolve;}));if(mode==='click')c.setExecute(async code=>code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT?scan('DISCOVER'):new Promise(resolve=>{finish=resolve;}));if(mode==='read')c.setRead(()=>new Promise(resolve=>{finish=v=>resolve(v as Read);}));
  const pending=c.engine.start('profile');await tick();c.engine.stop();const value=await pending;assert.equal(value.summary.reason,'STOPPED');assert.equal(value.summary.result,'INCONCLUSIVE');await assert.rejects(()=>c.engine.start('profile'),/BUSY/);finish(mode==='read'?c.result(c.observation()):scan(mode==='discovery'?'DISCOVER':'CLICK'));await tick();assert.equal(mode==='read'?c.stopReads:0,mode==='read'?1:0);
});});
test('Stop after dispatched click but before route event releases only the event wait, never starts read',()=>setup(async c=>{
  c.setExecute(async code=>code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT?scan('DISCOVER'):scan('CLICK'));const pending=c.engine.start('profile');await tick();c.engine.stop();const value=await pending;assert.equal(value.summary.reason,'STOPPED');assert.equal(value.summary.click_count,1);assert.equal(c.reads,0);await tick();c.setExecute(async()=>scan('DISCOVER','NO_ELIGIBLE_TIMESTAMP'));assert.equal((await c.engine.start('profile')).summary.reason,'NO_ELIGIBLE_TIMESTAMP');
}));
test('fresh barrier or missing qualifying post completion cannot become an opened sample',async()=>{for(const mode of ['CHALLENGE','AUTH_REQUIRED','ACCESS_DENIED','missing-record'])await setup(async c=>{c.setRead(async()=>c.result(c.observation(),mode==='missing-record'?'SAMPLES_READY':mode));const value=await c.engine.start('profile');assert.equal(value.summary.result,'INCONCLUSIVE');assert.equal(value.summary.reason,mode==='missing-record'?'INSUFFICIENT_POST_EVIDENCE':mode);assert.equal(value.summary.body_sha256,null);});});
test('elapsed scan/navigation/read limits are enforced without retry',async()=>{for(const mode of ['scan','navigation','read'])await setup(async c=>{
  if(mode==='scan')c.setExecute(async()=>{c.advance(4000);return scan('DISCOVER');});if(mode==='navigation')c.setExecute(async code=>{if(code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT)return scan('DISCOVER');c.emit({kind:'SAME_DOCUMENT',url:post});c.setUrl(post);c.emit({kind:'SAME_DOCUMENT',url:post});c.advance(10000);return scan('CLICK');});if(mode==='read')c.setRead(async()=>{c.advance(4000);const r=c.observation();c.engine.observe(r);return c.result(r);});const value=await c.engine.start('profile');assert.equal(value.summary.result,'INCONCLUSIVE');assert.equal(value.summary.reason,mode==='scan'?'DISCOVERY_TIMEOUT':mode==='navigation'?'NAVIGATION_TIMEOUT':'READ_TIMEOUT');assert.ok(c.calls.length<=2);
});});
test('eligibility counters and shapes are bounded enum/count metadata and reject raw/coerced data',()=>{
  const value=scan('DISCOVER'),shape={record:'UNMATCHED',scope:'HEADER',rendered:'YES',visible_signal:'PASS',header_invalidation:'NONE',href_kind:'SEARCH_PLACEHOLDER',action:'NONE',viewport:'PASS',header:'COLOCATED',stage:'ELIGIBLE',...SEARCH_OPEN_PREFLIGHT_DEFAULTS,count:1};
  value.searchOpen.eligibility.shapes=[shape];assert.equal(validateSearchPostOpenScan(value,'DISCOVER').opening.eligibility.shapes[0]?.stage,'ELIGIBLE');
  for(const changed of [{...value.searchOpen.eligibility,shapes:Array.from({length:6},()=>shape)},{...value.searchOpen.eligibility,shapes:[{...shape,href:post}]},{...value.searchOpen.eligibility,shapes:[{...shape,stage:'PRIVATE'}]},{...value.searchOpen.eligibility,shapes:[{...shape,count:0}]},{...value.searchOpen.eligibility,counters:{...value.searchOpen.eligibility.counters,popup:'1'}},{...value.searchOpen.eligibility,counters:{...value.searchOpen.eligibility.counters,headers_seen:6}},{...value.searchOpen.eligibility,counters:{...value.searchOpen.eligibility.counters,records_seen:2501}},{...value.searchOpen.eligibility,counters:[]},{...value.searchOpen.eligibility,shapes_truncated:'true'}])assert.throws(()=>validateSearchPostOpenScan({...value,searchOpen:{...value.searchOpen,eligibility:changed}},'DISCOVER'),/INVALID_RESULT/);
  for(const changed of [{...shape,target_kind:'RAW_WINDOW_PRIVATE'},{...shape,pf_popup:true},{...shape,preflight:'PASS'},{...shape,pf_visibility:'PRIVATE'},{...shape,raw_target:'PRIVATE'}])assert.throws(()=>validateSearchPostOpenScan({...value,searchOpen:{...value.searchOpen,eligibility:{...value.searchOpen.eligibility,shapes:[changed]}}},'DISCOVER'),/INVALID_RESULT/);
});
test('target categories contain no raw name and do not normalize the action guard',()=>{
  for(const [value,expected] of [[null,'ABSENT'],['','EMPTY'],['_self','SELF'],['_SELF','SELF'],['_blank','BLANK'],['_top','TOP'],['_parent','PARENT'],['PRIVATE_WINDOW_42','NAMED'],['constructor','NAMED'],['__proto__','INVALID'],['bad target','INVALID'],['_other','INVALID'],['x'.repeat(161),'INVALID']] as const)assert.equal(classifySearchTargetKind(value),expected);
});
test('read-only preflight preserves partial facts and candidate state while marking shared budget exhaustion',()=>{
  for(const mode of ['complete','node','time','cache']){
    const out={visited:mode==='node'?2499:40,nodeLimit:false,timeLimit:false,diagnostics:{unchanged:true}},candidate=Object.freeze({visibilityUnknown:false,openVisibilityInvalidated:false}),clip=Object.freeze({left:-Infinity,top:-Infinity,right:Infinity,bottom:Infinity,unknownReason:'NONE',hidden:false});
    const target={firstChild:null,tagName:'A',getAttribute:(key:string)=>key==='target'?'_blank':null,hasAttribute:()=>false,querySelector:()=>null,getClientRects:()=>Array.from({length:9},()=>({left:1,top:1,right:2,bottom:2,width:1,height:1}))},clips=new WeakMap<object,unknown>();if(mode!=='cache')clips.set(target,clip);
    const state=runInNewContext('(()=>{'+SEARCH_OPEN_SETUP+'const shape={...defaults,stage:"NEW_WINDOW",header_invalidation:"NONE"};openBindings.push({unchanged:true});out.searchOpen.status="TARGETS_READY";openPreflight.push({shape,target,record:{text:"OPAQUE"},frames:new Map(),publicNode:{}});eligibilityShape(shape);finishEligibilityDiagnostics();return {shape,bindings:openBindings,status:out.searchOpen.status};})()',{
      out,searchOpenMode:'DISCOVER',cap:2500,end:1,performance:{now:()=>mode==='time'?1:0},classifyOpenTarget:classifySearchTargetKind,defaults:SEARCH_OPEN_PREFLIGHT_DEFAULTS,target,clipFrames:clips,innerWidth:100,innerHeight:100,layout:()=> 'RENDERED',attr:()=>'',norm:(value:string)=>value.toLowerCase(),visibleSignal:()=>{throw new Error('MUST_NOT_CALL');},textClip:()=>{throw new Error('MUST_NOT_CALL');}
    });
    assert.equal(state.shape.stage,'NEW_WINDOW');assert.equal(state.status,'TARGETS_READY');assert.equal(state.bindings.length,1);assert.equal(candidate.visibilityUnknown,false);assert.equal(candidate.openVisibilityInvalidated,false);assert.equal(out.nodeLimit,mode==='node');assert.equal(out.timeLimit,mode==='time');assert.ok(out.visited<=2500);assert.deepEqual(out.diagnostics,{unchanged:true});assert.equal(clip.unknownReason,'NONE');
    if(mode==='complete'){assert.equal(state.shape.preflight,'COMPLETE');assert.equal(state.shape.pf_visibility,'UNKNOWN');assert.equal(state.shape.pf_viewport,'RECT_LIMIT');}else{assert.equal(state.shape.preflight,'INCOMPLETE');if(mode==='node')assert.equal(out.visited,2500);if(mode==='time')assert.equal(state.shape.target_kind,'NOT_CHECKED');if(mode==='cache')assert.equal(state.shape.pf_visibility,'NOT_CHECKED');}
  }
});
test('FINISH blocks binding and native click when preflight or the final action boundary exhausts budget',()=>{
  for(const phase of ['DISCOVER','CLICK'])for(const mode of ['node','time','boundary']){
    let clock=0,clicks=0,observers=0;class Element {isConnected=true;tagName='A';getAttribute(){if(mode==='time')clock=1;return null;}hasAttribute(){return false;}querySelector(){return null;}getClientRects(){return[];}click(){clicks++;}}
    const target=new Element(),root=new Element(),header={},pub={},body={},document={},location={href:search},binding={target,root,header,publicNode:pub,body,href:'OBSERVED',descriptor:{index:0,href_kind:'SEARCH_PLACEHOLDER',timestamp_proof:'UNIQUE_HEADER_PLACEHOLDER'}},out={visited:mode==='node'?2499:40,nodeLimit:false,timeLimit:false,barriers:{state:'CLEAR'}};
    if(mode==='boundary'&&phase==='CLICK')Object.defineProperty(target,'isConnected',{get(){clock=1;return true;}});
    const observer=class{constructor(){observers++;}takeRecords(){return[];}disconnect(){}observe(){if(mode==='boundary')clock=1;}};
    const state=runInNewContext('(()=>{'+SEARCH_OPEN_SETUP+'const shape={...defaults,stage:"ELIGIBLE",header_invalidation:"NONE"};openBindings.push(binding);eligibilityCount("eligible_records");eligibilityCount("headers_bound");eligibilityShape(shape);'+(mode==='boundary'?'':'openPreflight.push({shape,target,record:{text:"OPAQUE"},frames:new Map(),publicNode:{}});')+SEARCH_OPEN_FINISH+'})()',{
      out,searchOpenMode:phase,cap:2500,end:1,performance:{now:()=>clock},classifyOpenTarget:classifySearchTargetKind,defaults:SEARCH_OPEN_PREFLIGHT_DEFAULTS,target,binding,document,location,HTMLElement:Element,MutationObserver:observer,clipFrames:new WeakMap(),innerWidth:100,innerHeight:100,layout:()=> 'RENDERED',attr:()=>'',norm:(value:string)=>value.toLowerCase(),__csdObservedSearchPostOpenV1:{document,url:search,bindings:[binding],stale:false,observer:null}
    });
    assert.equal(state.searchOpen.status,'SCAN_INCOMPLETE');assert.equal(state.searchOpen.click_count,0);assert.equal(state.searchOpen.selected_index,null);assert.equal(clicks,0);assert.equal(state.searchOpen.targets.length,1);assert.equal(state.searchOpen.eligibility.counters.eligible_records,1);assert.equal(state.searchOpen.eligibility.shapes[0].stage,'ELIGIBLE');assert.equal(state.nodeLimit,mode==='node');assert.equal(state.timeLimit,mode!=='node');if(mode!=='boundary')assert.equal(observers,0);
  }
});

// Complete-script synthetic DOM helper adapted from the existing review fixture.
// Synthetic DOM only. These tests execute both complete fixed scripts in one isolated VM.
const headerBox = { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
const headerSearch = 'https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';
class HeaderElement {
  nodeType = 1; nodeValue = ''; parentElement: HeaderElement | null = null; children: HeaderElement[] = [];
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  hidden = false; clicks = 0;
  onClick: (() => void) | undefined;
  constructor(public tagName: string, public attrs: Record<string,string> = {}) {}
  getAttribute(key: string) { return this.attrs[key] ?? null; }
  hasAttribute(key: string) { return Object.hasOwn(this.attrs, key); }
  get localName() { return this.tagName.toLowerCase(); }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value, namespaceURI: null })); }
  get childNodes() { return this.children; }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.children.map(child => child.textContent).join(''); }
  getClientRects() { return this.hidden ? [] : [headerBox]; }
  getBoundingClientRect() { return headerBox; }
  get clientLeft() { return 0; } get clientTop() { return 0; }
  get clientWidth() { return headerBox.width; } get clientHeight() { return headerBox.height; }
  get childElementCount() { return this.children.filter(node => node.nodeType === 1).length; }
  get firstElementChild(): HeaderElement | null { return this.children.find(node => node.nodeType === 1) ?? null; }
  get nextElementSibling(): HeaderElement | null {
    const siblings = this.parentElement?.children.filter(node => node.nodeType === 1) ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get isConnected(): boolean { return this.tagName === 'BODY' || !!this.parentElement?.isConnected; }
  contains(other: HeaderElement): boolean { return this === other || this.children.some(child => child.contains(other)); }
  querySelector(selector: string): HeaderElement | null { return headerAll(this).find(node => headerMatches(node, selector)) ?? null; }
  click() { this.clicks++; this.onClick?.(); }
}
function headerAll(root: HeaderElement): HeaderElement[] { return root.children.flatMap(child => [child, ...headerAll(child)]); }
function headerSimple(node: HeaderElement, selector: string): boolean {
  const match = /^([a-z][a-z0-9]*)?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(selector);
  assert.ok(match, 'unsupported headerFixture selector: ' + selector);
  return node.nodeType === 1 && (!match[1] || node.tagName === match[1].toUpperCase()) &&
    (!match[2] || (match[3] === undefined ? node.hasAttribute(match[2]) : node.getAttribute(match[2]) === match[3]));
}
function headerMatches(node: HeaderElement, selector: string): boolean {
  return selector.split(',').some(part => {
    if (!headerSimple(node, part.split(':not(')[0]!)) return false;
    for (const match of part.matchAll(/:not\(([^)]+)\)/g)) {
      const value = match[1]!;
      if (value.endsWith(' *')) { for (let p = node.parentElement; p; p = p.parentElement) if (headerSimple(p, value.slice(0, -2))) return false; }
      else if (headerSimple(node, value)) return false;
    }
    return true;
  });
}
function headerElement(tag: string, attrs: Record<string,string> = {}, children: HeaderElement[] = []) {
  const node = new HeaderElement(tag, attrs); node.children = children;
  for (const child of children) child.parentElement = node;
  return node;
}
function headerText(value: string) { const node = new HeaderElement('#headerText'); node.nodeType = 3; node.nodeValue = value; return node; }
function svgElement(tag: string, attrs: Record<string,string> = {}, children: HeaderElement[] = []) {
  const node = headerElement(tag, attrs, children); node.namespaceURI = 'http://www.w3.org/2000/svg'; return node;
}
function svgClock() { return svgElement('SVG', { width: '100', height: '20', viewBox: '0 0 100 20' }, [svgElement('TEXT', { x: '0', y: '15' }, [svgElement('TSPAN', {}, [headerText('opaque-clock')])])]); }
function setChildren(parent: HeaderElement, children: HeaderElement[]) { parent.children = children; for (const child of children) child.parentElement = parent; }
function headerFixture(attrs: Record<string,string> = {}, targetText = 'obfuscated-clock', second = false) {
  const target = headerElement('A', { href: '/search/top/?__cft__[0]=headerFixture&__tn__=headerFixture', ...attrs }, [headerText(targetText)]);
  const header = headerElement('HEADER', {}, [headerElement('H3', {}, [headerText('SYNTHETIC_GROUP_HEADING')]), target,
    ...(second ? [headerElement('A', { href: '/search/top/?__tn__=second' }, [headerText('another-clock')])] : []),
    headerElement('SPAN', { 'aria-label': 'Đã chia sẻ với Nhóm công khai' })]);
  const root = headerElement('DIV', {}, [header, headerElement('DIV', { 'data-ad-preview': 'message' }, [headerText('SYNTHETIC_CAFE_BODY')])]);
  const body = headerElement('BODY', {}, [headerElement('MAIN', {}, [headerElement('DIV', { role: 'feed' }, [root])])]);
  const document = {
    body, querySelector: (selector: string) => body.querySelector(selector),
    evaluate(expression: string, context: unknown, _resolver: unknown, type: number) {
      assert.equal(context, document); assert.equal(type, 7);
      assert.equal(expression, '(//input[@type="password" or @autocomplete="one-time-code" or @name="approvals_code"] | //iframe[contains(@src,"/recaptcha/")] | //dialog | //*[@role="dialog" or @role="alert"])[position() <= 17]');
      return { snapshotLength: 0, snapshotItem: () => null };
    },
    createRange() { let selected: HeaderElement | null = null; return { selectNodeContents(node: HeaderElement) { selected = node; }, detach() {}, getClientRects() { return selected?.nodeValue ? [headerBox] : []; } }; },
    createTreeWalker(rootNode: HeaderElement, _mask: number, filter: { acceptNode(node: HeaderElement): number }) {
      const queue = [...rootNode.children]; return { nextNode() { while (queue.length) { const node = queue.shift()!; if (filter.acceptNode(node) === 2) continue; queue.unshift(...node.children); return node; } return null; } };
    }
  };
  class Observer { constructor(_callback: () => void) {} observe() {} disconnect() {} takeRecords() { return []; } }
  const context = createContext({ URL, location: { href: headerSearch }, document, HTMLElement: HeaderElement, MutationObserver: Observer,
    innerWidth: 1000, innerHeight: 800, performance: { now: () => 0 },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', clip: 'auto', clipPath: 'none', transform: 'none', position: 'static' }),
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 } });
  return { target, header, root, context };
}
function headerRunPair(f = headerFixture()) {
  const discovery = runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT, f.context, { timeout: 2000 });
  const click = runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT, f.context, { timeout: 2000 });
  return { discovery, click, clicks: f.target.clicks };
}

// Native fixtures below complement this model with actual SVG glyph rectangles and observers.
Object.defineProperties(HeaderElement.prototype,{
  firstChild:{get(this:HeaderElement){return this.children[0]||null;}},
  nextSibling:{get(this:HeaderElement){const list=this.parentElement?.children||[];return list[list.indexOf(this)+1]||null;}},
  attributes:{get(this:HeaderElement){return Object.entries(this.attrs).map(([name,value])=>({name,value,namespaceURI:null}));}},
  localName:{get(this:HeaderElement){return this.tagName.toLowerCase();}},
  namespaceURI:{get(this:HeaderElement):string{return ['SVG','G','TEXT','TSPAN','IMAGE','USE','FOREIGNOBJECT','PATH'].includes(this.tagName)||(this.parentElement as unknown as {namespaceURI?:string})?.namespaceURI==='http://www.w3.org/2000/svg'?'http://www.w3.org/2000/svg':'http://www.w3.org/1999/xhtml';}}
});
function postHeaderFixture(content:HeaderElement[]=[headerText('opaque clock')],attrs:Record<string,string>={}){
  const f=headerFixture({href:'/groups/123/posts/90071992547409931234/',...attrs});f.target.children=content;for(const node of content)node.parentElement=f.target;
  const original=f.context.getComputedStyle as ()=>Record<string,string>;f.context.getComputedStyle=()=>({...original(),fill:'rgb(0, 0, 0)',fillOpacity:'1',stroke:'none',filter:'none',maskImage:'none',backgroundImage:'none'});return f;
}
const svgHeaderText=()=>svgElement('SVG',{width:'120',height:'24',viewBox:'0 0 120 24'},[svgElement('TEXT',{x:'0',y:'18'},[svgElement('TSPAN',{},[headerText('opaque clock')])])]);
test('complete scripts bind a unique observed header post link without inventing temporal evidence',()=>{
  for(const content of [[headerText('opaque clock')],[svgHeaderText()]]){const f=postHeaderFixture(content),{discovery,click,clicks}=headerRunPair(f);assert.equal(discovery.searchOpen.status,'TARGETS_READY');assert.equal(discovery.searchOpen.targets[0].timestamp_proof,'UNIQUE_HEADER_POST_LINK');assert.equal(click.searchOpen.status,'CLICK_DISPATCHED');assert.equal(clicks,1);assert.equal(discovery.samples[0].published_at,null);assert.equal(discovery.searchOpen.eligibility.shapes.find((s:Record<string,unknown>)=>s.stage==='ELIGIBLE').subtree_kind,content[0]?.tagName==='SVG'?'SVG_TEXT_ONLY':'NONE');validateSearchPostOpenScan(discovery,'DISCOVER');}
});
test('complete scripts reject ambiguous, author, popup and unsupported observed-link subtrees',()=>{
  const bad=[headerElement('IMG'),headerElement('SVG',{},[headerElement('IMAGE',{href:'https://example.test/PRIVATE'})]),headerElement('SVG',{},[headerElement('FOREIGNOBJECT')]),headerElement('SVG',{},[headerElement('USE',{href:'#PRIVATE'})]),headerElement('SVG',{},[headerElement('PATH',{d:'M0 0'})]),headerElement('BUTTON'),headerElement('H4'),headerElement('CUSTOM-ELEMENT'),headerElement('SVG',{},[headerElement('A',{href:'/groups/123/posts/2/'})])];
  for(const node of bad){const f=postHeaderFixture([node]);assert.equal(headerRunPair(f).clicks,0);}
  for(const attrs of [{rel:'author'},{'aria-haspopup':'true'},{target:'_blank'}]){const f=postHeaderFixture([svgHeaderText()],attrs),r=headerRunPair(f);assert.equal(r.clicks,0);const shape=r.discovery.searchOpen.eligibility.shapes.find((s:Record<string,unknown>)=>s.href_kind==='OBSERVED_POST');assert.equal(shape.pf_subtree_kind,'SVG_TEXT_ONLY');}
  const f=postHeaderFixture([svgHeaderText()]),second=headerElement('A',{href:'/groups/123/posts/90071992547409931234/'},[headerText('another opaque clock')]);second.parentElement=f.header;f.header.children.push(second);assert.equal(headerRunPair(f).discovery.searchOpen.status,'AMBIGUOUS_TIMESTAMP');assert.equal(f.target.clicks,0);
});
test('complete scripts preserve observed-link raw binding, viewport and hard-budget guards',()=>{
  for(const change of ['node','href','subtree','viewport','rects','deadline']){const f=postHeaderFixture([svgHeaderText()]);const d=runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,f.context,{timeout:2000});assert.equal(d.searchOpen.status,'TARGETS_READY');
    if(change==='node'){const next=headerElement('A',{...f.target.attrs},[headerText('opaque')]);next.parentElement=f.header;f.header.children[f.header.children.indexOf(f.target)]=next;}
    if(change==='href')f.target.attrs.href='/groups/123/posts/999/';
    if(change==='subtree'){f.target.children.push(headerElement('BUTTON'));f.target.children.at(-1)!.parentElement=f.target;}
    if(change==='viewport')f.target.getClientRects=()=>[{...headerBox,left:-100,right:-1}];
    if(change==='rects')f.target.getClientRects=()=>Array.from({length:9},()=>({...headerBox}));
    if(change==='deadline'){let now=0,reads=0;f.context.performance={now:()=>now};const original=f.target.getAttribute.bind(f.target);f.target.getAttribute=key=>{if(key==='target'&&++reads===2)now=1000;return original(key);};}
    const c=runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT,f.context,{timeout:2000});assert.notEqual(c.searchOpen.status,'CLICK_DISPATCHED');assert.equal(f.target.clicks,0);}
});
test('subtree classifier bounds and SVG references fail closed in complete scripts',()=>{
  const variants=[()=>{const s=svgHeaderText();s.attrs.style='fill:url(https://example.test/PRIVATE)';return[s];},()=>{const s=svgHeaderText();s.attrs.onclick='PRIVATE';return[s];},()=>{const s=svgHeaderText();Object.defineProperty(s,'attributes',{get:()=>[{name:'fill',value:'currentColor',namespaceURI:'urn:unknown'}]});return[s];},()=>Array.from({length:33},()=>headerElement('SPAN')),()=>[headerText('x'.repeat(161))],()=>{let n=headerElement('SPAN');for(let i=0;i<9;i++)n=headerElement('SPAN',{},[n]);return[n];}];
  for(const make of variants){const f=postHeaderFixture(make()),r=headerRunPair(f);assert.equal(r.clicks,0);assert.ok(r.discovery.searchOpen.eligibility.shapes.some((s:Record<string,unknown>)=>['INCOMPLETE','SVG_OTHER'].includes(String(s.subtree_kind)))||r.discovery.rejected.INCOMPLETE_BOUNDARY===1);assert.equal(JSON.stringify(r.discovery.searchOpen).includes('PRIVATE'),false);
    const kind=runInNewContext('(()=>{'+SEARCH_OPEN_SETUP+'return classifyOpenSubtree(target);})()',{out:{visited:0,nodeLimit:false,timeLimit:false},searchOpenMode:'DISCOVER',cap:2500,end:1,performance:{now:()=>0},target:f.target,clipFrames:new WeakMap(),getComputedStyle:f.context.getComputedStyle,innerWidth:1000,innerHeight:800});assert.ok(['INCOMPLETE','SVG_OTHER'].includes(kind));}
  const valid=scan('DISCOVER');valid.searchOpen.targets=[{index:0,href_kind:'OBSERVED_POST',timestamp_proof:'UNIQUE_HEADER_POST_LINK'}];assert.equal(validateSearchPostOpenScan(valid,'DISCOVER').opening.targets[0]?.timestamp_proof,'UNIQUE_HEADER_POST_LINK');assert.throws(()=>validateSearchPostOpenScan({...valid,searchOpen:{...valid.searchOpen,targets:[{...valid.searchOpen.targets[0],href_kind:'SEARCH_PLACEHOLDER'}]}},'DISCOVER'),/INVALID_RESULT/);
});
test('complete observed SVG scripts stop at the shared node cap without dispatch',()=>{
  const f=postHeaderFixture([svgHeaderText()]),body=f.root.children[1]!;for(let i=0;i<812;i++){const node=headerElement('SPAN');node.parentElement=body;body.children.push(node);}
  for(const code of [FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,FACEBOOK_SEARCH_POST_CLICK_SCRIPT]){const scan=runInContext(code,f.context,{timeout:2000});assert.equal(scan.visited,2500);assert.equal(scan.nodeLimit,true);assert.equal(scan.searchOpen.status,'SCAN_INCOMPLETE');assert.equal(scan.searchOpen.click_count,0);assert.equal(f.target.clicks,0);}
});
test('computed SVG fill must have positive alpha in a supported bounded color before proving ink',()=>{
  const cases:[string,boolean][]=[['rgb(0, 0, 0)',true],['rgb(255, 255, 255)',true],['rgba(0, 0, 0, 0.5)',true],['rgba(1, 2, 3, 1)',true],['rgba(0, 0, 0, .001)',true],['rgba(0, 0, 0, 0)',false],['rgba(255, 255, 255, 0)',false],['rgba(0, 0, 0, 0.0)',false],['transparent',false],['none',false],['currentColor',false],['#000',false],['color(srgb 0 0 0 / 0)',false],['rgb(0 0 0 / 0)',false],['rgb(0, 0, 0, 0)',false],['rgba(0, 0, 0)',false],['rgba(0, 0, 0, 2)',false],['rgba(0, 0, 0, -1)',false],['rgb(999, 0, 0)',false],['rgb(NaN, 0, 0)',false],['x'.repeat(97),false]];
  for(const [fill,allowed] of cases){const f=postHeaderFixture([svgHeaderText()]),normal=f.context.getComputedStyle as (node:HeaderElement)=>Record<string,string>;f.context.getComputedStyle=(node:HeaderElement)=>({...normal(node),...(['TEXT','TSPAN'].includes(node.tagName)?{fill}:{})});const {discovery,clicks}=headerRunPair(f);assert.equal(clicks,allowed?1:0,fill);const shape=discovery.searchOpen.eligibility.shapes.find((s:Record<string,unknown>)=>s.href_kind==='OBSERVED_POST');assert.equal(shape.subtree_kind,allowed?'SVG_TEXT_ONLY':'SVG_OTHER',fill);}
});
test('raw target policy rejects named targets at 160/161 and a target mutation before click',()=>{
  for(const length of [160,161,2048]){const value='n'.repeat(length),f=postHeaderFixture([svgHeaderText()],{target:value}),r=headerRunPair(f);assert.equal(r.clicks,0);assert.equal(r.discovery.searchOpen.targets.length,0);const shape=r.discovery.searchOpen.eligibility.shapes.find((s:Record<string,unknown>)=>s.href_kind==='OBSERVED_POST');assert.equal(shape.stage,'NEW_WINDOW');assert.equal(shape.target_kind,length===160?'NAMED':'INVALID');assert.equal(JSON.stringify(r.discovery.searchOpen).includes(value),false);}
  const f=postHeaderFixture([svgHeaderText()]);assert.equal(runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,f.context,{timeout:2000}).searchOpen.status,'TARGETS_READY');f.target.attrs.target='n'.repeat(161);const c=runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT,f.context,{timeout:2000});assert.equal(c.searchOpen.status,'STALE_TARGET');assert.equal(f.target.clicks,0);
});
test('subtree first failpoint names are closed and preserve the v23 eligibility decision',()=>{
  const baseline=JSON.parse(readFileSync(resolve('tests/fixtures/facebook-search-open-v23-scripts.json'),'utf8')) as {discovery:string};
  const cases:[()=>HeaderElement,string,string,string,string][]=[
    [()=>headerElement('DIV',{},[headerText('opaque')]),'HTML_TAG','DIV','NONE','D1'],
    [()=>headerElement('SPAN',{class:'fixture','aria-hidden':'false',id:'PRIVATE_ID'},[headerText('opaque')]),'ATTR_NOT_ALLOWED','SPAN','ARIA_HIDDEN','D1'],
    [()=>headerElement('SPAN',{'aria-label':'PRIVATE_VALUE'},[headerText('opaque')]),'ATTR_NOT_ALLOWED','SPAN','ARIA_LABEL','D1'],
    [()=>headerElement('SPAN',{'aria-describedby':'PRIVATE_ID'},[headerText('opaque')]),'ATTR_NOT_ALLOWED','SPAN','ARIA_OTHER','D1'],
    [()=>headerElement('SPAN',{'data-private':'PRIVATE_VALUE'},[headerText('opaque')]),'ATTR_NOT_ALLOWED','SPAN','DATA_ATTR','D1'],
    [()=>headerElement('PRIVATE-WRAPPER',{},[headerText('opaque')]),'HTML_TAG','OTHER','NONE','D1'],
    [()=>{const n=svgHeaderText();n.attrs.style='PRIVATE_VALUE';return n;},'ATTR_NOT_ALLOWED','SVG','STYLE','D1'],
    [()=>{const n=svgHeaderText();n.namespaceURI='urn:private';return n;},'SVG_NAMESPACE','SVG','NONE','D1']
  ];
  const projection=(s:Record<string,any>)=>JSON.parse(JSON.stringify({status:s.status,node:s.nodeLimit,time:s.timeLimit,targets:s.searchOpen.targets,statusOpen:s.searchOpen.status,counters:s.searchOpen.eligibility.counters}));
  for(const [make,reason,tag,attr,depth] of cases)for(const blank of [false,true]){const f=postHeaderFixture([make()],blank?{target:'_blank'}:{}),before=runInContext(baseline.discovery,f.context,{timeout:2000}),r=headerRunPair(f);assert.deepEqual(projection(r.discovery),projection(before));assert.equal(r.clicks,0);const shape=r.discovery.searchOpen.eligibility.shapes.find((s:Record<string,unknown>)=>s.href_kind==='OBSERVED_POST'),prefix=blank?'pf_subtree':'subtree';assert.equal(shape[prefix+'_reason'],reason);assert.equal(shape[prefix+'_tag'],tag);assert.equal(shape[prefix+'_attr'],attr);assert.equal(shape[prefix+'_depth'],depth);assert.equal(JSON.stringify(r.discovery.searchOpen).includes('PRIVATE'),false);if(blank)assert.equal(shape.subtree_reason,'NOT_CHECKED');}
});
test('subtree incomplete and budget reasons retain bounded locations without granting action',()=>{
  const f=postHeaderFixture(Array.from({length:33},()=>headerElement('SPAN'))),detail=runInNewContext('(()=>{'+SEARCH_OPEN_SETUP+'const detail={};const kind=classifyOpenSubtree(target,detail);return{kind,detail,out};})()',{out:{visited:0,nodeLimit:false,timeLimit:false},searchOpenMode:'DISCOVER',cap:2500,end:1,performance:{now:()=>0},target:f.target,clipFrames:new WeakMap(),getComputedStyle:f.context.getComputedStyle,innerWidth:1000,innerHeight:800});assert.equal(detail.kind,'INCOMPLETE');assert.equal(detail.detail.reason,'NODE_LIMIT');assert.equal(detail.detail.depth,'D1');
  const value=scan('DISCOVER'),shape={record:'UNMATCHED',scope:'HEADER',rendered:'YES',visible_signal:'PASS',header_invalidation:'NONE',href_kind:'OBSERVED_POST',action:'MEDIA_OR_HEADING',viewport:'NOT_CHECKED',header:'NOT_CHECKED',stage:'MEDIA_OR_HEADING',...SEARCH_OPEN_PREFLIGHT_DEFAULTS,count:1};
  for(const changed of [{...shape,subtree_tag:'PRIVATE_TAG'},{...shape,pf_subtree_attr:'data-private-name'},{...shape,subtree_depth:'D99'},{...shape,pf_subtree_reason:'PRIVATE_REASON'}])assert.throws(()=>validateSearchPostOpenScan({...value,searchOpen:{...value.searchOpen,eligibility:{...value.searchOpen.eligibility,shapes:[changed]}}},'DISCOVER'),/INVALID_RESULT/);
});
test('passive SPAN aria-labelledby never dereferences or supplies proof and still checks every descendant',()=>{
  for(const content of [[headerText('opaque')],[svgHeaderText()]])for(const label of ['PRIVATE_ID','PUBLIC_TIME_PRIVATE_ID OTHER_PRIVATE_ID','', 'x'.repeat(160)]){const span=headerElement('SPAN',{'aria-labelledby':label},content),f=postHeaderFixture([span]);(f.context.document as {getElementById?:()=>never}).getElementById=()=>{throw new Error('MUST_NOT_DEREFERENCE_IDREF');};const r=headerRunPair(f);assert.equal(r.clicks,1);assert.equal(r.discovery.searchOpen.targets[0].timestamp_proof,'UNIQUE_HEADER_POST_LINK');assert.equal(r.discovery.samples[0].published_at,null);assert.equal(JSON.stringify(r.discovery.searchOpen).includes('PRIVATE_ID'),false);}
  const bad=[headerElement('IMG'),headerElement('BUTTON'),headerElement('PRIVATE-TAG'),headerElement('SPAN',{role:'button'}),svgElement('SVG',{},[svgElement('IMAGE',{href:'#PRIVATE_ID'})])];
  for(const node of bad){const f=postHeaderFixture([headerElement('SPAN',{'aria-labelledby':'PRIVATE_ID'},[node])]);assert.equal(headerRunPair(f).clicks,0);}
  for(const mode of ['hidden','transparent','unknown-attribute','long-value','blank']){const attrs:Record<string,string>={'aria-labelledby':mode==='long-value'?'x'.repeat(161):'PRIVATE_ID'};if(mode==='hidden')attrs.hidden='';if(mode==='unknown-attribute')attrs['aria-describedby']='PRIVATE_ID';const f=postHeaderFixture([headerElement('SPAN',attrs,[svgHeaderText()])],mode==='blank'?{target:'_blank'}:{});if(mode==='transparent'){const normal=f.context.getComputedStyle as ()=>Record<string,string>;f.context.getComputedStyle=()=>({...normal(),fill:'rgba(0, 0, 0, 0)'});}assert.equal(headerRunPair(f).clicks,0,mode);}
});
test('passive aria wrappers preserve attribute-count, node/deadline and native binding fences',()=>{
  const span=headerElement('SPAN',{'aria-labelledby':'PRIVATE_ID'},[svgHeaderText()]),f=postHeaderFixture([span]);assert.equal(runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,f.context,{timeout:2000}).searchOpen.status,'TARGETS_READY');span.attrs['aria-labelledby']='OTHER_PRIVATE_ID';const saved=(f.context as Record<string,any>).__csdObservedSearchPostOpenV1;saved.observer.takeRecords=()=>[{}];assert.equal(runInContext(FACEBOOK_SEARCH_POST_CLICK_SCRIPT,f.context,{timeout:2000}).searchOpen.status,'STALE_TARGET');assert.equal(f.target.clicks,0);
  const many:Record<string,string>={'aria-labelledby':'PRIVATE_ID'};for(let i=0;i<12;i++)many['data-private-'+i]='PRIVATE_VALUE';assert.equal(headerRunPair(postHeaderFixture([headerElement('SPAN',many,[headerText('opaque')])])).clicks,0);
  for(const mode of ['node','time']){const g=postHeaderFixture([headerElement('SPAN',{'aria-labelledby':'PRIVATE_ID'},[svgHeaderText()])]);if(mode==='node'){const body=g.root.children[1]!;for(let i=0;i<812;i++){const n=headerElement('SPAN');n.parentElement=body;body.children.push(n);}}else{let now=0,reads=0;g.context.performance={now:()=>now};const original=g.target.getAttribute.bind(g.target);g.target.getAttribute=key=>{if(key==='target'&&++reads===2)now=1000;return original(key);};}const d=runInContext(FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,g.context,{timeout:2000});assert.equal(d.searchOpen.status,'SCAN_INCOMPLETE');assert.equal(g.target.clicks,0);}
});


const observedUrl='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234&hoisted_section_header_type=recently_seen&__cft__[0]=FIXTURE&__tn__=FIXTURE';
function observedScan(phase:'DISCOVER'|'REVALIDATE',status=phase==='DISCOVER'?'TARGETS_READY':'URL_REVALIDATED'){const value=scan(phase==='DISCOVER'?'DISCOVER':'CLICK',status);Object.assign(value.searchOpen,{version:6,phase,click_count:0,selected_index:status==='URL_REVALIDATED'?0:null,observed_url:status==='URL_REVALIDATED'?observedUrl:null});value.searchOpen.targets=['TARGETS_READY','URL_REVALIDATED','STALE_TARGET'].includes(status)?[{index:0,href_kind:'OBSERVED_POST',timestamp_proof:'BOUND_HEADER_GROUP_QUERY_URL'}]:[];return value;}
test('observed GROUP_QUERY tracking parser is shared, bounded and never reconstructs the navigation URL',()=>{
  assert.equal(resolveObservedGroupQueryHref(observedUrl,search,inspectCurrentGroupPostRoute),observedUrl);assert.equal(inspectCurrentGroupPostRoute(observedUrl)?.observed_route,post);assert.equal(inspectCurrentGroupPostRoute(observedUrl.replace('__cft__[0]','__cft__%5B0%5D'))?.observed_route,post);
  const bad=[observedUrl+'#post',observedUrl.replace('__cft__[0]','__CFT__%5B0%5D'),observedUrl+'&multi_permalinks=2',observedUrl+'&__cft__%5B0%5D=duplicate',observedUrl.replace('__cft__[0]','%5F%5Fcft__%5B0%5D'),observedUrl.replace('=FIXTURE&__tn__','='+('x'.repeat(513))+'&__tn__'),observedUrl.replace('multi_permalinks=90071992547409931234','multi_permalinks=%39'+'0071992547409931234'),observedUrl.replace('www.facebook.com','www.facebook.com:443'),observedUrl.replace('/groups/123/','/groups/123/./'),observedUrl+'&unknown=x','https://m.facebook.com/groups/123/?multi_permalinks=1','/groups/123/posts/456/','/search/top?__tn__=FIXTURE'];for(const url of bad)assert.equal(resolveObservedGroupQueryHref(url,search,inspectCurrentGroupPostRoute),null,url);
});
test('URL fixed scripts separate decorated header identity from presentation and consume binding without a click',()=>{
  const targetContent=headerElement('SPAN',{'aria-labelledby':'PRIVATE_ID',style:'color:red'},[svgHeaderText()]),f=postHeaderFixture([targetContent],{href:observedUrl});const d=runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,f.context,{timeout:2000});assert.equal(d.searchOpen.status,'TARGETS_READY');assert.equal(d.searchOpen.targets[0].timestamp_proof,'BOUND_HEADER_GROUP_QUERY_URL');const shape=d.searchOpen.eligibility.shapes.find((s:Record<string,unknown>)=>s.stage==='ELIGIBLE');assert.equal(shape.subtree_kind,'NOT_CHECKED');assert.equal(shape.pf_subtree_reason,'ATTR_NOT_ALLOWED');assert.equal(shape.pf_subtree_attr,'STYLE');assert.equal(shape.url_semantics,'CLEAR');
  const v=runInContext(FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT,f.context,{timeout:2000}),clean=validateSearchPostOpenScan(v,'REVALIDATE',true);assert.equal(v.searchOpen.status,'URL_REVALIDATED');assert.equal(clean.observedUrl,observedUrl);assert.equal(JSON.stringify(clean.opening).includes(observedUrl),false);assert.equal(f.target.clicks,0);assert.equal(runInContext(FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT,f.context,{timeout:2000}).searchOpen.status,'STALE_TARGET');
  for(const attrs of [{href:'/search/top?__tn__=x'},{href:'/groups/123/posts/456/'},{href:observedUrl,target:'_blank'},{href:observedUrl,rel:'author'},{href:observedUrl,rel:'author '+('x'.repeat(161))},{href:observedUrl,role:'button '+('x'.repeat(161))},{href:observedUrl,'aria-haspopup':'true'}]){const g=postHeaderFixture([headerText('opaque')],attrs);assert.equal(runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,g.context,{timeout:2000}).searchOpen.targets.length,0);assert.equal(g.target.clicks,0);}
  for(const child of [headerElement('IMG'),headerElement('BUTTON'),headerElement('A',{href:observedUrl}),headerElement('SPAN',{role:'button'})]){const g=postHeaderFixture([child],{href:observedUrl});assert.equal(runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,g.context,{timeout:2000}).searchOpen.targets.length,0);}
});
test('bound URL controller performs one exact navigation and a fresh read with no raw URL in summary',()=>setup(async c=>{
  const value=await c.engine.start('profile');assert.equal(value.summary.result,'OPENED_POST_SAMPLE');assert.equal(value.summary.reason,'BOUND_OBSERVED_URL_AND_FRESH_POST_READ');assert.equal(value.summary.click_count,0);assert.equal(value.summary.click_attempt_count,0);assert.equal((value.summary as Record<string,unknown>).navigation_count,1);assert.equal(c.reads,1);assert.deepEqual(c.navigationUrls,[observedUrl]);assert.deepEqual(c.calls,[FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT]);for(const secret of [observedUrl,'90071992547409931234','FIXTURE','profile'])assert.equal(JSON.stringify(value.summary).includes(secret),secret==='FIXTURE');const proof=JSON.parse(readFileSync(join(value.directory,'candidates.json'),'utf8'));assert.equal(proof.observed_navigation_url,observedUrl);assert.equal(proof.observed_post_route.observed_route,post);
},true));
test('URL owner, route, generation, stale or unsupported revalidation blocks navigation before dispatch',async()=>{for(const mode of ['owner','route','generation','stale','invalid-url','cross-origin'])await setup(async c=>{
  c.setExecute(async code=>{if(code===FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT)return observedScan('DISCOVER');if(mode==='owner')c.replace();if(mode==='route')c.setUrl(search+'&ref=changed');if(mode==='generation')c.commit();const value=observedScan('REVALIDATE',mode==='stale'?'STALE_TARGET':'URL_REVALIDATED') as Record<string,any>;if(mode==='invalid-url')value.searchOpen.observed_url='/groups/123/posts/456/';if(mode==='cross-origin')value.searchOpen.observed_url=observedUrl.replace('www.facebook.com','m.facebook.com');return value;});const result=await c.engine.start('profile');assert.equal(result.summary.result,'INCONCLUSIVE');assert.equal(c.navigationUrls.length,0);assert.equal(c.reads,0);
},true);});
test('URL full-navigation guard rejects redirect, raw swap, SPA, missing commit and extra start',async()=>{for(const mode of ['redirect','raw-swap','spa','no-commit','extra-start'])await setup(async c=>{
  c.setNavigate(async()=>{if(mode==='redirect'){c.emit({kind:'REDIRECT',url:observedUrl});return;}if(mode==='spa'){c.setUrl(observedUrl);c.emit({kind:'SAME_DOCUMENT',url:observedUrl});return;}c.emit({kind:'START',url:observedUrl});if(mode==='extra-start')c.emit({kind:'START',url:observedUrl});if(mode==='no-commit'){c.engine.stop();return;}c.commit();c.setUrl(mode==='raw-swap'?observedUrl+'&ref=changed':observedUrl);c.emit({kind:'COMMIT',url:mode==='raw-swap'?observedUrl+'&ref=changed':observedUrl});});const value=await c.engine.start('profile');assert.equal(value.summary.result,'INCONCLUSIVE');assert.equal(c.navigationUrls.length,1);assert.equal(c.reads,0);
},true);});
test('URL Stop during revalidation or native navigation retains pending capacity and drops late work',async()=>{for(const mode of ['revalidation','navigation'])await setup(async c=>{
  let finish:(value?:unknown)=>void=()=>{};if(mode==='revalidation')c.setExecute(async code=>code===FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT?observedScan('DISCOVER'):new Promise(resolve=>{finish=resolve;}));else c.setNavigate(()=>new Promise<void>(resolve=>{finish=()=>resolve();}));const pending=c.engine.start('profile');await tick();c.engine.stop();const result=await pending;assert.equal(result.summary.reason,'STOPPED');assert.equal(c.reads,0);assert.equal(c.navigationUrls.length,mode==='navigation'?1:0);await assert.rejects(()=>c.engine.start('profile'),/BUSY/);finish(observedScan('REVALIDATE'));await tick();assert.equal(c.reads,0);
},true);});
test('URL fixed scans at the shared node cap never return a dispatchable private URL',()=>{
  const f=postHeaderFixture([headerElement('SPAN',{style:'color:red'},[svgHeaderText()])],{href:observedUrl}),body=f.root.children[1]!;for(let i=0;i<812;i++){const node=headerElement('SPAN');node.parentElement=body;body.children.push(node);}for(const code of [FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT]){const value=runInContext(code,f.context,{timeout:2000});assert.equal(value.visited,2500);assert.equal(value.nodeLimit,true);assert.equal(value.searchOpen.status,'SCAN_INCOMPLETE');assert.equal(value.searchOpen.observed_url,null);assert.equal(value.searchOpen.click_count,0);assert.equal(f.target.clicks,0);}
});
test('R-URL1 standard interactive descendant and ancestor roles cannot borrow observed URL identity',()=>{
  for(const role of SEARCH_OPEN_URL_INTERACTIVE_ROLES){const f=postHeaderFixture([headerElement('SPAN',{role},[headerText('opaque')])],{href:observedUrl});const d=runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,f.context,{timeout:2000});assert.equal(d.searchOpen.targets.length,0,role);assert.equal(f.target.clicks,0);}
  for(const role of ['menuitem','combobox','slider']){const f=postHeaderFixture([headerText('opaque')],{href:observedUrl}),index=f.header.children.indexOf(f.target),wrapper=headerElement('SPAN',{role},[f.target]);wrapper.parentElement=f.header;f.header.children[index]=wrapper;const d=runInContext(FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,f.context,{timeout:2000});assert.equal(d.searchOpen.targets.length,0,role);assert.equal(f.target.clicks,0);}
});
