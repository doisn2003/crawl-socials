import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { collectConversation, sameConversationLocation } from '../scripts/conversation-collector.mjs';

function windowFor(payload, { login = false, expand = false } = {}) {
 const debug=new EventEmitter();let attached=false,loads=0;
 debug.isAttached=()=>attached;debug.attach=()=>{attached=true;};debug.detach=()=>{attached=false;};debug.sendCommand=async()=>({});
 return {debugger:debug,isDestroyed:()=>false,loadURL:async()=>{loads++;},stop:()=>{},get loads(){return loads;},sendInputEvent:()=>{},executeJavaScript:async script=>{
  if(script.includes('const controls='))return {url:'https://www.threads.com/@synthetic/post/Root',password:login,alerts:'',sort:'Top',hasExpand:expand};
  if(script.includes('script[type='))return [JSON.stringify(payload)];
  throw Error('UNEXPECTED_SCRIPT');
 }};
}
const root={id:'100',url:'https://www.threads.com/@synthetic/post/Root'};
const post={pk:'100',id:'100_99',code:'Root',user:{username:'synthetic'},caption:{text:'Root'},text_post_app_info:{is_reply:false}};
const options=window=>({window,platform:'threads',root,runId:'synthetic',maxSteps:0,maxMs:1000,settleMs:0});

test('Navigation guard permits canonical aliases for the same root and rejects another conversation',()=>{
 assert.equal(sameConversationLocation('https://www.threads.com/@renamed/post/Root','https://www.threads.com/@original/post/Root','threads','100'),true);
 assert.equal(sameConversationLocation('https://www.threads.com/@synthetic/post/Other',root.url,'threads','100'),false);
 assert.equal(sameConversationLocation('https://www.facebook.com/groups/99/posts/100/?comment_id=5','https://www.facebook.com/groups/name/posts/100/','facebook','100'),true);
 assert.equal(sameConversationLocation('https://www.facebook.com/groups/99/posts/101/','https://www.facebook.com/groups/name/posts/100/','facebook','100'),false);
});

test('A root without a recognized comment connection is never observed-empty',async()=>{
 const window=windowFor({data:{media:post}}),rows=[];
 const receipt=await collectConversation({...options(window),onObservations:async items=>rows.push(...items)});
 assert.equal(receipt.root_found,true);assert.equal(receipt.coverage.status,'RETRYABLE_ERROR');
 assert.equal(receipt.coverage.observed_count,0);assert.equal(rows.at(-1).entity_type,'CAPTURE');assert.equal(window.debugger.isAttached(),false);
});
test('Observed empty requires an actual exhausted connection and no expansion affordance',async()=>{
 const payload={data:{media:{...post,text_post_app_info:{direct_replies:{edges:[],page_info:{has_next_page:false}}}}}};
 const receipt=await collectConversation(options(windowFor(payload)));
 assert.equal(receipt.coverage.status,'OBSERVED_EMPTY');assert.equal(receipt.coverage.has_more,false);
 const partial=await collectConversation(options(windowFor(payload,{expand:true})));
 assert.equal(partial.coverage.status,'PARTIAL');
 const missingRoot={data:{media:{id:'100_99',text_post_app_info:{direct_replies:{edges:[],page_info:{has_next_page:false}}}}}};
 const unconfirmed=await collectConversation(options(windowFor(missingRoot)));
 assert.equal(unconfirmed.root_found,false);assert.notEqual(unconfirmed.coverage.status,'OBSERVED_EMPTY');
});
test('Stop before starting avoids navigating or acquiring the browser debugger',async()=>{
 const window=windowFor({});
 const receipt=await collectConversation({...options(window),shouldStop:()=>true});
 assert.equal(receipt.coverage.status,'NOT_ATTEMPTED');assert.equal(window.loads,0);assert.equal(window.debugger.isAttached(),false);
});
test('Login barrier is inaccessible, with cleanup, not empty or unrelated',async()=>{
 const window=windowFor({},{login:true});
 const receipt=await collectConversation(options(window));
 assert.equal(receipt.coverage.status,'INACCESSIBLE');assert.equal(receipt.coverage.stop_reason,'ACCOUNT_BARRIER');assert.equal(window.debugger.isAttached(),false);
});
test('Durable persistence failure propagates after debugger cleanup instead of a false successful capture',async()=>{
 const window=windowFor({data:{media:post}});
 await assert.rejects(collectConversation({...options(window),onObservations:async()=>{throw Error('DISK_FULL');}}),/DISK_FULL/);
 assert.equal(window.debugger.isAttached(),false);
});
test('Comment cap stops expansion but preserves every record already received in the current batch',async()=>{
 const replies=[1,2,3].map(n=>({node:{posts:{edges:[{node:{...post,pk:String(100+n),id:`${100+n}_99`,caption:{text:`Question ${n}`},text_post_app_info:{is_reply:true}}}],page_info:{has_next_page:false}}}}));
 const payload={data:{media:{...post,text_post_app_info:{direct_replies:{edges:replies,page_info:{has_next_page:true}}}}}};
 const rows=[];
 const receipt=await collectConversation({...options(windowFor(payload)),maxComments:2,onObservations:async items=>rows.push(...items)});
 assert.equal(rows.filter(o=>o.entity_type==='COMMENT').length,3);assert.equal(receipt.coverage.observed_count,3);assert.equal(receipt.coverage.status,'PARTIAL');assert.equal(receipt.coverage.stop_reason,'COMMENT_BUDGET');
});

test('Storage admission prevents comment navigation and preserves an admitted batch before stopping expansion',async()=>{
 for(const blockedAt of [1,2]){
  const reply={node:{posts:{edges:[{node:{...post,pk:'101',id:'101_99',caption:{text:'Is it quiet?'},text_post_app_info:{is_reply:true}}}],page_info:{has_next_page:false}}}};
  const payload={data:{media:{...post,text_post_app_info:{direct_replies:{edges:[reply],page_info:{has_next_page:true}}}}}};
  const window=windowFor(payload,{expand:true}),rows=[];let checks=0;
  const receipt=await collectConversation({...options(window),maxSteps:3,onObservations:async items=>rows.push(...items),
   beforeNextPage:async()=>{if(++checks===blockedAt)throw Error('STORAGE_DISK_RESERVE_REACHED');}});
  assert.equal(window.loads,blockedAt-1);assert.equal(receipt.coverage.stop_reason,'STORAGE_DISK_RESERVE_REACHED');
  assert.equal(rows.filter(row=>row.entity_type==='COMMENT').length,blockedAt-1);
  assert.equal(window.debugger.isAttached(),false);assert.notEqual(receipt.coverage.status,'OBSERVED_EMPTY');
 }
});
