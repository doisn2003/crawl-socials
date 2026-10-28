import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const sha=value=>createHash('sha256').update(value).digest('hex');
const file=fileURLToPath(import.meta.url);
const workspace=resolve(dirname(file),'../../..');

if(!process.versions.electron){
  const modulePath=resolve(arg('--module')||'.test-build-adapter-candidate/v14-performance-baseline/src/main/facebook-public-candidate-script.js');
  const output=resolve(arg('--output')||'.brain/evidence/adapter-p02-post-performance-v14-2026-10-28.json');
  const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'csd-review-post-perf-'));
  try{
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const electron=createRequire(import.meta.url)('electron');
    const child=spawn(electron,[file,'--native','--review-root',root,'--module',modulePath],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{for(const line of String(chunk).split(/\r?\n/))if(line.startsWith('REVIEW_PERF_STAGE:'))console.log(line);});let diagnostics='';child.stderr.on('data',chunk=>{for(const line of String(chunk).split(/\r?\n/))if(line.startsWith('REVIEW_PERF_ERROR:'))diagnostics+=line;});
    const timer=setTimeout(()=>child.kill(),55000);
    const code=await new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('exit',resolveExit);});clearTimeout(timer);
    assert.equal(code,0,diagnostics||'Native performance process failed');
    const report=JSON.parse(await readFile(join(root,'report.json'),'utf8'));
    assert.equal(report.externalNetworkRequests,0);assert.equal(report.windowsAfterClose,0);assert.equal(report.webContentsAfterClose,0);
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,scriptHash:report.scriptHash,cases:report.cases.map(c=>({name:c.name,status:c.status,elapsedMs:c.elapsedMs,stages:c.stages}))},null,2));
  }finally{
    const target=resolve(root);assert.equal(dirname(target),temp);assert.ok(basename(target).startsWith('csd-review-post-perf-'));
    await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}else{
  async function nativeMain(){
  const {app,BrowserWindow,session,webContents}=await import('electron');
  const root=resolve(arg('--review-root'));app.setPath('userData',join(root,'profile'));app.setPath('sessionData',join(root,'session'));
  app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});await app.whenReady();console.log('REVIEW_PERF_STAGE:READY');
  let win=null,external=0;
  try{
    const {FACEBOOK_CURRENT_POST_SCRIPT:script}=await import(pathToFileURL(resolve(arg('--module'))).href);
    const target='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234';
    const fixtureSession=session.fromPartition('review-post-perf-'+randomUUID(),{cache:false});
    let html='';await fixtureSession.protocol.handle('https',request=>{
      if(request.url!==target){external++;return new Response('',{status:403});}
      return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
    });
    await fixtureSession.protocol.handle('http',()=>{external++;return new Response('',{status:403});});
    win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{session:fixtureSession,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    const rows='<div><span>Ordinary neutral text</span><span aria-label="ordinary label">Other neutral text</span></div>';
    const dialog='<div role="dialog" style="position:fixed;top:30px;left:30px;background:white"><h2>Post dialog</h2><article><header><h3>Fixture author</h3><span aria-label="Đã chia sẻ với Nhóm công khai">●</span></header><div data-ad-preview="message">FIXTURE_POST_BODY</div><div role="comment"><span>Comment fixture text</span></div></article></div>';
    const cases=[];
    for(const [name,count,marker,inside] of [
      ['small-positive',32,'',false],['large-positive',12000,'',false],
      ['large-late-auth-sibling',12000,'<input type="password">',false],
      ['large-late-auth-wrapper',12000,'<input autocomplete="one-time-code">',true],
      ['large-late-challenge',12000,'<span>Confirm your identity</span>',false],
      ['large-late-denied',12000,'<span aria-label="Access denied">Restricted</span>',false],
      ['extra-large-positive',24000,'',false],['extra-large-late-challenge',24000,'<span>Confirm your identity</span>',false],
      ['security-overflow',200,'<input type="password" style="display:none">'.repeat(17),false],
      ['dialog-overflow',200,'<div role="dialog" style="display:none"></div>'.repeat(15),false],
    ]){
      const boxed=marker?'<div style="position:fixed;top:5px;left:5px">'+marker+'</div>':'';
      html='<!doctype html><meta charset="utf-8"><title>Local reviewer fixture</title><main>'+rows.repeat(count)+'</main><div role="dialog" style="position:fixed;top:0;left:0;width:100%;height:100%">'+dialog+(inside?boxed:'')+'</div>'+(!inside?boxed:'');
      console.log('REVIEW_PERF_STAGE:LOAD:'+name);await win.loadURL(target);console.log('REVIEW_PERF_STAGE:EVALUATE:'+name);
      const fixtureHash=sha(html);
      const code=`(()=>{const stages=[];const original=document.evaluate;document.evaluate=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{stages.push({stage:args[0].includes('//input')?'SECURITY_XPATH':'DIALOG_XPATH',ms:performance.now()-start});}};const start=performance.now();let value;try{value=eval(${JSON.stringify(script)});}finally{document.evaluate=original;}return{elapsedMs:performance.now()-start,stages,status:value.status,visited:value.visited,inspected:value.barriers.inspected,barrierState:value.barriers.state,barrierReason:value.barriers.reason,samples:value.samples.length,contextHints:value.context_hint?1:0,nodeLimit:value.nodeLimit,timeLimit:value.timeLimit};})()`;
      const result=await win.webContents.executeJavaScriptInIsolatedWorld(1257,[{code}]);
      cases.push({name,rows:count,fixtureHash,...result});console.log('REVIEW_PERF_STAGE:DONE:'+name+':'+Math.round(result.elapsedMs));
    }
    win.destroy();win=null;
    await writeFile(join(root,'report.json'),JSON.stringify({mode:'LOCAL_NATIVE_SYNTHETIC',createdAt:new Date().toISOString(),electron:process.versions.electron,chrome:process.versions.chrome,
      scriptHash:sha(script),harnessHash:sha(await readFile(file)),cases,externalNetworkRequests:external,windowsAfterClose:BrowserWindow.getAllWindows().length,webContentsAfterClose:webContents.getAllWebContents().length},null,2));
    app.exit(0);
  }catch(error){if(win&&!win.isDestroyed())win.destroy();console.error('REVIEW_PERF_ERROR:'+String(error?.message||error));app.exit(1);}
  }
  void nativeMain().catch(error=>{console.error('REVIEW_PERF_ERROR:'+String(error?.message||error));process.exitCode=1;});
}
