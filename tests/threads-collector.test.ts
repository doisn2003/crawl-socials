import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseThreadsSearch } from '../src/infrastructure/browser/threads-search-parser.js';
import { createThreadsCollectorStore, type ThreadsProvenance } from '../src/infrastructure/browser/threads-collector-store.js';
import { createBrowserPolicy } from '../src/infrastructure/browser/navigation-policy.js';
import { createBrowserProfiles } from '../src/infrastructure/browser/profile-repository.js';
import { parseBrowserCommand } from '../src/main/browser-ipc-policy.js';
const context = { query: 'cafe Hà Nội', mode: 'top' as const, collectedAt: '2026-10-29T10:00:00Z', method: 'BROWSER_RESPONSE' as const };
const post = (id = '3975566122833663174', code = 'SyntheticCode') => ({ pk: id, code, user: { username: 'example.cafe', full_name: 'Example', text_post_app_is_private: false }, caption: { text: 'Quán cafe đẹp' }, taken_at: 1788144434, like_count: 0, text_post_app_info: { is_reply: false, direct_reply_count: 0, repost_count: 2, quote_count: 1, reshare_count: 3 } });
const payload = (posts: unknown[]) => ({ data: { searchResults: { edges: posts.map(p => ({ node: { thread: { thread_items: [{ post: p }] } } })), page_info: { has_next_page: true } } } });
const provenance: ThreadsProvenance = { run_id: 'synthetic', batch_id: 'synthetic-1', query_index: 0, scroll_index: 1, method: 'BROWSER_RESPONSE', response_sha256: 'a'.repeat(64), operation: 'BarcelonaSearchResultsRefetchableQuery', request_id: 'test.1' };
test('Threads parser preserves string IDs, zero counts and observed post fields; ignores unrelated feed/quoted data', () => {
 const p = post(); Object.assign(p, { quoted_post: post('99','Quoted') });
 const parsed = parseThreadsSearch([{ require: [{ __bbox: payload([p]) }], feed: { thread_items: [{ post: post('88','Feed') }] } }], context);
 assert.equal(parsed.connections, 1); assert.equal(parsed.has_next_page, true); assert.equal(parsed.records.length, 1);
 const r = parsed.records[0]!; assert.equal(r.post_id, '3975566122833663174'); assert.equal(r.likes, 0); assert.equal(r.replies, 0);
 assert.equal(r.post_url, 'https://www.threads.com/@example.cafe/post/SyntheticCode'); assert.equal(r.relevance, 'NOT_EVALUATED');
 assert.equal(JSON.stringify(r).includes('quoted_post'), false);
});
test('Threads parser rejects replies, unsafe identities, absent text and numeric IDs; missing counts stay null', () => {
 const reply = post(); reply.text_post_app_info.is_reply = true;
 const badName = post(); badName.user.username = '../evil';
 const empty = post(); empty.caption.text = '';
 const unsafe = { ...post(), pk: 3975566122833663000 };
 const nullable = { ...post('12','Nullable'), like_count: null, text_post_app_info: {} };
 const p = parseThreadsSearch([payload([reply,badName,empty,unsafe,nullable])],context);
 assert.equal(p.records.length,1); assert.equal(p.skipped.length,4); assert.equal(p.records[0]!.likes,null); assert.equal(p.records[0]!.replies,null);
});
test('Threads durable store deduplicates across queries/restarts and recovers only torn final JSON', () => {
 const dir=mkdtempSync(join(tmpdir(),'csd-threads-test-'));
 try {
  const rows=parseThreadsSearch([payload([post()])],context).records;
  const a=createThreadsCollectorStore(dir); assert.equal(a.persist([...rows,...rows],provenance).new_records,1);
  const b=createThreadsCollectorStore(dir); assert.equal(b.count,1); assert.equal(b.persist(rows,{...provenance,batch_id:'synthetic-2'}).new_records,0);
  const alias={...rows[0]!,post_id:'123'}; assert.equal(b.persist([alias],provenance).new_records,0);
  const valid=readFileSync(join(dir,'posts.jsonl'),'utf8'); appendFileSync(join(dir,'posts.jsonl'),'{"platform":');
  const c=createThreadsCollectorStore(dir); assert.equal(c.count,1); assert.equal(readFileSync(join(dir,'posts.jsonl'),'utf8'),valid); assert.equal(c.export().unique,1);
  appendFileSync(join(dir,'posts.jsonl'),'broken\n'); assert.throws(()=>createThreadsCollectorStore(dir),/DATA_CORRUPT/);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('Threads profile migration preserves Facebook IDs and sessions and rejects invalid platforms', async () => {
 const dir=mkdtempSync(join(tmpdir(),'csd-threads-test-'));
 try {
  const old={id:'csd-11111111-1111-4111-8111-111111111111',label:'Old Facebook',createdAt:'2026-10-28T00:00:00Z',accountBinding:{status:'UNVERIFIED',accountId:null,revision:0}};
  writeFileSync(join(dir,'browser-profiles.json'),JSON.stringify({version:1,profiles:[old]}));
  const profiles=createBrowserProfiles(dir),created=await profiles.create('Threads','threads');
  assert.equal(created.platform,'threads'); assert.deepEqual(await profiles.get(old.id),old); assert.notEqual(created.id,old.id);
  assert.equal(parseBrowserCommand('create',[{label:'Threads',platform:'threads'}]).action,'create');
  assert.throws(()=>parseBrowserCommand('create',[{label:'Bad',platform:'evil'}]),/INVALID/);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('Each platform window denies top-level navigation to the other social network and unsafe URLs', () => {
 const fb=createBrowserPolicy({manualLoginEnabled:true,platform:'facebook'}),th=createBrowserPolicy({manualLoginEnabled:true,platform:'threads'});
 assert.equal(th.navigationAllowed('https://www.threads.com/search?q=cafe'),true); assert.equal(th.navigationAllowed('https://www.facebook.com/'),false);
 assert.equal(fb.navigationAllowed('https://www.threads.com/'),false); assert.equal(th.resourceAllowed('https://static.cdninstagram.com/a.js'),true);
 for(const url of ['https://threads.com.evil.test/','https://user:pass@threads.com/','http://threads.com/','file:///C:/secret','https://threads.com:444/','https://www.instagram.com/']) assert.equal(th.navigationAllowed(url),false,url);
 assert.equal(th.cookieUrl('.threads.com','/',true),'https://threads.com/'); assert.equal(th.cookieUrl('.facebook.com','/',true),null);
});
