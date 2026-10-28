import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const node = process.execPath;
async function compile(args) {
  const child = spawn(node, [join(workspace,'node_modules/typescript/bin/tsc'),...args], {cwd:workspace,stdio:'inherit',windowsHide:true});
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw new Error('DOM_TYPES_FAILED');
}
await compile(['-p','tsconfig.main.json','--outDir','.build-csd-dom']);
await mkdir(join(workspace,'.test-build-csd-dom'),{recursive:true});
await writeFile(join(workspace,'.test-build-csd-dom/tsconfig.json'),JSON.stringify({extends:'../tsconfig.tests.json',
  compilerOptions:{outDir:'.',rootDir:'..'},include:['../tests/facebook-dom-diagnostic.test.ts','../tests/facebook-public-candidate.test.ts','../tests/facebook-current-post.test.ts','../tests/facebook-post-route-verification.test.ts','../tests/facebook-search-post-open.test.ts']},null,2));
await compile(['-p','.test-build-csd-dom/tsconfig.json']);
for(const name of ['campaign.schema.json','campaign.coffee.json','campaign.offline.json','probe-build.json']) {
  await mkdir(join(workspace,'.build-csd-dom/resources'),{recursive:true});
  await copyFile(join(workspace,'dist/resources',name),join(workspace,'.build-csd-dom/resources',name));
}
await copyFile(join(workspace,'tests/fixtures/facebook-current-post-v14-script.json'),join(workspace,'.build-csd-dom/resources/facebook-current-post-v14-script.json'));
await copyFile(join(workspace,'tests/fixtures/facebook-search-open-v21-scripts.json'),join(workspace,'.build-csd-dom/resources/facebook-search-open-v21-scripts.json'));
await copyFile(join(workspace,'tests/fixtures/facebook-search-open-v23-scripts.json'),join(workspace,'.build-csd-dom/resources/facebook-search-open-v23-scripts.json'));
for(const [folder,names] of [['renderer',['index.html','app.js','styles.css']],['preload',['index.cjs']]]) {
  await mkdir(join(workspace,'.build-csd-dom',folder),{recursive:true});
  for(const name of names)await copyFile(join(workspace,'dist',folder,name),join(workspace,'.build-csd-dom',folder,name));
}
const pkg=JSON.parse(await readFile(join(workspace,'package.json'),'utf8'));
await writeFile(join(workspace,'.build-csd-dom/package.json'),JSON.stringify({name:pkg.name,version:pkg.version,type:'module',main:'main/index.js'},null,2));
console.log('DOM isolated build ready: .build-csd-dom / .test-build-csd-dom; shared dist untouched.');
