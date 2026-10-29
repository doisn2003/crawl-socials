import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
// Legacy .env has duplicate PASSWORD keys; select the Threads section explicitly.
export function readThreadsCredentials(path) {
 let enabled=false;const scoped={},named={};
 for(const line of readFileSync(path,'utf8').split(/\r?\n/)){
  if(/^\s*#/.test(line)){enabled=/\bthreads?\b.*account/i.test(line);continue;}
  const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(!m)continue;
  const value=m[2].replace(/^(['"])(.*)\1$/,'$2');
  if(enabled)scoped[m[1]]=value;if(m[1].startsWith('THREADS_'))named[m[1]]=value;
 }
 const username=named.THREADS_USERNAME||scoped.USERNAME,password=named.THREADS_PASSWORD||scoped.PASSWORD;
 if(!username||!password)throw Error('THREADS_CREDENTIALS_MISSING');return {username,password};
}
export async function ensureThreadsLogin(wc,envPath,execute){
 await wc.loadURL('https://www.threads.com/login');await sleep(2500);
 const hasForm=await execute('!!document.querySelector("input[type=password]")');
 if(!hasForm){if(new URL(wc.getURL()).pathname.includes('login'))throw Error('ACCOUNT_BARRIER');return;}
 const {username,password}=readThreadsCredentials(envPath);
 if(new URL(wc.getURL()).origin!=='https://www.threads.com')throw Error('LOGIN_ORIGIN_DENIED');
 await execute(`(()=>{const u=document.querySelector('input[type="text"]'),p=document.querySelector('input[type="password"]');if(!u||!p)throw Error('LOGIN_FORM_MISSING');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [e,v] of [[u,${JSON.stringify(username)}],[p,${JSON.stringify(password)}]]){set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()`);
 await sleep(300);
 await execute(`(()=>{const b=[...document.querySelectorAll('button,[role="button"]')].find(e=>/^(Log in|Đăng nhập)$/.test(e.innerText.trim()));if(!b)throw Error('LOGIN_BUTTON_MISSING');b.click();return true;})()`);
 for(let i=0;i<15;i++){await sleep(1000);if(!/login|challenge|checkpoint/.test(new URL(wc.getURL()).pathname)&&!await execute('!!document.querySelector("input[type=password]")'))return;}
 throw Error('ACCOUNT_BARRIER');
}
