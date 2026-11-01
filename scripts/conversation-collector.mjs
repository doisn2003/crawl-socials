import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseThreadsConversation, parseFacebookConversation } from '../dist/infrastructure/browser/conversation-parser.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const decode=text=>{const clean=text.replace(/^for\s*\(;;\);/,'');try{return[JSON.parse(clean)];}catch{return clean.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});}};
// Lazy import leaves legacy conversation capture usable before the optional resolver is loaded.
export async function resolveThreadsReplyRoot(input){return (await import('./threads-reply-root-collector.mjs')).resolveThreadsReplyRoot(input);}
async function timed(work,ms,code){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]);}finally{clearTimeout(timer);}}
export function sameConversationLocation(actual,expected,platform,rootId){
 try{const a=new URL(actual),e=new URL(expected);if(a.protocol!=='https:')return false;
  if(platform==='threads')return a.pathname.match(/\/post\/([^/]+)/)?.[1]===e.pathname.match(/\/post\/([^/]+)/)?.[1]&&!!e.pathname.match(/\/post\/([^/]+)/);
  const id=a.pathname.match(/\/posts\/(\d+)\/?$/)?.[1]||a.searchParams.get('story_fbid');
  if(id&&/^\d+$/.test(id))return id===rootId;
  return a.pathname.replace(/\/$/,'')===e.pathname.replace(/\/$/,'')&&a.searchParams.get('story_fbid')===e.searchParams.get('story_fbid');
 }catch{return false;}
}

const stateScript=String.raw`(()=>{const controls=[...document.querySelectorAll('button,[role="button"]')].map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim());return {url:location.href,password:!!document.querySelector('input[type="password"]'),alerts:[...document.querySelectorAll('[role="alert"],[role="dialog"]')].map(e=>e.innerText).join(' ').slice(0,4000),sort:controls.find(t=>/^(Top|Recent|Most relevant|All comments|Newest|Phù hợp nhất|Tất cả bình luận|Mới nhất)$/i.test(t))||null,hasExpand:controls.some(t=>/^(show repl|view (more|previous|all|\d+)|see (more|previous)|xem (thêm|tất cả|các|\d+)|hiển thị)/i.test(t)&&/comment|repl|bình luận|trả lời|phản hồi/i.test(t))};})()`;
const expandScript=String.raw`(()=>{
 const forceScroll=__FORCE_SCROLL__;
 const dialog=[...document.querySelectorAll('[role="dialog"]')].find(e=>e.getClientRects().length&&e.querySelector('a[href*="comment_id="]'));
 const scope=dialog||document;
 const es=[...scope.querySelectorAll('button,[role="button"]')];
 const labels=/^(show repl|view (more|previous|all|\d+)|see (more|previous)|xem (thêm|tất cả|các|\d+)|hiển thị)/i;
 const kinds=/comment|repl|bình luận|trả lời|phản hồi/i;
 const e=es.find(e=>{const s=(e.innerText||e.getAttribute('aria-label')||'').trim();return s.length<120&&labels.test(s)&&kinds.test(s)&&e.getClientRects().length});
 if(e&&!forceScroll){e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {kind:'CLICK',label:e.innerText||e.getAttribute('aria-label'),x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}}
 const anchor=[...scope.querySelectorAll('a[href*="comment_id="]')].find(e=>e.getClientRects().length);
 let sc=anchor?.parentElement;
 while(sc&&!(sc.clientHeight>150&&sc.scrollHeight>sc.clientHeight+80&&/auto|scroll/.test(getComputedStyle(sc).overflowY)))sc=sc.parentElement;
 if(!sc){const regions=[...scope.querySelectorAll('main,[role="main"],div')].filter(e=>e.clientHeight>250&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY));sc=regions.sort((a,b)=>b.clientHeight-a.clientHeight)[0]||document.scrollingElement;}
 const before=sc.scrollTop;sc.scrollTo({top:sc.scrollHeight,behavior:'instant'});
 return {kind:'SCROLL',before,after:sc.scrollTop};
})()`;

/** Caller owns profile scheduling/window. Does not close the host or change login/session state. */
export async function collectConversation({window:wc,platform,root,runId,onObservations=async()=>{},shouldStop=()=>false,beforeNextPage=null,maxComments=50,maxSteps=3,maxMs=30000,settleMs=1800}) {
 if(!['threads','facebook'].includes(platform)||!/^\d+$/.test(root?.id)||typeof root?.url!=='string')throw Error('CONVERSATION_CONFIG_INVALID');
 if(!Number.isInteger(maxComments)||maxComments<1||maxComments>1000||!Number.isInteger(maxSteps)||maxSteps<0||maxSteps>100||maxMs<1000||maxMs>180000)throw Error('CONVERSATION_BUDGET_INVALID');
 const expected=new URL(root.url),hosts=platform==='threads'?['www.threads.com','threads.com','www.threads.net','threads.net']:['www.facebook.com','facebook.com'];
 if(expected.protocol!=='https:'||!hosts.includes(expected.hostname)||expected.username||expected.password||expected.port)throw Error('CONVERSATION_URL_INVALID');
 if(shouldStop())return {platform,root_id:root.id,root_found:false,coverage:{status:'NOT_ATTEMPTED',observed_count:0,has_more:null,stop_reason:'USER_STOP',observed_at:new Date().toISOString()},unresolved_parents:0,elapsed_ms:0};
 if(wc.isDestroyed()||wc.debugger.isAttached())throw Error('CONVERSATION_WINDOW_BUSY');
 const parse=platform==='threads'?parseThreadsConversation:parseFacebookConversation;
 const start=Date.now(),knownIds=new Set([root.id]),comments=new Set(),parentLinks=new Map(),digests=new Set(),pending=new Set(),requests=new Map();
 let recognized=false,rootFound=false,hasMore=null,cursor=null,advertised=null,pages=0,unresolved=0,stopReason='STEP_BUDGET',closing=false,sort=null,hasExpand=false,captureError=null,capturedBytes=0,responseBodies=0,persistenceFailure=null;
 let serial=Promise.resolve();
 const execute=script=>timed(wc.executeJavaScript(script),Math.min(10000,Math.max(1000,maxMs-(Date.now()-start))),'CONVERSATION_RENDERER_TIMEOUT');
 const persist=async(objects,method,digest)=>{
  if(closing||digests.has(digest))return;digests.add(digest);
  const parsed=parse(objects,{rootId:root.id,url:root.url,observedAt:new Date().toISOString(),runId,method,knownIds});
  recognized ||= parsed.recognized;rootFound ||= parsed.root_found;
  // A fully loaded inner branch must not mark an outer reply connection exhausted.
  // Until all per-connection cursors are tracked, retaining PARTIAL is deliberately conservative.
  if(parsed.recognized){pages++;if(parsed.has_more!==null)hasMore=hasMore===true||parsed.has_more;if(parsed.cursor)cursor=parsed.cursor;}
  advertised=parsed.advertised_count??advertised;
  const observations=[];
  // The budget stops the next expansion; never discard records already received in a batch.
  for(const o of parsed.observations){if(o.entity_id)knownIds.add(o.entity_id);if(o.entity_type==='COMMENT'){comments.add(o.entity_id);if(o.parent_id||!parentLinks.has(o.entity_id))parentLinks.set(o.entity_id,o.parent_id);}observations.push(o);}
  unresolved=[...parentLinks.values()].filter(parent=>!parent).length;
  if(observations.length)try{await onObservations(observations);}catch(error){persistenceFailure=error;throw error;}
 };
 const enqueue=(objects,method,digest)=>{serial=serial.then(()=>persist(objects,method,digest)).catch(e=>{captureError=e.message||'CONVERSATION_CAPTURE_FAILED';});return serial;};
 const onMessage=(_event,method,p,child)=>{
  if(closing||child)return;
  if(method==='Network.responseReceived'){
   try{const u=new URL(p.response.url);if(hosts.includes(u.hostname)&&/graphql|\/api\//.test(u.pathname)&&/json|javascript|text\/plain|text\/html/.test(p.response.mimeType)){if(requests.size>=100){captureError='CAPTURE_RESOURCE_LIMIT';return;}requests.set(p.requestId,{status:p.response.status});}}catch{}
  }
  if(method==='Network.loadingFinished'&&requests.has(p.requestId)){
   const meta=requests.get(p.requestId);requests.delete(p.requestId);
   if([401,403,429].includes(meta.status)){captureError='ACCOUNT_BARRIER';return;}
   if(p.encodedDataLength>12*1024*1024){captureError='RESPONSE_SIZE_LIMIT';return;}
   if(pending.size>=24||responseBodies>=80||capturedBytes>=48*1024*1024){captureError='CAPTURE_RESOURCE_LIMIT';return;}
   responseBodies++;
   const task=timed(wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId}),8000,'BODY_TIMEOUT').then(r=>{
    if(closing)return;const text=r.base64Encoded?Buffer.from(r.body,'base64').toString('utf8'):r.body;
    if(text.length>12*1024*1024){captureError='RESPONSE_SIZE_LIMIT';return;}capturedBytes+=Buffer.byteLength(text);
    return enqueue(decode(text),'BROWSER_RESPONSE',hash(text));
   }).catch(()=>{if(!closing)captureError='RESPONSE_READ_FAILED';});
   pending.add(task);void task.finally(()=>pending.delete(task));
  }
 };
 try {
  if(beforeNextPage)await beforeNextPage();
  if(shouldStop())throw Error('USER_STOP');
  wc.debugger.attach('1.3');wc.debugger.on('message',onMessage);await wc.debugger.sendCommand('Network.enable');
  await timed(wc.loadURL(root.url),Math.min(30000,maxMs),'CONVERSATION_NAVIGATION_TIMEOUT');await sleep(Math.min(settleMs,Math.max(0,maxMs-(Date.now()-start))));
  for(let step=0;step<=maxSteps;step++){
   if(shouldStop()){stopReason='USER_STOP';break;}if(Date.now()-start>=maxMs){stopReason='TIME_BUDGET';break;}
   const state=await execute(stateScript);sort=state.sort;hasExpand=state.hasExpand;
   if(state.password||/\/(login|checkpoint|challenge)/.test(new URL(state.url).pathname)||/temporarily blocked|try again later|tạm thời bị chặn/i.test(state.alerts)){stopReason='ACCOUNT_BARRIER';break;}
   const actual=new URL(state.url);if(!hosts.includes(actual.hostname)||!sameConversationLocation(actual.href,root.url,platform,root.id)){stopReason='NAVIGATION_CHANGED';break;}
   const embedded=await execute(`[...document.querySelectorAll('script[type="application/json"]')].map(e=>e.textContent).filter(s=>s&&s.length<12000000).slice(0,200)`);
   await enqueue(embedded.flatMap(decode),'EMBEDDED_DOCUMENT_JSON',hash(embedded.join('\n')));
   await Promise.allSettled([...pending]);await serial;
   if(captureError){stopReason=captureError;break;}if(comments.size>=maxComments){stopReason='COMMENT_BUDGET';break;}
   if(recognized&&rootFound&&hasMore===false&&!hasExpand&&!unresolved){stopReason='EXHAUSTED_VISIBLE';break;}
   if(step===maxSteps)break;
   if(beforeNextPage)await beforeNextPage();
   if(shouldStop()){stopReason='USER_STOP';break;}if(Date.now()-start>=maxMs){stopReason='TIME_BUDGET';break;}
   const action=await execute(expandScript.replace('__FORCE_SCROLL__',step%2===1?'true':'false'));
   if(action.kind==='CLICK'){
    wc.sendInputEvent({type:'mouseMove',x:action.x,y:action.y});wc.sendInputEvent({type:'mouseDown',x:action.x,y:action.y,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',x:action.x,y:action.y,button:'left',clickCount:1});
   }
   await sleep(Math.min(settleMs,Math.max(0,maxMs-(Date.now()-start))));
  }
 } catch(e){stopReason=e.message||'CONVERSATION_CAPTURE_FAILED';if(stopReason==='CONVERSATION_NAVIGATION_TIMEOUT'&&!wc.isDestroyed())wc.stop();}
 finally{
  await timed(Promise.allSettled([...pending]),10000,'DRAIN_TIMEOUT').catch(()=>{stopReason='DRAIN_TIMEOUT';});await serial;
  closing=true;if(!wc.isDestroyed()){wc.debugger.removeListener('message',onMessage);if(wc.debugger.isAttached())wc.debugger.detach();}
 }
 if(persistenceFailure)throw persistenceFailure;
 let status=stopReason==='ACCOUNT_BARRIER'&&!recognized?'INACCESSIBLE':recognized?'PARTIAL':'RETRYABLE_ERROR';
 if(stopReason==='EXHAUSTED_VISIBLE')status=comments.size?'EXHAUSTED_VISIBLE':'OBSERVED_EMPTY';
 const coverage={status,advertised_count:advertised,observed_count:comments.size,has_more:hasMore,sort_mode:sort,stop_reason:stopReason,pages,cursor,observed_at:new Date().toISOString()};
 await onObservations([{platform,entity_type:'CAPTURE',entity_id:null,root_post_id:root.id,parent_id:null,text:'',observed_at:coverage.observed_at,coverage,provenance:{run_id:runId,method:'CONVERSATION_CAPTURE',url:root.url}}]);
 return {platform,root_id:root.id,root_found:rootFound,coverage,unresolved_parents:unresolved,response_bodies:responseBodies,captured_bytes:capturedBytes,elapsed_ms:Date.now()-start};
}
