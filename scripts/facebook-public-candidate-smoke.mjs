import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,realpath,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
async function main(){
  const i=process.argv.indexOf('--output'),output=i<0?null:resolve(process.argv[i+1]);
  const workspace=fileURLToPath(new URL('../',import.meta.url)),electron=createRequire(import.meta.url)('electron');
  const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'csd-bootstrap-'));
  try{
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(electron,[join(workspace,'.build-csd-dom'),'--csd-facebook-public-candidate-fixture',...(process.argv.includes('--boundary')?['--csd-candidate-boundary-fixture']:[]),...(process.argv.includes('--layout')?['--csd-dom-layout-fixture']:[]),...(process.argv.includes('--overlay')?['--csd-overlay-visibility-fixture']:[]),...(process.argv.includes('--temporal')?['--csd-header-temporal-fixture']:[]),...(process.argv.includes('--visibility')?['--csd-text-visibility-fixture']:[]),...(process.argv.includes('--local-clip')?['--csd-local-clip-fixture']:[]),...(process.argv.includes('--optional-time')?['--csd-optional-time-fixture']:[]),...(process.argv.includes('--header-tree')?['--csd-header-tree-fixture']:[]),...(process.argv.includes('--auxiliary')?['--csd-auxiliary-fixture']:[]),...(process.argv.includes('--public-group')?['--csd-public-group-fixture']:[]),...(process.argv.includes('--post-context')?['--csd-current-post-fixture']:[]),...(process.argv.includes('--post-barriers')?['--csd-current-post-barriers-fixture']:[]),...(process.argv.includes('--post-performance')?['--csd-post-performance-fixture']:[]),...(process.argv.includes('--route-verification')?['--csd-post-route-verification-fixture','--csd-post-route-case='+(process.argv.find(arg=>arg.startsWith('--route-case='))?.slice('--route-case='.length)||'match')]:[]),...(process.argv.includes('--search-post-open')?['--csd-search-post-open-fixture','--csd-search-post-case='+(process.argv.find(arg=>arg.startsWith('--search-case='))?.slice('--search-case='.length)||'placeholder')]:[]),'--allow-manual-facebook-login','--csd-smoke-root='+root],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let codes='';child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{for(const line of String(chunk).split(/\r?\n/))if(/^CSD_STARTUP_FAILED:[A-Z_]+$/.test(line))codes+=line;});
    const timer=setTimeout(()=>child.kill(),25000);
    try{const code=await new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('exit',resolveExit);});if(code!==0)console.error(codes||'CANDIDATE_FIXTURE_PROCESS_FAILED');assert.equal(code,0);}finally{clearTimeout(timer);}
    const report=JSON.parse(await readFile(join(root,'facebook-public-candidate-result.json'),'utf8'));
    assert.equal(report.result,'PASS');assert.equal(report.mode,'FIXTURE');assert.equal(report.windowsAfterClose,0);assert.equal(report.webContentsAfterClose,0);
    if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
    console.log(JSON.stringify({result:report.result,mode:report.mode,cases:report.cases.length,externalNetworkRequests:0,output},null,2));
  }finally{const target=resolve(root);assert.ok(dirname(target)===temp&&basename(target).startsWith('csd-bootstrap-'));await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
void main().catch(()=>{console.error('FACEBOOK_PUBLIC_CANDIDATE_FIXTURE_FAILED');process.exitCode=1;});
