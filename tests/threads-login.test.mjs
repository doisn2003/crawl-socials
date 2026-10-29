import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readThreadsCredentials } from '../scripts/threads-login.mjs';
test('Threads credentials use their own section when PASSWORD keys repeat',()=>{
 const dir=mkdtempSync(join(tmpdir(),'csd-threads-env-'));try{
  const file=join(dir,'.env');writeFileSync(file,'## Facebook clone account\nPHONE_NUMBER="synthetic"\nPASSWORD="facebook-test"\n## Thread account\nUSERNAME="threads-test"\nPASSWORD="threads-test-password"\n');
  assert.deepEqual(readThreadsCredentials(file),{username:'threads-test',password:'threads-test-password'});
  writeFileSync(file,'## Facebook account\nUSERNAME="not-threads"\nPASSWORD="not-threads"\n');assert.throws(()=>readThreadsCredentials(file),/MISSING/);
  writeFileSync(file,'THREADS_USERNAME=explicit-user\nTHREADS_PASSWORD="explicit-test"');assert.deepEqual(readThreadsCredentials(file),{username:'explicit-user',password:'explicit-test'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
