import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),queries=[];let configPath=null,output=null,profile='CSD Facebook',resume=false,stop=false,exportOnly=false,target=100,maxMinutes=30,maxScrolls=20;
for(let i=0;i<args.length;i++){
 const a=args[i];if(a==='--resume'){resume=true;continue;}if(a==='--stop'){stop=true;continue;}if(a==='--export'){exportOnly=true;continue;}
 const value=args[++i];if(!value)throw new Error('Missing value for '+a);
 if(a==='--config')configPath=resolve(value);else if(a==='--query')queries.push(value);else if(a==='--output')output=resolve(value);else if(a==='--profile')profile=value;else if(a==='--target')target=Number(value);else if(a==='--minutes')maxMinutes=Number(value);else if(a==='--scrolls')maxScrolls=Number(value);else throw new Error('Unknown option '+a);
}
if(!configPath){
 if(resume||stop||exportOnly)throw new Error('--config is required for resume/stop/export');
 if(!queries.length)throw new Error('Provide --query (repeat for multiple queries) or --config');
 const id='facebook-'+new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17);
 output??=join(process.env.APPDATA,'csd-desktop','data','collections',id);
 const rel=relative(root,output);if(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw new Error('OUTPUT_MUST_BE_OUTSIDE_WORKSPACE');
 mkdirSync(output,{recursive:true});configPath=join(output,id+'.json');
 writeFileSync(configPath,JSON.stringify({runId:id,output,profileLabel:profile,queries,maxScrollsPerQuery:maxScrolls,maxMinutes,targetNewRecords:target,settleMs:3000},null,2),{flush:true});
}
const config=JSON.parse(readFileSync(configPath,'utf8'));console.log('Config: '+configPath);console.log('Dataset: '+join(config.output,'posts.jsonl'));
if(stop){const dir=join(config.output,'runs',config.runId);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'STOP'),'USER_STOP\n');process.exit(0);}
if(exportOnly){const {createFacebookCollectorStore}=await import('../dist/infrastructure/browser/facebook-collector-store.js');console.log(JSON.stringify(createFacebookCollectorStore(config.output).export(),null,2));process.exit(0);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(createRequire(import.meta.url)('electron'),['scripts/facebook-collector.mjs','--config',configPath,...(resume?['--resume']:[])],{cwd:root,env,stdio:'inherit',windowsHide:false});
const requestStop=()=>{const dir=join(config.output,'runs',config.runId);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'STOP'),'SIGNAL_STOP\n');};
process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
child.on('error',()=>{console.error('COLLECTOR_LAUNCH_FAILED');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
