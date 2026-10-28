import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as tick } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { canonicalCandidateLink,redactCandidateText,classifyHeaderTemporal } from '../src/main/facebook-public-candidate-fields.js';
import { createFacebookPublicCandidateProbe,createPublicCandidateSink,validatePublicCandidateResult } from '../src/main/facebook-public-candidate.js';
import type { PublicCandidateResult } from '../src/main/facebook-public-candidate.js';
import type { DomTarget } from '../src/main/facebook-dom-diagnostic.js';
import { facebookDomCaptureMode } from '../src/main/facebook-dom-diagnostic.js';
import { FACEBOOK_PUBLIC_CANDIDATE_SCRIPT } from '../src/main/facebook-public-candidate-script.js';
const id='90071992547409931234',url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i&token=PRIVATE';
const layout=()=>({contents:0,boxless:0,hidden:0,textRanges:0,textRangeMisses:0,textParentBoxes:0,textRangePositive:0,textZeroArea:0,textClipped:0,textUnknown:0,textSeparators:0,textClipChecks:0,textUnknownApi:0,textUnknownRect:0,textUnknownAncestor:0,textUnknownClip:0,textUnknownPartial:0,clipCacheHits:0,clipAncestorSteps:0,clipAncestorMisses:0,clipPropagations:0,localIncomplete:0,clipFullX:0,clipFullY:0,clipPartialX:0,clipPartialY:0,clipMixed:0,clipEmptyLegacy:0,clipEmptyInset:0,clipLegacyInactive:0,auxiliaryOmitted:0,negativeScopes:0,negativeUnresolved:0,negativeVetoes:0});
const messages=()=>({markers:0,groups:0,nestedAliases:0,nestedUnresolved:0,sibling:0,disjoint:0,nestedDirect:0,nestedShallow:0,nestedDeep:0});
const temporalShape=()=>({links:0,roleLinks:0,controls:0,labelMatches:0,directMatches:0,nestedMatches:0,splitMatches:0,controlMatches:0,unmatched:0,textLimits:0,recordLimits:0,charLimits:0,textNodeLimits:0,probeLimits:0,scopeMisses:0,emptyText:0,classifierMisses:0,rangeSegments:0,rangeChars:0,zeroSegments:0,clippedSegments:0,unknownSegments:0,controlSkipped:0,probeNodes:0,date:0,relative:0,dayWord:0,abbreviated:0,quoteExcluded:0,headingExcluded:0,bodyExcluded:0,hiddenSkipped:0});
const clearBarriers=()=>({state:'CLEAR' as const,reason:'NONE' as const,kind:'NONE' as const,evidence:'NONE' as const,inspected:0,hidden:0,empty:0,visible:0,descendants:0,ancestors:0,overflow:false});
const payload=():PublicCandidateResult=>({version:13,status:'SAMPLES_READY',route:'SEARCH_TOP_MIXED',root:'FEED_IN_MAIN',visited:30,examined:1,pruned:0,nodeLimit:false,timeLimit:false,candidateLimit:false,boundaryLimit:false,
  barriers:clearBarriers(),
  diagnostics:{layout:layout(),messages:{...messages(),groupingIncomplete:0,depthLimits:0},headers:{deepHints:0,clustersFound:0,ancestorLimits:0,publicClustersFound:0,treeNodes:0,treeEdges:0,ancestryCuts:0,treeIncomplete:0,publicLabelsSeen:0,publicSignalsAccepted:0,publicControlsPruned:0},temporal:temporalShape()},
  selection:{firstFeedFound:true,feedLandmarks:true,fallbackUsed:false,feedExamined:1,mainExamined:0,coLocationMisses:0,fallbackScan:'NOT_USED',discoveryHints:{headings:0,temporal:0,publicLabels:0,restrictedLabels:0,messageRegions:0,articles:0,outsideFeed:0}},rejectionShapes:[],geometryShapes:[],
  rejected:{NO_FEED:0,NOT_RENDERED:0,NO_HEADER:0,NO_TEMPORAL:0,MISSING_PUBLIC:0,RESTRICTED:0,CONFLICTING_PUBLIC:0,AD_OR_SUGGESTION:0,AMBIGUOUS_BOUNDARY:0,INCOMPLETE_BOUNDARY:0,DUPLICATE_ID:0,NO_COLOCATED_BOUNDARY:0,NO_HEADER_CLUSTER:0},
  samples:[{boundary:'FEED_CHILD_HEADER_TEMPORAL',boundary_verified:false,public_signal:'DIRECT_PUBLIC_LABEL',source_type:'UNKNOWN',post_id:id,permalink:'https://www.facebook.com/owner/posts/'+id+'/',published_at:null,text:'PUBLIC_COFFEE_BODY',text_status:'VISIBLE_SNIPPET',contacts_redacted:false,missing_fields:['BOUNDARY_HEURISTIC','SOURCE_TYPE_UNVERIFIED','PUBLICITY_NOT_INDEPENDENTLY_VERIFIED'],metadata:{headings:1,temporal:1,temporalStatus:'OBSERVED',headerProof:'HEADING_TEMPORAL_PUBLIC',auxiliaryTextOmitted:false,publicLabels:1,restrictedLabels:0,messageRegions:1,links:{post:1,group:0,profile:0,other:0,external:0},timeTag:true,abbr:false,ariaTemporal:false}}]});
async function setup(work:(ctx:ReturnType<typeof create>)=>Promise<void>|void){const root=mkdtempSync(join(tmpdir(),'csd-candidate-unit-'));try{await work(create(root));}finally{assert.ok(resolve(root).startsWith(resolve(tmpdir(),'csd-candidate-unit-')));rmSync(root,{recursive:true,force:true});}}
function create(root:string){const data=join(root,'data'),workspace=join(root,'workspace');mkdirSync(data);mkdirSync(workspace);let now=Date.now(),mono=0,loss:(()=>void)|null=null,read:()=>Promise<unknown>=async()=>payload(),active=0;
  let target:DomTarget|null={webContentsId:5,viewGeneration:1,url:()=>url,execute:async code=>{assert.equal(code,FACEBOOK_PUBLIC_CANDIDATE_SCRIPT);return read();},watchLoss:cb=>{loss=cb;active++;return()=>{loss=null;active--;};}};
  const engine=createFacebookPublicCandidateProbe({resolve:()=>target,sink:createPublicCandidateSink(data,workspace),mode:'FIXTURE',now:()=>now,mono:()=>mono});
  return{engine,data,workspace,get active(){return active;},setRead(fn:()=>Promise<unknown>){read=fn;},lose(){loss?.();},drop(){target=null;},advance(ms:number){now+=ms;mono+=ms;},backward(){now--;}};}
test('canonical post identity keeps long IDs as strings, strips tracking and rejects author/group/photo identities',()=>{
  const direct=canonicalCandidateLink('/groups/123/posts/'+id+'/?token=PRIVATE');assert.equal(direct?.post_id,id);assert.equal(direct?.permalink,'https://www.facebook.com/groups/123/posts/'+id+'/');
  assert.equal(canonicalCandidateLink('/groups/123/permalink/'+id+'/')?.post_id,id);assert.equal(canonicalCandidateLink('/story.php?story_fbid='+id+'&id=42&token=PRIVATE')?.post_id,id);
  for(const value of ['/groups/123/','/profile.php?id='+id,'/photo.php?fbid='+id,'https://facebook.com.attacker.test/owner/posts/'+id+'/', '/owner/posts/not-a-post/'])assert.equal(canonicalCandidateLink(value),null);
  assert.equal(redactCandidateText('0901234567 sample@example.test https://example.test/?token=PRIVATE'),'[NUMBER] [EMAIL] [LINK]');
});
test('public candidate validator rejects extra fields, contact text, missing public proof, invalid body and identity alias duplicates',()=>{
  assert.equal(validatePublicCandidateResult(payload()).samples[0]?.post_id,id);
  const sample=payload().samples[0]!;
  for(const value of [{...payload(),samples:[{...sample,name:'PRIVATE'}]},{...payload(),samples:[{...sample,text:'email@example.test'}]},
    {...payload(),samples:[{...sample,metadata:{...sample.metadata,publicLabels:0}}]},
    {...payload(),samples:[{...sample,metadata:{...sample.metadata,restrictedLabels:1}}]},
    {...payload(),samples:[{...sample,metadata:{...sample.metadata,messageRegions:0}}]},
    {...payload(),samples:[{...sample,permalink:sample.permalink+'?token=PRIVATE'}]},
    {...payload(),examined:2,samples:[sample,sample]},{...payload(),samples:Array.from({length:6},()=>sample)},
    {...payload(),samples:[{...sample,text:'x'.repeat(801)}]}])assert.throws(()=>validatePublicCandidateResult(value),/INVALID_RESULT/);
});
test('v13 temporal/barrier/layout shapes are bounded sanitized observations and selection counts remain consistent',()=>{
  const value=payload();const sh={origin:'MAIN_ARTICLE',reason:'NO_HEADER',tag:'ARTICLE',role:'article',depth:'DEEP',feedRelation:'OUTSIDE',state:'PRUNED',hints:{headings:0,temporal:0,publicLabels:0,restrictedLabels:0,messageRegions:0,outsideHeaderDepth:0},prunes:{article:1,hidden:0,control:0,navigation:0,comment:0},layout:layout(),messages:{...messages(),depthLimit:false,groupingComplete:false},header:{clusterFound:false,publicClusterFound:false,ancestorLimit:false,treeState:'COMPLETE',publicDepth:'NONE',temporalDepth:'NONE',publicLabelsSeen:0,publicSignalsAccepted:0,publicControlsPruned:0},temporal:temporalShape()};
  assert.equal(validatePublicCandidateResult({...value,rejectionShapes:[sh]}).rejectionShapes.length,1);
  for(const bad of [{...value,version:12},{...value,rejectionShapes:Array.from({length:6},()=>sh)},
    {...value,rejectionShapes:[{...sh,tag:'PRIVATE_NAME'}]}, {...value,rejectionShapes:[{...sh,hints:{...sh.hints,html:'PRIVATE'}}]},
    {...value,rejectionShapes:[{...sh,layout:{...layout(),css:'PRIVATE'}}]},
    {...value,rejectionShapes:[{...sh,messages:{...sh.messages,groups:2}}]},
    {...value,barriers:{...clearBarriers(),label:'PRIVATE'}},{...value,barriers:{...clearBarriers(),inspected:17}},
    {...value,barriers:{...clearBarriers(),state:'INCOMPLETE',reason:'CANDIDATE_LIMIT'}},
    {...value,diagnostics:{...value.diagnostics,temporal:{...temporalShape(),text:'PRIVATE_DATE'}}},
    {...value,diagnostics:{...value.diagnostics,temporal:{...temporalShape(),scopeMisses:'PRIVATE_SCOPE'}}},
    {...value,diagnostics:{...value.diagnostics,temporal:{...temporalShape(),charLimits:2501}}},
    {...value,diagnostics:{...value.diagnostics,layout:{...layout(),textUnknown:'PRIVATE_GEOMETRY'}}},
    {...value,diagnostics:{...value.diagnostics,temporal:{...temporalShape(),rangeChars:2501}}},
    {...value,selection:{...value.selection,mainExamined:1}}])assert.throws(()=>validatePublicCandidateResult(bad),/INVALID_RESULT/);
  const denied={...value,status:'ACCESS_DENIED',samples:[],barriers:{...clearBarriers(),state:'VISIBLE',kind:'DENIED',evidence:'DENIED_TEXT',inspected:1,visible:1}};
  assert.equal(validatePublicCandidateResult(denied).status,'ACCESS_DENIED');
  for(const bad of [{...denied,barriers:{...denied.barriers,state:'CLEAR'}},{...denied,barriers:clearBarriers()},
    {...denied,barriers:{...denied.barriers,kind:'CHALLENGE'}},{...denied,barriers:{...denied.barriers,evidence:'AUTH_FIELD'}}])assert.throws(()=>validatePublicCandidateResult(bad),/INVALID_RESULT/);
});
test('temporal format classifier accepts bounded whole timestamp phrases and rejects IDs/junk/invalid ranges',()=>{
  for(const text of ['17 tháng 10 lúc 08:30','27 tháng 10, 2026 lúc 08:30','17/10/2026','Ngày 17 tháng 10 năm 2026'])assert.equal(classifyHeaderTemporal(text),'DATE');
  for(const text of ['2giờ','2 hours ago','3 ngày trước'])assert.equal(classifyHeaderTemporal(text),'RELATIVE');
  assert.equal(classifyHeaderTemporal('hôm qua lúc 08:30'),'DAY_WORD');assert.equal(classifyHeaderTemporal('2h'),'ABBREVIATED');
  for(const text of ['90071992547409931234','99 tháng 88','17 tháng 10 lúc 99:99','17 tháng 10 promotion','1 2 giờ','1\n2 giờ','2 giờ NOT_A_TIMESTAMP','x'.repeat(97),''])assert.equal(classifyHeaderTemporal(text),'NONE');
});

test('geometry shapes preserve only bounded enums/counts and reject coordinates, raw data and oversized arrays',()=>{
  const shape={scope:'TEMPORAL',reason:'BOUNDS',axis:'Y',coverage:'PARTIAL',excess:'SUBPIXEL',rects:'ONE',count:1};
  assert.equal(validatePublicCandidateResult({...payload(),geometryShapes:[shape]}).geometryShapes[0]?.axis,'Y');
  for(const geometryShapes of [Array.from({length:6},()=>shape),[{...shape,count:0}],[{...shape,count:2501}],[{...shape,axis:'PRIVATE'}],[{...shape,left:12.5}],[{...shape,url:'PRIVATE'}],[{...shape,excess:0.2}]])assert.throws(()=>validatePublicCandidateResult({...payload(),geometryShapes}),/INVALID_RESULT/);
});

test('optional-time candidates require public header proof, one readable body and honest missing temporal metadata',()=>{
  const base=payload(),sample=base.samples[0]!;
  const optional={...sample,boundary:'FEED_CHILD_HEADER_PUBLIC_OPTIONAL_TIME',missing_fields:[...sample.missing_fields,'TEMPORAL_NOT_OBSERVED'],metadata:{...sample.metadata,temporal:0,timeTag:false,temporalStatus:'MISSING',headerProof:'HEADING_PUBLIC'}};
  assert.equal(validatePublicCandidateResult({...base,samples:[optional]}).samples[0]?.published_at,null);
  const unreadable={...optional,missing_fields:[...sample.missing_fields,'TEMPORAL_UNREADABLE'],metadata:{...optional.metadata,temporalStatus:'UNREADABLE'}};
  assert.equal(validatePublicCandidateResult({...base,samples:[unreadable]}).samples[0]?.metadata.temporalStatus,'UNREADABLE');
  for(const bad of [{...optional,published_at:'2026-10-28'}, {...optional,text:null,text_status:'MISSING_BODY_TEXT'}, {...optional,missing_fields:sample.missing_fields},
    {...optional,metadata:{...optional.metadata,temporal:1}}, {...optional,metadata:{...optional.metadata,timeTag:true}}, {...optional,metadata:{...optional.metadata,temporalStatus:'OBSERVED'}},
    {...optional,metadata:{...optional.metadata,headerProof:'HEADING_TEMPORAL_PUBLIC'}}, {...optional,metadata:{...optional.metadata,headings:2}}, {...optional,metadata:{...optional.metadata,messageRegions:0}},
    {...optional,metadata:{...optional.metadata,publicLabels:0}}, {...optional,metadata:{...optional.metadata,restrictedLabels:1}}, {...unreadable,missing_fields:optional.missing_fields}])assert.throws(()=>validatePublicCandidateResult({...base,samples:[bad]}),/INVALID_RESULT/);
});
test('challenge/denied literal guards produce consistent visible metadata and retain candidate-limit behavior',()=>{
  for(const mode of ['challenge','denied','capped']){
    const node=(tag:string,attrs:Record<string,string>={},parent:unknown=null,empty=false)=>({nodeType:1,tagName:tag,parentElement:parent,hidden:false,getAttribute:(key:string)=>attrs[key]||null,getClientRects:()=>empty?[]:[{width:100,height:100,left:0,top:0,right:100,bottom:100}]});
    const body=node('BODY'),main=node('MAIN',{},body),form=node('FORM'),span=node('SPAN',{},form);
    const feed={...node('DIV',{role:'feed'},main),firstElementChild:form};form.parentElement=feed;
    const text={nodeType:3,parentElement:span,nodeValue:mode==='denied'?'Access denied':'Confirm your identity'};
    const regions=Array.from({length:16},()=>node('DIV',{role:'alert'},body,true));
    const doc={body,evaluate:()=>({snapshotLength:mode==='capped'?16:0,snapshotItem:(index:number)=>regions[index]}),querySelector:()=>main,
      createRange:()=>({selectNodeContents(){},getClientRects:()=>[{width:100,height:100,left:0,top:0,right:100,bottom:100}],detach(){}}),
      createTreeWalker:(root:unknown,_mask:unknown,filter:{acceptNode:(value:unknown)=>number})=>{const nodes=root===form?[span,text]:[];let i=0;return{nextNode(){const next=nodes[i++];if(next)filter.acceptNode(next);return next||null;}};}};
    const mainWithQuery=main as typeof main&{querySelector?:(selector:string)=>unknown};mainWithQuery.querySelector=()=>feed;
    const raw=runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,{URL,location:{href:url},document:doc,innerWidth:100,innerHeight:100,performance:{now:()=>0},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:1000});
    const result=validatePublicCandidateResult(raw);assert.equal(result.samples.length,0);
    if(mode==='capped'){assert.equal(result.status,'BARRIER_SCAN_INCOMPLETE');assert.equal(result.barriers.reason,'CANDIDATE_LIMIT');assert.equal(result.barriers.inspected,16);}
    else{assert.equal(result.status,mode==='denied'?'ACCESS_DENIED':'CHALLENGE');assert.equal(result.barriers.state,'VISIBLE');assert.equal(result.barriers.visible,1);assert.equal(result.barriers.inspected,1);}
    assert.equal(/Access denied|Confirm your identity/.test(JSON.stringify(result)),false);
  }
});
test('fixed barrier preflight fails closed on candidate/descendant/time/API limits without scanning main',()=>{
  for(const mode of ['candidates','descendants','time','api']){
    const body={nodeType:1,tagName:'BODY',parentElement:null,hidden:false,getAttribute:()=>null,getClientRects:()=>[{width:100,height:100,left:0,top:0,right:100,bottom:100}]};
    const region={nodeType:1,tagName:'DIV',parentElement:body,hidden:false,getAttribute:(key:string)=>key==='role'?'alert':null,getClientRects:()=>[]};
    const span={...region,getAttribute:()=>null,parentElement:region,tagName:'SPAN'};let calls=0;
    const doc={body,evaluate:mode==='api'?undefined:()=>({snapshotLength:mode==='descendants'?1:17,snapshotItem:()=>region}),
      querySelector:()=>{throw new Error('MAIN_MUST_NOT_BE_SCANNED');},createTreeWalker:(_root:unknown,_mask:unknown,filter:{acceptNode:(value:unknown)=>number})=>{let i=0;return{nextNode(){if(mode==='descendants'&&i++<200){filter.acceptNode(span);return span;}return null;}};}};
    const raw=runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,{URL,location:{href:url},document:doc,innerWidth:100,innerHeight:100,
      performance:{now:()=>mode==='time'&&calls++>0?2000:0},getComputedStyle:(node:unknown)=>({display:node===body?'block':'contents',visibility:'visible',opacity:'1'}),
      NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:1000});
    const result=validatePublicCandidateResult(raw);assert.equal(result.status,'BARRIER_SCAN_INCOMPLETE');assert.equal(result.samples.length,0);assert.equal(result.root,'NONE');
    assert.equal(result.barriers.reason,mode==='candidates'?'CANDIDATE_LIMIT':mode==='descendants'?'DESCENDANT_LIMIT':mode==='time'?'TIME_LIMIT':'API_UNAVAILABLE');assert.ok(result.visited<=2500);
  }
});

test('public badges require their own signal and bounded checks; scoped negatives and author/body literals stay independent',()=>{
  for(const mode of ['link','vietnamese','control','body','quote','heading','footer','split_link','split_span','split_control','unknown_split','split_ad','split_vi','split_vi_ad','publicGroupImage','publicGroupSvg','publicGroupTitle','publicKnownButton','publicGroupButton','publicGroupRoleButton','publicControlConflict','publicControlCapacity','publicControlProbeLimit','publicNestedOnly']){
    const rect={left:0,top:0,right:100,bottom:20,width:100,height:20};
    const node=(tag:string,attrs:Record<string,string>={})=>({nodeType:1,tagName:tag,parentElement:null as unknown,children:[] as unknown[],hidden:false,getAttribute:(key:string)=>attrs[key]||null,getClientRects:()=>[rect]});
    const text=(parent:unknown,nodeValue:string)=>({nodeType:3,parentElement:parent,nodeValue,children:[]});
    const group='Đã chia sẻ với Nhóm công khai',publicMode=mode.startsWith('public'),publicControl=['publicKnownButton','publicGroupButton','publicControlConflict','publicControlCapacity','publicControlProbeLimit','publicNestedOnly'].includes(mode),pubTag=mode==='publicGroupImage'?'IMG':mode==='publicGroupSvg'?'SVG':publicControl?'BUTTON':'SPAN';
    const pubAttrs:Record<string,string>=mode==='publicNestedOnly'?{}:mode==='publicGroupTitle'?{title:group}:mode==='publicGroupRoleButton'?{role:'button','aria-label':group}:{'aria-label':publicMode&&mode!=='publicKnownButton'?group:'Public'};
    const body=node('BODY'),main=node('MAIN'),feed=node('DIV',{role:'feed'}),article=node('ARTICLE'),header=node('HEADER'),heading=node('H3'),pub=node(pubTag,pubAttrs),message=node('DIV',{'data-ad-preview':'message'});
    const split=mode.startsWith('split_')||mode==='unknown_split',badge=node(mode==='control'||mode==='split_control'?'BUTTON':mode==='quote'?'Q':['split_span','unknown_split','split_ad','split_vi','split_vi_ad'].includes(mode)?'SPAN':'A'),footer=node('FOOTER');
    const attach=(parent:typeof body,children:unknown[])=>{parent.children=children;for(const child of children)(child as {parentElement:unknown}).parentElement=parent;};
    attach(body,[main]);attach(main,[feed]);attach(feed,[article]);attach(article,[header,message,...(mode==='footer'?[footer]:[])]);attach(header,[heading,pub,...(['link','vietnamese','control','quote'].includes(mode)||split?[badge]:[])]);
    attach(heading,[text(heading,mode==='heading'?'Friends':'AUTHOR')]);attach(pub,[text(pub,'globe')]);attach(message,[text(message,mode==='body'?'Friends':'COFFEE_BODY')]);attach(badge,[text(badge,mode==='vietnamese'?'Bạn bè':'Friends')]);attach(footer,[text(footer,'Friends')]);
    if(pubTag==='IMG')attach(pub,[]);
    if(mode==='publicControlConflict'){const privateChild=node('SPAN',{'aria-label':'Friends'});attach(pub,[privateChild]);attach(privateChild,[text(privateChild,'private')]);}
    if(mode==='publicNestedOnly'){const graphic=node('SPAN',{'aria-label':group});attach(pub,[graphic]);}
    if(mode==='publicControlCapacity'){const before=Array.from({length:4},()=>{const control=node('BUTTON');attach(control,[text(control,'globe')]);return control;});attach(header,[heading,...before,pub]);}
    if(mode==='publicControlProbeLimit'){const many=Array.from({length:65},()=>node('SPAN'));attach(pub,many);}
    if(split){const parts=mode==='split_vi'?['Bạn',' ','bè']:mode==='split_vi_ad'?['Được',' ','tài trợ']:mode==='split_ad'?['Spon','sored']:['Fri','ends'];const spans=parts.map(part=>{const span=node('SPAN');attach(span,[Object.assign(text(span,part),{rangeUnknown:mode==='unknown_split'})]);return span;});attach(badge,spans);}
    const mainSurface=Object.assign(main,{querySelector:()=>feed});Object.assign(feed,{firstElementChild:article});
    const document={body,evaluate:()=>({snapshotLength:0,snapshotItem:()=>null}),querySelector:()=>mainSurface,createRange:()=>{let selected:{rangeUnknown?:boolean}|null=null;return{selectNodeContents(node:unknown){selected=node as {rangeUnknown?:boolean};},getClientRects:()=>[{...rect,width:selected?.rangeUnknown?NaN:100}],detach(){}};},
      createTreeWalker:(root:typeof body,_mask:unknown,filter:{acceptNode:(part:unknown)=>number})=>{const queue=[...root.children];return{nextNode(){while(queue.length){const part=queue.shift() as typeof body;if(filter.acceptNode(part)===2)continue;queue.unshift(...part.children);return part;}return null;}};}};
    const raw=runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,{URL,location:{href:url},document,performance:{now:()=>0},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',clip:'auto',clipPath:'none',transform:'none',position:'static'}),NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:1000});
    const result=validatePublicCandidateResult(raw),restricted=['link','vietnamese','control','footer','publicControlConflict'].includes(mode)||split,blocked=['publicControlCapacity','publicControlProbeLimit','publicNestedOnly'].includes(mode);assert.equal(result.samples.length,restricted||blocked?0:1,mode);
    if(restricted)assert.ok(result.rejected[['split_ad','split_vi_ad'].includes(mode)?'AD_OR_SUGGESTION':'CONFLICTING_PUBLIC']>0,mode);else if(blocked)assert.ok(result.rejected[mode==='publicNestedOnly'?'MISSING_PUBLIC':'INCOMPLETE_BOUNDARY']>0,mode);else{assert.equal(result.samples[0]?.metadata.restrictedLabels,0);if(publicMode)assert.equal(result.samples[0]?.metadata.publicLabels,1);}
  }
});

test('auxiliary omission requires honest missing reason and a single independently readable body',()=>{
  const base=payload(),sample=base.samples[0]!,omitted={...sample,missing_fields:[...sample.missing_fields,'AUXILIARY_TEXT_OMITTED'],metadata:{...sample.metadata,auxiliaryTextOmitted:true}};
  assert.equal(validatePublicCandidateResult({...base,samples:[omitted]}).samples[0]?.metadata.auxiliaryTextOmitted,true);
  for(const bad of [{...omitted,missing_fields:sample.missing_fields},{...omitted,metadata:{...omitted.metadata,auxiliaryTextOmitted:false}},{...omitted,metadata:{...omitted.metadata,headings:2}},{...omitted,text:null,text_status:'MISSING_BODY_TEXT'},{...omitted,metadata:{...omitted.metadata,messageRegions:0}}])assert.throws(()=>validatePublicCandidateResult({...base,samples:[bad]}),/INVALID_RESULT/);
});

test('quoted message markers remain ambiguous and never contribute their text to the outer body',()=>{
  for(const tag of ['BLOCKQUOTE','Q'])for(const depth of [0,40]){
    const rect={left:0,top:0,right:100,bottom:20,width:100,height:20};
    const node=(tagName:string,attrs:Record<string,string>={})=>({nodeType:1,tagName,parentElement:null as unknown,children:[] as unknown[],hidden:false,childElementCount:0,getAttribute:(key:string)=>attrs[key]||null,getClientRects:()=>[rect]});
    const attach=(parent:ReturnType<typeof node>,children:unknown[])=>{parent.children=children;parent.childElementCount=children.filter(c=>(c as {nodeType:number}).nodeType===1).length;for(const child of children)(child as {parentElement:unknown}).parentElement=parent;};
    const text=(parent:unknown,nodeValue:string)=>({nodeType:3,parentElement:parent,nodeValue,children:[]});
    const body=node('BODY'),main=node('MAIN'),feed=node('DIV',{role:'feed'}),article=node('ARTICLE'),header=node('HEADER'),heading=node('H3'),pub=node('SPAN',{'aria-label':'Public'}),time=node('TIME'),outer=node('DIV',{'data-ad-preview':'message'}),quote=node(tag),inner=node('DIV',{'data-ad-comet-preview':'message'});
    attach(body,[main]);attach(main,[feed]);attach(feed,[article]);attach(article,[header,outer]);attach(header,[heading,time,pub]);attach(heading,[text(heading,'AUTHOR')]);attach(time,[text(time,'2 giờ')]);attach(pub,[text(pub,'globe')]);attach(outer,[text(outer,'OUTER_PUBLIC_BODY'),quote]);let parent=quote;
    for(let i=0;i<depth;i++){const wrapper=node('DIV');attach(parent,[wrapper]);parent=wrapper;}attach(parent,[inner]);attach(inner,[text(inner,'QUOTED_MESSAGE_PRIVATE')]);Object.assign(main,{querySelector:()=>feed});Object.assign(feed,{firstElementChild:article});
    const document={body,evaluate:()=>({snapshotLength:0,snapshotItem:()=>null}),querySelector:()=>main,createRange:()=>({selectNodeContents(){},getClientRects:()=>[rect],detach(){}}),createTreeWalker:(root:typeof body,_mask:unknown,filter:{acceptNode:(part:unknown)=>number})=>{const queue=[...root.children];return{nextNode(){while(queue.length){const part=queue.shift() as typeof body;if(filter.acceptNode(part)===2)continue;queue.unshift(...part.children);return part;}return null;}};}};
    const raw=runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,{URL,location:{href:url},document,performance:{now:()=>0},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',clip:'auto',clipPath:'none',transform:'none',position:'static'}),NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:1000});
    const result=validatePublicCandidateResult(raw);assert.equal(result.samples.length,0,tag+depth);assert.equal(result.rejected.AMBIGUOUS_BOUNDARY,1,tag+depth);assert.equal(JSON.stringify(result).includes('QUOTED_MESSAGE_PRIVATE'),false);assert.ok(result.rejectionShapes.some(shape=>shape.prunes.article>0&&shape.messages.markers===2));
  }
});

test('text geometry fails closed on missing/malformed/oversized Range results and spends the shared deadline',()=>{
  for(const mode of ['missing','malformed','listLength','rectLimit','deadline','ancestry','treeCut']){
    const rect={left:0,top:0,right:100,bottom:20,width:100,height:20};
    const element=(tag:string,attrs:Record<string,string>={},parent:unknown=null)=>({nodeType:1,tagName:tag,parentElement:parent,hidden:false,getAttribute:(key:string)=>attrs[key]||null,getClientRects:()=>[rect]});
    const body=element('BODY');let feed:unknown;
    const main=Object.assign(element('MAIN',{},body),{querySelector:()=>feed}),article=element('ARTICLE'),header=element('HEADER',{},article),heading=element('H3',{},header),link=element('A',{},header),pub=element('SPAN',{'aria-label':'Public'},header),message=element('DIV',{'data-ad-preview':'message'},article);
    feed=Object.assign(element('DIV',{role:'feed'},main),{firstElementChild:article});article.parentElement=feed;
    if(mode==='treeCut')heading.parentElement=element('DIV',{},article);
    if(mode==='ancestry'){let outside:unknown=body;for(let i=0;i<40;i++)outside=element('DIV',{},outside);main.querySelector=()=>{main.parentElement=outside;return feed;};}
    const text=(parent:unknown,nodeValue:string)=>({nodeType:3,parentElement:parent,nodeValue});let ranges=0;
    const nodes=[header,heading,text(heading,'AUTHOR_PRIVATE'),link,...Array.from({length:mode==='ancestry'?8:1},()=>text(link,'2 giờ')),pub,text(pub,'globe'),message,text(message,'BODY_PRIVATE')];
    const doc={body,evaluate:()=>({snapshotLength:0,snapshotItem:()=>null}),querySelector:()=>main,
      createRange:mode==='missing'?undefined:()=>({selectNodeContents(){},getClientRects:()=>{ranges++;return mode==='listLength'?{length:NaN}:mode==='rectLimit'?Array.from({length:9},()=>rect):[{...rect,width:mode==='malformed'?NaN:100}];},detach(){}}),
      createTreeWalker:(root:unknown,_mask:unknown,filter:{acceptNode:(node:unknown)=>number})=>{let i=0;const parts=root===article?nodes:[];return{nextNode(){const part=parts[i++];if(part)filter.acceptNode(part);return part||null;}};}};
    const raw=runInNewContext(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT,{URL,location:{href:url},document:doc,performance:{now:()=>mode==='deadline'&&ranges?2000:0},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',clip:'auto',clipPath:'none',transform:'none'}),NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:1000});
    const result=validatePublicCandidateResult(raw);assert.equal(result.samples.length,0);assert.ok(result.rejected.INCOMPLETE_BOUNDARY>0);
    if(mode==='deadline')assert.equal(result.timeLimit,true);else if(mode!=='treeCut')assert.ok(result.diagnostics.layout.textUnknown>0);
    if(mode==='ancestry'){assert.equal(result.diagnostics.layout.clipAncestorMisses,1);assert.ok(result.diagnostics.layout.clipAncestorSteps<=32);assert.ok(result.diagnostics.layout.clipCacheHits>8);assert.ok(result.diagnostics.layout.textUnknownAncestor>8);assert.ok(result.visited<500);}
    else if(mode==='treeCut'){assert.equal(result.diagnostics.headers.ancestryCuts,1);assert.equal(result.diagnostics.headers.treeIncomplete,1);assert.equal(result.rejectionShapes[0]?.header.treeState,'INCOMPLETE');assert.equal(result.rejectionShapes[0]?.header.publicClusterFound,false);}
    else if(mode==='missing')assert.ok(result.diagnostics.layout.textUnknownApi>0);
    else if(mode!=='deadline')assert.ok(result.diagnostics.layout.textUnknownRect>0);
    assert.equal(/AUTHOR_PRIVATE|BODY_PRIVATE/.test(JSON.stringify(result)),false);
  }
});
test('candidate text/permalink exists only in local payload; summary, started envelope and return value are sanitized',()=>setup(async ctx=>{
  const value=await ctx.engine.start('PRIVATE_PROFILE');assert.equal(value.summary.candidate_count,1);assert.equal(value.summary.capture_mode,'FIXTURE');assert.equal(value.summary.platform_permission,'UNKNOWN');assert.equal(value.summary.verified_valid_count,0);
  const samples=readFileSync(join(value.directory,'candidates.json'),'utf8');assert.ok(samples.includes('PUBLIC_COFFEE_BODY'));assert.ok(samples.includes(id));
  for(const text of [JSON.stringify(value),readFileSync(join(value.directory,'summary.json'),'utf8'),readFileSync(join(value.directory,'started.json'),'utf8')]){assert.equal(text.includes('PUBLIC_COFFEE_BODY'),false);assert.equal(text.includes('https://'),false);assert.equal(text.includes('PRIVATE_PROFILE'),false);}
  assert.equal(value.summary.candidate_file_sha256,createHash('sha256').update(samples).digest('hex'));assert.equal(ctx.active,0);
}));
test('Stop and ownership loss discard late candidate payload and retain native capacity until settlement',async()=>{
  for(const reason of ['STOPPED','OWNER_CHANGED'])await setup(async ctx=>{let release!:(value:unknown)=>void;ctx.setRead(()=>new Promise(resolve=>{release=resolve;}));const pending=ctx.engine.start('p');await tick();if(reason==='STOPPED')ctx.engine.stop();else ctx.lose();const value=await pending;assert.equal(value.summary.status,reason);assert.equal(value.summary.candidate_count,0);assert.equal(ctx.active,0);await assert.rejects(ctx.engine.start('p'),/BUSY/);const before=readFileSync(join(value.directory,'candidates.json'),'utf8');release(payload());await tick();assert.equal(readFileSync(join(value.directory,'candidates.json'),'utf8'),before);assert.equal(before.includes('PUBLIC_COFFEE_BODY'),false);});
});
test('elapsed timeout, clock reversal, invalid payload and missing owner never persist candidate content',async()=>{
  for(const reason of ['READ_TIMEOUT','CLOCK_UNCERTAIN','INVALID_RESULT','OWNER_CHANGED'])await setup(async ctx=>{if(reason==='OWNER_CHANGED')ctx.drop();else ctx.setRead(async()=>{if(reason==='READ_TIMEOUT')ctx.advance(4001);if(reason==='CLOCK_UNCERTAIN')ctx.backward();return reason==='INVALID_RESULT'?{...payload(),raw:'PRIVATE'}:payload();});const value=await ctx.engine.start('p');assert.equal(value.summary.status,reason);assert.equal(readFileSync(join(value.directory,'candidates.json'),'utf8').includes('PUBLIC_COFFEE_BODY'),false);});
});
test('actual read timeout returns safely and prevents accumulating outstanding native reads',()=>setup(async ctx=>{ctx.setRead(()=>new Promise(()=>{}));const value=await ctx.engine.start('p');assert.equal(value.summary.status,'READ_TIMEOUT');assert.equal(value.summary.candidate_count,0);await assert.rejects(ctx.engine.start('p'),/BUSY/);}));
test('output containment, byte cap and per-process cap apply to candidate payload too',()=>setup(async ctx=>{assert.throws(()=>createPublicCandidateSink(ctx.workspace,ctx.workspace),/OUTPUT_DENIED/);
  const full=payload();full.examined=5;full.selection.feedExamined=5;full.samples=Array.from({length:5},(_,i)=>({...payload().samples[0]!,post_id:id+String(i),permalink:'https://www.facebook.com/owner/posts/'+id+String(i)+'/',text:'☕'.repeat(800)}));ctx.setRead(async()=>full);const value=await ctx.engine.start('p');assert.equal(value.summary.candidate_count,5);assert.ok(readdirSync(value.directory).reduce((sum,file)=>sum+readFileSync(join(value.directory,file)).byteLength,0)<=32768);await ctx.engine.start('p');await ctx.engine.start('p');await assert.rejects(ctx.engine.start('p'),/PROCESS_LIMIT/);
}));
test('candidate fixture cannot receive LIVE provenance or coexist with other smoke/fixture flags',()=>{
  const fixture='--csd-facebook-public-candidate-fixture';assert.equal(facebookDomCaptureMode([fixture]),'FIXTURE');
  for(const other of ['--csd-facebook-dom-diagnostic','--csd-facebook-dom-fixture','--csd-smoke','--csd-session-smoke','--csd-probe-smoke'])assert.throws(()=>facebookDomCaptureMode([fixture,other]),/ARGUMENTS_INVALID/);
});
