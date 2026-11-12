import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import pg from 'pg';
import { migrate, database } from '../dist/backend/database.js';
import { createBackend } from '../dist/backend/server.js';
import { totp } from '../dist/backend/admin.js';
import { yearAfter } from '../dist/backend/billing.js';
import { createEntitlements } from '../dist/backend/entitlements.js';
import { createManagedClient, ManagedHttpError } from '../dist/infrastructure/managed/client.js';
import { createHttpBackupStore } from '../dist/infrastructure/managed/backup.js';
import { createRunAccess } from '../dist/infrastructure/managed/run-access.js';
import { createRemoteModelGateway } from '../dist/infrastructure/managed/model-gateway.js';
import { createDurableSpend, REBUILD_MODEL } from '../dist/infrastructure/llm/durable-spend.js';
import { createPostgresBackup } from '../dist/infrastructure/projects/postgres.js';
import { snapshotProject, withProjectSnapshot } from '../dist/infrastructure/projects/snapshot.js';
import { ProjectPostStore } from '../dist/infrastructure/storage/project-post-store.js';
import { postEvidenceWireSchema, postEvidenceWireSystem } from '../dist/application/opportunity-post-classifier.js';
import { createProductionService } from '../dist/application/production-service.js';
import { compileSemanticTurn } from '../dist/application/semantic-campaign.js';
import { OPPORTUNITY_PLANNER_POLICY } from '../dist/domain/discovery-contract.js';
import { starterGeminiFixture } from './fixtures/starter-gemini.mjs';

const envPath = process.argv.find(arg => arg.startsWith('--env='))?.slice(6);
if (envPath) process.loadEnvFile(envPath);
const original = process.env.DATABASE_URL;
if (!original || !envPath && !process.env.FINDLINK_TEST_CREATE_DATABASE) throw Error('PASS_ENV_FILE_FOR_ISOLATED_DATABASE_TEST');
const dbName = 'findlink_it_' + randomUUID().replaceAll('-','');
const isolated = new URL(original);
isolated.pathname = '/' + dbName;
const creator = new pg.Client({ connectionString: original, connectionTimeoutMillis: 8000 });
const temporary = mkdtempSync(join(tmpdir(), 'findlink-starter-it-'));
let created = false;
let pool, backend, oldBackup;
let providerCalls = 0;
let failTransport = false;
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const fake = {
  databaseUrl: isolated.href, production: false, origin: 'http://127.0.0.1', host: '127.0.0.1', port: 0,
  leaseKey: generateKeyPairSync('ed25519').privateKey, identityKey: secret(), trialGeminiKey: 'mock-trial-gemini-key',
  admin: { token: secret(), totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' },
  sepay: { secret: secret(), bank: 'Vietcombank', account: '1000012345', name: 'FindLink fixture' },
  topupPriceVnd: 325000,
  trustLocalProxy: false,
};
const starterGeminiKey = 'mock-starter-gemini-key', peerGeminiKey = 'mock-peer-gemini-key';
const starterDeepseekKey = 'mock-starter-deepseek-key';
const peerDeepseekKey = 'mock-peer-deepseek-key';
let expectedGeminiKey = fake.trialGeminiKey;

async function mockProvider(url, request) {
  providerCalls++;
  if (failTransport) throw Error('simulated transport loss');
  if (url === 'https://api.deepseek.com/chat/completions') {
    assert.equal(request.headers.Authorization, 'Bearer ' + starterDeepseekKey);
    assert.equal(request.headers['x-goog-api-key'], undefined);
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.max_tokens, modelRequest.max_output_tokens);
    assert.equal(body.thinking.type, 'disabled');
    assert.equal(body.response_format.type, 'json_object');
    assert.match(body.messages[0].content, /key named "result"/);
    return Response.json({ model:'fixture-deepseek', choices:[{finish_reason:'stop',message:{content:'{"result":[{"i":0,"e0":0,"ev":[]}]}'}}],
      usage:{prompt_tokens:900,completion_tokens:108,prompt_cache_hit_tokens:100,prompt_cache_miss_tokens:800} });
  }
  assert.equal(request.headers['x-goog-api-key'], expectedGeminiKey);
  return starterGeminiFixture(url, request);
}

const memory = () => {
  const values = new Map();
  return { get: async key => values.get(key) ?? null, set: async (key,value) => { values.set(key,value); }, delete: async key => { values.delete(key); } };
};
const modelRequest = {
  purpose: 'opportunity-post-evidence-v1', system: postEvidenceWireSystem(false,false),
  input: { goal: { topic: 'cà phê' }, as_of: '2026-11-11T00:00:00.000Z',
    posts: [{ i: 0, evidence_scope: 'POST_ONLY_V1', published_at: null, spans: [{ e: 0, text: 'Xin gợi ý quán cà phê yên tĩnh.' }] }] },
  schema: postEvidenceWireSchema([1]), max_output_tokens: 608,
};
const scopes = (projectId, runId, scope = 'COLLECT_AI') => ({ projectId, runId, scope, budget: '3000000000' });

try {
  await creator.connect();
  await creator.query('CREATE DATABASE "' + dbName + '"');
  created = true;
  pool = database(isolated.href);
  await migrate(pool);
  await migrate(pool);
  backend = createBackend(pool, fake, { transport: mockProvider, workers: false });
  await new Promise(resolveListen => backend.server.listen(0, '127.0.0.1', resolveListen));
  const origin = 'http://127.0.0.1:' + backend.server.address().port;
  let administrator;
  async function request(path, expected, { method = 'GET', json, authorization, headers = {}, raw } = {}) {
    const result = await fetch(origin + path, { method, headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
      ...(authorization ? { Authorization: 'Bearer ' + authorization } : {}),
    }, ...(raw !== undefined ? { body: raw } : json !== undefined ? { body: JSON.stringify(json) } : {}) });
    const body = await result.json();
    assert.equal(result.status, expected, method + ' ' + path + ' ' + (body.code ?? ''));
    return body;
  }
  const admin = (path, json, method = 'POST', expected = 200) =>
    request('/v1/admin/' + path, expected, { method, json, authorization: administrator });
  const credential = (accountId, input, expected = 200) => admin('accounts/' + accountId + '/model-credential',
    { provider:'gemini', action:'set', reason:'Synthetic provider credential test', ...input }, 'PUT', expected);
  const invite = (email, purpose = 'TRIAL', accountId) => admin('invites', { email,purpose,...(accountId ? { accountId } : {}) }, 'POST', 201);
  const newClient = secrets => createManagedClient({ release: { origin }, secrets, development: true });
  const signUp = async (email, secrets = memory(), purpose = 'TRIAL') => {
    const issued = await invite(email,purpose);
    const client = await newClient(secrets);
    const user = await client.login({ username: email, password: 'synthetic-password-2026', invite: issued.code },true);
    return { client,user,secrets,issued };
  };
  const getStatus = c => c.json('/v1/me/entitlements');
  const activate = (c, installationTag) => c.json('/v1/trial/activate', { method: 'POST', json: { installationTag } });
  const lease = async (c, json) => (await c.json('/v1/runs/authorize',{ method: 'POST', json })).lease;
  const release = (c, id) => c.json('/v1/runs/leases/' + id + '/release', { method: 'POST' });
  const enqueue = (c, id, leaseId, data = modelRequest) => c.json('/v1/ai/operations',{ method: 'POST', json: { id,leaseId,request:data } });
  const status = (c, id) => c.json('/v1/ai/operations/' + id);

  assert.equal((await request('/healthz',200)).ok,true);
  const download = (path, method = 'GET') => fetch(origin + '/downloads/windows' + path, { method, redirect: 'manual' });
  assert.equal((await download('/latest.yml')).status,404);
  fake.starterRelease = { repository:'fixture/FindLink', version:'0.5.5' };
  for (const [path, method, version, filename] of [
    ['', 'GET', '0.5.5', 'FindLink-Starter-0.5.5-Setup.exe'],
    ['/latest.yml?noCache=1', 'GET', '0.5.5', 'latest.yml'],
    ['/FindLink-Starter-0.5.4-Setup.exe.blockmap', 'HEAD', '0.5.4', 'FindLink-Starter-0.5.4-Setup.exe.blockmap'],
  ]) {
    const result = await download(path, method);
    assert.equal(result.status,307);
    assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal(result.headers.get('location'),`https://github.com/fixture/FindLink/releases/download/findlink-starter-v${version}/${filename}`);
  }
  assert.equal((await download('/FindLink-Starter-0.5.6-Setup.exe')).status,404);
  assert.equal((await download('/other.exe')).status,404);
  delete fake.starterRelease;
  console.log('PASS HTTPS release alias, versioned blockmaps and unpublished release protection');
  const otp = totp(fake.admin.totp,Math.floor(Date.now()/30_000));
  administrator = (await request('/v1/admin/session',200,{ method: 'POST', json: { token: fake.admin.token, otp } })).token;
  await request('/v1/admin/session',401,{ method: 'POST',json:{ token: fake.admin.token,otp } });
  await admin('policy', { trial_enabled: true, pause_grants: false, pause_trial: false, pause_ai: false,
    max_trial_subjects: 4, trial_subjects_per_day: 4, trial_grant_cap: '400000000', trial_daily_cost: '100000000',
    trial_total_cost: '100000000', paid_daily_cost: '1000000000', paid_total_cost: '1000000000' },'PUT');

  const a = await signUp('trial-a@example.test');
  const other = await signUp('other@example.test',memory(),'ACCOUNT');
  const aDevice2 = await newClient(memory());
  await aDevice2.login({username:a.user.username,password:'synthetic-password-2026'},false);
  assert.equal((await getStatus(a.client)).state,'INACTIVE');
  await assert.rejects(aDevice2.login({ username: a.user.username,password:'synthetic-password-2026',invite:a.issued.code },true));
  const installation = digest('synthetic-windows-installation');
  const double = await Promise.all([activate(a.client,installation),activate(a.client,installation)]);
  assert.ok(double.every(s => s.available === '100000000'));
  assert.equal((await getStatus(aDevice2)).reason,'TRIAL_DEVICE_MISMATCH');
  await assert.rejects(activate(other.client),/INVITE_REQUIRED/);
  const reused = await signUp('same-device@example.test', a.secrets);
  await assert.rejects(activate(reused.client),/TRIAL_REVIEW_REQUIRED/);
  const review = (await admin('overview',undefined,'GET')).reviews[0];
  assert.equal(review.account_id,reused.user.id);
  await admin('reviews/'+review.id,{ approved:false,reason:'Synthetic device reuse test' });
  await assert.rejects(activate(reused.client),/TRIAL_REVIEW_REQUIRED/);
  const reusedNewDevice = await newClient(memory());
  await reusedNewDevice.login({username:reused.user.username,password:'synthetic-password-2026'},false);
  await assert.rejects(activate(reusedNewDevice),/TRIAL_REVIEW_REQUIRED/);
  assert.equal((await getStatus(reusedNewDevice)).reason,'TRIAL_REVIEW_REQUIRED');

  const reinstalled = await signUp('reinstalled@example.test');
  await assert.rejects(activate(reinstalled.client,installation),/TRIAL_REVIEW_REQUIRED/);
  const reinstalledReview = (await admin('overview',undefined,'GET')).reviews[0];
  assert.equal(reinstalledReview.account_id,reinstalled.user.id);
  assert.equal(reinstalledReview.reason,'WINDOWS_INSTALLATION_REUSE');
  const reinstalledNewDevice = await newClient(memory());
  await reinstalledNewDevice.login({username:reinstalled.user.username,password:'synthetic-password-2026'},false);
  await assert.rejects(activate(reinstalledNewDevice),/TRIAL_REVIEW_REQUIRED/);
  await admin('reviews/'+reinstalledReview.id,{ approved:true,reason:'Verified distinct fixture user' });
  await assert.rejects(activate(reinstalledNewDevice),/TRIAL_REVIEW_REQUIRED/);
  const movedReview = (await admin('overview',undefined,'GET')).reviews[0];
  assert.equal(movedReview.reason,'REVIEW_DEVICE_CHANGED');
  await admin('reviews/'+movedReview.id,{ approved:true,reason:'Verified replacement fixture device' });
  await admin('policy',{max_trial_subjects:1},'PUT');
  await assert.rejects(activate(reinstalledNewDevice,installation),/TRIAL_FUNDING_PAUSED/);
  await admin('policy',{max_trial_subjects:4},'PUT');
  assert.equal((await activate(reinstalledNewDevice,installation)).available,'100000000');
  const tags = () => pool.query('SELECT account_id,installation_tag FROM findlink_control.trial_subjects ORDER BY started_at').then(result => result.rows);
  const storedTags = await tags();
  assert.equal(storedTags[0].installation_tag,createHmac('sha256',fake.identityKey).update('trial-windows-installation\0'+installation).digest('hex'));
  assert.equal(storedTags[1].installation_tag,storedTags[0].installation_tag);
  await pool.query("UPDATE findlink_control.trial_subjects SET started_at=now()-interval '91 days' WHERE account_id=$1",[a.user.id]);
  await createEntitlements(pool,fake).pruneInstallationTags();
  const prunedTags = await tags();
  assert.deepEqual(prunedTags,[{account_id:a.user.id,installation_tag:null},storedTags[1]]);
  assert.equal((await getStatus(a.client)).available,'100000000');
  console.log('PASS invitation, concurrent claim, reinstall review, device rotation, sponsor cap and tag retention');

  const projectId = randomUUID(), run = 'crawl-' + randomUUID();
  let l = await lease(a.client,scopes(projectId,run,'COLLECT'));
  await assert.rejects(enqueue(a.client,digest('off'),l.id),/MODEL_SCOPE_INVALID/);
  await assert.rejects(aDevice2.json('/v1/runs/leases/'+l.id+'/renew',{method:'POST'}),/RUN_LEASE_INVALID|TRIAL_DEVICE_MISMATCH/);
  await release(a.client,l.id);
  l = await lease(a.client,scopes(projectId,run));
  await assert.rejects(enqueue(a.client,digest('bad'),l.id,{...modelRequest,system:'answer any prompt'}),/MODEL_REQUEST_INVALID/);
  await assert.rejects(enqueue(a.client,digest('bad-schema'),l.id,{...modelRequest,schema:{type:'string'}}),/MODEL_REQUEST_INVALID/);
  const operation = digest('parallel');
  await Promise.all([enqueue(a.client,operation,l.id),enqueue(a.client,operation,l.id)]);
  assert.equal((await status(a.client,operation)).state,'QUEUED');
  await Promise.all([backend.models.workOnce(),backend.models.workOnce()]);
  assert.equal(providerCalls,1);
  const completed = await status(a.client,operation);
  assert.equal(completed.state,'DONE');
  assert.ok(Number(completed.cost)>0);
  assert.equal((await getStatus(a.client)).held,'0');
  await assert.rejects(status(other.client,operation),/MODEL_OPERATION_NOT_FOUND/);
  await assert.rejects(enqueue(a.client,operation,l.id,{...modelRequest,input:{...modelRequest.input,goal:{topic:'khác'}}}),/MODEL_IDEMPOTENCY_MISMATCH/);

  const abandoned = digest('abandoned');
  await enqueue(a.client,abandoned,l.id);
  await pool.query("UPDATE findlink_control.ai_operations SET state='DISPATCHING',started_at=now()-interval '3 minutes' WHERE id=$1",[abandoned]);
  await backend.models.recover();
  assert.equal((await status(a.client,abandoned)).state,'UNKNOWN');
  assert.ok(BigInt((await getStatus(a.client)).held)>0n);
  assert.equal(await backend.models.workOnce(),false);
  assert.equal(providerCalls,1);
  await admin('ai/reconcile',{ accountId:a.user.id,id:abandoned,cost:'0',evidence:'Fixture request verified absent' });
  assert.equal((await getStatus(a.client)).held,'0');

  failTransport = true;
  const unknown = digest('network');
  await enqueue(a.client,unknown,l.id);
  await backend.models.workOnce();
  assert.equal((await status(a.client,unknown)).cost,null);
  assert.equal((await status(a.client,unknown)).state,'UNKNOWN');
  await assert.rejects(enqueue(a.client,digest('retry-unknown'),l.id),/MODEL_USAGE_UNKNOWN/);
  failTransport = false;
  await admin('ai/reconcile',{ accountId:a.user.id,id:unknown,cost:'50',evidence:'Verified fixture provider usage' });
  assert.equal((await status(a.client,unknown)).cost,'50');

  const heldRequest = digest('hold-then-pause');
  await enqueue(a.client,heldRequest,l.id);
  await admin('policy',{pause_trial:true},'PUT');
  await backend.models.workOnce();
  assert.equal((await status(a.client,heldRequest)).error,'TRIAL_FUNDING_PAUSED');
  assert.equal(providerCalls,2);
  await admin('policy',{pause_trial:false},'PUT');
  const c = await signUp('trial-c@example.test');
  await activate(c.client);
  const cLease = await lease(c.client,scopes(randomUUID(),'crawl-' + randomUUID()));
  const cost = (await pool.query(`SELECT sum(coalesce(cost,bound))::text AS used FROM findlink_control.ai_operations WHERE funding='TRIAL'`)).rows[0].used;
  await admin('policy',{trial_total_cost:String(BigInt(cost)+BigInt(completed.bound))},'PUT');
  const race = await Promise.allSettled([enqueue(a.client,digest('pool-a'),l.id),enqueue(c.client,digest('pool-c'),cLease.id)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.match(String(race.find(r=>r.status==='rejected').reason),/TRIAL_FUNDING_PAUSED/);
  await admin('policy',{pause_trial:true},'PUT');
  await backend.models.workOnce();
  await admin('policy',{pause_trial:false,trial_total_cost:'100000000'},'PUT');
  await release(c.client,cLease.id);
  let lostRawResponse, recoveredRawResponse, trialService;
  const trialClient = { ...a.client, async json(path, input, authenticated) {
    const result = await a.client.json(path,input,authenticated);
    if (path.endsWith('/raw') && result.rawRemaining === 0) {
      if (!lostRawResponse) {
        lostRawResponse = { path,input,result };
        throw new ManagedHttpError('BACKEND_UNAVAILABLE',0);
      }
      assert.deepEqual(input,lostRawResponse.input);
      assert.deepEqual(result,lostRawResponse.result);
      recoveredRawResponse = true;
    }
    return result;
  } };
  const trialGate = createRunAccess(trialClient,projectId,()=>{ void trialService?.stop().catch(()=>{}); });
  await trialGate.begin({runId:run,scope:'COLLECT_AI',budgetUsd:3});
  const prefix = await a.client.json('/v1/runs/leases/'+trialGate.lease().id+'/raw',{
    method:'POST',json:{roots:Array.from({length:999},(_,i)=>digest('facebook\0root-'+i))},
  });
  assert.equal(prefix.accepted.length,999);
  assert.equal(prefix.rawRemaining,1);
  await trialGate.end();
  const trialProfile = 'csd-' + randomUUID();
  const trialSource = { profiles:[{platform:'threads',profileId:trialProfile}] };
  const callsBeforeRawQuota = providerCalls;
  trialService = createProductionService({ directory:join(temporary,'trial-quota'),version:'test',access:trialGate,
    host:{list:async()=>[{id:trialProfile,label:'Fixture',platform:'threads',open:false,persistenceError:null}],sessionStatus:async()=>true},
    collectConversation:async()=>{ throw Error('UNEXPECTED_COMMENT_COLLECTION'); },
    collect:async input=>{
      const candidates = ['last-1','last-2'].map(post_id=>({post_id,text:'Bài đã duyệt của trial'}));
      const admitted = await input.admitRecords(candidates);
      assert.equal(input.shouldStop(),true);
      assert.deepEqual(await input.admitRecords([{post_id:'after-quota'}]),[]);
      await input.onRecords(admitted,{method:'FIXTURE'});
      writeFileSync(join(input.config.output,'posts.json'),JSON.stringify(admitted));
      return { stop_reason:'USER_STOP' };
    } });
  trialService.saveConfig({schemaVersion:2,keywords:['thử'],minimumPosts:2,filterPercent:0,opportunity:{enabled:true,prompt:'',brandContext:'',
    totalTarget:2,filterMode:'OFF',rawCap:1000,budgetUsd:0,commentsEnabled:false,languageScope:'VIETNAMESE'}});
  await trialService.start(trialSource);
  await trialService.settled();
  const retainedTrial = await trialService.snapshotResults();
  assert.ok(lostRawResponse,'The server must commit the final admission before the simulated disconnect');
  assert.equal(lostRawResponse.result.accepted.length,1);
  assert.equal(recoveredRawResponse,true,'The final admitted batch must survive a lost response');
  assert.equal(retainedTrial.run.state,'STOPPED');
  assert.equal(retainedTrial.run.platforms[0].reason,'TRIAL_EXHAUSTED');
  assert.equal(retainedTrial.threads.length,1);
  assert.equal(retainedTrial.opportunity.snapshots[0].root_post_id,retainedTrial.threads[0].post_id);
  assert.equal(retainedTrial.opportunity.decisions.length,0);
  assert.equal(providerCalls,callsBeforeRawQuota);
  assert.deepEqual(await a.client.json(lostRawResponse.path,lostRawResponse.input),lostRawResponse.result);
  await assert.rejects(aDevice2.json(lostRawResponse.path,lostRawResponse.input),/RUN_LEASE_INVALID/);
  await assert.rejects(other.client.json(lostRawResponse.path,lostRawResponse.input),/RUN_LEASE_INVALID/);
  const newRoots = [digest('trial-after-quota')];
  await assert.rejects(a.client.json(lostRawResponse.path,{method:'POST',json:{...lostRawResponse.input.json,roots:newRoots}}),/TRIAL_RAW_IDEMPOTENCY_MISMATCH/);
  await assert.rejects(a.client.json(lostRawResponse.path,{method:'POST',json:{reportId:randomUUID(),roots:newRoots}}),/TRIAL_EXHAUSTED/);
  assert.equal((await getStatus(a.client)).reason,'TRIAL_EXHAUSTED');
  assert.equal((await getStatus(a.client)).rawRemaining,0);
  await assert.rejects(trialService.start(trialSource),/TRIAL_EXHAUSTED/);
  await assert.rejects(lease(a.client,scopes(projectId,'crawl-off','COLLECT')),/TRIAL_EXHAUSTED/);
  await assert.rejects(lease(a.client,scopes(projectId,'crawl-assess','ASSESS')),/TRIAL_EXHAUSTED/);
  await trialService.shutdown();
  console.log('PASS durable AI holds, replay, isolation, revocation, OFF/AI trial lock and final batch recovery');

  async function sepay(order, id, { amount = order.amountVnd, good = true, currency, code = order.code } = {}) {
    const payload = JSON.stringify({id,gateway:fake.sepay.bank,accountNumber:fake.sepay.account,transferType:'in',
      transactionDate:new Date(Date.now()+7*3600_000).toISOString().slice(0,19).replace('T',' '),
      content:'Thanh toán '+code,code:null,transferAmount:amount,referenceCode:'FIXTURE-'+id,currency});
    const now = String(Math.floor(Date.now()/1000));
    return request('/v1/billing/webhooks/sepay',good?201:401,{method:'POST',raw:payload,headers:{
      'Content-Type':'application/json','X-SePay-Timestamp':now,'X-SePay-Signature':'sha256='+(good?
        createHmac('sha256',fake.sepay.secret).update(now+'.'+payload).digest('hex'):'0'.repeat(64))}});
  }
  const buy = () => a.client.json('/v1/billing/orders',{method:'POST',json:{requestId:randomUUID()}});
  const paid = await buy();
  assert.equal(paid.amountVnd,23_000_000);
  await sepay(paid,1001,{good:false});
  await sepay(paid,1002,{amount:paid.amountVnd-1});
  await sepay(paid,1006,{code:'sai mã đơn',currency:'USD'});
  assert.equal((await admin('overview',undefined,'GET')).payments.find(payment=>payment.provider_id==='1006').reason,'CURRENCY_MISMATCH');
  const mismatch = await admin('payments/1006/reconcile',{orderId:paid.id,reason:'Synthetic wrong currency'},'POST',409);
  assert.equal(mismatch.code,'PAYMENT_NOT_RECONCILABLE');
  assert.equal((await getStatus(a.client)).state,'TRIAL');
  await Promise.all([sepay(paid,1003),sepay(paid,1003)]);
  assert.equal((await getStatus(a.client)).available,'50000000000');
  assert.equal((await getStatus(aDevice2)).state,'STARTER');
  assert.equal((await getStatus(a.client)).aiReason,'MODEL_ACCOUNT_KEY_REQUIRED');
  await assert.rejects(lease(a.client,scopes(projectId,'paid-no-key','PLAN')),/MODEL_ACCOUNT_KEY_REQUIRED/);
  const noKeyLease = await lease(a.client,scopes(projectId,'paid-no-key'));
  await assert.rejects(enqueue(a.client,digest('no-paid-key'),noKeyLease.id),/MODEL_ACCOUNT_KEY_REQUIRED/);
  await release(a.client,noKeyLease.id);
  const offLease = await lease(a.client,scopes(projectId,'paid-no-key-off','COLLECT'));
  await release(a.client,offLease.id);
  assert.equal((await credential(a.user.id,{key:fake.trialGeminiKey},409)).code,'MODEL_KEY_RESERVED_FOR_TRIAL');
  await credential(a.user.id,{key:starterGeminiKey});
  assert.equal((await getStatus(a.client)).aiReason,undefined);
  const storedKey = (await pool.query('SELECT key_tag,encrypted_key FROM findlink_control.model_credentials WHERE account_id=$1',[a.user.id])).rows[0];
  assert.notEqual(storedKey.key_tag,starterGeminiKey);
  assert.equal(storedKey.encrypted_key.includes(starterGeminiKey),false);
  const overview = await admin('overview',undefined,'GET');
  assert.deepEqual(overview.accounts.find(account=>account.id===a.user.id).model_providers,['gemini']);
  assert.equal(JSON.stringify(overview).includes(starterGeminiKey),false);
  const renewal = await buy();
  await sepay(renewal,1004);
  assert.equal((await getStatus(a.client)).available,'50000000000');
  const terms = (await pool.query('SELECT starts_at,ends_at FROM findlink_control.subscriptions WHERE account_id=$1 ORDER BY starts_at',[a.user.id])).rows;
  assert.equal(terms.length,2);
  assert.equal(+terms[0].ends_at,+terms[1].starts_at);
  assert.equal(yearAfter(new Date('2028-02-29T12:00:00Z')).toISOString(),'2029-02-28T12:00:00.000Z');
  const topup = await a.client.json('/v1/billing/orders',{method:'POST',json:{requestId:randomUUID(),kind:'TOPUP'}});
  assert.equal(topup.amountVnd,fake.topupPriceVnd);
  await sepay(topup,1005,{code:'sai mã đơn'});
  await admin('payments/1005/reconcile',{orderId:topup.id,reason:'Verified VND fixture with wrong order code'});
  assert.equal((await getStatus(a.client)).available,'60000000000');
  await admin('payments/1005/refund',{reason:'Synthetic top-up refund record'});
  assert.equal((await getStatus(a.client)).available,'50000000000');
  console.log('PASS SePay signature, amount, currency, manual reconciliation, double delivery and early renewal');

  const peer = await signUp('paid-peer@example.test',memory(),'ACCOUNT');
  const peerOrder = await peer.client.json('/v1/billing/orders',{method:'POST',json:{requestId:randomUUID()}});
  await sepay(peerOrder,1007);
  const peerLease = await lease(peer.client,scopes(randomUUID(),'paid-peer'));
  await assert.rejects(enqueue(peer.client,digest('peer-without-key'),peerLease.id),/MODEL_ACCOUNT_KEY_REQUIRED/);
  assert.equal((await credential(peer.user.id,{key:starterGeminiKey},409)).code,'MODEL_KEY_IN_USE');
  await credential(peer.user.id,{key:peerGeminiKey});
  expectedGeminiKey = peerGeminiKey;
  const peerRequest = digest('peer-with-own-key');
  await enqueue(peer.client,peerRequest,peerLease.id);
  assert.equal(await backend.models.workOnce(),true);
  assert.equal((await status(peer.client,peerRequest)).state,'DONE');
  await release(peer.client,peerLease.id);

  const revokedLease = await lease(a.client,scopes(projectId,'paid-key-revoked'));
  const revokedRequest = digest('queued-before-key-revocation');
  const callsBeforeRevoke = providerCalls;
  await enqueue(a.client,revokedRequest,revokedLease.id);
  assert.ok(BigInt((await getStatus(a.client)).held)>0n);
  await credential(a.user.id,{action:'revoke'});
  assert.equal(await backend.models.workOnce(),false);
  const revoked = await status(a.client,revokedRequest);
  assert.equal(revoked.state,'FAILED');
  assert.equal(revoked.error,'MODEL_ACCOUNT_KEY_REQUIRED');
  assert.equal(revoked.dispatched,false);
  assert.equal((await getStatus(a.client)).held,'0');
  assert.equal(providerCalls,callsBeforeRevoke);
  await release(a.client,revokedLease.id);
  await credential(a.user.id,{key:starterGeminiKey});
  expectedGeminiKey = starterGeminiKey;
  const waiting = await signUp('paid-waiting-for-key@example.test',memory(),'ACCOUNT');
  const waitingOrder = await waiting.client.json('/v1/billing/orders',{method:'POST',json:{requestId:randomUUID()}});
  await sepay(waitingOrder,1008);
  console.log('PASS paid credentials scoped to account and provider, trial key isolation and queued revocation');

  const backup = createHttpBackupStore(a.client), alternate = createHttpBackupStore(other.client);
  const now = new Date().toISOString();
  const project = { id:projectId,name:'Starter fixture',avatar:null,createdAt:now,updatedAt:now };
  const content = Buffer.from('{"test":"restore"}');
  const snapshotDir = join(temporary,'snapshot');
  mkdirSync(snapshotDir);
  writeFileSync(join(snapshotDir,'fixture.json'),content);
  const canonical = new ProjectPostStore(snapshotDir);
  try {
    canonical.observe(run,'facebook','fixture-root',{post_id:'fixture-root',text:'Saved root'},now);
    canonical.observe(run+'-repeat','facebook','fixture-root',{post_id:'fixture-root',text:'Saved root'},now);
  } finally { canonical.close(); }
  const files = await snapshotProject(snapshotDir);
  const fingerprint = digest(JSON.stringify({name:project.name,avatar:null,deletedAt:null,files:files.map(f=>[f.path,f.sha256])}));
  const upload = {ownerId:a.user.id,deviceId:randomUUID(),project,revision:0,fingerprint,sourceDirectory:temporary,deletedAt:null};
  const uploadFull = (store, input = upload) => withProjectSnapshot(snapshotDir, snapshot => store.upload(input, snapshot), { full: true });
  const readBackup = (store, owner) => Array.fromAsync(store.files(owner,projectId,1));
  assert.equal(await uploadFull(backup),1);
  assert.equal(await uploadFull(backup),1);
  assert.deepEqual(await readBackup(backup,a.user.id),files);
  const memberships = (await pool.query('SELECT previously_collected FROM csd_backup.project_run_posts WHERE project_id=$1 ORDER BY previously_collected',[projectId])).rows;
  assert.deepEqual(memberships.map(r=>r.previously_collected),[false,true]);
  await assert.rejects(readBackup(alternate,other.user.id),/PROJECT_NOT_FOUND|PROJECT_DATABASE/);
  await assert.rejects(uploadFull(alternate,{...upload,ownerId:other.user.id}),/PROJECT_BACKUP_READ_ONLY|PROJECT_ACCESS_DENIED/);
  await assert.rejects(a.client.json('/v1/projects/backups',{method:'POST',json:{...upload,files:[{path:'../.env',category:'state',sha256:digest(content),size:content.length}]}}),/PROJECT_BACKUP_PATH_INVALID/);

  // Exercise the real remote desktop gateway and its local reservation ledger.
  const paidRun = 'crawl-' + randomUUID();
  const gate = createRunAccess(a.client,projectId,()=>{});
  await gate.begin({runId:paidRun,scope:'COLLECT_AI',budgetUsd:3});
  const spending = createDurableSpend({managed:true,file:join(temporary,'wallet.sqlite'),envelope:()=>({scope:'USER',model:REBUILD_MODEL,totalUsd:30,dailyUsd:6})});
  const gateway = createRemoteModelGateway({directory:join(temporary,'model'),runId:paidRun,budgetUsd:3,client:a.client,access:gate,spending});
  const worker = setInterval(()=>void backend.models.workOnce().catch(()=>{}),200);
  try {
    const output = await gateway.generateJson(modelRequest);
    assert.equal(output.model_version,'fixture-3.1');
    const before = providerCalls;
    await gateway.generateJson(modelRequest);
    assert.equal(providerCalls,before);
    assert.equal(spending.status().calls,1);
    assert.ok(spending.status().measuredUsd>0);
    const beforeRefund = BigInt((await getStatus(a.client)).available);
    const creditPath = 'accounts/' + a.user.id + '/credits';
    await admin(creditPath,{action:'refund',operationId:output.invocation_id,reason:'Verified fixture credit refund'});
    await admin(creditPath,{action:'refund',operationId:output.invocation_id,reason:'Repeat fixture refund'});
    assert.equal(BigInt((await getStatus(a.client)).available)-beforeRefund,BigInt(Math.round(output.cost_usd*1e9)));
    await gate.end();
    const plannerId = 'crawl-' + randomUUID(), prompt = 'Tìm bài viết hỏi về quán cà phê yên tĩnh.';
    const planner = createRemoteModelGateway({directory:join(temporary,'plan'),runId:plannerId,budgetUsd:3,client:a.client,access:gate,spending,planning:true});
    const turn = await compileSemanticTurn({prompt,planner_policy:OPPORTUNITY_PLANNER_POLICY},
      {stage:'S2',prompt,context:'',seeds:[],revision:1,answers:[],edits:[]},planner);
    assert.equal(turn.plan.state,'READY');
    assert.ok(turn.campaign?.queries.length);
    const price = {input_per_million:.3,cached_input_per_million:.006,output_per_million:1.2,observed_at:'2026-11-12'};
    await admin('tariffs',{model:'arbitrary-model',price},'POST',400);
    await admin('tariffs',{model:'deepseek-flash',price},'POST',409);
    await credential(a.user.id,{provider:'deepseek',key:starterDeepseekKey});
    const coverage = (await admin('overview',undefined,'GET')).setup.models.find(model=>model.model==='deepseek-flash');
    assert.equal(coverage.paidKeys,1);
    assert.equal(coverage.paidMissingOnSwitch,1);
    const incomplete = await admin('tariffs',{model:'deepseek-flash',price},'POST',409);
    assert.equal(incomplete.code,'MODEL_ROUTE_KEYS_MISSING');
    assert.equal((await getStatus(peer.client)).aiReason,undefined);
    assert.equal((await admin('overview',undefined,'GET')).tariff[0].model,REBUILD_MODEL);
    await credential(peer.user.id,{provider:'deepseek',key:peerDeepseekKey});
    const switched = await admin('tariffs',{model:'deepseek-flash',price},'POST',201);
    assert.equal(switched.model,'deepseek-flash');
    assert.equal((await getStatus(peer.client)).aiReason,undefined);
    assert.equal((await getStatus(waiting.client)).aiReason,'MODEL_ACCOUNT_KEY_REQUIRED');
    assert.equal((await admin('tariffs',{funding:'TRIAL',model:'deepseek-flash',price},'POST',409)).code,'MODEL_KEY_REQUIRED');
    const trialAfterSwitch = await lease(reinstalledNewDevice,scopes(randomUUID(),'trial-after-paid-switch','PLAN'));
    assert.equal(trialAfterSwitch.model,REBUILD_MODEL);
    await release(reinstalledNewDevice,trialAfterSwitch.id);
    await gate.end();
    await gate.begin({runId:paidRun,scope:'COLLECT_AI',budgetUsd:3});
    assert.equal(gate.lease().model,REBUILD_MODEL);
    assert.equal((await gateway.generateJson({...modelRequest,cache_namespace:'pinned-after-switch'})).model,REBUILD_MODEL);
    await gate.end();
    const nextRun = 'crawl-' + randomUUID();
    await gate.begin({runId:nextRun,scope:'COLLECT_AI',budgetUsd:3});
    assert.equal(gate.lease().route,switched.id);
    const nextGateway = createRemoteModelGateway({directory:join(temporary,'model-switched'),runId:nextRun,budgetUsd:3,client:a.client,access:gate,spending});
    const priorCredits = BigInt((await getStatus(a.client)).available);
    const next = await nextGateway.generateJson(modelRequest);
    assert.equal(next.model,'deepseek-flash');
    assert.equal(next.model_version,'fixture-deepseek');
    assert.equal(nextGateway.summary().model,'deepseek-flash');
    assert.deepEqual(next.value,output.value);
    assert.equal(BigInt((await getStatus(a.client)).available),priorCredits-370200n);
  } finally { clearInterval(worker); await gate.end(); }
  console.log('PASS project backup authorization, remote model switch, pinned runs and credits settlement');

  // Expired paid entitlement retains authenticated backup reads and local exports.
  await admin('payments/1003/refund',{reason:'Synthetic bank refund record'});
  await admin('payments/1004/refund',{reason:'Synthetic renewal refund record'});
  assert.equal((await getStatus(a.client)).reason,'SUBSCRIPTION_REQUIRED');
  assert.deepEqual(await readBackup(backup,a.user.id),files);
  await assert.rejects(uploadFull(backup),/PROJECT_BACKUP_READ_ONLY/);

  const local = join(temporary,'saved');
  mkdirSync(local);
  const savedRun = 'crawl-' + randomUUID(), profileId = 'csd-' + randomUUID();
  const resultDirectory = join(local,'collections',savedRun);
  mkdirSync(join(resultDirectory,'facebook'),{recursive:true});
  writeFileSync(join(resultDirectory,'facebook','posts.json'),JSON.stringify([{post_id:'100',text:'Saved fixture'}]));
  writeFileSync(join(local,'latest-run.json'),JSON.stringify({id:savedRun,state:'STOPPED',startedAt:now,finishedAt:now,minimumPosts:1,
    keywords:['test'],outputDirectory:resultDirectory,platforms:[{platform:'facebook',profileId,state:'STOPPED',count:1,reason:'TRIAL_EXHAUSTED'}],preview:[]}));
  const service = createProductionService({directory:local,version:'test',host:{list:async()=>[{id:profileId,label:'Fixture',platform:'facebook',open:false,persistenceError:null}],sessionStatus:async()=>true},collect:async()=>{throw Error('UNEXPECTED_COLLECTION');},
    access:{begin:async()=>{throw Error('TRIAL_EXHAUSTED');},reason:()=>null,admit:async(_platform,rows)=>rows,end:async()=>{}}});
  service.saveConfig({keywords:['test'],minimumPosts:1,performance:'BALANCED'});
  await assert.rejects(service.start({profiles:[{platform:'facebook',profileId}]}),/TRIAL_EXHAUSTED/);
  const saved = await service.snapshotResults();
  assert.equal(saved.run.id,savedRun);
  assert.equal(saved.facebook[0].text,'Saved fixture');
  await service.shutdown();

  oldBackup = createPostgresBackup(isolated.href);
  const legacy = await oldBackup.authenticate({username:'legacy-test',password:'oldpassword'},true);
  const legacyFolder = join(temporary,'legacy-results');
  mkdirSync(legacyFolder);
  writeFileSync(join(legacyFolder,'user-config.json'),'{"keywords":["fixture"]}');
  const legacyProject = { ...project, id:randomUUID() };
  await withProjectSnapshot(legacyFolder, async snapshot => {
    assert.deepEqual(snapshot.files.map(file=>file.path),['user-config.json']);
    const fingerprint = digest(JSON.stringify({name:legacyProject.name,avatar:null,deletedAt:null,files:snapshot.files.map(f=>[f.path,f.sha256])}));
    const legacyUpload = { ownerId:legacy.id,deviceId:randomUUID(),project:legacyProject,revision:0,fingerprint,
      sourceDirectory:legacyFolder,deletedAt:null,resultsOnly:true };
    assert.equal(await oldBackup.upload(legacyUpload,snapshot),1);
    assert.equal(await oldBackup.upload(legacyUpload,snapshot),1);
  });
  const legacyFiles = await Array.fromAsync(oldBackup.files(legacy.id,legacyProject.id,1));
  assert.equal(legacyFiles[0].content.toString(),'{"keywords":["fixture"]}');
  assert.equal((await pool.query('SELECT 1 FROM csd_backup.project_records WHERE project_id=$1',[legacyProject.id])).rowCount,0);
  const legacyClient = await newClient(memory());
  const imported = await legacyClient.login({username:'legacy-test',password:'oldpassword'},false);
  assert.equal(imported.id,legacy.id);
  assert.equal((await getStatus(legacyClient)).verified,false);
  console.log('PASS legacy account mapping, refunds and access to saved exports');
  console.log('STARTER_INTEGRATION_PASSED');
} catch (error) {
  const safe = error instanceof assert.AssertionError ? error.message : error?.code ?? error?.message;
  // No connection strings or environment values in diagnostic output.
  console.error('STARTER_INTEGRATION_FAILED', String(safe).replaceAll(original,'[database]').replaceAll(isolated.href,'[isolated database]'));
  process.exitCode=1;
} finally {
  await oldBackup?.close().catch(()=>{});
  await backend?.close().catch(()=>{});
  await pool?.end().catch(()=>{});
  if (created && /^findlink_it_[0-9a-f]{32}$/.test(dbName)) await creator.query('DROP DATABASE "' + dbName + '" WITH (FORCE)').catch(()=>{
    console.error('ISOLATED_DATABASE_CLEANUP_FAILED',dbName); process.exitCode=1;
  });
  await creator.end().catch(()=>{});
  const target=resolve(temporary), prefix=resolve(tmpdir())+sep+'findlink-starter-it-';
  if (target.startsWith(prefix) && !target.slice(prefix.length).includes(sep)) rmSync(target,{recursive:true,force:true});
}
