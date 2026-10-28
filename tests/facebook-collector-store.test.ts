import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { createFacebookCollectorStore } from '../src/infrastructure/browser/facebook-collector-store.js';
import type { EmbeddedSearchRecord } from '../src/infrastructure/browser/facebook-search-embedded-parser.js';
const provenance = { run_id: 'synthetic-run', batch_id: 'batch-1', query_index: 0, scroll_index: 0,
  method: 'BROWSER_RESPONSE' as const, response_sha256: 'synthetic', operation: null, transport_request_id: 'request-1' };
const record = (id: string): EmbeddedSearchRecord => ({ post_id:id,observed_post_url:`https://www.facebook.com/synthetic/posts/${id}/`,text:'Synthetic cafe',
  source_type:'UNKNOWN',source_name:null,source_evidence:null,source_url:null,author_name:null,author_url:null,visibility:'UNKNOWN',visibility_evidence:[],published_at:null,published_at_raw:null,
  reactions_total:null,love_count:null,comments_count:null,shares_count:null,query:'cafe',collected_at:'2026-10-28T04:00:00Z',extraction_method:'EMBEDDED_DOCUMENT_JSON',text_completeness:'UNKNOWN',relevance:'UNVERIFIED',evidence_ref:{document_url:'https://www.facebook.com/search/top?q=cafe',json_path:[]},missing_reasons:{},source_signals:{actor_typename:null,page_id_type:null,actor_post_match:false} });
function temporary(work:(directory:string)=>void){const directory=mkdtempSync(join(tmpdir(),'csd-collector-store-'));try{work(directory);}finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('csd-collector-store-'));rmSync(directory,{recursive:true,force:true});}}
test('durable dedup survives new store instance, different query and URL aliases for the same identity',()=>temporary(directory=>{
  const a=createFacebookCollectorStore(directory);a.persist([record('9007199254740993123')],provenance);
  const b=createFacebookCollectorStore(directory);const alias={...record('9007199254740993123'),query:'coffee',observed_post_url:'https://www.facebook.com/synthetic/posts/pfbidAlias'};
  assert.equal(b.persist([alias,record('9007199254740993124')],{...provenance,batch_id:'batch-2'}).new_records,1);
  assert.equal(createFacebookCollectorStore(directory).count,2);assert.equal(readFileSync(join(directory,'posts.jsonl'),'utf8').trim().split('\n').length,2);
}));
test('committed data survives checkpoint failure and replay does not double count',()=>temporary(directory=>{
  const a=createFacebookCollectorStore(directory);a.persist([record('1234567890')],provenance);
  const blocked=join(directory,'not-a-directory');writeFileSync(blocked,'preserve');assert.throws(()=>a.checkpoint(blocked,{query_index:1}));
  const b=createFacebookCollectorStore(directory);assert.equal(b.persist([record('1234567890')],provenance).new_records,0);assert.equal(b.count,1);
}));
test('export uses batch transport for early pilot records without rewriting observations',()=>temporary(directory=>{
  const a=createFacebookCollectorStore(directory);a.persist([record('1234567890')],provenance);
  const original=readFileSync(join(directory,'posts.jsonl'),'utf8');
  assert.equal(a.export().export_method_normalizations,1);
  assert.equal(JSON.parse(readFileSync(join(directory,'posts.json'),'utf8'))[0].extraction_method,'BROWSER_RESPONSE');
  assert.equal(readFileSync(join(directory,'posts.jsonl'),'utf8'),original);
}));
test('torn final write is backed up; corruption in a completed record is never silently dropped',()=>temporary(directory=>{
  const a=createFacebookCollectorStore(directory);a.persist([record('1234567890')],provenance);appendFileSync(join(directory,'posts.jsonl'),'{"post_id":');
  const b=createFacebookCollectorStore(directory);assert.equal(b.count,1);assert.equal(b.repairedTail,true);assert.ok(readdirSync(directory).some(f=>f.includes('.incomplete-')));
  appendFileSync(join(directory,'posts.jsonl'),'bad-completed-record\n');assert.throws(()=>createFacebookCollectorStore(directory),/CORRUPT/);
}));
