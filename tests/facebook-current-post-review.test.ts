import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {setImmediate as tick} from 'node:timers/promises';
import {inspectCurrentGroupPostRoute} from '../src/main/facebook-public-candidate-fields.js';
import {FACEBOOK_CURRENT_POST_SCRIPT} from '../src/main/facebook-public-candidate-script.js';
import {createFacebookPublicCandidateProbe,validatePublicCandidateResult} from '../src/main/facebook-public-candidate.js';

const id='90071992547409931234',group='90071992547409931235';
const url=`https://www.facebook.com/groups/${group}/?multi_permalinks=${id}`;
const box={left:10,top:10,right:110,bottom:30,width:100,height:20};
interface N {nodeType:number;tagName:string;nodeValue:string;attrs:Record<string,string>;children:N[];parentElement:N|null;hidden:boolean;getAttribute:(k:string)=>string|null;getClientRects:()=>typeof box[];contains:(n:N)=>boolean;}
function n(tag:string,attrs:Record<string,string>={},children:N[]=[],text=''):N{
  const node:N={nodeType:tag==='#text'?3:1,tagName:tag,nodeValue:text,attrs,children:[],parentElement:null,hidden:false,
    getAttribute:key=>attrs[key]??null,getClientRects:()=>node.hidden?[]:[box],contains:other=>other===node||node.children.some(child=>child.contains(other))};
  add(node,...children);return node;
}
function add(parent:N,...children:N[]){for(const child of children){parent.children.push(child);child.parentElement=parent;}return parent;}
function move(node:N,parent:N){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);add(parent,node);}
const t=(value:string)=>n('#text',{},[],value);
const message=(value:string)=>n('DIV',{'data-ad-preview':'message'},[t(value)]);
const pub=()=>n('SVG',{role:'img','aria-label':'Đã chia sẻ với Nhóm công khai'});
function fixture(){
  const header=n('HEADER',{},[n('H3',{},[t('AUTHOR_PRIVATE')]),pub()]);
  const body=message('POST_BODY contact@example.test');
  const comments=n('DIV',{role:'comment'},[n('H3',{},[t('COMMENT_AUTHOR_PRIVATE')]),n('A',{href:'/groups/'+group+'/posts/888/'},[t('2 giờ')]),message('COMMENT_BODY_PRIVATE')]);
  const article=n('ARTICLE',{},[header,body,comments]);
  const dialog=n('DIV',{role:'dialog'},[n('H2',{},[t('DIALOG_TITLE_PRIVATE')]),article]);
  const wrapper=n('DIV',{role:'dialog'},[dialog]);
  const documentBody=n('BODY',{},[wrapper]);
  return{documentBody,wrapper,dialog,article,header,body,comments};
}
const descendants=(root:N):N[]=>root.children.flatMap(child=>[child,...descendants(child)]);
const normalize=(v:string)=>v.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
function read(f=fixture(),route=url,now=()=>0){
  const phrases=['security check','kiểm tra bảo mật','xác minh bạn là người','confirm your identity','access denied','you do not have permission','bạn không có quyền truy cập'];
  const document={body:f.documentBody,
    evaluate(xpath:string,context:unknown,_resolver:unknown,type:number){
      assert.equal(context,document);assert.equal(type,7);assert.ok(xpath.endsWith('[position() <= 17]'));
      const security=xpath.startsWith('(//input');
      if(security){assert.ok(xpath.includes('//text()['));assert.ok(xpath.includes('@autocomplete="one-time-code"'));}
      else assert.equal(xpath,'(//dialog | //*[@role="dialog" or @role="alert"])[position() <= 17]');
      const nodes=descendants(f.documentBody).filter(node=>security?
        (node.tagName==='INPUT'&&(node.attrs.type==='password'||node.attrs.autocomplete==='one-time-code'||node.attrs.name==='approvals_code'))||
        (node.tagName==='IFRAME'&&(node.attrs.src??'').includes('/recaptcha/'))||
        (node.nodeType===3?phrases.includes(normalize(node.nodeValue)):['aria-label','title'].some(key=>phrases.includes(normalize(node.attrs[key]??'')))):
        node.tagName==='DIALOG'||['dialog','alert'].includes(node.attrs.role??''));
      const selected=nodes.slice(0,17);return{snapshotLength:selected.length,snapshotItem:(index:number)=>selected[index]};
    },
    createRange(){let selected:N|null=null;return{selectNodeContents(node:N){selected=node;},detach(){},getClientRects(){for(let p=selected?.parentElement;p;p=p.parentElement)if(p.hidden)return[];return selected?.nodeValue?[box]:[];}};},
    createTreeWalker(root:N,_mask:number,filter:{acceptNode:(node:N)=>number}){const pending=[...root.children];return{nextNode(){while(pending.length){const node=pending.shift()!;if(filter.acceptNode(node)===2)continue;pending.unshift(...node.children);return node;}return null;}};},
  };
  const raw=runInNewContext(FACEBOOK_CURRENT_POST_SCRIPT,{URL,location:{href:route},document,innerWidth:1000,innerHeight:800,
    performance:{now},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',clip:'auto',clipPath:'none',transform:'none',position:'static'}),
    NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2}},{timeout:2000});
  return validatePublicCandidateResult(raw,true);
}

test('review current post: route hints preserve string IDs and reject ambiguous or normalized route tricks',()=>{
  const hint=inspectCurrentGroupPostRoute(url+'&ref=tracking');assert.equal(hint?.post_id,id);assert.equal(hint?.group_id,group);assert.equal(hint?.observed_route,url);assert.equal(hint?.verification,'UNVERIFIED');
  for(const bad of [url+'&multi_permalinks=2',url+'&%6dulti_permalinks=2',url.replace(id,id+'%2C2'),url.replace(id,id+';2'),url.replace(id,''),url.replace(id,'1e20'),url.replace(id,'1'.repeat(33)),url.replace('/groups/','/groups/../groups/'),url.replace(group,'%39'+group.slice(1)),url.replace('www.facebook.com','www.facebook.com.evil.test'),url.replace('https:','http:'),url+'#comment',url+'&scope=all'])assert.equal(inspectCurrentGroupPostRoute(bad),null);
});

test('review current post: one nested dialog retains only its body and unverified route hint',()=>{
  const result=read();assert.equal(result.samples.length,1);assert.equal(result.context?.visibleDialogs,2);assert.equal(result.context?.wrapperDialogs,1);
  const sample=result.samples[0]!;assert.equal(sample.text,'POST_BODY [EMAIL]');assert.equal(sample.post_id,null);assert.equal(sample.permalink,null);assert.equal(sample.published_at,null);
  assert.equal(sample.metadata.temporal,0);assert.equal(sample.source_type,'UNKNOWN');assert.equal(sample.boundary_verified,false);
  assert.equal(result.context_hint?.post_id,id);assert.equal(result.context_hint?.verification,'UNVERIFIED');assert.equal(/COMMENT_|AUTHOR_PRIVATE|DIALOG_TITLE_PRIVATE/.test(JSON.stringify(result)),false);
});

test('review current post: multiple dialogs, independent wrapper content and crossed article fields cannot form one post',()=>{
  for(const mode of ['sibling','wrapperBody','wrapperText','publicOutside','bodyOutside','twoBodies','private','nestedQuote']){
    const f=fixture();
    if(mode==='sibling')add(f.documentBody,n('DIV',{role:'dialog'}));
    if(mode==='wrapperBody')add(f.wrapper,message('WRAPPER_PRIVATE'));
    if(mode==='wrapperText')add(f.wrapper,t('WRAPPER_PRIVATE'));
    if(mode==='publicOutside')move(f.header.children[1]!,f.dialog);
    if(mode==='bodyOutside')move(f.body,f.dialog);
    if(mode==='twoBodies')add(f.article,message('SECOND_PRIVATE'));
    if(mode==='private')f.header.children[1]!.attrs['aria-label']='Đã chia sẻ với Nhóm riêng tư';
    if(mode==='nestedQuote')add(f.body,n('Q',{},[message('QUOTE_PRIVATE')]));
    const result=read(f);assert.equal(result.samples.length,0,mode);assert.equal(result.context_hint,null);assert.equal(/POST_BODY|PRIVATE/.test(JSON.stringify(result)),false);
  }
});

test('review current post: global security markers take precedence over a valid content dialog',()=>{
  for(const [kind,status] of [['password','AUTH_REQUIRED'],['challenge','CHALLENGE'],['deny','ACCESS_DENIED']] as const){
    const f=fixture();if(kind==='password')add(f.wrapper,n('INPUT',{type:'password'}));else add(f.documentBody,n('DIV',{},[t(kind==='challenge'?'Confirm your identity':'Access denied')]));
    const result=read(f);assert.equal(result.status,status);assert.equal(result.examined,0);assert.equal(result.samples.length,0);assert.equal(result.context_hint,null);
  }
});

test('review current post: comment identity cannot fill the post ID and conflicting own link cannot validate route hint',()=>{
  const f=fixture();add(f.header,n('A',{href:'/groups/'+group+'/posts/999/'}));
  const result=read(f);assert.equal(result.samples.length,0);assert.equal(result.context_hint,null);
  const positive=fixture();add(positive.header,n('A',{href:'/groups/'+group+'/posts/'+id+'/?ref=tracking'}));
  const same=read(positive);assert.equal(same.samples.length,1);assert.equal(same.samples[0]!.post_id,id);assert.equal(same.context_hint?.verification,'UNVERIFIED');
});

test('review current post: dialog sentinel, wrapper/global caps and elapsed deadline retain no partial payload',()=>{
  for(const mode of ['dialogs','wrapper','nodes','time']){
    const f=fixture();if(mode==='dialogs')for(let i=0;i<15;i++)add(f.documentBody,n('DIV',{role:'dialog'}));
    if(mode==='wrapper')for(let i=0;i<130;i++)add(f.wrapper,n('SPAN'));
    if(mode==='nodes')for(let i=0;i<1500;i++)add(f.body,n('SPAN'));
    let calls=0;const result=read(f,url,()=>mode==='time'&&calls++>0?2000:0);
    assert.equal(result.samples.length,0,mode);assert.equal(result.context_hint,null);assert.ok(result.visited<=2500);
    if(mode==='nodes')assert.equal(result.nodeLimit,true);else assert.equal(result.status,'BARRIER_SCAN_INCOMPLETE',mode);
  }
});

test('review current post: schema cannot promote provenance, retain raw extras or return multiple candidates',()=>{
  const value=read();for(const bad of [{...value,context_hint:{...value.context_hint,verification:'VERIFIED'}},{...value,context_hint:{...value.context_hint,post_id:['1']}},
    {...value,context_hint:{...value.context_hint,raw:'PRIVATE'}},{...value,samples:[...value.samples,...value.samples]},{...value,context_hint:null},
    {...value,context:{...value.context,publicGroupSignals:0}}])assert.throws(()=>validatePublicCandidateResult(bad,true),/INVALID_RESULT/);
});

test('review current post: Stop, owner loss and changed ID discard late body and context while summaries remain sanitized',async()=>{
  for(const reason of ['stop','owner','route','positive']){
    const files=new Map<string,unknown>();let current=url,loss=()=>{},release!:(value:unknown)=>void;
    const target={webContentsId:1,viewGeneration:1,url:()=>current,watchLoss(callback:()=>void){loss=callback;return()=>{};},execute(script:string){assert.equal(script,FACEBOOK_CURRENT_POST_SCRIPT);return new Promise(resolve=>{release=resolve;});}};
    const probe=createFacebookPublicCandidateProbe({context:'CURRENT_GROUP_POST',mode:'FIXTURE',resolve:()=>target,
      sink:()=>({directory:'memory-review',write(name,value){files.set(name,value);return createHash('sha256').update(JSON.stringify(value)).digest('hex');}})});
    const pending=probe.start('PROFILE_PRIVATE');await tick();
    if(reason==='stop')probe.stop();else if(reason==='owner')loss();else if(reason==='route')current=url.replace(id,'777');
    if(reason==='stop'||reason==='owner'){
      const result=await pending;assert.equal(result.summary.status,reason==='stop'?'STOPPED':'OWNER_CHANGED');const before=JSON.stringify([...files]);
      await assert.rejects(()=>probe.start('PROFILE_PRIVATE'),/BUSY/);release(read());await tick();assert.equal(JSON.stringify([...files]),before);
    }else{release(read());const result=await pending;assert.equal(result.summary.status,reason==='route'?'OWNER_CHANGED':'SAMPLES_READY');}
    for(const name of ['summary.json','started.json'])assert.equal(/POST_BODY|9007199254740993|PROFILE_PRIVATE/.test(JSON.stringify(files.get(name))),false);
    if(reason!=='positive')assert.equal(/POST_BODY|9007199254740993/.test(JSON.stringify(files.get('candidates.json'))),false);
  }
});
