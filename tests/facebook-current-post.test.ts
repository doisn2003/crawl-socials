import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as tick } from 'node:timers/promises';
import { inspectCurrentGroupPostRoute } from '../src/main/facebook-public-candidate-fields.js';
import { FACEBOOK_CURRENT_POST_SCRIPT } from '../src/main/facebook-public-candidate-script.js';
import { createFacebookPublicCandidateProbe,createPublicCandidateSink,validatePublicCandidateResult } from '../src/main/facebook-public-candidate.js';
import type { DomTarget } from '../src/main/facebook-dom-diagnostic.js';

const url='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234',id='90071992547409931234';
type Node={nodeType:number;tagName:string;nodeValue:string;parentElement:Node|null;children:Node[];hidden:boolean;getAttribute:(key:string)=>string|null;getClientRects:()=>unknown[];contains:(other:Node)=>boolean};
function fixture(mode='positive'){
  const rect={left:0,top:0,right:100,bottom:20,width:100,height:20};
  function node(tag:string,attrs:Record<string,string>={},text=''):Node{const n:Node={nodeType:tag==='#text'?3:1,tagName:tag,nodeValue:text,parentElement:null,children:[],hidden:false,getAttribute:key=>attrs[key]||null,getClientRects:()=>[rect],contains(other){return other===n||n.children.some(c=>c.contains(other));}};return n;}
  function add(parent:Node,...children:Node[]){for(const child of children){parent.children.push(child);child.parentElement=parent;}return parent;}
  const body=node('BODY'),wrapper=add(body,node('DIV',{role:'dialog'})).children[0]!,dialog=add(wrapper,node('DIV',{role:'dialog'})).children[0]!;
  const title=add(dialog,add(node('H2'),node('#text',{},'DIALOG_TITLE_PRIVATE'))),article=add(dialog,node('ARTICLE')).children[1]!;
  const header=add(article,node('HEADER')).children[0]!,heading=add(header,add(node('H3'),node('#text',{},'AUTHOR_PRIVATE')));
  const pub=node('SPAN',{'aria-label':mode==='private'?'Đã chia sẻ với Nhóm riêng tư':mode==='generic'?'Public':'Đã chia sẻ với Nhóm công khai'});if(mode!=='missing')add(header,pub);
  const message=add(article,add(node('DIV',{'data-ad-preview':'message'}),node('#text',{},'COFFEE_BODY sample@example.test'))).children[1]!;
  add(article,add(node('DIV',{role:'comment'}),add(node('H3'),node('#text',{},'COMMENT_AUTHOR_PRIVATE')),add(node('TIME'),node('#text',{},'2 giờ')),node('A',{href:'/groups/123/posts/888/'}),add(node('DIV',{'data-ad-preview':'message'}),node('#text',{},'COMMENT_BODY_PRIVATE'))));
  if(mode==='headerOutside'){header.children=header.children.filter(n=>n!==pub);dialog.children.splice(1,0,pub);pub.parentElement=dialog;}
  if(mode==='bodyOutside'){article.children=article.children.filter(n=>n!==message);add(dialog,message);}
  if(mode==='body2')add(article,add(node('DIV',{'data-ad-preview':'message'}),node('#text',{},'SECOND_PRIVATE')));
  if(mode==='dialogs2')add(body,node('DIV',{role:'dialog'}));
  if(mode==='wrapperBody')add(wrapper,node('DIV',{'data-ad-preview':'message'}));
  if(mode==='wrapperHeading')add(wrapper,node('H3'));
  if(mode==='wrapperText')add(wrapper,node('#text',{},'UNRELATED_OVERLAY_PRIVATE'));
  if(mode==='nested')add(message,add(node('BLOCKQUOTE'),node('DIV',{'data-ad-preview':'message'})));
  if(mode==='identityConflict')add(header,node('A',{href:'/groups/123/posts/999/'}));
  if(mode==='nodeCap')for(let i=0;i<1400;i++)add(message,node('SPAN'));
  if(mode==='wrapperCap')for(let i=0;i<130;i++)add(wrapper,node('SPAN'));
  const security:Node[]=[];
  if(mode==='securityCap')for(let i=0;i<17;i++){const n=node('INPUT',{type:'password'});n.hidden=true;security.push(add(body,n).children.at(-1)!);}
  if(mode==='auth')security.push(add(body,node('INPUT',{type:'password'})).children.at(-1)!);
  if(mode==='denied')security.push(add(wrapper,node('#text',{},'Access denied')).children.at(-1)!);
  if(mode==='challenge')security.push(add(body,node('#text',{},'Confirm your identity')).children.at(-1)!);
  function descendants(root:Node):Node[]{return root.children.flatMap(c=>[c,...descendants(c)]);}
  const doc={body,evaluate:(xpath:string)=>{const list=xpath.includes('//input')?security:descendants(body).filter(n=>n.getAttribute('role')==='dialog'||n.getAttribute('role')==='alert');return{snapshotLength:mode==='dialogCap'&&!xpath.includes('//input')?17:list.length,snapshotItem:(i:number)=>list[i]};},
    createRange:()=>({selectNodeContents(){},getClientRects:()=>[rect],detach(){}}),createTreeWalker:(root:Node,_mask:number,filter:{acceptNode:(n:Node)=>number})=>{let pending=[...root.children];return{nextNode(){while(pending.length){const n=pending.shift()!;if(filter.acceptNode(n)!==2){pending.unshift(...n.children);return n;}}return null;}};}};
  let timeReads=0;const raw=runInNewContext(FACEBOOK_CURRENT_POST_SCRIPT,{URL,location:{href:url},document:doc,innerWidth:200,innerHeight:200,performance:{now:()=>mode==='timeCap'&&timeReads++>0?2000:0},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:1500});
  void title;void heading;return JSON.parse(JSON.stringify(raw));
}
test('current group route retains observed string IDs and strips only allowed tracking',()=>{
  const parsed=inspectCurrentGroupPostRoute(url+'&hoisted_section_header_type=recently_seen');assert.equal(parsed?.post_id,id);assert.equal(parsed?.observed_route,url);assert.equal(parsed?.verification,'UNVERIFIED');
  for(const bad of [url+'&multi_permalinks=2',url.replace(id,id+',2'),url.replace(id,id+'%2C2'),url.replace(id,'%39'+id.slice(1)),url.replace('multi_permalinks','%6dulti_permalinks'),url+'&unknown_scope=all',url+'&ref=a&ref=b',url+'#post',url.replace('www.facebook.com','facebook.com.attacker.test'),url.replace('https:','http:'),url.replace('www.facebook.com','user@www.facebook.com'),url.replace('www.facebook.com','www.facebook.com:443'),url.replace('/groups/123/','/groups/123/./'),url.replace('/groups/123/','/groups/123/posts/'),url.replace('/groups/123/','/groups/%31%32%33/'),url.replace('123','9'.repeat(33)),url.replace(id,'9'.repeat(33))])assert.equal(inspectCurrentGroupPostRoute(bad),null,bad);
});
test('one bounded post dialog produces body and separate unverified context without comment data',()=>{
  const raw=fixture(),result=validatePublicCandidateResult(raw,true),sample=result.samples[0]!;assert.equal(result.samples.length,1);assert.equal(result.context?.wrapperDialogs,1);assert.equal(result.context_hint?.post_id,id);assert.equal(sample.text,'COFFEE_BODY [EMAIL]');assert.equal(sample.boundary,'POST_DIALOG_HEADER_PUBLIC_OPTIONAL_TIME');assert.equal(sample.metadata.headings,2);assert.equal(sample.metadata.temporal,0);assert.equal(sample.post_id,null);assert.equal(sample.published_at,null);assert.equal(sample.source_type,'UNKNOWN');assert.equal(sample.boundary_verified,false);assert.equal(JSON.stringify(result).includes('COMMENT_'),false);
  assert.throws(()=>validatePublicCandidateResult(raw),/INVALID_RESULT/);
});
test('post dialog guards reject independent dialogs, wrapper content, private/missing public, ambiguous bodies and nested stories',()=>{
  for(const mode of ['dialogs2','wrapperBody','wrapperHeading','wrapperText','private','missing','generic','body2','nested','identityConflict','headerOutside','bodyOutside']){const result=validatePublicCandidateResult(fixture(mode),true);assert.equal(result.samples.length,0,mode);assert.equal(result.context_hint,null,mode);}
});
test('security markers outside the current post remain prior barriers',()=>{
  for(const [mode,status] of [['auth','AUTH_REQUIRED'],['challenge','CHALLENGE'],['denied','ACCESS_DENIED']]){const result=validatePublicCandidateResult(fixture(mode),true);assert.equal(result.status,status);assert.equal(result.samples.length,0);assert.equal(result.context_hint,null);assert.equal(result.barriers.visible,1);}
});
test('dialog sentinel, wrapper work, global node and script-time caps fail closed',()=>{
  for(const mode of ['securityCap','dialogCap','wrapperCap','nodeCap','timeCap']){const result=validatePublicCandidateResult(fixture(mode),true);assert.equal(result.samples.length,0,mode);assert.equal(result.context_hint,null);assert.ok(result.visited<=2500);if(mode==='nodeCap')assert.equal(result.nodeLimit,true);else assert.equal(result.status,'BARRIER_SCAN_INCOMPLETE',mode);}
});
test('post schema binds hints to a single current context and rejects forged provenance or extra raw fields',()=>{
  const raw=fixture();for(const bad of [{...raw,context_hint:{...raw.context_hint,verification:'VERIFIED'}},{...raw,context_hint:{...raw.context_hint,post_id:'2'}},{...raw,context_hint:{...raw.context_hint,observed_route:url+'&ref=tracking'}},{...raw,context:{...raw.context,raw:'PRIVATE'}},{...raw,context:{...raw.context,publicGroupSignals:0}},{...raw,context:{...raw.context,visibleDialogs:3}},{...raw,samples:[...raw.samples,...raw.samples]},{...raw,context_hint:null},{...raw,samples:[]},{...raw,version:13}])assert.throws(()=>validatePublicCandidateResult(bad,true),/INVALID_RESULT/);
});
async function lifecycle(action:string){
  const root=mkdtempSync(join(tmpdir(),'csd-current-post-'));try{
    const data=join(root,'data'),workspace=join(root,'workspace');mkdirSync(data);mkdirSync(workspace);let current=url,loss=()=>{},resolveNative:(value:unknown)=>void=()=>{},calls=0;
    const target:DomTarget={webContentsId:1,viewGeneration:1,url:()=>current,watchLoss:cb=>{loss=cb;return()=>{loss=()=>{};};},execute:code=>{assert.equal(code,FACEBOOK_CURRENT_POST_SCRIPT);calls++;return new Promise(resolve=>{resolveNative=resolve;});}};
    const probe=createFacebookPublicCandidateProbe({resolve:()=>target,sink:createPublicCandidateSink(data,workspace),mode:'FIXTURE',context:'CURRENT_GROUP_POST'});
    const pending=probe.start('profile');await tick();if(action==='stop')probe.stop();else if(action==='loss')loss();else if(action==='route')current=url.replace(id,'2');
    if(action==='stop'||action==='loss'){const result=await pending;assert.equal(result.summary.status,action==='stop'?'STOPPED':'OWNER_CHANGED');assert.equal(result.summary.candidate_count,0);assert.equal(JSON.stringify(result).includes(id),false);await assert.rejects(()=>probe.start('profile'),/BUSY/);resolveNative(fixture());await tick();assert.equal(JSON.parse(readFileSync(join(result.directory,'candidates.json'),'utf8')).context_hint,null);}
    else{resolveNative(fixture());const result=await pending;assert.equal(result.summary.status,action==='route'?'OWNER_CHANGED':'SAMPLES_READY');assert.equal(calls,1);assert.equal(JSON.stringify(result.summary).includes(id),false);assert.equal(JSON.stringify(result.summary).includes('COFFEE_BODY'),false);assert.equal(result.summary.limits.candidates,1);assert.equal(result.summary.verified_valid_count,0);assert.equal(result.summary.platform_permission,'UNKNOWN');assert.equal(result.summary.benchmark_eligible,false);}
  }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir(),'csd-current-post-')));rmSync(root,{recursive:true,force:true});}
}
test('post lifecycle stores context hints only in local payload and summary remains sanitized',()=>lifecycle('positive'));
test('post Stop drops late payload and keeps native capacity until settlement',()=>lifecycle('stop'));
test('post ownership loss drops late payload and keeps native capacity until settlement',()=>lifecycle('loss'));
test('a changed observed post ID drops a native return',()=>lifecycle('route'));
test('only a clean qualifying current-post completion emits a main anchor record after both artifacts are durable',async()=>{
  const root=mkdtempSync(join(tmpdir(),'csd-current-anchor-'));try{
    const data=join(root,'data'),workspace=join(root,'workspace');mkdirSync(data);mkdirSync(workspace);
    for(const kind of ['clean','node','time','local','grouping','multiple-public','ambiguous','auth']){
      const raw=fixture(kind==='ambiguous'?'body2':kind==='auth'?'auth':'positive');if(kind==='node'){raw.nodeLimit=true;raw.visited=2500;}if(kind==='time')raw.timeLimit=true;if(kind==='local')raw.diagnostics.layout.localIncomplete=1;if(kind==='grouping')raw.diagnostics.messages.groupingIncomplete=1;if(kind==='multiple-public')raw.context.publicGroupSignals=2;
      let observed=0;const engine=createFacebookPublicCandidateProbe({resolve:()=>({webContentsId:1,viewGeneration:1,url:()=>url,execute:async()=>raw,watchLoss:()=>()=>{}}),sink:createPublicCandidateSink(data,workspace),mode:'FIXTURE',context:'CURRENT_GROUP_POST',onCurrentPost:record=>{
        observed++;assert.equal(record.profile_id,'profile');assert.equal(record.context_hint.verification,'UNVERIFIED');for(const [file,expected] of [['candidates.json',record.candidate_file_sha256],['summary.json',record.summary_sha256]])assert.equal(createHash('sha256').update(readFileSync(join(data,'public-candidate-diagnostics',record.run_id,file!))).digest('hex'),expected);
      }});await engine.start('profile');assert.equal(observed,kind==='clean'?1:0,kind);
    }
  }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir(),'csd-current-anchor-')));rmSync(root,{recursive:true,force:true});}
});
