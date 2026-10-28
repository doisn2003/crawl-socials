import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as tick } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createDomReportSink, createFacebookDomDiagnostic, facebookDomCaptureMode, inspectDomRoute, validateDomResult, DOM_LIMITS } from '../src/main/facebook-dom-diagnostic.js';
import type { DomResult, DomTarget } from '../src/main/facebook-dom-diagnostic.js';
import { FACEBOOK_DOM_SCRIPT } from '../src/main/facebook-dom-diagnostic-script.js';
const url = 'https://www.facebook.com/search/posts/?q=cafe%20H%C3%A0%20N%E1%BB%99i&token=private-token';
const link = () => ({post:1,group:0,page:0,profile:0,facebookOther:0,external:0,unsupported:0});
const payload = (): DomResult => ({version:2,status:'HEURISTIC_MATCH',route:'SEARCH_POSTS',queryMatched:true,visited:20,elementCount:12,textNodes:8,
  articleRoots:1,feedRoots:1,mainRoots:1,pageletMarkers:0,nodeLimit:false,timeLimit:false,links:link(),
  root:{kind:'MAIN_TAG',probes:3,candidates:1,cap:3,enumeration:'FIRST_PER_SELECTOR',verified:false},scan:'COMPLETE',pruned:0,barrierProbes:3,postLinkSamples:[],ancestorSteps:0,
  cards:[{kind:'ROLE_ARTICLE',textNodes:3,textSize:'MEDIUM',timeHint:true,publicLabelHints:1,restrictedLabelHints:0,seeMoreHint:true,links:link()}]});
async function setup(work: (ctx: ReturnType<typeof create>) => Promise<void> | void) {
  const root = mkdtempSync(join(tmpdir(),'csd-dom-unit-'));
  try { await work(create(root)); }
  finally { assert.ok(resolve(root).startsWith(resolve(tmpdir(),'csd-dom-unit-'))); rmSync(root,{recursive:true,force:true}); }
}
function create(root: string) {
  const data=join(root,'data'),workspace=join(root,'workspace');mkdirSync(data);mkdirSync(workspace);
  let loss: (()=>void) | null=null, calls=0, active=0, now=Date.now(), mono=0, currentUrl=url;
  let read: ()=>Promise<unknown> = async()=>payload();
  let target: DomTarget | null = {webContentsId:7,viewGeneration:1,url:()=>currentUrl,
    execute: async code=>{assert.equal(code,FACEBOOK_DOM_SCRIPT);calls++;return read();},
    watchLoss: callback=>{loss=callback;active++;return()=>{active--;loss=null;};}};
  const engine=createFacebookDomDiagnostic({resolve:()=>target,sink:createDomReportSink(data,workspace),mode:'FIXTURE',now:()=>now,mono:()=>mono});
  return {engine,data,workspace,get calls(){return calls;},get active(){return active;},
    setRead(fn:()=>Promise<unknown>){read=fn;},setTarget(value:DomTarget|null){target=value;},lose(){loss?.();},
    setUrl(value:string){currentUrl=value;},
    advance(ms:number){now+=ms;mono+=ms;},backward(){now--;},
  };
}
test('scope checks allow only exact Posts and observed Top routes for the fixed query',()=>{
  assert.equal(inspectDomRoute(url),'OK');
  assert.equal(inspectDomRoute(url.replace('/posts/','/top/')),'OK');
  assert.equal(inspectDomRoute(url.replace('/posts/','/top')),'OK');
  for(const route of ['people','groups','pages','videos','posts/other','top/other','topology'])assert.equal(inspectDomRoute(url.replace('/posts/',`/${route}/`)),'UNSUPPORTED_ROUTE');
  for(const bad of ['https://facebook.com.attacker.test/search/posts/?q=cafe','http://www.facebook.com/search/posts/?q=cafe',
    'https://www.facebook.com/feed/','https://www.facebook.com/search/posts/','https://www.facebook.com/search/posts/?q=other',url+'&q=other'])assert.notEqual(inspectDomRoute(bad),'OK');
  assert.equal(inspectDomRoute('https://www.facebook.com/two_step_verification/?token=private-token'),'AUTH_REQUIRED');
});
test('mixed search metadata stays SEARCH_TOP_MIXED and cannot be relabeled Posts by native output',()=>setup(async ctx=>{
  ctx.setUrl(url.replace('/posts/','/top/'));ctx.setRead(async()=>({...payload(),route:'SEARCH_TOP_MIXED'}));
  const mixed=await ctx.engine.start('p');
  assert.equal(mixed.report.status,'HEURISTIC_MATCH');assert.equal(mixed.report.result?.route,'SEARCH_TOP_MIXED');
  assert.equal(mixed.report.verified_valid_count,0);assert.equal(mixed.report.candidates_collected,0);
  assert.equal(mixed.report.platform_permission,'UNKNOWN');assert.ok(mixed.report.missing_fields.includes('SOURCE_TYPE_UNVERIFIED'));
  ctx.setRead(async()=>payload());
  const mislabeled=await ctx.engine.start('p');assert.equal(mislabeled.report.status,'INVALID_RESULT');assert.equal(mislabeled.report.result,null);
  ctx.setRead(async()=>({...payload(),route:'SEARCH_TOP_MIXED',status:'NO_MATCH',articleRoots:0,cards:[]}));
  const empty=await ctx.engine.start('p');assert.equal(empty.report.status,'NO_MATCH');assert.equal(empty.report.result?.route,'SEARCH_TOP_MIXED');
}));
test('LIVE and FIXTURE modes cannot be combined with each other or unrelated smoke runs',()=>{
  assert.equal(facebookDomCaptureMode([]),null);
  assert.equal(facebookDomCaptureMode(['--csd-facebook-dom-diagnostic']),'LIVE');
  assert.equal(facebookDomCaptureMode(['--csd-facebook-dom-fixture']),'FIXTURE');
  const smoke=['--csd-smoke','--csd-session-smoke','--csd-observer-smoke','--csd-probe-smoke','--csd-policy-smoke','--csd-auth-dependency-smoke'];
  for(const flag of smoke)for(const dom of ['--csd-facebook-dom-diagnostic','--csd-facebook-dom-fixture'])assert.throws(()=>facebookDomCaptureMode([dom,flag]),/ARGUMENTS_INVALID/);
  assert.throws(()=>facebookDomCaptureMode(['--csd-facebook-dom-diagnostic','--csd-facebook-dom-fixture']),/ARGUMENTS_INVALID/);
});
test('main validator rejects unknown raw fields, enum coercion, excessive nodes/cards and payload-size tricks',()=>{
  assert.equal(validateDomResult(payload()).cards.length,1);
  for(const bad of [{...payload(),rawText:'private-name'},{...payload(),status:['HEURISTIC_MATCH']},{...payload(),visited:2501},
    {...payload(),route:'SEARCH_OTHER'},{...payload(),elementCount:20},{...payload(),feedRoots:21},
    {...payload(),cards:Array.from({length:6},()=>payload().cards[0])},{...payload(),cards:[{...payload().cards[0],name:'private-name'}]}])assert.throws(()=>validateDomResult(bad),/INVALID_RESULT/);
  const result=validateDomResult(payload());result.cards[0]!.links.post=99;assert.equal(payload().cards[0]!.links.post,1);
});
test('v2 schema bounds root probes and ancestor samples and rejects old/raw/deeper payloads',()=>{
  const ancestor={tag:'DIV',role:'NONE',children:'FEW',pagelet:true,label:true,atRoot:false};
  const linkShape={...payload(),status:'POST_LINK_STRUCTURE',articleRoots:0,cards:[],postLinkSamples:[{kind:'POST_LIKE_LINK',depthLimit:true,ancestors:Array.from({length:8},()=>({...ancestor}))}],ancestorSteps:8};
  assert.equal(validateDomResult(linkShape).postLinkSamples[0]?.ancestors.length,8);
  for(const bad of [{...payload(),version:1},{...payload(),scan:'BARRIER_STOP'},{...payload(),root:{...payload().root,probes:4}},
    {...payload(),root:{...payload().root,verified:true}},
    {...linkShape,ancestorSteps:41},{...linkShape,postLinkSamples:Array.from({length:6},()=>linkShape.postLinkSamples[0])},
    {...linkShape,postLinkSamples:[{...linkShape.postLinkSamples[0],ancestors:Array.from({length:9},()=>ancestor)}]},
    {...linkShape,postLinkSamples:[{...linkShape.postLinkSamples[0],ancestors:[{...ancestor,href:'private-id'}]}]}])assert.throws(()=>validateDomResult(bad),/INVALID_RESULT/);
});
test('fixed script guards forbidden root self matches and distinguishes body fallback from node-cap partial scan',()=>{
  function run(nodes:number,post:boolean,unsafeProbe=false){
    const body={nodeType:1,tagName:'BODY',parentElement:null,childElementCount:nodes,hidden:false,getAttribute:()=>null,hasAttribute:()=>false};
    const unsafeRoot={...body,tagName:'NAV',getAttribute:(key:string)=>key==='role'?'main':null};
    const entries=Array.from({length:nodes},(_,i)=>({nodeType:1,tagName:post&&i===0?'A':'SPAN',parentElement:body,childElementCount:0,hidden:false,
      getAttribute:(key:string)=>key==='href'&&post&&i===0?'/private-person/posts/private-id/?token=private-token':null}));
    const value=runInNewContext(FACEBOOK_DOM_SCRIPT,{URL,location:{href:url},performance:{now:()=>0},
      NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},document:{body,querySelector:(selector:string)=>unsafeProbe&&(selector.startsWith('main')||selector.startsWith('[role='))?unsafeRoot:null,
        createTreeWalker:(_root:unknown,_mask:unknown,filter:{acceptNode:(node:unknown)=>number})=>{let index=0;return{nextNode(){while(index<entries.length){const node=entries[index++];if(filter.acceptNode(node)===1)return node;}return null;}};}}},{timeout:1000});
    return validateDomResult(value);
  }
  const fallback=run(1,true);assert.equal(fallback.root.kind,'BODY_FALLBACK');assert.equal(fallback.root.candidates,0);
  assert.equal(fallback.status,'POST_LINK_STRUCTURE');assert.equal(fallback.scan,'COMPLETE');assert.equal(fallback.postLinkSamples[0]?.ancestors[0]?.tag,'BODY');
  assert.equal(JSON.stringify(fallback).includes('private'),false);
  const guarded=run(1,true,true);assert.equal(guarded.root.kind,'BODY_FALLBACK');assert.equal(guarded.root.candidates,0);
  const partial=run(2600,false);assert.equal(partial.root.kind,'BODY_FALLBACK');assert.equal(partial.scan,'PARTIAL');
  assert.equal(partial.status,'NO_MATCH');assert.equal(partial.visited,2500);assert.equal(partial.nodeLimit,true);
});
test('fixed read produces bounded FIXTURE metadata/provenance, with no raw profile/query/URL/name and no public claim',()=>setup(async ctx=>{
  const result=await ctx.engine.start('private-profile-id');
  assert.equal(result.report.capture_mode,'FIXTURE');assert.equal(result.report.diagnostic_only,true);assert.equal(result.report.platform_permission,'UNKNOWN');
  assert.equal(result.report.verified_valid_count,0);assert.equal(result.report.actions,1);assert.equal(ctx.calls,1);assert.equal(ctx.active,0);
  const files=readdirSync(result.directory);assert.deepEqual(files.sort(),['result.json','started.json']);
  const text=files.map(name=>readFileSync(join(result.directory,name),'utf8')).join('');
  assert.equal(text.includes('private'),false);assert.equal(text.includes('https://'),false);assert.equal(text.includes('public:true'),false);
  assert.ok(Buffer.byteLength(text)<=DOM_LIMITS.bytes);assert.equal(result.report.script_sha256.length,64);assert.equal(result.report.code_sha256.length,64);
  assert.equal(result.sha256,createHash('sha256').update(readFileSync(join(result.directory,'result.json'))).digest('hex'));
}));
test('maximum combined article and link-ancestor samples fit the existing total report byte cap',()=>setup(async ctx=>{
  const full=payload();full.visited=2500;full.elementCount=2000;full.textNodes=500;full.articleRoots=5;full.links.post=5;
  full.cards=Array.from({length:5},()=>payload().cards[0]!);
  full.postLinkSamples=Array.from({length:5},()=>({kind:'POST_LIKE_LINK',depthLimit:true,ancestors:Array.from({length:8},()=>({tag:'DIV',role:'group',children:'MANY',pagelet:true,label:true,atRoot:false}))}));
  full.ancestorSteps=40;ctx.setRead(async()=>full);const value=await ctx.engine.start('p');
  assert.equal(value.report.status,'HEURISTIC_MATCH');assert.equal(value.report.result?.ancestorSteps,40);
  const bytes=readdirSync(value.directory).reduce((sum,name)=>sum+readFileSync(join(value.directory,name)).byteLength,0);
  assert.ok(bytes<=DOM_LIMITS.bytes);
}));
test('route/auth preflight never invokes source script and active/foreign owner fails closed',()=>setup(async ctx=>{
  ctx.setTarget({webContentsId:7,viewGeneration:1,url:()=> 'https://www.facebook.com/login/',execute:async()=>{throw new Error('must not execute');},watchLoss:()=>()=>{}});
  assert.equal((await ctx.engine.start('p')).report.status,'AUTH_REQUIRED');assert.equal(ctx.calls,0);
  ctx.setTarget(null);assert.equal((await ctx.engine.start('p')).report.status,'OWNER_CHANGED');
}));
test('Stop cancels an outstanding read, holds native capacity, and late data cannot overwrite final output',()=>setup(async ctx=>{
  let release!: (value:unknown)=>void;ctx.setRead(()=>new Promise(resolve=>{release=resolve;}));
  const pending=ctx.engine.start('p');await tick();await assert.rejects(ctx.engine.start('p'),/BUSY/);ctx.engine.stop();
  const stopped=await pending;assert.equal(stopped.report.status,'STOPPED');assert.equal(stopped.report.result,null);assert.equal(ctx.active,0);
  const before=readFileSync(join(stopped.directory,'result.json'),'utf8');await assert.rejects(ctx.engine.start('p'),/BUSY/);
  release({...payload(),rawText:'private-name'});await tick();assert.equal(readFileSync(join(stopped.directory,'result.json'),'utf8'),before);
}));
test('owner loss/late generation results are discarded and detached',()=>setup(async ctx=>{
  let release!: (value:unknown)=>void;ctx.setRead(()=>new Promise(resolve=>{release=resolve;}));
  const pending=ctx.engine.start('p');await tick();ctx.lose();const result=await pending;
  assert.equal(result.report.status,'OWNER_CHANGED');assert.equal(result.report.result,null);assert.equal(ctx.active,0);release(payload());await tick();
}));
test('deadline and backward clock reject completed reads; malformed native output is never persisted',async()=>{
  for(const behavior of ['deadline','late','backward','malformed'])await setup(async ctx=>{
    ctx.setRead(async()=>{if(behavior==='deadline')ctx.advance(DOM_LIMITS.runMs);if(behavior==='late')ctx.advance(DOM_LIMITS.readMs+1);if(behavior==='backward')ctx.backward();return behavior==='malformed'?{...payload(),token:'private-secret'}:payload();});
    const result=await ctx.engine.start('p');assert.equal(result.report.status,behavior==='deadline'?'DEADLINE':behavior==='late'?'READ_TIMEOUT':behavior==='backward'?'CLOCK_UNCERTAIN':'INVALID_RESULT');
    assert.equal(result.report.result,null);assert.equal(readFileSync(join(result.directory,'result.json'),'utf8').includes('private-secret'),false);
  });
});
test('read timeout finalizes without waiting forever and prevents accumulating native reads',()=>setup(async ctx=>{
  ctx.setRead(()=>new Promise(()=>{}));const result=await ctx.engine.start('p');
  assert.equal(result.report.status,'READ_TIMEOUT');assert.equal(result.report.result,null);assert.equal(ctx.active,0);
  await assert.rejects(ctx.engine.start('p'),/BUSY/);
}));
test('three process reads maximum and output cannot be placed in repository',()=>setup(async ctx=>{
  for(let i=0;i<3;i++)await ctx.engine.start('p');await assert.rejects(ctx.engine.start('p'),/PROCESS_READ_LIMIT/);
  assert.throws(()=>createDomReportSink(ctx.workspace,ctx.workspace),/ROOT_DENIED/);
}));
