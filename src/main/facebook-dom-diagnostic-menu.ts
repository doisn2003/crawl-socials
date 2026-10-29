import { Menu, MenuItem } from 'electron';
import type { WebContents } from 'electron';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import { createDomReportSink, createFacebookDomDiagnostic,inspectDomRoute } from './facebook-dom-diagnostic.js';
import type { DomTarget } from './facebook-dom-diagnostic.js';
import { createFacebookPublicCandidateProbe, createPublicCandidateSink } from './facebook-public-candidate.js';
import { createFacebookPostRouteVerification } from './facebook-post-route-verification.js';
import type { PostRouteTarget } from './facebook-post-route-verification.js';
import { inspectCurrentGroupPostRoute,resolveObservedGroupQueryHref } from './facebook-public-candidate-fields.js';
import { createFacebookSearchPostOpen } from './facebook-search-post-open.js';

const documents=new WeakMap<WebContents,{generation:number}>();
function documentCounter(wc:WebContents){let state=documents.get(wc);if(!state){state={generation:0};documents.set(wc,state);const counter=state;wc.on('did-navigate',()=>{counter.generation++;});}return state;}

export function resolveFacebookDomTarget(host: BrowserHost, profileId: string, sameDocumentNoop=false): DomTarget | null {
  const target = host.observerTarget(profileId); if (!target) return null;
  const wc = target.contents;
  return { webContentsId: target.webContentsId, viewGeneration: target.viewGeneration,
    url: () => wc.getURL(), execute: code => wc.executeJavaScriptInIsolatedWorld(1004, [{ code }]),
    watchLoss(callback) {
      const expected=wc.getURL(),counter=sameDocumentNoop?documentCounter(wc):null,generation=counter?.generation;let lost=false;
      const loss=()=>{if(!lost){lost=true;callback();}};
      const noOp=(mainUrl?:string)=>{if(!sameDocumentNoop||!counter)return false;try{const current=host.observerTarget(profileId);return !!current&&current.contents===wc&&current.viewGeneration===target.viewGeneration&&counter.generation===generation&&(mainUrl===undefined||mainUrl===expected)&&wc.getURL()===expected;}catch{return false;}};
      const navigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => { if (event.isMainFrame&&!(event.isSameDocument&&noOp(event.url))) loss(); };
      // A child frame's URL is not the owned main document's route. Check only the main context.
      const inPage=(_event:Electron.Event,url:string,main:boolean)=>{if(!(main===true?noOp(url):main===false&&noOp()))loss();};
      wc.on('did-start-navigation', navigation); wc.on('did-navigate-in-page', inPage);
      wc.on('destroyed', loss); wc.on('render-process-gone', loss); wc.on('devtools-opened', loss);
      return () => { wc.removeListener('did-start-navigation', navigation); wc.removeListener('did-navigate-in-page', inPage);
        wc.removeListener('destroyed', loss); wc.removeListener('render-process-gone', loss); wc.removeListener('devtools-opened', loss); };
    } };
}
export function installFacebookDomDiagnosticMenu(input: { host: BrowserHost; userData: string; workspace: string; mode: 'LIVE' | 'FIXTURE' }) {
  let active=false,nativePending=false,runs=0;
  const fence=<T>(work:()=>Promise<T>):Promise<T>=>{if(nativePending)return Promise.reject(new Error('DOM_DIAGNOSTIC_BUSY'));nativePending=true;
    try{return Promise.resolve(work()).finally(()=>{nativePending=false;});}catch(error){nativePending=false;return Promise.reject(error);}};
  const resolve=(id:string,sameDocumentNoop=false):DomTarget|null=>{const target=resolveFacebookDomTarget(input.host,id,sameDocumentNoop);if(!target)return null;
    return{...target,execute(code){return fence(()=>target.execute(code));}};};
  const resolveVerification=(id:string,fromSearch=false):PostRouteTarget|null=>{
    const base=resolve(id,true),owned=input.host.observerTarget(id);if(!base||!owned||base.webContentsId!==owned.webContentsId||base.viewGeneration!==owned.viewGeneration)return null;
    const wc=owned.contents,counter=documentCounter(wc),initialUrl=wc.getURL(),initialGeneration=counter.generation;
    return{...base,documentGeneration:()=>counter.generation,navigateObservedRoute(route){
      const hint=inspectCurrentGroupPostRoute(route);
      const canNavigate=()=>{const current=input.host.observerTarget(id);return !!hint&&!!current&&current.contents===wc&&current.viewGeneration===owned.viewGeneration&&(fromSearch?(inspectDomRoute(initialUrl)==='OK'&&counter.generation===initialGeneration&&wc.getURL()===initialUrl&&resolveObservedGroupQueryHref(route,initialUrl,inspectCurrentGroupPostRoute)===route):(hint.observed_route===route&&JSON.stringify(inspectCurrentGroupPostRoute(wc.getURL()))===JSON.stringify(hint)));};
      if(!canNavigate())return Promise.reject(new Error('OWNER_CHANGED'));
      return fence(()=>{if(!canNavigate())throw new Error('OWNER_CHANGED');return wc.loadURL(route);});
    },watchNavigation(callback){
      const start=(event:Electron.Event<Electron.WebContentsDidStartNavigationEventParams>)=>{if(event.isMainFrame)callback({kind:event.isSameDocument?'SAME_DOCUMENT':'START',url:event.url,source:'DID_START_NAVIGATION',mainFrame:true});};
      const redirect=(event:Electron.Event<Electron.WebContentsDidRedirectNavigationEventParams>)=>{if(event.isMainFrame)callback({kind:'REDIRECT',url:event.url,source:'DID_REDIRECT_NAVIGATION',mainFrame:true});};
      const commit=(_event:Electron.Event,url:string)=>callback({kind:'COMMIT',url,source:'DID_NAVIGATE',mainFrame:true});
      const same=(_event:Electron.Event,url:string,main:boolean)=>callback({kind:'SAME_DOCUMENT',url,source:'DID_NAVIGATE_IN_PAGE',mainFrame:main});
      const destroyed=()=>callback({kind:'OWNER_LOST',source:'DESTROYED'}),gone=()=>callback({kind:'OWNER_LOST',source:'RENDER_PROCESS_GONE'}),devtools=()=>callback({kind:'OWNER_LOST',source:'DEVTOOLS_OPENED'});
      wc.on('did-start-navigation',start);wc.on('did-redirect-navigation',redirect);wc.on('did-navigate',commit);wc.on('did-navigate-in-page',same);wc.on('destroyed',destroyed);wc.on('render-process-gone',gone);wc.on('devtools-opened',devtools);
      return()=>{wc.removeListener('did-start-navigation',start);wc.removeListener('did-redirect-navigation',redirect);wc.removeListener('did-navigate',commit);wc.removeListener('did-navigate-in-page',same);wc.removeListener('destroyed',destroyed);wc.removeListener('render-process-gone',gone);wc.removeListener('devtools-opened',devtools);};
    }};
  };
  const engine = createFacebookDomDiagnostic({ resolve,
    sink: createDomReportSink(input.userData, input.workspace), mode: input.mode });
  const candidateEngine=createFacebookPublicCandidateProbe({resolve,sink:createPublicCandidateSink(input.userData,input.workspace),mode:input.mode});
  let verification:ReturnType<typeof createFacebookPostRouteVerification>;
  let searchOpen:ReturnType<typeof createFacebookSearchPostOpen>;
  let observedUrlOpen:ReturnType<typeof createFacebookSearchPostOpen>;
  const postEngine=createFacebookPublicCandidateProbe({resolve:id=>resolve(id,true),sink:createPublicCandidateSink(input.userData,input.workspace),mode:input.mode,context:'CURRENT_GROUP_POST',onCurrentPost:record=>{verification.observe(record);searchOpen.observe(record);observedUrlOpen.observe(record);}});
  verification=createFacebookPostRouteVerification({resolve:id=>resolveVerification(id),read:id=>postEngine.start(id),stopRead:()=>postEngine.stop(),sink:createPublicCandidateSink(input.userData,input.workspace),mode:input.mode});
  searchOpen=createFacebookSearchPostOpen({resolve:id=>resolveVerification(id),read:id=>postEngine.start(id),stopRead:()=>postEngine.stop(),sink:createPublicCandidateSink(input.userData,input.workspace),mode:input.mode});
  observedUrlOpen=createFacebookSearchPostOpen({resolve:id=>resolveVerification(id,true),read:id=>postEngine.start(id),stopRead:()=>postEngine.stop(),sink:createPublicCandidateSink(input.userData,input.workspace),mode:input.mode,strategy:'OBSERVED_URL'});
  function enter(){if(active||nativePending||runs>=3)throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE');active=true;runs++;}
  const previousMenu = Menu.getApplicationMenu();
  let status: MenuItem | null = null, statusText = 'Chưa đọc DOM';
  let revision = 0, disposed = false;
  async function start(profileId: string) {
    enter();
    statusText = 'Đang đọc DOM một lần…'; if (status) status.label = statusText;
    try { const result = await engine.start(profileId); statusText = 'Kết quả: ' + result.report.status; if (status) status.label = statusText; return result; }
    catch { statusText = 'Không chạy được: busy/limit/output'; if (status) status.label = statusText; throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE'); }
    finally { active=false; }
  }
  async function startCandidates(profileId:string){enter();statusText='Đang trích thử tối đa 5 ứng viên…';if(status)status.label=statusText;
    try{const result=await candidateEngine.start(profileId);statusText='Ứng viên: '+result.summary.status+' / '+result.summary.candidate_count;if(status)status.label=statusText;return result;}
    catch{statusText='Không chạy được: busy/limit/output';if(status)status.label=statusText;throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE');}
    finally{active=false;}}
  async function startCurrentPost(profileId:string){enter();verification.clearAnchor();statusText='Đang đọc một bài nhóm đang mở…';if(status)status.label=statusText;
    try{const result=await postEngine.start(profileId);statusText='Bài đang mở: '+result.summary.status+' / '+result.summary.candidate_count;if(status)status.label=statusText;return result;}
    catch{statusText='Không chạy được: busy/limit/output';if(status)status.label=statusText;throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE');}
    finally{active=false;}}
  async function startRouteVerification(profileId:string){enter();statusText='Đang mở lại và đối chiếu route vừa đọc…';if(status)status.label=statusText;
    try{const result=await verification.start(profileId);statusText='Đối chiếu route: '+result.summary.result+' / '+result.summary.reason;if(status)status.label=statusText;return result;}
    catch{statusText='Không chạy được: busy/limit/output';if(status)status.label=statusText;throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE');}finally{active=false;}}
  async function startSearchPostOpen(profileId:string){enter();verification.clearAnchor();statusText='Đang nhận diện timestamp và mở một bài…';if(status)status.label=statusText;
    try{const result=await searchOpen.start(profileId);statusText='Từ tìm kiếm: '+result.summary.result+' / '+result.summary.reason;if(status)status.label=statusText;return result;}
    catch{statusText='Không chạy được: busy/limit/output';if(status)status.label=statusText;throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE');}finally{active=false;}}
  async function startObservedUrlOpen(profileId:string){enter();verification.clearAnchor();statusText='Đang mở một link bài đã quan sát…';if(status)status.label=statusText;try{const result=await observedUrlOpen.start(profileId);statusText='Link đã thấy: '+result.summary.result+' / '+result.summary.reason;if(status)status.label=statusText;return result;}catch{statusText='Không chạy được: busy/limit/output';if(status)status.label=statusText;throw new Error('DOM_DIAGNOSTIC_UNAVAILABLE');}finally{active=false;}}
  const stop=()=>{observedUrlOpen.stop();searchOpen.stop();verification.stop();engine.stop();candidateEngine.stop();postEngine.stop();};
  async function refresh() {
    const current = ++revision, profiles = await input.host.list(); if (disposed || current !== revision) return;
    const submenu = new Menu();
    submenu.append(new MenuItem({ label: 'Làm mới danh sách phiên', click: () => { void refresh().catch(() => {}); } }));
    for (const profile of profiles.filter(profile => profile.open && !profile.persistenceError && profile.platform !== 'threads')) {
      submenu.append(new MenuItem({ id: 'csd-dom-read-' + profile.id, label: 'Đọc một lần: ' + profile.label,
        click: () => { void start(profile.id).catch(() => {}); } }));
      submenu.append(new MenuItem({id:'csd-public-candidate-read-'+profile.id,label:'Trích tối đa 5 ứng viên công khai: '+profile.label,
        click:()=>{void startCandidates(profile.id).catch(()=>{});}}));
      submenu.append(new MenuItem({id:'csd-current-post-read-'+profile.id,label:'Đọc 1 bài nhóm đang mở (chưa xác minh): '+profile.label,
        click:()=>{void startCurrentPost(profile.id).catch(()=>{});}}));
      submenu.append(new MenuItem({id:'csd-post-route-verify-'+profile.id,label:'Đối chiếu route bài nhóm vừa đọc: '+profile.label,
        click:()=>{void startRouteVerification(profile.id).catch(()=>{});}}));
      submenu.append(new MenuItem({id:'csd-search-post-open-'+profile.id,label:'Mở 1 bài từ timestamp tìm kiếm: '+profile.label,
        click:()=>{void startSearchPostOpen(profile.id).catch(()=>{});}}));
      submenu.append(new MenuItem({id:'csd-observed-url-open-'+profile.id,label:'Mở 1 link bài đã quan sát: '+profile.label,click:()=>{void startObservedUrlOpen(profile.id).catch(()=>{});}}));
    }
    status = new MenuItem({ label: statusText, enabled: false });
    submenu.append(new MenuItem({ label: 'Dừng DOM diagnostic', click: stop })); submenu.append(status);
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{role:'quit'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'},
      {id:'csd-dom-diagnostic',label:'Chẩn đoán Posts',submenu}]));
  }
  return { start, startCandidates, startCurrentPost, startRouteVerification, startSearchPostOpen,startObservedUrlOpen, refresh, stop, dispose() { disposed = true; revision++; stop();verification.dispose();searchOpen.dispose();observedUrlOpen.dispose(); Menu.setApplicationMenu(previousMenu); } };
}
