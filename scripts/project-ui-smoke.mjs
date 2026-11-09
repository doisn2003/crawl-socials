// Isolated renderer regression. Project operations are mocked and network is blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve('artifacts/project-ui-smoke');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url)], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', value => { logs += value; });
  child.stderr.on('data', value => { logs += value; });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, logs);
  console.log(logs.trim());
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  const directory = mkdtempSync(join(tmpdir(), 'csd-project-ui-'));
  app.setPath('userData', join(directory, 'user-data'));
  app.setPath('sessionData', join(directory, 'sessions'));
  mkdirSync(output, { recursive: true });
  const preload = join(directory, 'preload.cjs');
  writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
const api={getState:()=>ipcRenderer.invoke('mock:state'),saveConfig:arg=>ipcRenderer.invoke('mock:config',arg),
geminiKey:{status:async()=>({source:'NONE',readError:false})},discoveryWatch:{list:async()=>[]},projects:{}};
for(const name of ['state','create','update','remove','select','register','login','logout','sync'])api.projects[name]=arg=>ipcRenderer.invoke('mock:project:'+name,arg);
contextBridge.exposeInMainWorld('csd',api);`);
  const timestamp = '2026-11-09T00:00:00Z';
  const project = (id, name) => ({ id, name, avatar: null, createdAt: timestamp, updatedAt: timestamp });
  const config = prompt => ({ schemaVersion: 2, performance: 'BALANCED', keywords: ['piano'], minimumPosts: 100,
    spendLimits: { totalUsd: 3, dailyUsd: 3 }, opportunity: { enabled: true, filterMode: 'CONSISTENT', languageScope: 'VIETNAMESE', prompt,
      brandContext: '', totalTarget: 100, rawCap: 1000, budgetUsd: 3, commentsEnabled: false } });
  const saved = new Map([['first', config('Tìm thảo luận về piano')]]);
  const workspace = { projects: [project('first', 'Piano hôm nay')], activeProjectId: 'first', user: null,
    backup: { configured: true, status: 'PENDING', lastSyncAt: null, error: null } };
  let runState = null, failNextLogin = false;
  const state = () => ({ version: 'project-smoke', config: saved.get(workspace.activeProjectId), accounts: [], run: runState, campaignPresets: [] });
  ipcMain.handle('mock:state', state);
  ipcMain.handle('mock:config', (_event, next) => { saved.set(workspace.activeProjectId, next); return next; });
  const handlers = {
    state: () => workspace,
    create: input => { const p = { ...project('second', input.name), avatar: input.avatar }; workspace.projects.push(p); workspace.activeProjectId = p.id; saved.set(p.id, config('')); return workspace; },
    select: input => { workspace.activeProjectId = input.id; return workspace; },
    update: input => { Object.assign(workspace.projects.find(p => p.id === input.id), input); return workspace; },
    remove: input => { workspace.projects = workspace.projects.filter(p => p.id !== input.id); workspace.activeProjectId = workspace.projects[0].id; return workspace; },
    login: input => {
      assert.equal(input.password, 'test password');
      workspace.user = { id: 'user', username: input.username };
      if (!workspace.projects.some(p => p.id === 'remote')) workspace.projects.push(project('remote', 'Project trên máy khác'));
      saved.set('remote', config('Tìm người học đàn ở nước ngoài'));
      workspace.backup = { configured: true, status: 'SYNCED', lastSyncAt: timestamp, error: null };
      if (failNextLogin) {
        failNextLogin = false;
        workspace.activeProjectId = 'remote';
        throw Error('PROJECT_DATABASE_UNAVAILABLE');
      }
      return workspace;
    },
    register: input => { workspace.user = { id: 'user', username: input.username }; return workspace; },
    logout: () => { workspace.user = null; return workspace; },
    sync: () => { workspace.backup.status = 'SYNCED'; workspace.backup.lastSyncAt = timestamp; return workspace; },
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle('mock:project:' + name, (_event, input) => handler(input));
  const timer = setTimeout(() => { console.error('PROJECT_UI_TIMEOUT'); app.exit(1); }, 60000);
  app.whenReady().then(async () => {
    let window;
    try {
      window = new BrowserWindow({ show: false, width: 1240, height: 1020, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload } });
      const errors = [];
      let networkAttempts = 0;
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, done) => { networkAttempts++; done({ cancel: true }); });
      window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
      const evaluate = code => window.webContents.executeJavaScript(code);
      const until = async condition => {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (typeof condition === 'string' ? await evaluate(condition) : condition()) return;
          await new Promise(done => setTimeout(done, 40));
        }
        throw Error('PROJECT_UI_WAIT_FAILED ' + String(condition));
      };
      const click = id => evaluate(`document.getElementById('${id}').click()`);
      const set = (id, value) => evaluate(`(() => {const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await window.loadFile(resolve('dist/renderer/index.html'));
      await until("!document.getElementById('project-create').disabled");
      assert.equal(await evaluate("document.querySelector('.project-card strong').textContent"), 'Piano hôm nay');
      await set('campaign-prompt', 'Prompt đã sửa được lưu theo project');
      await click('project-create');
      await set('project-name', 'Piano tuần sau');
      await click('project-editor-save');
      await until(() => workspace.activeProjectId === 'second');
      await until("!document.getElementById('project-editor').open");
      assert.equal(saved.get('first').opportunity.prompt, 'Prompt đã sửa được lưu theo project');
      assert.equal(await evaluate("document.getElementById('campaign-prompt').value"), '');
      await evaluate("document.querySelector('.project-select').click()");
      await until("document.getElementById('campaign-prompt').value==='Prompt đã sửa được lưu theo project'");
      await evaluate("document.querySelector('.project-card-actions button').click()");
      await set('project-name', 'Piano • đã đổi tên');
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
      await evaluate(`(() => { const raw=atob(${JSON.stringify(image.split(',')[1])});const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const files=new DataTransfer();files.items.add(new File([bytes],'avatar.png',{type:'image/png'}));const n=document.getElementById('project-avatar-file');n.files=files.files;n.dispatchEvent(new Event('change')); })()`);
      await until("!document.getElementById('project-avatar-preview').hidden");
      await click('project-editor-save');
      await until("!document.getElementById('project-editor').open");
      assert.equal(workspace.projects[0].avatar, image);
      assert.equal(workspace.projects[0].name, 'Piano • đã đổi tên');
      await click('project-auth-open');
      await set('project-username', 'sample user');
      await set('project-password', 'test password');
      await click('project-login');
      await until("!document.getElementById('project-auth-dialog').open");
      assert.equal(await evaluate("document.querySelectorAll('.project-card').length"), 3);
      assert.equal(await evaluate("document.getElementById('project-password').value"), '');
      await evaluate("document.querySelectorAll('.project-select')[2].click()");
      await until("document.getElementById('campaign-prompt').value==='Tìm người học đàn ở nước ngoài'");
      await evaluate("document.querySelectorAll('.project-card-actions')[1].querySelectorAll('button')[1].click()");
      await click('project-delete-confirm');
      await until("!document.getElementById('project-delete-dialog').open");
      assert.equal(workspace.projects.length, 2);
      await click('project-logout');
      await until("!document.getElementById('project-auth-open').hidden && !document.getElementById('project-auth-open').disabled");
      failNextLogin = true;
      await click('project-auth-open');
      await set('project-password', 'test password');
      await click('project-login');
      await until("!document.getElementById('project-auth-error').hidden");
      assert.equal(await evaluate("document.getElementById('campaign-prompt').value"), 'Tìm người học đàn ở nước ngoài');
      await click('project-auth-cancel');
      window.setSize(1241, 1020);
      await new Promise(done => setTimeout(done, 100));
      window.setSize(1240, 1020);
      await new Promise(done => setTimeout(done, 100));
      writeFileSync(join(output, 'projects-desktop.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      window.setSize(800, 1000);
      await new Promise(done => setTimeout(done, 100));
      assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'), false);
      writeFileSync(join(output, 'projects-narrow.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      runState = { id: 'running', state: 'RUNNING', startedAt: timestamp, finishedAt: null, minimumPosts: 100, keywords: ['piano'], outputDirectory: directory, platforms: [], preview: [] };
      await click('reload-state');
      await until("document.getElementById('project-create').disabled");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.project-select')).every(n=>n.disabled)"), true);
      assert.equal(networkAttempts, 0);
      assert.deepEqual(errors, []);
      console.log('Project renderer smoke passed: create, saved prompts, switch, rename, avatar, login restore, partial auth failure recovery, delete, busy locks, desktop and narrow layout.');
      clearTimeout(timer);
      window.destroy();
      app.quit();
    } catch (error) {
      clearTimeout(timer);
      console.error(error);
      window?.destroy();
      app.exit(1);
    }
  });
}
