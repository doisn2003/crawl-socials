// Packaged main, preload and renderer with isolated local data and a fixture service.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = resolve(process.argv.find(a => a.startsWith('--module='))?.slice(9) ||
  'release/starter-qa/win-unpacked/resources/app.asar/dist/main/index.js');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url), '--module=' + entry],
    { windowsHide: true, env, stdio: ['ignore','inherit','inherit'] });
  process.exitCode = await new Promise((done,fail) => { child.once('exit', code => done(code ?? 1)); child.once('error',fail); });
} else {
  const { app, dialog, BrowserWindow } = await import('electron');
  const isolated = mkdtempSync(join(tmpdir(), 'findlink-desktop-it-'));
  app.setPath('appData',isolated);
  const qaRoot = join(isolated,'FindLink Starter QA','csd-desktop');
  const local = join(qaRoot,'data');
  const runId = 'crawl-' + randomUUID(), profileId = 'csd-' + randomUUID();
  const outputDirectory = join(local,'collections',runId);
  const now = new Date().toISOString();
  mkdirSync(outputDirectory,{recursive:true});
  writeFileSync(join(outputDirectory,'results.json'),JSON.stringify({facebook:[{post_id:'fixture-post',text:'Bài đã lưu để kiểm tra export.'}],threads:[]}));
  writeFileSync(join(local,'latest-run.json'),JSON.stringify({ id:runId,state:'STOPPED',startedAt:now,finishedAt:now,minimumPosts:1,
    keywords:['cà phê'],outputDirectory,platforms:[{platform:'facebook',profileId,state:'STOPPED',count:1,reason:'USER_STOP'}],preview:[] }));
  const config = JSON.parse(readFileSync(resolve(dirname(entry),'../managed-release.json'),'utf8'));
  assert.equal(config.testOnly,true);
  app.getVersion = () => JSON.parse(readFileSync(resolve(dirname(entry),'../../package.json'),'utf8')).version;
  const user = { id: randomUUID(), username: 'starter-fixture@example.test' };
  const tokens = { accessToken:'a'.repeat(64),refreshToken:'b'.repeat(64),expiresIn:900,deviceId:randomUUID() };
  const routes = [];
  let offline = false, exports = 0;
  dialog.showSaveDialog = async () => ({ canceled:false,filePath:join(isolated,'export-' + ++exports + '.json') });
  globalThis.fetch = async (value, options) => {
    const url = new URL(value);
    assert.equal(url.origin,config.origin);
    routes.push(url.pathname);
    if (offline) throw Error('SYNTHETIC_OFFLINE');
    const path = url.pathname;
    if (path === '/v1/config') return Response.json({ protocol:1 });
    if (path === '/v1/auth/register') {
      assert.equal(options.method,'POST');
      return Response.json({ ...user, ...tokens });
    }
    if (path === '/v1/projects') return Response.json([]);
    if (path === '/v1/projects/claim') return Response.json({ok:true});
    if (path === '/v1/auth/session') return Response.json(user);
    if (path === '/v1/me/entitlements') return Response.json({state:'TRIAL',reason:'TRIAL_EXHAUSTED',
      available:'0',held:'0',spent:'100000000',until:null,rawRemaining:0,verified:true});
    if (path === '/v1/billing/orders') return Response.json({id:randomUUID(),kind:'STARTER',code:'FL123456789ABC',amountVnd:23000000,
      bank:'Fixture Bank',accountNumber:'1000012345',accountName:'Fixture',expiresAt:new Date(Date.now()+60000).toISOString(),paid:false});
    throw Error('UNEXPECTED_FIXTURE_REQUEST');
  };
  const safeCleanup = () => {
    const target = resolve(isolated), prefix = resolve(tmpdir()) + sep + 'findlink-desktop-it-';
    if (target.startsWith(prefix) && !target.slice(prefix.length).includes(sep)) rmSync(target,{recursive:true,force:true,maxRetries:3});
  };
  app.on('quit',() => { try { safeCleanup(); } catch {} });
  const timer = setTimeout(() => { console.error('STARTER_DESKTOP_SMOKE_TIMEOUT'); app.exit(1); },55_000);
  app.on('browser-window-created',(_event,window) => {
    window.show = () => {};
    window.webContents.setBackgroundThrottling(false);
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    window.webContents.once('did-finish-load',() => void (async () => {
      const run = script => window.webContents.executeJavaScript(script);
      async function until(script) {
        for (let i=0;i<100;i++) {
          if (await run(script)) return;
          await new Promise(resolveWait => setTimeout(resolveWait,50));
        }
        throw Error('DESKTOP_CONTROL_NOT_READY');
      }
      try {
        await until("!document.getElementById('managed-starter').hidden");
        const initial = await run('window.csd.getState()');
        assert.equal(initial.managed,true);
        assert.equal(initial.version,'0.5.0');
        assert.equal(app.getName(),'FindLink Starter QA');
        assert.equal(app.getPath('userData'),qaRoot);
        assert.equal(initial.run.id,runId);
        assert.equal(initial.run.resultsOnly,true);
        assert.equal((await run('window.csd.managed.status()')).state,'GUEST');
        assert.match(await run("window.csd.prepareCampaign().then(()=>'',e=>String(e.message))"),/AUTH_REQUIRED/);
        assert.match(await run("window.csd.geminiKey.save({key:'fixture-no-provider-key'}).then(()=>'',e=>String(e.message))"),/MODEL_NOT_AUTHORIZED/);
        const credential = {username:user.username,password:'fixture-desktop-password',invite:'c'.repeat(64)};
        await run('window.csd.projects.register(' + JSON.stringify(credential) + ')');
        assert.equal((await run('window.csd.managed.status()')).reason,'TRIAL_EXHAUSTED');
        assert.match(await run("window.csd.prepareCampaign().then(()=>'',e=>String(e.message))"),/TRIAL_EXHAUSTED/);
        assert.equal(await run("document.getElementById('start').disabled"),true);
        assert.equal(await run("document.getElementById('resume').disabled"),true);
        const order = await run('window.csd.managed.buyStarter()');
        assert.equal(order.amountVnd,23000000);
        offline = true;
        assert.equal((await run('window.csd.managed.status()')).state,'UNAVAILABLE');
        const exported = await run("window.csd.exportResults({format:'json'})");
        assert.equal(exported.canceled,false);
        assert.equal(JSON.parse(readFileSync(exported.path,'utf8')).facebook[0].post_id,'fixture-post');
        assert.deepEqual(errors,[]);
        assert.equal(BrowserWindow.getAllWindows().length,1);
        assert.equal(routes.some(path=>path.startsWith('/v1/ai/')),false);
        console.log('STARTER_DESKTOP_SMOKE_PASSED managed guest, locked trial, SePay order, offline export, isolated AppData');
        clearTimeout(timer); app.quit();
      } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
    })());
  });
  await import(pathToFileURL(entry).href);
}
