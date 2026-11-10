import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),queries=[];let configPath=null,output=null,profile='FindLink Threads',resume=false,stop=false,exportOnly=false,target=1000,maxMinutes=90,maxScrolls=80;
for(let i=0;i<args.length;i++){
 const a=args[i];if(a==='--resume'){resume=true;continue;}if(a==='--stop'){stop=true;continue;}if(a==='--export'){exportOnly=true;continue;}
 const value=args[++i];if(!value)throw Error('Missing value for '+a);
 if(a==='--config')configPath=resolve(value);else if(a==='--query')queries.push(value);else if(a==='--output')output=resolve(value);else if(a==='--profile')profile=value;else if(a==='--target')target=Number(value);else if(a==='--minutes')maxMinutes=Number(value);else if(a==='--scrolls')maxScrolls=Number(value);else throw Error('Unknown option '+a);
}
if(!configPath){
 if(resume||stop||exportOnly)throw Error('--config required');
 if(!queries.length)throw Error('Provide --query (repeat for multiple queries) or --config');
 const id='threads-'+new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17);output??=join(process.env.APPDATA,'csd-desktop','data','collections',id);
 const rel=relative(root,output);if(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('OUTPUT_MUST_BE_OUTSIDE_WORKSPACE');
 mkdirSync(join(output,'configs'),{recursive:true});configPath=join(output,'configs',id+'.json');
 writeFileSync(configPath,JSON.stringify({runId:id,output,profileLabel:profile,queries,modes:['top','recent'],maxScrollsPerQuery:maxScrolls,maxMinutes,targetTotal:target,settleMs:3000},null,2),{flush:true});
}
const config=JSON.parse(readFileSync(configPath,'utf8'));console.log('Config: '+configPath);console.log('Dataset: '+join(config.output,'posts.jsonl'));
const requestStop=()=>{const dir=join(config.output,'runs',config.runId);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'STOP'),'USER_STOP\n',{flush:true});};
if(stop){requestStop();process.exit(0);}
if(exportOnly){const{createThreadsCollectorStore}=await import('../dist/infrastructure/browser/threads-collector-store.js');console.log(JSON.stringify(createThreadsCollectorStore(config.output).export(),null,2));process.exit(0);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(createRequire(import.meta.url)('electron'),['scripts/threads-collector.mjs','--config',configPath,...(resume?['--resume']:[])],{cwd:root,env,stdio:'inherit',windowsHide:false});
process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);child.on('error',()=>{console.error('THREADS_LAUNCH_FAILED');process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
