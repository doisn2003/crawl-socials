// Isolated real Electron compositor probe. No social accounts or network access.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const output = resolve('artifacts/hidden-pagination-probe');
if (!process.versions.electron) {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'),[fileURLToPath(import.meta.url),...process.argv.slice(2)],{env,windowsHide:true,stdio:'inherit'});
  process.exitCode = await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});
} else { void (async () => {
  const {app,BaseWindow,WebContentsView,BrowserWindow,session} = await import('electron');
  const temporary=mkdtempSync(join(tmpdir(),'csd-hidden-pagination-'));
  app.setPath('userData',join(temporary,'user'));app.setPath('sessionData',join(temporary,'sessions'));
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-background-networking');
  app.on('window-all-closed',()=>{});
  const watchdog=setTimeout(()=>app.exit(2),60000);let window,wc,networkAttempts=0;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const capture=async(rect,opts)=>{try{return await Promise.race([wc.capturePage(rect,opts),sleep(3000).then(()=>{throw Error('CAPTURE_TIMEOUT')})]);}catch(error){console.log(error.message);return null;}};
  try {
    await app.whenReady();mkdirSync(output,{recursive:true});
    const isolated=session.fromPartition('hidden-pagination-memory');
    isolated.webRequest.onBeforeRequest((details,callback)=>{const allowed=/^(data:|about:)/.test(details.url);if(!allowed)networkAttempts++;callback({cancel:!allowed});});
    window=new BaseWindow({show:false,skipTaskbar:true,width:1000,height:760});
    const view=new WebContentsView({webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    window.contentView.addChildView(view);const bounds=window.getContentBounds();view.setBounds({x:0,y:0,width:bounds.width,height:bounds.height});
    wc=view.webContents;wc.setBackgroundThrottling(false);
    const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline'"><style>body{margin:0}article{height:400px;border-bottom:1px solid}</style><main></main><div id="sentinel" style="height:10px">load</div><script>
      window.stats={frames:0,intersections:0,pages:0,scrollEvents:0};const main=document.querySelector('main'),sentinel=document.querySelector('#sentinel');
      function add(){stats.pages++;for(let i=0;i<5;i++){const a=document.createElement('article');a.textContent='Synthetic post '+(main.children.length+1);main.append(a);}}
      function tick(){stats.frames++;requestAnimationFrame(tick)};requestAnimationFrame(tick);add();addEventListener('scroll',()=>stats.scrollEvents++);
      new IntersectionObserver(entries=>{stats.intersections++;if(entries.some(e=>e.isIntersecting)&&stats.pages<20)add();}).observe(sentinel);
    </script>`;
    await wc.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await sleep(700);
    const snapshots=[];
    const sample=async label=>{const state=await wc.executeJavaScript('({...stats,visibility:document.visibilityState,top:document.scrollingElement.scrollTop,height:document.scrollingElement.scrollHeight,client:document.scrollingElement.clientHeight,posts:document.querySelectorAll("article").length})');snapshots.push({label,windowVisible:window.isVisible(),...state});writeFileSync(join(output,'progress.json'),JSON.stringify(snapshots,null,2));console.log(JSON.stringify(snapshots.at(-1)));assert.equal(window.isVisible(),false);};
    await sample('baseline-initial');
    for(let i=0;i<3;i++){await wc.executeJavaScript('document.scrollingElement.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');await sleep(600);}
    await sample('baseline-after-scroll');
    for(let i=0;i<3;i++){await wc.executeJavaScript('document.scrollingElement.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');await capture(undefined,{stayHidden:true,stayAwake:true});await sleep(600);}
    await sample('capture-stay-hidden');
    for(let i=0;i<3;i++){await wc.executeJavaScript('document.scrollingElement.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');await capture({x:0,y:0,width:1,height:1},{stayHidden:true,stayAwake:true});await sleep(600);}
    await sample('capture-one-pixel');
    for(let i=0;i<3;i++){await wc.executeJavaScript('document.scrollingElement.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');await capture({x:0,y:0,width:1,height:1},{stayAwake:true});await sleep(600);}
    await sample('capture-page-visible-native-hidden');
    wc.close();window.destroy();
    for(const variant of ['offscreen-view','offscreen-browser-window']) {
      let paints=0;
      if(variant==='offscreen-view') {
        window=new BaseWindow({show:false,skipTaskbar:true,width:1000,height:760});
        const offscreenView=new WebContentsView({webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
        window.contentView.addChildView(offscreenView);offscreenView.setBounds({x:0,y:0,width:1000,height:721});wc=offscreenView.webContents;
      } else {
        window=new BrowserWindow({show:false,skipTaskbar:true,width:1000,height:760,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});wc=window.webContents;
      }
      wc.on('paint',()=>paints++);if(wc.isOffscreen()){wc.setFrameRate(15);wc.startPainting();}
      await wc.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await sleep(700);
      await sample(variant+'-initial');
      for(let i=0;i<3;i++){await wc.executeJavaScript('document.scrollingElement.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');await sleep(600);}
      await sample(variant+'-after-scroll');console.log(JSON.stringify({variant,paints,offscreen:wc.isOffscreen(),type:wc.getType()}));
      wc.close();window.destroy();
    }
    const hostRoot=resolve(process.argv.find(arg=>arg.startsWith('--host-root='))?.slice(12)??'dist');
    const {createBrowserHost}=await import(pathToFileURL(join(hostRoot,'infrastructure/browser/browser-host.js')).href);
    const {createBrowserProfiles}=await import(pathToFileURL(join(hostRoot,'infrastructure/browser/profile-repository.js')).href);
    const profiles=createBrowserProfiles(join(temporary,'profiles')),secrets=new Map();
    const host=createBrowserHost({profiles,secrets:{async get(k){return secrets.get(k)??null},async set(k,v){secrets.set(k,v)},async delete(k){secrets.delete(k)}},
      journalDirectory:join(temporary,'journal'),manualLoginEnabled:false,fixtureOrigin:'http://127.0.0.1:1',
      sessionForPartition:partition=>{const ss=session.fromPartition('memory-probe-'+partition);ss.webRequest.onBeforeRequest((details,callback)=>{const allowed=details.url==='about:blank';if(!allowed)networkAttempts++;callback({cancel:!allowed});});return ss;}});
    try {
      const profile=await profiles.create('Synthetic pagination','threads');const worker=host.forWorker('threads-pagination');
      await worker.open(profile.id);wc=worker.observerTarget(profile.id).contents;window=BaseWindow.getAllWindows().find(w=>!w.isDestroyed());
      await wc.executeJavaScript('document.open();document.write('+JSON.stringify(html)+');document.close();');await sleep(700);await sample('production-host-initial');
      assert.equal(wc.isOffscreen(),true);assert.equal(wc.getFrameRate(),15);
      for(let i=0;i<3;i++){await wc.executeJavaScript('document.scrollingElement.scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');await sleep(600);}
      await sample('production-host-after-scroll');
      assert.ok(snapshots.at(-1).pages>=4);assert.ok(snapshots.at(-1).frames>0);assert.ok(snapshots.at(-1).intersections>0);
      assert.equal(networkAttempts,0);assert.ok(BaseWindow.getAllWindows().every(w=>!w.isVisible()));
      await worker.close(profile.id);
    } finally {await host.shutdown();}
    const result={electron:process.versions.electron,networkAttempts,snapshots};writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(error){console.error(error);process.exitCode=1;}
  finally{if(wc&&!wc.isDestroyed())wc.close();if(window&&!window.isDestroyed())window.destroy();clearTimeout(watchdog);app.exit(process.exitCode??0);}
})().catch(error=>{console.error(error);process.exit(1);});}
