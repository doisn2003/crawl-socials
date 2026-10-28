import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { session,Menu } from 'electron';
import { FACEBOOK_CURRENT_POST_SCRIPT,FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT,FACEBOOK_SEARCH_POST_CLICK_SCRIPT,FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT,FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT } from './facebook-public-candidate-script.js';
import { validatePublicCandidateResult } from './facebook-public-candidate.js';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { installFacebookDomDiagnosticMenu } from './facebook-dom-diagnostic-menu.js';

async function runFacebookObservedUrlFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>,kind:string){
  const cases=['url-success','url-stale-node','url-stale-href','url-stale-subtree','url-invalid','url-placeholder','url-ambiguous','url-popup','url-body','url-hidden','url-private','url-owner','url-stop-revalidate','url-stop-nav','url-redirect','url-time','url-media','url-path','url-role-menuitem','url-role-combobox','url-role-slider','url-barrier'];assert.ok(cases.includes(kind));
  const profile=await host.create('Synthetic exact observed URL'),isolated=session.fromPartition('persist:csd-v1-'+profile.id),search='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i',expected='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234&hoisted_section_header_type=recently_seen&__cft__[0]=FIXTURE&__tn__=FIXTURE';
  const href=kind==='url-placeholder'?search+'&__tn__=FIXTURE':kind==='url-path'?'https://www.facebook.com/groups/123/posts/90071992547409931234/':kind==='url-invalid'?expected+'&unknown_scope=all':expected;
  const decorated='<span aria-labelledby="PRIVATE_ID"><span style="color:rgb(0,0,0)"><svg xmlns="http://www.w3.org/2000/svg" width="120" height="24"><text x="0" y="18">opaque clock</text></svg></span></span>';
  const link='<a role="link" data-fixture-url href="'+href.replace(/&/g,'&amp;')+'"'+(kind==='url-popup'?' aria-haspopup="true"':kind==='url-hidden'?' style="display:none"':'')+'>'+(kind.startsWith('url-role-')?'<span role="'+kind.slice('url-role-'.length)+'">opaque clock</span>':kind==='url-media'?'<img width="20" height="20">':decorated)+'</a>';
  const page='<!doctype html><main><div role="feed"><article><header><h3>FIXTURE_AUTHOR</h3><a href="/groups/123/">FIXTURE_GROUP</a><span aria-label="'+(kind==='url-private'?'Đã chia sẻ với Nhóm riêng tư':'Đã chia sẻ với Nhóm công khai')+'">globe</span>'+(kind==='url-body'?'':link)+(kind==='url-ambiguous'?link:'')+'</header><div data-ad-preview="message">SEARCH_COFFEE_BODY'+(kind==='url-body'?link:'')+'</div></article></div></main><script>window.fixtureClicks=0;document.addEventListener("click",()=>window.fixtureClicks++);</script>';
  const post='<!doctype html><div role="dialog"><div><div role="dialog"><h2>FIXTURE_TITLE</h2><article><header><h3>FIXTURE_AUTHOR</h3><span aria-label="Đã chia sẻ với Nhóm công khai">globe</span></header><div data-ad-preview="message">EXACT_OPENED_BODY sample@example.test</div></article></div></div></div>';
  let release=()=>{},began=()=>{},groupRequests=0;const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{began=resolve;});
  await isolated.protocol.handle('https',async request=>{const u=new URL(request.url);if(u.pathname==='/groups/123/'){groupRequests++;began();if(kind==='url-stop-nav')await held;if(kind==='url-redirect'&&!u.searchParams.has('ref'))return new Response('',{status:302,headers:{location:expected+'&ref=redirect'}});return new Response(post,{headers:{'content-type':'text/html; charset=utf-8'}});}return new Response(page,{headers:{'content-type':'text/html; charset=utf-8'}});});
  let pendingLoad:Promise<void>|null=null;
  try{await host.open(profile.id);const wc=host.ownedContents(profile.id)!;await wc.loadURL(search);await tools.refresh();const native=wc.executeJavaScriptInIsolatedWorld.bind(wc),nativeLoad=wc.loadURL.bind(wc),loads:string[]=[];let clicksBeforeNavigation=0;
    wc.loadURL=(url,options)=>{loads.push(url);pendingLoad=nativeLoad(url,options);void pendingLoad.catch(()=>{});return pendingLoad;};
    wc.executeJavaScriptInIsolatedWorld=(world,scripts,gesture)=>{
      const time=kind==='url-time'&&world===1004&&scripts[0]?.code===FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT;
      const executed=time?scripts.map(script=>({...script,code:'(()=>{const target=document.querySelector("[data-fixture-url]"),get=Element.prototype.getAttribute,oldGet=Object.getOwnPropertyDescriptor(target,"getAttribute"),oldNow=Object.getOwnPropertyDescriptor(performance,"now");let count=0,clock=0;Object.defineProperty(performance,"now",{configurable:true,value:()=>clock});target.getAttribute=function(key){const v=get.call(this,key);if(key==="target"&&++count===2)clock=1000;return v;};try{return ('+script.code+');}finally{if(oldGet)Object.defineProperty(target,"getAttribute",oldGet);else delete target.getAttribute;if(oldNow)Object.defineProperty(performance,"now",oldNow);else delete performance.now;}})()'})):scripts;
      return native(world,executed,gesture).then(async value=>{
        if(world===1004&&scripts[0]?.code===FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT){if(kind==='url-stale-node')await native(1004,[{code:'const node=document.querySelector("[data-fixture-url]");node.replaceWith(node.cloneNode(true));'}]);if(kind==='url-stale-href')await native(1004,[{code:'document.querySelector("[data-fixture-url]").setAttribute("href","/groups/123/?multi_permalinks=999");'}]);if(kind==='url-stale-subtree')await native(1004,[{code:'document.querySelector("[data-fixture-url] span").setAttribute("style","color:blue");'}]);}
        if(world===1004&&scripts[0]?.code===FACEBOOK_OBSERVED_URL_DISCOVER_SCRIPT&&kind==='url-barrier')await native(1004,[{code:'const alert=document.createElement("div");alert.setAttribute("role","alert");alert.textContent="Confirm your identity";document.body.append(alert);'}]);
        if(world===1004&&scripts[0]?.code===FACEBOOK_OBSERVED_URL_REVALIDATE_SCRIPT){clicksBeforeNavigation=await wc.executeJavaScript('window.fixtureClicks');if(kind==='url-owner')await host.close(profile.id);if(kind==='url-stop-revalidate'){began();await held;}}
        return value;
      });
    };
    const pending=tools.startObservedUrlOpen(profile.id);if(['url-stop-nav','url-stop-revalidate'].includes(kind)){await started;tools.stop();}
    const result=await pending;const success=kind==='url-success';assert.equal(result.summary.result,success?'OPENED_POST_SAMPLE':'INCONCLUSIVE');assert.equal(result.summary.click_count,0);assert.equal(result.summary.click_attempt_count,0);assert.equal(clicksBeforeNavigation,0);assert.equal(result.summary.post_read_count,success?1:0);
    const navigated=['url-success','url-redirect','url-stop-nav'].includes(kind);assert.equal(loads.length,navigated?1:0);if(navigated)assert.equal(loads[0],expected);
    if(['url-stop-nav','url-stop-revalidate'].includes(kind)){assert.equal(result.summary.reason,'STOPPED');await assert.rejects(()=>tools.startCandidates(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);release();if(pendingLoad)await pendingLoad;await new Promise<void>(resolve=>setImmediate(resolve));}
    if(kind==='url-redirect'){assert.equal(result.summary.reason,'ROUTE_CHANGED');if(pendingLoad)await pendingLoad;await new Promise<void>(resolve=>setImmediate(resolve));}
    if(kind.startsWith('url-stale-'))assert.equal(result.summary.reason,'STALE_TARGET');if(kind==='url-owner')assert.equal(result.summary.reason,'OWNER_CHANGED');if(kind==='url-barrier')assert.equal(result.summary.reason,'CHALLENGE');if(kind==='url-time')assert.equal(result.summary.reason,'SCAN_INCOMPLETE');
    if(success){assert.equal(result.summary.navigation_count,1);assert.equal(result.summary.fresh_document,true);assert.equal(result.summary.discovery?.opening.targets[0]?.timestamp_proof,'BOUND_HEADER_GROUP_QUERY_URL');assert.ok(result.summary.discovery?.opening.eligibility.shapes.some(s=>s.url_semantics==='CLEAR'&&s.pf_subtree_kind==='UNSUPPORTED'));const proof=JSON.parse(readFileSync(join(result.directory,'candidates.json'),'utf8'));assert.equal(proof.observed_navigation_url,expected);assert.ok(proof.post_read.body_sha256);}
    for(const secret of [expected,'90071992547409931234','PRIVATE_ID','EXACT_OPENED_BODY','__cft__[0]'])assert.equal(JSON.stringify(result.summary).includes(secret),false);
    wc.executeJavaScriptInIsolatedWorld=native;wc.loadURL=nativeLoad;
    if(success){await tools.start(profile.id);await tools.startCandidates(profile.id);await assert.rejects(()=>tools.startObservedUrlOpen(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);}
    return{task:'P02_BOUND_OBSERVED_URL_OPEN',caseKind:kind,result:'PASS',mode:'FIXTURE',schemaVersion:6,cases:[{result:result.summary.result,reason:result.summary.reason,navigations:result.summary.navigation_count,navigationAttempts:result.summary.navigation_attempt_count,clicks:result.summary.click_count,postReads:result.summary.post_read_count,freshDocument:result.summary.fresh_document,discovery:result.summary.discovery,revalidation:result.summary.revalidation,eventTrace:result.summary.event_trace,summarySha256:result.sha256}],exactNavigationUrlPreserved:loads.length?loads[0]===expected:null,nativeNavigationCalls:loads.length,groupRequests,clicksBeforeNavigation,externalNetworkRequests:0,verifiedValidCount:0};
  }finally{release();const settled=pendingLoad as Promise<void>|null;if(settled)await settled.catch(()=>{});isolated.protocol.unhandle('https');}
}

export async function runFacebookSearchPostOpenFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>,kind:string){
  if(kind.startsWith('url-'))return runFacebookObservedUrlFixture(host,tools,kind);
  assert.ok(['placeholder','obfuscated','popup','popup-false','rel-author','generic-public','stale','header-stale','ambiguous','wrong-link','pre-barrier','post-barrier','stop','group-geometry','timestamp-geometry','shape-cap','fragment','fragment-target','fragment-post','fragment-bad','fragment-stale','fragment-popup','fragment-geometry','fragment-pre-barrier','preflight-empty','preflight-self','preflight-blank','preflight-top','preflight-parent','preflight-named','preflight-invalid','preflight-facts','preflight-isolation','preflight-viewport','preflight-time-discovery','preflight-time-click','observed-plain','observed-svg','observed-img','observed-foreign','observed-use','observed-control','observed-unknown','observed-ambiguous','observed-stale-node','observed-stale-href','observed-stale-subtree','observed-offscreen','observed-rects','observed-stop','observed-time','observed-blank','observed-barrier','observed-transparent','observed-transparent-keyword','observed-alpha-positive','observed-target160','observed-target161','observed-stale-target','observed-wrapper-tag','observed-wrapper-attribute','observed-wrapper-blank-tag','observed-wrapper-blank-attribute','observed-passive-plain','observed-passive-svg','observed-passive-media','observed-passive-blank','observed-passive-limit','observed-passive-stale','observed-passive-time'].includes(kind));
  const profile=await host.create('Synthetic observed timestamp'),isolated=session.fromPartition('persist:csd-v1-'+profile.id),search='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';
  const passive=kind.startsWith('observed-passive-'),observed=kind.startsWith('observed-'),stopped=kind==='stop'||kind==='observed-stop',fragment=kind.startsWith('fragment'),href=observed?'https://www.facebook.com/groups/123/posts/90071992547409931234/':kind==='wrong-link'?'javascript:void(0)':kind==='fragment-post'?'https://www.facebook.com/groups/123/posts/456/#?abc':fragment?'https://www.facebook.com/search/top?__cft__[0]='+('x'.repeat(198))+'&amp;__tn__=abcdef'+(kind==='fragment-target'?'#target':kind==='fragment-bad'?'#?ab1':'#?abc'):'https://www.facebook.com/search/top?__cft__[0]=FIXTURE&amp;__tn__=FIXTURE';
  const preflightKind=kind.startsWith('preflight-'),budgetCase=kind.startsWith('preflight-time-'),targetKinds:Record<string,string>={'preflight-empty':'','preflight-self':'_self','preflight-blank':'_blank','preflight-top':'_top','preflight-parent':'_parent','preflight-named':'PRIVATE_WINDOW_42','preflight-invalid':'bad target','preflight-facts':'_blank','preflight-viewport':'_blank'};
  const targetAttr=Object.hasOwn(targetKinds,kind)?' target="'+targetKinds[kind]+'"':'';
  const opaque=observed||preflightKind||['obfuscated','popup','popup-false','rel-author','fragment','fragment-stale','fragment-popup','fragment-geometry','fragment-pre-barrier'].includes(kind),extra=targetAttr+(['observed-target160','observed-target161'].includes(kind)?' target="'+('n'.repeat(kind==='observed-target160'?160:161))+'"':(kind==='observed-blank'||kind==='observed-passive-blank'||kind.startsWith('observed-wrapper-blank-'))?' target="_blank"':kind==='observed-offscreen'?' style="position:absolute;left:-5000px"':kind==='preflight-facts'?' aria-haspopup="true" rel="author" title="menu"':kind==='preflight-viewport'?' style="position:absolute;left:-5000px"':['popup','fragment-popup'].includes(kind)?' aria-haspopup="true"':kind==='popup-false'?' aria-haspopup="false"':kind==='rel-author'?' rel="noopener author"':kind==='obfuscated'?' rel="noopener noreferrer"':'');
  const multiLine=Array.from({length:9},()=>'<span>G</span><br>').join('');
  const geometry=['timestamp-geometry','fragment-geometry','observed-rects'].includes(kind)?' data-fixture-geometry':'';
  const svgStart='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="24" viewBox="0 0 120 24">',svgText=svgStart+'<text x="0" y="18"><tspan>opaque clock</tspan></text></svg>';
  const wrapperTag=kind==='observed-wrapper-tag'||kind==='observed-wrapper-blank-tag',wrapperAttr=kind==='observed-wrapper-attribute'||kind==='observed-wrapper-blank-attribute';
  const passiveLabel=kind==='observed-passive-limit'?'x'.repeat(161):'PRIVATE_ID OTHER_PRIVATE_ID';
  const observedContent=passive?'<span aria-labelledby="'+passiveLabel+'">'+(kind==='observed-passive-plain'?'opaque clock':kind==='observed-passive-media'?'<img width="20" height="20">':svgText)+'</span>':wrapperTag?'<div class="fixture">opaque clock</div>':wrapperAttr?'<span class="fixture" aria-hidden="false" id="PRIVATE_ID">opaque clock</span>':kind==='observed-plain'?'OPAQUE_CLOCK':kind==='observed-img'?'<img width="20" height="20">':kind==='observed-foreign'?svgStart+'<foreignObject width="20" height="20"><span>opaque</span></foreignObject></svg>':kind==='observed-use'?svgStart+'<use href="#PRIVATE"/></svg>':kind==='observed-control'?svgStart+'<a href="/groups/123/posts/2/"><text x="0" y="18">opaque</text></a></svg>':kind==='observed-unknown'?'<custom-tag>opaque</custom-tag>':kind==='observed-rects'?multiLine:svgText;
  const timestamp='<a role="link" data-fixture-timestamp href="'+href+'"'+(opaque?'':' aria-label="2 giờ"')+extra+geometry+'>'+(observed?observedContent:['timestamp-geometry','fragment-geometry'].includes(kind)?multiLine:kind==='popup'?'Options':opaque?'OBFUSCATED_TEXT':'2 giờ')+(kind==='preflight-facts'?'<svg width="1" height="1"></svg>':'')+'</a>';
  const post='<!doctype html><div role="dialog"><div><div role="dialog"><h2>FIXTURE_TITLE</h2><article><header><h3>FIXTURE_AUTHOR</h3><span aria-label="Đã chia sẻ với Nhóm công khai">globe</span></header><div data-ad-preview="message">OPENED_POST_BODY sample@example.test</div><div role="comment"><a href="/groups/123/posts/999/">COMMENT_PRIVATE</a><div data-ad-preview="message">COMMENT_BODY_PRIVATE</div></div></article></div></div></div>'+(kind==='post-barrier'?'<div role="alert">Confirm your identity</div>':'');
  const groupLink='<a href="/groups/123/"'+(kind==='group-geometry'?' data-fixture-geometry':'')+'>'+(kind==='group-geometry'?multiLine:'GROUP_TITLE_PRIVATE')+'</a>';
  const decoys=kind==='preflight-isolation'?'<a role="link" href="'+href+'" target="_blank" data-fixture-geometry>'+multiLine+'</a>':kind==='shape-cap'?['target="_blank"','download','aria-disabled="true"','aria-haspopup="true"','rel="author"'].map(attrs=>'<a role="link" href="'+href+'" '+attrs+'>OPAQUE_PRIVATE</a>').join(''):'';
  const alphaCss=['observed-transparent','observed-transparent-keyword','observed-alpha-positive'].includes(kind)?'<style>[data-fixture-timestamp] svg text,[data-fixture-timestamp] svg tspan{fill:'+(kind==='observed-alpha-positive'?'rgba(0,0,0,0.5)':kind==='observed-transparent-keyword'?'transparent':'rgba(0,0,0,0)')+'}</style>':'';
  const html='<!doctype html>'+alphaCss+'<main><div role="feed"><article><header><h3><a href="/profile.php?id=42">AUTHOR_PRIVATE</a></h3>'+groupLink+'<span aria-label="'+(kind==='generic-public'?'Public':'Đã chia sẻ với Nhóm công khai')+'">globe</span>'+decoys+timestamp+(['ambiguous','observed-ambiguous'].includes(kind)?timestamp:'')+'</header><div data-ad-preview="message">SEARCH_COFFEE_BODY <a href="'+href+'" aria-label="2 giờ">BODY_LINK_PRIVATE</a></div><div role="comment"><a href="'+href+'" aria-label="2 giờ">COMMENT_LINK_PRIVATE</a></div></article></div></main><script>window.fixtureClicks=0;document.addEventListener("click",event=>{const target=event.target.closest("[data-fixture-timestamp]");if(!target)return;event.preventDefault();window.fixtureClickedHref=target.getAttribute("href");window.fixtureClicks++;document.body.innerHTML='+JSON.stringify(post.replace('<!doctype html>',''))+';history.pushState(null,"","/groups/123/?multi_permalinks=90071992547409931234");});</script>';
  let placeholderRequests=0;await isolated.protocol.handle('https',request=>{if(new URL(request.url).pathname.replace(/\/$/,'')==='/search/top')placeholderRequests++;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});});
  let release=()=>{},began=()=>{};const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{began=resolve;});
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;await wc.loadURL(search);await tools.refresh();const observedHref=await wc.executeJavaScript('document.querySelector("[data-fixture-timestamp]").getAttribute("href")');assert.equal(observedHref,href.replace(/&amp;/g,'&'));const geometryRects=await wc.executeJavaScript('document.querySelector("[data-fixture-geometry]")?.getClientRects().length||0');if(['group-geometry','timestamp-geometry','fragment-geometry','preflight-isolation','observed-rects'].includes(kind))assert.ok(geometryRects>8);const native=wc.executeJavaScriptInIsolatedWorld.bind(wc);let heldOnce=false;
    const baseline=JSON.parse(readFileSync(new URL(observed?'../resources/facebook-search-open-v23-scripts.json':'../resources/facebook-search-open-v21-scripts.json',import.meta.url),'utf8')) as {version:number;discovery:string};assert.equal(baseline.version,observed?23:21);
    const baselineScan=await native(1004,[{code:baseline.discovery}]),preflightScan=await native(1004,[{code:FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT}]);
    const eligibilityProjection=(scan:Record<string,any>)=>({status:scan.status,nodeLimit:scan.nodeLimit,timeLimit:scan.timeLimit,opening:{status:scan.searchOpen.status,targets:scan.searchOpen.targets,qualified:scan.searchOpen.qualified_headers,empty:scan.searchOpen.no_timestamp_headers,ambiguous:scan.searchOpen.ambiguous_headers,counters:scan.searchOpen.eligibility.counters}});
    if(!passive)assert.deepEqual(eligibilityProjection(preflightScan),eligibilityProjection(baselineScan));assert.equal(await wc.executeJavaScript('window.fixtureClicks'),0);
    if(passive)await native(1004,[{code:'Object.defineProperty(document,"getElementById",{configurable:true,value:()=>{throw new Error("FIXTURE_IDREF_DEREFERENCE");}});void 0;'}]);
    const svgGlyphGeometry=observed?await wc.executeJavaScript('(()=>{const node=document.querySelector("[data-fixture-timestamp] svg text");return !!node&&node.getComputedTextLength()>0&&[...node.getClientRects()].some(r=>r.width>0&&r.height>0);})()'):null;if(['observed-svg','observed-blank','observed-passive-svg','observed-passive-blank'].includes(kind))assert.equal(svgGlyphGeometry,true);
    const cssFillAlpha=['observed-transparent','observed-transparent-keyword','observed-alpha-positive'].includes(kind)?await wc.executeJavaScript('(()=>{const fill=getComputedStyle(document.querySelector("[data-fixture-timestamp] svg tspan")).fill;return fill==="rgba(0, 0, 0, 0)"?"ZERO":fill==="rgba(0, 0, 0, 0.5)"?"POSITIVE":"UNKNOWN";})()'):null;if(cssFillAlpha!==null){assert.equal(svgGlyphGeometry,true);assert.equal(cssFillAlpha,kind==='observed-alpha-positive'?'POSITIVE':'ZERO');}
    let budgetGate:Record<string,unknown>|null=null;
    wc.executeJavaScriptInIsolatedWorld=(world,scripts,gesture)=>{
      const code=scripts[0]?.code,exhaust=world===1004&&((kind==='preflight-time-discovery'&&code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT)||(['preflight-time-click','observed-time','observed-passive-time'].includes(kind)&&code===FACEBOOK_SEARCH_POST_CLICK_SCRIPT));
      const executed=exhaust?scripts.map(script=>({...script,code:'(()=>{const target=document.querySelector("[data-fixture-timestamp]"),oldGet=Object.getOwnPropertyDescriptor(target,"getAttribute"),oldNow=Object.getOwnPropertyDescriptor(performance,"now"),get=Element.prototype.getAttribute;let reads=0,clock=0;Object.defineProperty(performance,"now",{configurable:true,value:()=>clock});target.getAttribute=function(key){const value=get.call(this,key);if(key==="target"&&++reads===2)clock=1000;return value;};try{return ('+script.code+');}finally{if(oldGet)Object.defineProperty(target,"getAttribute",oldGet);else delete target.getAttribute;if(oldNow)Object.defineProperty(performance,"now",oldNow);else delete performance.now;}})()'})):scripts;
      return native(world,executed,gesture).then(async value=>{
      if(exhaust){assert.equal(value.timeLimit,true);assert.equal(value.searchOpen.status,'SCAN_INCOMPLETE');assert.equal(value.searchOpen.click_count,0);assert.equal(value.searchOpen.eligibility.counters.eligible_records,1);assert.ok(value.searchOpen.eligibility.shapes.some((s:Record<string,unknown>)=>s.stage==='ELIGIBLE'&&s.preflight==='INCOMPLETE'));budgetGate={phase:code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT?'DISCOVER':'CLICK',timeLimit:value.timeLimit,nodeLimit:value.nodeLimit,visited:value.visited};}
      if(world===1004&&scripts[0]?.code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT&&!heldOnce){heldOnce=true;if(kind==='stale')await native(1004,[{code:'const target=document.querySelector("[data-fixture-timestamp]");target.replaceWith(target.cloneNode(true));'}]);if(kind==='header-stale')await native(1004,[{code:'const original=document.querySelector("header"),replacement=original.cloneNode(false);while(original.firstChild)replacement.append(original.firstChild);original.replaceWith(replacement);'}]);if(kind==='pre-barrier')await native(1004,[{code:'const alert=document.createElement("div");alert.setAttribute("role","alert");alert.textContent="Confirm your identity";document.body.append(alert);'}]);if(stopped){began();await held;}}
      if(world===1004&&scripts[0]?.code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT){if(kind==='fragment-stale')await native(1004,[{code:'const target=document.querySelector("[data-fixture-timestamp]");target.setAttribute("href",target.getAttribute("href").replace(/#\\?abc$/,"#?xyz"));'}]);if(kind==='fragment-pre-barrier'||kind==='observed-barrier')await native(1004,[{code:'const alert=document.createElement("div");alert.setAttribute("role","alert");alert.textContent="Confirm your identity";document.body.append(alert);'}]);}
      if(world===1004&&code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT){if(kind==='observed-stale-node')await native(1004,[{code:'const node=document.querySelector("[data-fixture-timestamp]");node.replaceWith(node.cloneNode(true));'}]);if(kind==='observed-stale-href')await native(1004,[{code:'document.querySelector("[data-fixture-timestamp]").setAttribute("href","/groups/123/posts/999/");'}]);if(kind==='observed-stale-subtree')await native(1004,[{code:'document.querySelector("[data-fixture-timestamp] tspan").textContent="another opaque clock";'}]);}
      if(world===1004&&code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT&&kind==='observed-stale-target')await native(1004,[{code:'document.querySelector("[data-fixture-timestamp]").setAttribute("target","n".repeat(161));'}]);
      if(world===1004&&code===FACEBOOK_SEARCH_POST_DISCOVER_SCRIPT&&kind==='observed-passive-stale')await native(1004,[{code:'document.querySelector("[data-fixture-timestamp] span").setAttribute("aria-labelledby","OTHER_PRIVATE_ID");'}]);
      return value;
    });};
    const pending=tools.startSearchPostOpen(profile.id);if(stopped){await started;tools.stop();}
    const result=await pending;
    if(stopped){assert.equal(result.summary.reason,'STOPPED');await assert.rejects(()=>tools.startCandidates(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);release();await new Promise<void>(resolve=>setImmediate(resolve));}
    const success=['placeholder','obfuscated','popup-false','group-geometry','shape-cap','fragment','preflight-empty','preflight-self','preflight-isolation','observed-plain','observed-svg','observed-alpha-positive','observed-passive-plain','observed-passive-svg'].includes(kind);assert.equal(result.summary.result,success?'OPENED_POST_SAMPLE':'INCONCLUSIVE');assert.equal(result.summary.click_count,success||kind==='post-barrier'?1:0);assert.equal(result.summary.post_read_count,success||kind==='post-barrier'?1:0);
    if(['stale','header-stale'].includes(kind))assert.equal(result.summary.reason,'STALE_TARGET');if(kind==='ambiguous')assert.equal(result.summary.reason,'AMBIGUOUS_TIMESTAMP');if(['wrong-link','popup','rel-author','generic-public','timestamp-geometry'].includes(kind))assert.equal(result.summary.reason,'NO_ELIGIBLE_TIMESTAMP');if(['pre-barrier','post-barrier'].includes(kind))assert.equal(result.summary.reason,'CHALLENGE');
    if(kind==='fragment-stale')assert.equal(result.summary.reason,'STALE_TARGET');if(kind==='fragment-pre-barrier')assert.equal(result.summary.reason,'CHALLENGE');if(['fragment-target','fragment-post','fragment-bad','fragment-popup','fragment-geometry'].includes(kind))assert.equal(result.summary.reason,'NO_ELIGIBLE_TIMESTAMP');
    if(preflightKind&&!success)assert.equal(result.summary.reason,budgetCase?'SCAN_INCOMPLETE':'NO_ELIGIBLE_TIMESTAMP');if(budgetCase)assert.ok(budgetGate);
    if(observed){if(kind.includes('stale-'))assert.equal(result.summary.reason,'STALE_TARGET');if(kind==='observed-ambiguous')assert.equal(result.summary.reason,'AMBIGUOUS_TIMESTAMP');if(kind==='observed-time'){assert.equal(result.summary.reason,'SCAN_INCOMPLETE');assert.ok(budgetGate);}if(kind==='observed-barrier')assert.equal(result.summary.reason,'CHALLENGE');}
    if(kind==='observed-passive-stale')assert.equal(result.summary.reason,'STALE_TARGET');if(kind==='observed-passive-time'){assert.equal(result.summary.reason,'SCAN_INCOMPLETE');assert.ok(budgetGate);}
    if(!stopped){
    const diag=result.summary.discovery?.opening.eligibility;assert.ok(diag);assert.ok(diag.shapes.length<=5);for(const value of Object.values(diag.counters))assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=2500);
    if(kind==='group-geometry'){assert.ok(diag.counters.href_rejected>=1);assert.equal(diag.counters.target_visibility_unknown,0);assert.equal(diag.counters.headers_visibility_unknown,0);assert.ok(diag.shapes.some(s=>s.stage==='HREF'&&s.header_invalidation==='NONE'));}
    if(kind==='timestamp-geometry'){assert.ok(diag.counters.target_visibility_unknown>=1);assert.equal(diag.counters.headers_visibility_unknown,1);assert.ok(diag.shapes.some(s=>s.stage==='TARGET_VISIBILITY'&&s.header_invalidation==='TARGET_VISIBILITY'));}
    if(kind==='popup')assert.ok(diag.counters.popup>=1);if(kind==='rel-author')assert.ok(diag.counters.author>=1);if(kind==='shape-cap'){assert.equal(diag.shapes.length,5);assert.equal(diag.shapes_truncated,true);}
    if(['fragment-target','fragment-post','fragment-bad'].includes(kind))assert.ok(diag.shapes.some(s=>s.stage==='HREF'&&s.href_kind==='REJECTED'));if(kind==='fragment-popup')assert.ok(diag.counters.popup>=1);if(kind==='fragment-geometry'){assert.ok(diag.counters.target_visibility_unknown>=1);assert.equal(diag.counters.headers_visibility_unknown,1);}
    if((preflightKind&&!budgetCase)||kind==='fragment'){
      const shape=diag.shapes.find(s=>s.href_kind==='SEARCH_PLACEHOLDER'&&s.stage===(success?'ELIGIBLE':'NEW_WINDOW'));assert.ok(shape);assert.equal(shape.preflight,'COMPLETE');
      const expected=kind==='preflight-empty'?'EMPTY':kind==='preflight-self'?'SELF':kind==='preflight-top'?'TOP':kind==='preflight-parent'?'PARENT':kind==='preflight-named'?'NAMED':kind==='preflight-invalid'?'INVALID':success?'ABSENT':'BLANK';assert.equal(shape.target_kind,expected);
      if(kind==='preflight-facts'){for(const key of ['pf_popup','pf_author','pf_media','pf_action_label'])assert.equal(shape[key],'FAIL');assert.equal(shape.pf_header,'BLOCKED_ANCESTOR');assert.equal(shape.pf_ancestor,'POPUP');assert.equal(shape.pf_rendered,'YES');assert.equal(shape.pf_viewport,'PASS');}
      if(kind==='preflight-viewport')assert.equal(shape.pf_viewport,'FAIL');
      if(kind==='preflight-isolation'){assert.ok(diag.shapes.some(s=>s.target_kind==='BLANK'&&s.stage==='NEW_WINDOW'&&s.pf_visibility==='UNKNOWN'&&s.pf_viewport==='RECT_LIMIT'));assert.equal(diag.counters.target_visibility_unknown,0);assert.equal(diag.counters.headers_visibility_unknown,0);}
    }
    if(observed){const shape=diag.shapes.find(s=>s.href_kind==='OBSERVED_POST');if(success){assert.ok(shape);assert.equal(shape.subtree_kind,['observed-plain','observed-passive-plain'].includes(kind)?'NONE':'SVG_TEXT_ONLY');}if(kind==='observed-blank'){assert.ok(shape);assert.equal(shape.stage,'NEW_WINDOW');assert.equal(shape.pf_subtree_kind,'SVG_TEXT_ONLY');}}
    if(kind==='observed-transparent'||kind==='observed-transparent-keyword'){const shape=diag.shapes.find(s=>s.href_kind==='OBSERVED_POST');assert.ok(shape);assert.equal(shape.subtree_kind,'SVG_OTHER');assert.equal(shape.pf_subtree_kind,'SVG_OTHER');}
    if(kind==='observed-target160'||kind==='observed-target161'){const shape=diag.shapes.find(s=>s.href_kind==='OBSERVED_POST');assert.ok(shape);assert.equal(shape.stage,'NEW_WINDOW');assert.equal(shape.target_kind,kind==='observed-target160'?'NAMED':'INVALID');assert.equal(JSON.stringify(result).includes('n'.repeat(160)),false);}
    if(wrapperTag||wrapperAttr){const shape=diag.shapes.find(s=>s.href_kind==='OBSERVED_POST');assert.ok(shape);const prefix=kind.startsWith('observed-wrapper-blank-')?'pf_subtree':'subtree';assert.equal(shape[prefix+'_reason'],wrapperTag?'HTML_TAG':'ATTR_NOT_ALLOWED');assert.equal(shape[prefix+'_tag'],wrapperTag?'DIV':'SPAN');assert.equal(shape[prefix+'_attr'],wrapperTag?'NONE':'ARIA_HIDDEN');assert.equal(shape[prefix+'_depth'],'D1');assert.equal(JSON.stringify(result).includes('PRIVATE_ID'),false);if(prefix==='pf_subtree'){assert.equal(shape.stage,'NEW_WINDOW');assert.equal(shape.subtree_reason,'NOT_CHECKED');}}
    if(passive){const shape=diag.shapes.find(s=>s.href_kind==='OBSERVED_POST');assert.ok(shape);assert.equal(JSON.stringify(result).includes('PRIVATE_ID'),false);if(kind==='observed-passive-media')assert.equal(shape.subtree_kind,'MEDIA');if(kind==='observed-passive-limit'){assert.equal(shape.subtree_kind,'INCOMPLETE');assert.equal(shape.subtree_reason,'ATTR_VALUE_LIMIT');assert.equal(shape.subtree_attr,'ARIA_LABELLEDBY');}if(kind==='observed-passive-blank'){assert.equal(shape.stage,'NEW_WINDOW');assert.equal(shape.pf_subtree_kind,'SVG_TEXT_ONLY');}}
    }
    const browserClicks=await wc.executeJavaScript('window.fixtureClicks');assert.equal(browserClicks,result.summary.click_count);
    const clickedHref=await wc.executeJavaScript('window.fixtureClickedHref??null');if(browserClicks)assert.equal(clickedHref,observedHref);else assert.equal(clickedHref,null);assert.equal(placeholderRequests,1);
    if(success){assert.equal(result.summary.discovery?.opening.targets.length,1);assert.equal(result.summary.discovery?.opening.targets[0]?.href_kind,observed?'OBSERVED_POST':'SEARCH_PLACEHOLDER');assert.equal(result.summary.discovery?.opening.targets[0]?.timestamp_proof,observed?'UNIQUE_HEADER_POST_LINK':opaque?'UNIQUE_HEADER_PLACEHOLDER':'LABEL');const proof=JSON.parse(readFileSync(join(result.directory,'candidates.json'),'utf8'));assert.equal(proof.observed_post_route.provenance,'OBSERVED_CURRENT_URL');assert.equal(proof.observed_post_route.verification,'UNVERIFIED');assert.equal(proof.observed_post_route.post_id,'90071992547409931234');assert.ok(proof.post_read.body_sha256);}
    for(const secret of [search,'90071992547409931234','OPENED_POST_BODY','AUTHOR_PRIVATE','FIXTURE&amp;','PRIVATE_WINDOW_42','bad target'])assert.equal(JSON.stringify(result).includes(secret),false);
    wc.executeJavaScriptInIsolatedWorld=native;await tools.start(profile.id);await tools.startCandidates(profile.id);await assert.rejects(()=>tools.startSearchPostOpen(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);
    return{task:'P02_OBSERVED_SEARCH_POST_OPEN',caseKind:kind,result:'PASS',mode:'FIXTURE',schemaVersion:5,baselineEligibilityEquivalent:passive?null:true,baselineScriptSha256:createHash('sha256').update(baseline.discovery).digest('hex'),budgetGate,geometryRects,svgGlyphGeometry,cssFillAlpha,cases:[{result:result.summary.result,reason:result.summary.reason,clickAttempts:result.summary.click_attempt_count,clicks:result.summary.click_count,postReads:result.summary.post_read_count,discovery:result.summary.discovery,click:result.summary.click,eventTrace:result.summary.event_trace,summarySha256:result.sha256}],browserClicks,clickedObservedHrefUnchanged:browserClicks?clickedHref===observedHref:null,placeholderRequests,externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{release();isolated.protocol.unhandle('https');}
}

export async function runFacebookPostRouteVerificationFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>,kind:string){
  assert.ok(['match','body','barrier','redirect','stop','same-loading','same-read','away-return','full-same','trace-overflow','iframe-loading','iframe-read','iframe-main-change','iframe-barrier'].includes(kind));
  const profile=await host.create('Synthetic route verification'),isolated=session.fromPartition('persist:csd-v1-'+profile.id),route='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234';
  const iframeCase=kind.startsWith('iframe-');
  const childPage='<!doctype html><h3>IFRAME_AUTHOR_PRIVATE</h3><span aria-label="Đã chia sẻ với Nhóm công khai">globe</span><div data-ad-preview="message">IFRAME_BODY_PRIVATE</div><time>2 giờ</time>'+(kind==='iframe-loading'?'<script>history.replaceState(null,"","/fixture-child?replace=1");history.pushState(null,"","/fixture-child?push=2");</script>':'');
  const page=(body:string)=>'<!doctype html><div role="dialog"><div><div role="dialog"><h2>FIXTURE_TITLE</h2><article><header><h3>FIXTURE_AUTHOR</h3><span aria-label="Đã chia sẻ với Nhóm công khai">globe</span></header><div data-ad-preview="message">'+body+'</div><div role="comment"><a href="/groups/123/posts/999/">COMMENT_ID_PRIVATE</a><time>2 giờ</time><div data-ad-preview="message">COMMENT_BODY_PRIVATE</div></div></article></div></div></div>'+(iframeCase?'<iframe src="https://www.facebook.com/fixture-child" style="position:fixed;bottom:0;left:0;width:120px;height:60px"></iframe>':'');
  let requestStarted=()=>{},release=()=>{};const requested=new Promise<void>(resolve=>{requestStarted=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});let reopenRequests=0;
  await isolated.protocol.handle('https',async request=>{const u=new URL(request.url);if(u.pathname==='/fixture-child')return new Response(childPage,{headers:{'content-type':'text/html; charset=utf-8'}});if(u.pathname==='/groups/123/'&&u.searchParams.get('multi_permalinks')==='90071992547409931234'&&!u.searchParams.has('ref')){
    reopenRequests++;requestStarted();if(kind==='stop')await held;
    if(kind==='redirect')return new Response('',{status:302,headers:{location:'https://www.facebook.com/groups/123/?multi_permalinks=2'}});
    return new Response(page(kind==='body'?'CHANGED_BODY':'SYNTHETIC_COFFEE_BODY')+(kind==='same-loading'?'<script>history.replaceState(null,"",location.href);history.pushState(null,"",location.href);</script>':'')+(['barrier','iframe-barrier'].includes(kind)?'<div role="alert">Confirm your identity</div>':''),{headers:{'content-type':'text/html; charset=utf-8'}});
  }return new Response(page('SYNTHETIC_COFFEE_BODY'),{headers:{'content-type':'text/html; charset=utf-8'}});});
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;await wc.loadURL(route+'&ref=fixture');await tools.refresh();const cases=[];let injectHistory=false,nativeHistoryEvents=0,nativeSubframeHistoryEvents=0;const countHistory=(_event:Electron.Event,_url:string,main:boolean)=>{if(main)nativeHistoryEvents++;else nativeSubframeHistoryEvents++;};const countStart=(event:Electron.Event<Electron.WebContentsDidStartNavigationEventParams>)=>{if(event.isMainFrame&&event.isSameDocument)nativeHistoryEvents++;};wc.on('did-start-navigation',countStart);wc.on('did-navigate-in-page',countHistory);const nativeExecute=wc.executeJavaScriptInIsolatedWorld.bind(wc);
    wc.executeJavaScriptInIsolatedWorld=(world,scripts,gesture)=>{if(injectHistory&&world===1004&&scripts.length===1&&scripts[0]?.code===FACEBOOK_CURRENT_POST_SCRIPT){injectHistory=false;const childHistory='const child=document.querySelector("iframe").contentWindow;child.history.replaceState(null,"","/fixture-child?replace=1");child.history.pushState(null,"","/fixture-child?push=2");';const action=['iframe-read','iframe-barrier'].includes(kind)?childHistory:kind==='iframe-main-change'?'history.replaceState(null,"",location.href+"&ref=changed");'+childHistory:kind==='away-return'?'const previous=location.href;history.pushState(null,"",previous+"&ref=away");history.replaceState(null,"",previous);':kind==='full-same'?'location.reload();':kind==='trace-overflow'?'for(let i=0;i<20;i++)history.replaceState(null,"",location.href);':'history.replaceState(null,"",location.href);history.pushState(null,"",location.href);';return nativeExecute(1004,[{code:action}]).then(()=>nativeExecute(world,scripts,gesture));}return nativeExecute(world,scripts,gesture);};
    if(kind!=='stop'){const noAnchor=await tools.startRouteVerification(profile.id);assert.equal(noAnchor.summary.reason,'NO_ANCHOR');assert.equal(noAnchor.summary.navigation_count,0);cases.push({label:'NO_ANCHOR',result:noAnchor.summary.result,reason:noAnchor.summary.reason});}
    const anchor=await tools.startCurrentPost(profile.id);assert.equal(anchor.summary.status,'SAMPLES_READY');assert.equal(anchor.summary.candidate_count,1);const anchorFile=readFileSync(join(anchor.directory,'candidates.json'),'utf8');
    injectHistory=['same-read','away-return','full-same','trace-overflow','iframe-read','iframe-main-change','iframe-barrier'].includes(kind);const pending=tools.startRouteVerification(profile.id);
    if(kind==='stop'){
      let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([requested,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new Error('FIXTURE_NAVIGATION_NOT_STARTED')),2000);})]);}finally{if(timer)clearTimeout(timer);}
      tools.stop();const stopped=await pending;assert.equal(stopped.summary.reason,'STOPPED');assert.equal(stopped.summary.read_count,0);await assert.rejects(()=>tools.startCandidates(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);
      const finished=new Promise<void>(resolve=>wc.once('did-finish-load',()=>resolve()));release();await finished;await new Promise<void>(resolve=>setImmediate(resolve));
      const consumed=await tools.startRouteVerification(profile.id);assert.equal(consumed.summary.reason,'NO_ANCHOR');cases.push({label:'STOP_PENDING_NAVIGATION',result:stopped.summary.result,reason:stopped.summary.reason,navigationCount:stopped.summary.navigation_count,readCount:stopped.summary.read_count,eventTrace:stopped.summary.event_trace,traceOverflow:stopped.summary.event_trace_overflow,firstCancellation:stopped.summary.first_cancellation},{label:'CONSUMED_ANCHOR',result:consumed.summary.result,reason:consumed.summary.reason});
    }else{
      const verified=await pending;assert.equal(verified.summary.result,['match','same-loading','same-read','iframe-loading','iframe-read'].includes(kind)?'REOPEN_MATCH':kind==='body'?'REOPEN_MISMATCH':'INCONCLUSIVE');assert.equal(verified.summary.reason,['match','same-loading','same-read','iframe-loading','iframe-read'].includes(kind)?'MATCHED':kind==='body'?'BODY_CHANGED':['barrier','iframe-barrier'].includes(kind)?'CHALLENGE':kind==='trace-overflow'?'EVENT_TRACE_LIMIT':'ROUTE_CHANGED');assert.equal(verified.summary.navigation_count,1);assert.equal(verified.summary.read_count,kind==='redirect'?0:1);assert.equal(verified.summary.full_text_verified,false);assert.equal(verified.summary.verified_valid_count,0);assert.equal(verified.summary.canonical_permalink_verification,'UNVERIFIED');assert.equal(verified.summary.source_verification,'UNVERIFIED');
      for(const secret of [route,'90071992547409931234','SYNTHETIC_COFFEE_BODY','COMMENT_BODY_PRIVATE'])assert.equal(JSON.stringify(verified).includes(secret),false);
      const proof=JSON.parse(readFileSync(join(verified.directory,'candidates.json'),'utf8'));assert.equal(proof.anchor.run_id,anchor.summary.run_id);assert.equal(proof.anchor.context_hint.observed_route,route);assert.equal(proof.anchor.context_hint.verification,'UNVERIFIED');if(['match','same-loading','same-read','iframe-loading','iframe-read'].includes(kind)){assert.equal(proof.anchor.body_sha256,proof.reopened.body_sha256);assert.notEqual(proof.anchor.run_id,proof.reopened.run_id);}
      cases.push({label:kind.toUpperCase(),result:verified.summary.result,reason:verified.summary.reason,navigationCount:verified.summary.navigation_count,readCount:verified.summary.read_count,freshDocument:verified.summary.fresh_document,eventTrace:('event_trace' in verified.summary?verified.summary.event_trace:undefined),traceOverflow:('event_trace_overflow' in verified.summary?verified.summary.event_trace_overflow:undefined),firstCancellation:('first_cancellation' in verified.summary?verified.summary.first_cancellation:undefined),summarySha256:verified.sha256});
    }
    if(['iframe-loading','iframe-read','iframe-barrier'].includes(kind)){assert.ok(nativeSubframeHistoryEvents>0);const trace=cases.at(-1) as {eventTrace?:{frame:string;phase:string;decision:string;url_equality:string}[]};const events=trace.eventTrace?.filter(e=>e.frame==='SUBFRAME')||[];assert.ok(events.some(e=>e.phase===(kind==='iframe-loading'?'NAVIGATING':'READING')&&e.decision==='NO_OP'));assert.ok(events.every(e=>e.url_equality==='NOT_APPLICABLE'));assert.equal(anchorFile.includes('IFRAME_'),false);}
    if(['same-loading','same-read','away-return','trace-overflow'].includes(kind))assert.ok(nativeHistoryEvents>0);wc.executeJavaScriptInIsolatedWorld=nativeExecute;wc.removeListener('did-navigate-in-page',countHistory);wc.removeListener('did-start-navigation',countStart);
    assert.equal(readFileSync(join(anchor.directory,'candidates.json'),'utf8'),anchorFile);assert.equal(reopenRequests,1);await assert.rejects(()=>tools.startCandidates(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_POST_ROUTE_VERIFICATION',caseKind:kind,result:'PASS',mode:'FIXTURE',schemaVersion:2,nativeHistoryEvents,nativeSubframeHistoryEvents,cases:[{label:'CURRENT_POST_ANCHOR',status:anchor.summary.status,summarySha256:anchor.sha256},...cases],reopenRequests,externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{release();isolated.protocol.unhandle('https');}
}

export async function runFacebookPostPerformanceFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  // Entirely synthetic, no source access. Frozen v14 and current code run against exactly the same DOM.
  const baseline=JSON.parse(readFileSync(new URL('../resources/facebook-current-post-v14-script.json',import.meta.url),'utf8')) as {sha256:string;script:string};
  const digest=(value:string)=>createHash('sha256').update(value).digest('hex');assert.equal(digest(baseline.script),baseline.sha256);assert.equal(baseline.sha256,'ed4e51967912dab472d37230103a51d42df722cd1896ae0565f876ece8e633cd');
  const profile=await host.create('Synthetic large post workload'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const noise=Array.from({length:4500},(_,i)=>'<div'+(i%4===0?' aria-label="Unrelated synthetic label"':'')+'>'+Array.from({length:5},()=>'<span>Unrelated synthetic text for native performance measurement.</span>').join('')+'</div>').join('');
  let html='<!doctype html><main style="height:0;overflow:hidden">'+noise+'</main><div role="dialog" style="position:fixed;top:40px;left:0"><div><div role="dialog"><h2>FIXTURE_TITLE</h2><article><header><h3>FIXTURE_AUTHOR</h3><span aria-label="Đã chia sẻ với Nhóm công khai">globe</span></header><div data-ad-preview="message">SYNTHETIC_COFFEE_BODY</div><div role="comment"><time>2 giờ</time><div data-ad-preview="message">COMMENT_PRIVATE</div></div></article></div></div></div>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  const instrument=(script:string)=>{
    const security='const scan=document.evaluate(security,document,null,7,null);',dialogs='const dialogs=document.evaluate(\'(//dialog | //*[@role="dialog" or @role="alert"])[position() <= 17]\',document,null,7,null),visible=[];';
    assert.ok(script.includes(security)&&script.includes(dialogs)&&script.includes('const end=performance.now()+1000'));
    return script.replace('const end=performance.now()+1000','const stageStart=performance.now(),end=stageStart+1000')
      .replace(security,'out.stageTimings={preparationMs:performance.now()-stageStart,securityXPathMs:0,dialogXPathMs:0};const securityStart=performance.now();'+security+'out.stageTimings.securityXPathMs=performance.now()-securityStart;')
      .replace(dialogs,'const dialogStart=performance.now();'+dialogs+'out.stageTimings.dialogXPathMs=performance.now()-dialogStart;');
  };
  const predicate=(script:string)=>{const first=script.indexOf('const phrases='),last=script.indexOf('const scan=document.evaluate(security,document,null,7,null);');assert.ok(first>=0&&last>first);return'(()=>{const norm=value=>value.normalize("NFC").replace(/\\s+/g," ").trim().toLowerCase();'+script.slice(first,last)+'return security;})()';};
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/groups/123/?multi_permalinks=90071992547409931234';await wc.loadURL(url);await tools.refresh();
    const equivalence=await wc.executeJavaScriptInIsolatedWorld(1004,[{code:'(()=>{const before='+predicate(baseline.script)+',after='+predicate(FACEBOOK_CURRENT_POST_SCRIPT)+';const phrases=["security check","kiểm tra bảo mật","xác minh bạn là người","confirm your identity","access denied","you do not have permission","bạn không có quyền truy cập"],values=["","unrelated","|",...phrases.flatMap(p=>[p,p.toUpperCase()," \\t"+p+"\\n ",p.replace(/ /g," \\n\\t "),p.slice(1),p+" extra","prefix "+p,"|"+p,p+"|",p.replace(/ /g,"\\u00a0"),p.normalize("NFD")]),...phrases.flatMap(p=>phrases.map(q=>p+"|"+q))];let cases=0,mismatches=0,expectedMismatches=0;for(const channel of ["text","aria-label","title","aria-and-title"]){for(const value of values){const doc=document.implementation.createHTMLDocument(""),node=doc.createElement("span");if(channel==="text")node.textContent=value;else if(channel==="aria-and-title"){node.setAttribute("aria-label","Unrelated");node.setAttribute("title",value);}else node.setAttribute(channel,value);doc.body.append(node);const a=doc.evaluate(before,doc,null,7,null),b=doc.evaluate(after,doc,null,7,null),expected=phrases.includes(value.replace(/[ \\t\\r\\n]+/g," ").replace(/^ | $/g,"").toLowerCase());cases++;if(a.snapshotLength!==b.snapshotLength||(a.snapshotLength&&a.snapshotItem(0)!==b.snapshotItem(0)))mismatches++;if((b.snapshotLength===1)!==expected)expectedMismatches++;}}const sentinel=document.implementation.createHTMLDocument("");for(let i=0;i<18;i++){const node=sentinel.createElement("span");node.setAttribute("title","Access denied");sentinel.body.append(node);}const a=sentinel.evaluate(before,sentinel,null,7,null),b=sentinel.evaluate(after,sentinel,null,7,null);cases++;if(a.snapshotLength!==17||b.snapshotLength!==17)expectedMismatches++;for(let i=0;i<17;i++)if(a.snapshotItem(i)!==b.snapshotItem(i))mismatches++;return{cases,mismatches,expectedMismatches};})()'}]);
    assert.equal(equivalence.mismatches,0);assert.equal(equivalence.expectedMismatches,0);
    const cases=[];for(const [label,script] of [['FROZEN_V14',baseline.script],['OPTIMIZED',FACEBOOK_CURRENT_POST_SCRIPT]]){
      const started=performance.now(),raw=await wc.executeJavaScriptInIsolatedWorld(1004,[{code:instrument(script!)}]),executionMs=performance.now()-started,{stageTimings,...payload}=raw,result=validatePublicCandidateResult(payload,true);
      if(label==='OPTIMIZED'){assert.equal(result.status,'SAMPLES_READY');assert.equal(result.samples.length,1);assert.equal(result.samples[0]!.text,'SYNTHETIC_COFFEE_BODY');assert.equal(result.context_hint?.verification,'UNVERIFIED');}
      cases.push({label,scriptSha256:digest(script!),status:result.status,candidateCount:result.samples.length,visited:result.visited,examined:result.examined,barriers:result.barriers,executionMs,stageTimings});
    }
    // A visible exact marker appears after all unrelated nodes and after the permitted dialog.
    const positiveHtml=html;for(const [label,marker,status] of [['TAIL_AUTH','<input style="position:fixed;top:0;left:0" type="password">','AUTH_REQUIRED'],['TAIL_CHALLENGE_TITLE','<span style="position:fixed;top:0;left:0" aria-label="Unrelated" title="CONFIRM YOUR IDENTITY">neutral</span>','CHALLENGE'],['TAIL_DENIED','<span style="position:fixed;top:0;left:0">Access denied</span>','ACCESS_DENIED']]){
      html=positiveHtml+marker;await wc.loadURL(url);const tail=await tools.startCurrentPost(profile.id);assert.equal(tail.summary.status,status);assert.equal(tail.summary.candidate_count,0);assert.equal(tail.summary.context_hint_count,0);cases.push({label,status:tail.summary.status,candidateCount:tail.summary.candidate_count,visited:tail.summary.visited,examined:tail.summary.examined,barriers:tail.summary.barriers});}
    await assert.rejects(()=>tools.startCandidates(profile.id),/DOM_DIAGNOSTIC_UNAVAILABLE/);
    return{task:'P02_POST_SECURITY_PERFORMANCE',result:'PASS',mode:'FIXTURE',schemaVersion:14,workload:{unrelatedCards:4500,unrelatedElements:27000,unrelatedTextNodes:22500,unrelatedLabelAttributes:1125,placement:'SIBLINGS_BEFORE_POST_AND_TAIL_MARKER',machinePlatform:process.platform,machineArch:process.arch,electron:process.versions.electron,chromium:process.versions.chrome},equivalence,cases,externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookCurrentPostFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>,barriers=false){
  const profile=await host.create('Synthetic current post fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const group='123456',postId='90071992547409931234',url='https://www.facebook.com/groups/'+group+'/?multi_permalinks='+postId+'&hoisted_section_header_type=recently_seen';
  const article='<article><header><h3>AUTHOR_PRIVATE</h3><span role="img" aria-label="Đã chia sẻ với Nhóm công khai">globe</span></header><div data-ad-preview="message">POST_BODY coffee contact sample@example.test</div><div role="comment" aria-label="Bình luận của COMMENT_PRIVATE"><h3>COMMENT_AUTHOR_PRIVATE</h3><time>2 giờ</time><a href="/groups/123456/posts/777/">COMMENT_ID_PRIVATE</a><div data-ad-preview="message">COMMENT_BODY_PRIVATE</div></div></article>';
  const dialog='<div role="dialog"><h2>POST_TITLE_PRIVATE</h2>'+article+'</div>',wrap=(content:string)=>'<!doctype html><div role="dialog"><div>'+content+'</div></div>';
  let html=wrap(dialog);await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;await tools.refresh();const cases=[];
    if(!barriers){
      await wc.loadURL(url);const positive=await tools.startCurrentPost(profile.id);const payload=JSON.parse(readFileSync(join(positive.directory,'candidates.json'),'utf8')),sample=payload.samples[0];
      assert.equal(positive.summary.candidate_count,1);assert.equal(positive.summary.version,14);assert.equal(positive.summary.route,'GROUP_SINGLE_POST');assert.equal(positive.summary.root,'POST_DIALOG');
      assert.equal(payload.context_hint.group_id,group);assert.equal(payload.context_hint.post_id,postId);assert.equal(payload.context_hint.verification,'UNVERIFIED');assert.equal(payload.context_hint.observed_route.includes('hoisted'),false);
      assert.equal(sample.post_id,null);assert.equal(sample.permalink,null);assert.equal(sample.published_at,null);assert.equal(sample.source_type,'UNKNOWN');assert.equal(sample.boundary_verified,false);assert.equal(sample.metadata.temporal,0);assert.equal(sample.metadata.timeTag,false);assert.equal(sample.metadata.messageRegions,1);assert.equal(sample.metadata.headings,2);assert.equal(sample.text,'POST_BODY coffee contact [EMAIL]');assert.equal(sample.contacts_redacted,true);
      for(const secret of ['COMMENT','AUTHOR_PRIVATE','TITLE_PRIVATE',group,postId])assert.equal(JSON.stringify(positive.summary).includes(secret),false);
      assert.equal(JSON.stringify(payload.samples).includes('COMMENT'),false);assert.equal(positive.summary.context?.wrapperDialogs,1);cases.push(positive);
      html=wrap(dialog.replace('</article>','<div data-ad-preview="message">SECOND_BODY_PRIVATE</div></article>'));await wc.loadURL(url);const ambiguous=await tools.startCurrentPost(profile.id);assert.equal(ambiguous.summary.candidate_count,0);assert.equal(ambiguous.summary.context_hint_count,0);cases.push(ambiguous);
      html='<!doctype html><main></main>';await wc.loadURL('https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i');const search=await tools.startCandidates(profile.id);assert.equal(search.summary.version,13);cases.push(search);
    }else{
      for(const [marker,status] of [['<input type="password">','AUTH_REQUIRED'],['<div role="alert">Confirm your identity</div>','CHALLENGE'],['<div role="dialog"><h2>OTHER_PRIVATE</h2></div>','UNSUPPORTED_OVERLAY']]){
        html=wrap(dialog)+marker;await wc.loadURL(url);const result=await tools.startCurrentPost(profile.id);assert.equal(result.summary.status,status);assert.equal(result.summary.candidate_count,0);assert.equal(result.summary.context_hint_count,0);cases.push(result);
      }
    }
    for(const action of [()=>tools.start(profile.id),()=>tools.startCandidates(profile.id),()=>tools.startCurrentPost(profile.id)])await assert.rejects(action,/DOM_DIAGNOSTIC_UNAVAILABLE/);
    assert.equal(wc.debugger.isAttached(),false);
    return{task:barriers?'P02_CURRENT_POST_BARRIERS':'P02_CURRENT_POST_CONTEXT',result:'PASS',mode:'FIXTURE',schemaVersion:14,cases:cases.map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,examined:value.summary.examined,nodeLimit:value.summary.node_limit,context:value.summary.context,barriers:value.summary.barriers,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookPublicGroupFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic exact public group fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const group='Đã chia sẻ với Nhóm công khai',known='Đã chia sẻ với Công khai',privateGroup='Đã chia sẻ với Nhóm riêng tư';
  const graphic=(label:string,key='aria-label',style='display:inline-block;width:16px;height:16px')=>'<span role="img" '+key+'="'+label+'" style="'+style+'"></span>';
  const post=(badge:string,body='GROUP_PUBLIC_BODY',extra='',tag='article')=>'<'+tag+'><header><h3>AUTHOR_PRIVATE</h3>'+badge+'</header><div data-ad-preview="message">'+body+'</div>'+extra+'</'+tag+'>';
  const kinds=['GROUP_GRAPHIC_ARIA','GROUP_GRAPHIC_TITLE','KNOWN_PUBLIC_BUTTON','GROUP_ROLEBUTTON','KNOWN_PUBLIC_GRAPHIC'];
  let html='<!doctype html><main><div role="feed">'+post('<svg role="img" aria-label="'+group+'" width="16" height="16"><circle cx="8" cy="8" r="6"></circle></svg>',kinds[0])+post(graphic(group,'title'),kinds[1])+post('<button aria-label="'+known+'"><span>globe</span></button>',kinds[2])+post('<div role="button" title="'+group+'"><span>globe</span></div>',kinds[3])+post('<img aria-label="'+known+'" width="16" height="16" alt="">',kinds[4])+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const positive=await tools.startCandidates(profile.id);const samples=JSON.parse(readFileSync(join(positive.directory,'candidates.json'),'utf8')).samples;assert.equal(positive.summary.candidate_count,5);assert.ok(samples.every((s:{source_type:string;published_at:null;metadata:{publicLabels:number};missing_fields:string[]})=>s.source_type==='UNKNOWN'&&s.published_at===null&&s.metadata.publicLabels===1&&s.missing_fields.includes('PUBLICITY_NOT_INDEPENDENTLY_VERIFIED')));assert.equal(positive.summary.diagnostics?.headers.publicLabelsSeen,5);assert.equal(positive.summary.diagnostics?.headers.publicSignalsAccepted,5);assert.equal(positive.summary.diagnostics?.headers.publicControlsPruned,2);
    html='<!doctype html><main><div role="feed">'+post(graphic(privateGroup),'PRIVATE_GROUP_BODY')+post(graphic(group),'CONFLICT_PRIVATE',graphic(privateGroup))+
      post('','<span aria-label="'+group+'">BODY_ONLY_PRIVATE</span>')+post('<q>'+graphic(group)+'</q>','QUOTE_PRIVATE')+post('<div role="comment">'+graphic(group)+'</div>','COMMENT_PRIVATE')+
      post(graphic(group,'aria-label','display:inline-block;width:16px;height:16px;visibility:hidden'),'HIDDEN_PRIVATE')+
      post('<div style="overflow:hidden;width:12px">'+graphic(group,'aria-label','display:inline-block;width:120px;height:16px')+'</div>','PARTIAL_PRIVATE')+
      post('','FOOTER_PRIVATE','<footer>'+graphic(group)+'</footer>')+post(graphic('nội dung '+group),'SUBSTRING_PRIVATE')+
      post('','<button aria-label="'+group+'">BODY_BUTTON_PRIVATE</button>')+post('<button>'+graphic(group)+'</button>','NESTED_ONLY_PRIVATE')+
      post('<button aria-label="'+group+'"><span aria-label="Friends">private</span></button>','CONTROL_CONFLICT_PRIVATE')+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,0);assert.equal(negative.summary.node_limit,false);assert.equal(negative.summary.examined,12);assert.equal(readFileSync(join(negative.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed"></div><section>'+post('<button aria-label="'+group+'"><span>globe</span></button>','GROUP_PUBLIC_BODY','','div')+post(graphic(group))+'</section></main>';await wc.loadURL(url);
    const fallback=await tools.startCandidates(profile.id);assert.equal(fallback.summary.candidate_count,2);assert.equal(fallback.summary.selection?.fallbackScan,'COMPLETE');assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_PUBLIC_GROUP',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[positive,negative,fallback].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,examined:value.summary.examined,nodeLimit:value.summary.node_limit,diagnostics:value.summary.diagnostics,selection:value.summary.selection,rejected:value.summary.rejected,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookAuxiliaryFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic auxiliary fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const style='display:inline-block;overflow:hidden;width:200px;height:12.5px;line-height:12.5px;font-size:16px';
  const partial=(text:string)=>'<span style="'+style+'">'+text+'</span>';
  const post=(aux='',body='AUX_PUBLIC_BODY',time='',author='AUTHOR_PRIVATE',footer='')=>'<article><header><h3>'+author+'</h3><span aria-label="Public">globe</span>'+time+aux+'</header><div data-ad-preview="message">'+body+'</div>'+footer+'</article>';
  const wrap=(count:number,text:string)=>'<div>'.repeat(count)+text+'</div>'.repeat(count);
  let html='<!doctype html><main><div role="feed">'+post('','AUX_PUBLIC_BODY','','AUTHOR_PRIVATE'+partial('AUTHOR_DECORATION'))+
    post(partial('123 reactions'))+post('','AUX_PUBLIC_BODY','','AUTHOR_PRIVATE','<footer>'+partial('auxiliary counts')+'</footer>')+
    post('<q>'+partial('Friends')+'</q>')+post('','AUX_PUBLIC_BODY','<time style="'+style+'">2 giờ</time>')+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const positive=await tools.startCandidates(profile.id);assert.equal(positive.summary.version,13);assert.equal(positive.summary.candidate_count,5);assert.equal(positive.summary.node_limit,false);
    const samples=JSON.parse(readFileSync(join(positive.directory,'candidates.json'),'utf8')).samples;assert.ok(samples.every((s:{text:string;published_at:null})=>s.text==='AUX_PUBLIC_BODY'&&s.published_at===null));assert.ok(samples.slice(0,4).every((s:{metadata:{auxiliaryTextOmitted:boolean};missing_fields:string[]})=>s.metadata.auxiliaryTextOmitted&&s.missing_fields.includes('AUXILIARY_TEXT_OMITTED')));assert.equal(samples[4].metadata.temporal,0);assert.equal(samples[4].metadata.temporalStatus,'UNREADABLE');assert.equal(samples[4].metadata.auxiliaryTextOmitted,false);
    for(const value of [JSON.stringify(samples),JSON.stringify(positive.summary),readFileSync(join(positive.directory,'started.json'),'utf8')])for(const secret of ['AUTHOR_DECORATION','123 reactions','auxiliary counts'])assert.equal(value.includes(secret),false);
    html='<!doctype html><main><div role="feed">'+post('',partial('BODY_PRIVATE'))+post('','PREFIX'+wrap(40,partial('DEEP_BODY_PRIVATE')))+
      '<article><header><h3>A</h3><div style="overflow:hidden;width:12px"><span aria-label="Public" style="display:inline-block;width:120px">globe</span></div></header><div data-ad-preview="message">PUBLIC_PRIVATE</div></article>'+
      post(partial('Friends'),'EXACT_PRIVATE')+post(partial('Sponsored'),'AD_PRIVATE')+
      post('<span><span>Fri</span><span>ends</span></span>','SPLIT_PRIVATE')+post('<span><span>Bạn</span> <span>bè</span></span>','VI_PRIVATE')+
      post('<span style="'+style+'"><span>Spon</span><span>sored</span></span>','PARTIAL_AD_PRIVATE')+
      post('<button><span style="'+style+'"><span>Fri</span><span>ends</span></span></button>','CONTROL_PRIVATE')+
      post('','OUTER<blockquote><div data-ad-comet-preview="message">QUOTE_PRIVATE</div></blockquote>')+
      post('','ONE_PRIVATE<div data-ad-comet-preview="message">TWO_PRIVATE</div>')+
      post('<span style="'+style.replace('width:200px','width:2000px')+';white-space:pre">'+'<span>X</span>'.repeat(97)+'</span>','SCOPE_LIMIT_PRIVATE')+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,0);assert.equal(negative.summary.node_limit,false);assert.equal(negative.summary.examined,12);assert.ok((negative.summary.rejected?.CONFLICTING_PUBLIC||0)>=4);assert.ok((negative.summary.rejected?.AD_OR_SUGGESTION||0)>=2);assert.ok((negative.summary.diagnostics?.layout.negativeUnresolved||0)>0);assert.equal(readFileSync(join(negative.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed">'+post(partial('decoration'),'<span>X</span>'.repeat(2600))+post()+'</div></main>';await wc.loadURL(url);
    const global=await tools.startCandidates(profile.id);assert.equal(global.summary.candidate_count,0);assert.equal(global.summary.visited,2500);assert.equal(global.summary.node_limit,true);assert.equal(global.summary.examined,1);assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_AUXILIARY',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[positive,negative,global].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,examined:value.summary.examined,nodeLimit:value.summary.node_limit,diagnostics:value.summary.diagnostics,geometryShapes:value.summary.geometry_shapes,rejected:value.summary.rejected,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookHeaderTreeFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic header tree fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const wrap=(count:number,content:string)=>'<div style="display:contents">'.repeat(count)+content+'</div>'.repeat(count);
  const post=(headingDepth:number,publicDepth:number,timeDepth:number|null=null,body='HEADER_TREE_BODY')=>'<article><header>'+wrap(headingDepth,'<h3>AUTHOR_PRIVATE</h3>')+wrap(publicDepth,'<span aria-label="Public">globe</span>')+(timeDepth===null?'':wrap(timeDepth,'<time>2 giờ</time>'))+'</header><div data-ad-preview="message">'+body+'</div></article>';
  let html='<!doctype html><main><div role="feed">'+post(0,0)+post(20,20)+post(16,18,12)+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const positive=await tools.startCandidates(profile.id);assert.equal(positive.summary.candidate_count,3);assert.equal(positive.summary.node_limit,false);assert.equal(positive.summary.diagnostics?.headers.publicClustersFound,3);assert.equal(positive.summary.diagnostics?.headers.clustersFound,1);assert.equal(positive.summary.diagnostics?.headers.ancestryCuts,0);assert.equal(positive.summary.diagnostics?.headers.treeIncomplete,0);
    const samples=JSON.parse(readFileSync(join(positive.directory,'candidates.json'),'utf8')).samples;assert.ok(samples.every((s:{text:string;published_at:null})=>s.text==='HEADER_TREE_BODY'&&s.published_at===null));assert.equal(samples[1].metadata.headerProof,'HEADING_PUBLIC');assert.equal(samples[2].metadata.headerProof,'HEADING_TEMPORAL_PUBLIC');
    html='<!doctype html><aside><span aria-label="Public">sidebar</span></aside><main><div role="feed">'+
      '<article><header>'+wrap(12,'<h3>A</h3>')+'</header><header>'+wrap(12,'<span aria-label="Public">globe</span>')+'</header><div data-ad-preview="message">SPLIT_PRIVATE</div></article>'+
      '<article><header><h3>A</h3></header><header><span aria-label="Public">globe</span></header>'+wrap(40,'<div data-ad-preview="message">DEEP_BODY_PRIVATE</div>')+'</article>'+
      '<article><header><h3>A</h3><span aria-label="Public"></span></header><div data-ad-preview="message">BODY_A_PRIVATE</div><div data-ad-comet-preview="message">BODY_B_PRIVATE</div></article>'+
      '<article><header><h3>A</h3></header><div data-ad-preview="message"><span aria-label="Public">BODY_PUBLIC_PRIVATE</span></div></article>'+
      '<article><header><h3>A</h3><q><span aria-label="Public">quote</span></q></header><div data-ad-preview="message">QUOTE_PRIVATE</div></article>'+
      '<article><header><h3>A</h3></header><div data-ad-preview="message">SIDEBAR_PRIVATE</div></article>'+
      '<article><header><h3>A</h3><span aria-label="Public"></span></header><div data-ad-preview="message">PRIVATE_SIBLING_BODY</div><span aria-label="Friends">private</span></article>'+
      post(12,12,null,'AD_PRIVATE').replace('</article>','<footer>Sponsored</footer></article>')+
      '<article><header><q>'+wrap(12,'<h3>A</h3><span aria-label="Public">quote</span>')+'</q></header><div data-ad-preview="message">QUOTED_HEADER_PRIVATE</div></article>'+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,0);assert.equal(readFileSync(join(negative.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed">'+post(16,18,null,'<span>X</span>'.repeat(2600))+post(0,0)+'</div></main>';await wc.loadURL(url);
    const partial=await tools.startCandidates(profile.id);assert.equal(partial.summary.visited,2500);assert.equal(partial.summary.node_limit,true);assert.equal(partial.summary.candidate_count,0);assert.equal(partial.summary.examined,1);assert.equal(wc.debugger.isAttached(),false);
    assert.equal(partial.summary.diagnostics?.headers.treeIncomplete,1);assert.equal(partial.summary.diagnostics?.headers.publicClustersFound,0);assert.ok(partial.summary.rejection_shapes.some(shape=>shape.header.treeState==='INCOMPLETE'&&!shape.header.publicClusterFound&&!shape.header.clusterFound));
    return{task:'P02_HEADER_TREE',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[positive,negative,partial].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,nodeLimit:value.summary.node_limit,examined:value.summary.examined,diagnostics:value.summary.diagnostics,rejectionShapes:value.summary.rejection_shapes,rejected:value.summary.rejected,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookOptionalTimeFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic optional temporal fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const post=(time:string,body='OPTIONAL_PUBLIC_BODY',extra='',label='Public')=>'<article><header><h3>AUTHOR_PRIVATE</h3>'+time+'<span aria-label="'+label+'">globe</span>'+extra+'</header><div data-ad-preview="message">'+body+'</div></article>';
  const partial='<a style="display:inline-block;overflow:hidden;width:200px;height:12.5px;line-height:12.5px;font-size:16px">2 giờ</a>';
  let html='<!doctype html><main><div role="feed">'+post('<a>Friends</a>')+post(partial,'OPTIONAL_PUBLIC_BODY','<a>Bạn bè</a>')+
    post('','OPTIONAL_PUBLIC_BODY','<span style="position:absolute;width:1px;height:1px;clip:rect(1px,1px,1px,1px)">ACCESS_ONLY_LABEL</span><button><span>Friends</span></button>')+
    post('','Friends','<span style="position:absolute;width:1px;height:1px;clip-path:inset(50%)">ACCESS_ONLY_LABEL</span>')+
    post('<a style="position:static;clip:rect(0px,0px,0px,0px)">2 giờ</a>','OPTIONAL_PUBLIC_BODY','<q>Friends</q>')+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const positive=await tools.startCandidates(profile.id);assert.equal(positive.summary.candidate_count,2);assert.equal(positive.summary.version,13);assert.equal(positive.summary.rejected?.CONFLICTING_PUBLIC,3);
    const samples=JSON.parse(readFileSync(join(positive.directory,'candidates.json'),'utf8')).samples;assert.ok(samples.every((s:{published_at:null})=>s.published_at===null));assert.deepEqual(samples.map((s:{text:string})=>s.text),['Friends','OPTIONAL_PUBLIC_BODY']);
    assert.ok(samples[0].boundary.endsWith('_HEADER_PUBLIC_OPTIONAL_TIME'));assert.equal(samples[0].metadata.temporal,0);assert.equal(samples[0].metadata.temporalStatus,'MISSING');assert.equal(samples[1].metadata.temporalStatus,'OBSERVED');
    assert.ok((positive.summary.diagnostics?.layout.clipEmptyLegacy||0)>0);assert.ok((positive.summary.diagnostics?.layout.clipEmptyInset||0)>0);assert.ok((positive.summary.diagnostics?.layout.clipLegacyInactive||0)>0);
    html='<!doctype html><main><div role="feed">'+post('','FRIENDS_PRIVATE','','Friends')+
      post('','QUOTE_PRIVATE','<q><span aria-label="Public">quoted</span></q>','')+post('','<span aria-label="Public">BODY_PUBLIC_PRIVATE</span>','','')+
      '<article><header><span aria-label="Public">globe</span></header><div data-ad-preview="message">NO_HEADER_PRIVATE</div></article>'+
      '<article><header><h3>A</h3><span aria-label="Public"></span></header><div data-ad-preview="message">MIXED_A_PRIVATE</div><header><h3>B</h3></header><div data-ad-preview="message">MIXED_B_PRIVATE</div></article>'+
      post('','<span style="clip-path:inset(1px)">BODY_UNKNOWN_PRIVATE</span>')+
      post('','OTHER_AUX_PUBLIC_BODY','<span style="position:absolute;clip:rect(0px,5px,5px,0px)">OTHER_UNKNOWN_LABEL</span>')+
      '<article><header><h3>A</h3><span aria-label="Public" style="clip-path:inset(1px)"></span></header><div data-ad-preview="message">PUBLIC_UNKNOWN_PRIVATE</div></article>'+
      '<article><header><h3 style="clip-path:inset(50%)">HIDDEN_HEADER</h3><span aria-label="Public"></span></header><div data-ad-preview="message">HEADER_PRIVATE</div></article>'+
      post('','<span style="clip-path:inset(50%)">EMPTY_BODY_PRIVATE</span>')+
      '<article><header><h3>A</h3></header><header><span aria-label="Public"></span></header><div data-ad-preview="message">CROSS_PRIVATE</div></article>'+
      post('<a style="position:static;clip:rect(0px,0px,0px,0px)">Sponsored</a>','STATIC_AD_PRIVATE')+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,1);const auxiliary=JSON.parse(readFileSync(join(negative.directory,'candidates.json'),'utf8')).samples;assert.equal(auxiliary[0].text,'OTHER_AUX_PUBLIC_BODY');assert.equal(auxiliary[0].metadata.auxiliaryTextOmitted,true);assert.equal(JSON.stringify(auxiliary).includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed"></div><section>'+post(partial)+post('','<span style="clip-path:inset(1px)">FALLBACK_BODY_PRIVATE</span>')+'</section></main>';await wc.loadURL(url);
    const fallback=await tools.startCandidates(profile.id);assert.equal(fallback.summary.candidate_count,1);assert.equal(fallback.summary.selection?.fallbackScan,'COMPLETE');const last=JSON.parse(readFileSync(join(fallback.directory,'candidates.json'),'utf8')).samples;assert.equal(last[0].metadata.temporalStatus,'UNREADABLE');assert.equal(last[0].published_at,null);assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_OPTIONAL_TEMPORAL',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[positive,negative,fallback].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,examined:value.summary.examined,nodeLimit:value.summary.node_limit,diagnostics:value.summary.diagnostics,geometryShapes:value.summary.geometry_shapes,selection:value.summary.selection,rejected:value.summary.rejected,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookLocalClipFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic local clipping fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const post=(time:string,body='LOCAL_PUBLIC_BODY',headingStyle='')=>'<article><header><h3 style="'+headingStyle+'">AUTHOR_PRIVATE</h3>'+time+'<span aria-label="Public">globe</span></header><div data-ad-preview="message">'+body+'</div></article>';
  const unsupported='<a style="display:inline-block;overflow:hidden;transform:translateX(0px)">2 giờ</a>';
  const linebox='display:inline-block;overflow:hidden;width:200px;height:12.5px;line-height:12.5px;font-size:16px';
  let html='<!doctype html><main><div role="feed">'+post(unsupported,'TRANSFORM_PUBLIC_BODY')+post('<a style="'+linebox+'">2 giờ</a>','LINEBOX_PUBLIC_BODY')+
    post('<a style="display:inline-block;overflow:hidden;width:12px;white-space:nowrap">2 giờ NOT_A_TIMESTAMP</a>','TAIL_PUBLIC_BODY')+
    post('<a>2 giờ</a>','<span style="'+linebox+'">BODY_PRIVATE</span>')+post('<a>2 giờ</a>','CLIPPATH_PRIVATE','clip-path:inset(0)')+post('<a>2 giờ</a>')+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const feed=await tools.startCandidates(profile.id);assert.equal(feed.summary.version,13);assert.equal(feed.summary.candidate_count,4);assert.equal(feed.summary.examined,6);assert.equal(feed.summary.barriers?.state,'CLEAR');assert.equal(feed.summary.diagnostics?.layout.localIncomplete,2);
    const shapes=feed.summary.geometry_shapes;assert.ok(shapes.some(shape=>shape.scope==='TEMPORAL'&&shape.reason==='BOUNDS'&&shape.axis==='Y'));assert.ok(shapes.some(shape=>shape.reason==='BOUNDS'&&shape.axis==='X'));assert.ok(shapes.some(shape=>shape.scope==='BODY'));assert.ok(shapes.some(shape=>shape.reason==='TRANSFORM'));assert.ok(shapes.some(shape=>shape.reason==='CLIP_PATH'));assert.ok(shapes.length<=5);
    const samples=JSON.parse(readFileSync(join(feed.directory,'candidates.json'),'utf8')).samples;assert.deepEqual(samples.map((s:{text:string})=>s.text),['TRANSFORM_PUBLIC_BODY','LINEBOX_PUBLIC_BODY','TAIL_PUBLIC_BODY','LOCAL_PUBLIC_BODY']);assert.ok(samples.slice(0,3).every((s:{metadata:{temporal:number;temporalStatus:string};published_at:null})=>s.metadata.temporal===0&&s.metadata.temporalStatus==='UNREADABLE'&&s.published_at===null));assert.equal(JSON.stringify(samples).includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed"></div><section>'+post(unsupported,'FALLBACK_PUBLIC_BODY')+post('<a>2 giờ</a>')+'</section></main>';await wc.loadURL(url);
    const fallback=await tools.startCandidates(profile.id);assert.equal(fallback.summary.candidate_count,2);assert.equal(fallback.summary.examined,2);assert.equal(fallback.summary.selection?.fallbackScan,'COMPLETE');assert.equal(fallback.summary.diagnostics?.layout.localIncomplete,0);assert.equal(fallback.summary.barriers?.state,'CLEAR');
    assert.equal(readFileSync(join(fallback.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed">'+post('<a>2 giờ'+'<span>X</span>'.repeat(2600)+'</a>','GLOBAL_PRIVATE')+post('<a>2 giờ</a>')+'</div></main>';await wc.loadURL(url);
    const partial=await tools.startCandidates(profile.id);assert.equal(partial.summary.candidate_count,0);assert.equal(partial.summary.visited,2500);assert.equal(partial.summary.node_limit,true);assert.equal(partial.summary.examined,1);assert.equal(partial.summary.diagnostics?.layout.localIncomplete,0);assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_LOCAL_CLIP',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[feed,fallback,partial].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,nodeLimit:value.summary.node_limit,examined:value.summary.examined,selection:value.summary.selection,diagnostics:value.summary.diagnostics,geometryShapes:value.summary.geometry_shapes,rejected:value.summary.rejected,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookTextVisibilityFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic text geometry fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const post=(time:string,body='VISIBILITY_PUBLIC_BODY',label='Public')=>'<article><header><h3>AUTHOR_PRIVATE</h3>'+time+'<span aria-label="'+label+'">globe</span></header><div data-ad-preview="message">'+body+'</div></article>';
  const noise='<span style="display:inline-block;width:12px;height:12px;font-size:0">X</span>'.repeat(100);
  const zero='<span style="display:inline-block;transform:scale(0)">'+ 'X'.repeat(120)+'</span>';
  const clipped='<span style="display:inline-block;overflow:hidden;width:0;height:0">'+'X'.repeat(120)+'</span>';
  const deep='<a style="white-space:pre">'+'<span style="display:contents">'.repeat(40)+Array.from('2 giờ'.padEnd(96,' ')).map(char=>'<span>'+char+'</span>').join('')+'</span>'.repeat(40)+noise+'</a>';
  let html='<!doctype html><main><div role="feed">'+post(deep).replace('<h3>AUTHOR_PRIVATE</h3>','<h3 style="height:20px"></h3>')+
    post('<span role="link" style="display:contents"><span>2</span> <span>giờ</span>'+zero+'</span>')+
    post('<a>hôm qua'+clipped+'</a>')+post('<a style="color:transparent;text-shadow:0 0 1px black">2 giờ</a>')+
    post('<a style="position:relative;left:-5000px">2 giờ</a>')+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const positive=await tools.startCandidates(profile.id);assert.equal(positive.summary.candidate_count,5);assert.equal(positive.summary.node_limit,false);
    const geometry=positive.summary.diagnostics;assert.ok((geometry?.layout.textZeroArea||0)>=101);assert.ok((geometry?.layout.textClipped||0)>=1);assert.ok((geometry?.layout.textParentBoxes||0)>0);assert.ok((geometry?.temporal.zeroSegments||0)>=101);assert.ok((geometry?.temporal.clippedSegments||0)>=1);assert.equal(geometry?.temporal.charLimits,0);assert.equal(geometry?.temporal.textNodeLimits,0);
    assert.equal(geometry?.layout.textUnknownAncestor,0);assert.ok((geometry?.layout.clipPropagations||0)>40);assert.ok((geometry?.layout.clipCacheHits||0)>96);assert.ok((geometry?.layout.clipAncestorSteps||0)<32);
    const samples=JSON.parse(readFileSync(join(positive.directory,'candidates.json'),'utf8')).samples;assert.ok(samples.every((value:{text:string})=>value.text==='VISIBILITY_PUBLIC_BODY'));
    html='<!doctype html><main><div role="feed">'+post('<a>2 giờ</a>','FRIENDS_PRIVATE','Friends')+'<div style="overflow:hidden;width:0;height:0">'+post('<a>2 giờ</a>','ANCESTOR_CLIP_PRIVATE')+'</div>'+
      post('<a style="display:inline-block;overflow:hidden;width:12px;white-space:nowrap">2 giờ NOT_A_TIMESTAMP</a>','PARTIAL_TEMPORAL_BODY')+
      post('<a><span style="display:inline-block;width:20px;height:20px;font-size:0">2 giờ</span></a>','FONT_PUBLIC_BODY')+
      post('<a><span style="display:inline-block;transform:scale(0)">2 giờ</span></a>','ZERO_PUBLIC_BODY')+
      post('<a><span style="display:inline-block;overflow:hidden;width:0;height:0">2 giờ</span></a>','CLIP_PUBLIC_BODY')+
      post('<a style="visibility:hidden">2 giờ</a>','HIDDEN_DATE_PUBLIC_BODY')+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,5);
    const optional=JSON.parse(readFileSync(join(negative.directory,'candidates.json'),'utf8')).samples;assert.ok(optional.every((s:{published_at:null;boundary:string;metadata:{temporal:number;timeTag:boolean;ariaTemporal:boolean}})=>s.published_at===null&&s.boundary.endsWith('_HEADER_PUBLIC_OPTIONAL_TIME')&&s.metadata.temporal===0&&!s.metadata.timeTag&&!s.metadata.ariaTemporal));
    assert.ok((negative.summary.diagnostics?.layout.textUnknownPartial||0)>0);assert.ok((negative.summary.diagnostics?.layout.textClipped||0)>1);
    assert.equal(readFileSync(join(negative.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed">'+post('<a>2 giờ</a>','UNKNOWN_PRIVATE')+'</div></main>';await wc.loadURL(url);
    await wc.executeJavaScriptInIsolatedWorld(1004,[{code:"(() => { Object.defineProperty(document,'createRange',{value:undefined,configurable:true}); return true; })()"}]);
    const unknown=await tools.startCandidates(profile.id);assert.equal(unknown.summary.candidate_count,0);
    assert.ok((unknown.summary.diagnostics?.layout.textUnknown||0)>0);assert.ok((unknown.summary.diagnostics?.temporal.unknownSegments||0)>0);assert.ok((unknown.summary.rejected?.INCOMPLETE_BOUNDARY||0)>0);
    assert.equal(unknown.summary.diagnostics?.layout.textUnknownApi,unknown.summary.diagnostics?.layout.textUnknown);
    assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_TEXT_VISIBILITY',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[positive,negative,unknown].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,nodeLimit:value.summary.node_limit,diagnostics:value.summary.diagnostics,rejected:value.summary.rejected,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookHeaderTemporalFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic header temporal fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const post=(id:string,time:string,body='TEMPORAL_PUBLIC_BODY',heading='AUTHOR_PRIVATE',extra='')=>'<article><header><h3>'+heading+'</h3>'+time+'<span aria-label="Public">globe</span><a href="/owner/posts/'+id+'/?token=never-export">post</a></header><div data-ad-preview="message">'+body+'</div>'+extra+'</article>';
  const characters=(value:string)=>Array.from(value).map(char=>'<span>'+char+'</span>').join('');
  const nested='<a href="/owner/posts/50001/">'+'<span style="display:contents">'.repeat(10)+characters('17 tháng 10 lúc 08:30')+'</span>'.repeat(10)+'</a>';
  let html='<!doctype html><main><div role="feed">'+post('50001',nested)+post('50002','<div role="link" style="display:contents"><span>2</span> <span>giờ</span></div>')+
    post('50003','<a role="button" style="white-space:pre" href="/owner/posts/50003/">'+characters('hôm qua lúc 08:30'.padEnd(96,' '))+'</a>')+
    post('50004','<button><span>3</span><span> ngày</span></button>')+post('50005','<button aria-label="27 tháng 10, 2026 lúc 08:30"></button>')+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const matched=await tools.startCandidates(profile.id);assert.equal(matched.summary.version,13);assert.equal(matched.summary.candidate_count,5);assert.equal(matched.summary.node_limit,false);
    const t=matched.summary.diagnostics?.temporal;assert.ok((t?.nestedMatches||0)>=4);assert.ok((t?.splitMatches||0)>=4);assert.ok((t?.roleLinks||0)>=1);assert.ok((t?.controlMatches||0)>=2);assert.ok((t?.labelMatches||0)>=1);
    assert.equal(t?.charLimits,0);assert.equal(t?.textNodeLimits,0);
    const samples=JSON.parse(readFileSync(join(matched.directory,'candidates.json'),'utf8')).samples;assert.ok(samples.every((sample:{text:string;metadata:{timeTag:boolean;abbr:boolean;temporal:number}})=>sample.text==='TEMPORAL_PUBLIC_BODY'&&!sample.metadata.timeTag&&!sample.metadata.abbr&&sample.metadata.temporal>0));
    const bodyDate='<a href="#"><span>2 giờ</span></a>BODY_DATE_PUBLIC';
    const quote='<blockquote><a href="#"><span>2</span><span> giờ</span></a><span aria-label="Friends">quote</span></blockquote>';
    const cross='<article><header><h3>HEADER_A_PRIVATE</h3><span aria-label="Public">globe</span></header><header><a href="#"><span>2 giờ</span></a></header><div data-ad-preview="message">CROSS_PRIVATE</div></article>';
    const deepTail='<a href="#"><span>2 giờ</span>'+'<span>'.repeat(8)+'NOT_A_TIMESTAMP'+'</span>'.repeat(8)+'</a>';
    const spacedDigits='<a href="#"><span>1</span> <span>2 giờ</span></a>';
    html='<!doctype html><aside><a>2 giờ</a></aside><main><div role="feed">'+post('51002',quote,'QUOTE_PRIVATE')+
      post('51005','<a href="#"><span>2 giờ</span></a>','FRIENDS_PRIVATE','AUTHOR_PRIVATE','<footer><button aria-label="Friends">private</button></footer>')+
      post('51006','<a href="#"><span>2 giờ</span></a>','AD_PRIVATE','AUTHOR_PRIVATE','<footer>Sponsored</footer>')+cross+
      post('51009',deepTail,'DEEP_TAIL_PUBLIC_BODY')+post('51010',spacedDigits,'SPACED_DIGITS_PUBLIC_BODY')+
      post('51001','',bodyDate,'AUTHOR_PRIVATE','<article><a>2 giờ</a><time>time</time>EMBED_ONLY_PRIVATE</article><div role="comment"><a>2 giờ</a>COMMENT_ONLY_PRIVATE</div>')+
      post('51003','','AUTHOR_DATE_PUBLIC_BODY','<a href="/profile.php?id=777">2 giờ</a>')+
      post('51008','<q><a href="#">2 giờ</a></q><blockquote><a>2 giờ</a></blockquote>','PLAIN_QUOTE_PUBLIC_BODY')+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,5);assert.ok((negative.summary.rejected?.NO_HEADER_CLUSTER||0)>=1);assert.ok((negative.summary.rejected?.CONFLICTING_PUBLIC||0)>=2);
    assert.ok((negative.summary.diagnostics?.temporal.quoteExcluded||0)>=1);assert.ok((negative.summary.diagnostics?.temporal.headingExcluded||0)>=1);assert.ok((negative.summary.diagnostics?.temporal.bodyExcluded||0)>=1);assert.ok((negative.summary.diagnostics?.temporal.classifierMisses||0)>=2);
    const noTemporal=JSON.parse(readFileSync(join(negative.directory,'candidates.json'),'utf8')).samples;assert.ok(noTemporal.every((s:{published_at:null;metadata:{temporal:number;temporalStatus:string;timeTag:boolean;abbr:boolean;ariaTemporal:boolean}})=>s.published_at===null&&s.metadata.temporal===0&&s.metadata.temporalStatus==='MISSING'&&!s.metadata.timeTag&&!s.metadata.abbr&&!s.metadata.ariaTemporal));assert.equal(JSON.stringify(noTemporal).includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed">'+post('52001','<a href="#" style="white-space:pre">'+characters('2 giờ'.padEnd(97,' '))+'</a>','TEXT_NODES_LIMIT_PUBLIC_BODY')+
      post('52002','<a href="#" style="white-space:pre">'+'2 giờ'.padEnd(97,' ')+'</a><a href="#"></a>','CHAR_LIMIT_PUBLIC_BODY')+
      post('52003','<a href="#"><span>17 tháng 10</span>'+'<span>x</span>'.repeat(2600)+'</a>','PARTIAL_PRIVATE')+'</div></main>';await wc.loadURL(url);
    const partial=await tools.startCandidates(profile.id);assert.equal(partial.summary.visited,2500);assert.equal(partial.summary.node_limit,true);assert.equal(partial.summary.candidate_count,2);assert.ok((partial.summary.diagnostics?.temporal.textLimits||0)>0);
    const limited=JSON.parse(readFileSync(join(partial.directory,'candidates.json'),'utf8')).samples;assert.ok(limited.every((s:{published_at:null;metadata:{temporal:number;temporalStatus:string}})=>s.published_at===null&&s.metadata.temporal===0&&s.metadata.temporalStatus==='UNREADABLE'));assert.equal(JSON.stringify(limited).includes('PARTIAL_PRIVATE'),false);assert.ok((partial.summary.diagnostics?.temporal.charLimits||0)>=2);assert.ok((partial.summary.diagnostics?.temporal.textNodeLimits||0)>=1);assert.ok((partial.summary.diagnostics?.temporal.emptyText||0)>=1);
    assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_HEADER_TEMPORAL',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[matched,negative,partial].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,nodeLimit:value.summary.node_limit,temporal:value.summary.diagnostics?.temporal,rejected:value.summary.rejected,rejectionShapes:value.summary.rejection_shapes,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookPublicCandidateFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic public candidate fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const id='90071992547409931234';
  const post=(options:{id?:string;href?:string;label?:string;extra?:string;body?:string;role?:string;marker?:boolean;footer?:string}={})=>'<div '+(options.role?'role="'+options.role+'"':'')+'><header><h3>AUTHOR_PRIVATE</h3><a href="'+(options.href||'/owner/posts/'+(options.id||id)+'/?token=never-export')+'">author link</a><time datetime="2026-10-27">time</time><span aria-label="'+(options.label??'Công khai')+'"></span>'+ (options.extra||'')+'</header><div '+(options.marker===false?'':'data-ad-preview="message"')+'>'+(options.body??'PUBLIC_COFFEE_BODY 0901234567 sample@example.test https://example.test/?token=secret')+'</div><article><span aria-label="Bạn bè"></span><div data-ad-preview="message">EMBED_PRIVATE</div></article><div role="comment"><div data-ad-preview="message">COMMENT_PRIVATE</div></div><footer>'+(options.footer||'')+'</footer></div>';
  let html='<!doctype html><main><div role="feed">'+
    post({label:'Bạn bè',body:'PRIVATE_BODY',extra:'<article><span aria-label="Public"></span>EMBED_PRIVATE</article>'})+
    post({footer:'<span aria-label="Bạn bè"></span>',body:'CONFLICT_PRIVATE'})+
    post({label:'',body:'UNKNOWN_PRIVATE',extra:'<article><span aria-label="Public"></span>EMBED_PRIVATE</article>'})+
    post({footer:'<span>Sponsored</span>',body:'AD_PRIVATE'})+
    post({extra:'<span aria-label="Pages you may like"></span>',body:'SUGGESTION_PRIVATE'})+
    post({role:'comment',body:'COMMENT_PRIVATE'})+
    post({body:'PUBLIC_COFFEE_BODY <span>090</span><span>123</span><span>4567</span> sample@example.test '+ 'coffee '.repeat(250)})+
    post({href:'/permalink.php?story_fbid='+id+'&id=12345&token=never-export',body:'DUPLICATE_PRIVATE'})+
    post({href:'/groups/888/',extra:'<a href="/profile.php?id=777">AUTHOR_PRIVATE</a>',body:'PUBLIC_MISSING_ID'})+
    post({id:'90071992547409931235'})+post({id:'90071992547409931236'})+post({id:'90071992547409931237',body:'HEADER_ONLY_PRIVATE',marker:false})+'</div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;
    const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i&token=never-export';await wc.loadURL(url);await tools.refresh();
    assert.ok(Menu.getApplicationMenu()?.getMenuItemById('csd-public-candidate-read-'+profile.id));
    const matched=await tools.startCandidates(profile.id);assert.equal(matched.summary.status,'SAMPLES_READY');assert.equal(matched.summary.candidate_count,5);assert.equal(matched.summary.capture_mode,'FIXTURE');assert.equal(matched.summary.verified_valid_count,0);
    const samples=JSON.parse(readFileSync(join(matched.directory,'candidates.json'),'utf8')).samples;
    assert.equal(samples[0].post_id,id);assert.equal(typeof samples[0].post_id,'string');assert.equal(samples[0].text_status,'TRUNCATED');
    assert.equal(samples[0].contacts_redacted,true);assert.equal(samples[0].text.replace(/\D/g,'').includes('0901234567'),false);
    assert.equal(samples[1].post_id,null);assert.equal(samples[1].permalink,null);assert.equal(matched.summary.rejected?.DUPLICATE_ID,1);
    assert.equal(samples[4].text,null);assert.equal(samples[4].text_status,'MISSING_BODY_MARKER');assert.equal(matched.summary.text_missing_count,1);
    const raw=JSON.stringify(samples);assert.ok(raw.includes('PUBLIC_COFFEE_BODY'));assert.ok(raw.includes('[NUMBER]'));assert.ok(raw.includes('[EMAIL]'));
    for(const secret of ['AUTHOR_PRIVATE','PRIVATE_BODY','CONFLICT_PRIVATE','UNKNOWN_PRIVATE','AD_PRIVATE','SUGGESTION_PRIVATE','COMMENT_PRIVATE','EMBED_PRIVATE','DUPLICATE_PRIVATE','HEADER_ONLY_PRIVATE','never-export','0901234567','sample@example.test'])assert.equal(raw.includes(secret),false);
    assert.equal(JSON.stringify(matched.summary).includes('PUBLIC_COFFEE_BODY'),false);assert.equal(JSON.stringify(matched.summary).includes('https://'),false);
    assert.equal(readFileSync(join(matched.directory,'started.json'),'utf8').includes('PUBLIC_COFFEE_BODY'),false);
    html='<!doctype html><main><div role="feed">'+post({body:'<span>PARTIAL_PRIVATE</span>'.repeat(3000),extra:'<span aria-label="Public"></span>'})+'</div></main>';await wc.loadURL(url);
    const partial=await tools.startCandidates(profile.id);assert.equal(partial.summary.candidate_count,0);assert.equal(partial.summary.node_limit,true);assert.equal(partial.summary.visited,2500);
    assert.equal(readFileSync(join(partial.directory,'candidates.json'),'utf8').includes('PARTIAL_PRIVATE'),false);
    html='<!doctype html><form><input type="password" value="PASSWORD_PRIVATE"></form>';await wc.loadURL(url);
    const auth=await tools.startCandidates(profile.id);assert.equal(auth.summary.status,'AUTH_REQUIRED');assert.equal(auth.summary.candidate_count,0);
    assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_PUBLIC_CANDIDATES',result:'PASS',mode:'FIXTURE',cases:[matched,partial,auth].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,identityMissing:value.summary.identity_missing_count,nodeLimit:value.summary.node_limit,visited:value.summary.visited,summarySha256:value.sha256,candidateFileSha256:value.summary.candidate_file_sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookCandidateBoundaryFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic boundary fallback fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const aux='<section><div role="feed">'+('<div><button>AUX_PRIVATE</button></div>').repeat(7)+'</div></section>';
  const post=(id:string,tag='div',label='Public',body='BOUNDARY_PUBLIC_BODY')=>'<'+tag+'><header><h3>AUTHOR_PRIVATE</h3><time>time</time><span aria-label="'+label+'"></span><a href="/owner/posts/'+id+'/?token=never-export">author</a></header><div data-ad-preview="message">'+body+'</div><article><header><h3>EMBED_PRIVATE</h3><time>time</time><span aria-label="Public"></span></header><div data-ad-preview="message">EMBED_PRIVATE</div></article><div role="comment">COMMENT_PRIVATE</div></'+tag+'>';
  let html='<!doctype html><main>'+aux+post('12345','article')+'<div>'.repeat(10)+post('12346')+'</div>'.repeat(10)+'</main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const matched=await tools.startCandidates(profile.id);assert.equal(matched.summary.version,13);assert.equal(matched.summary.status,'SAMPLES_READY');assert.equal(matched.summary.candidate_count,2);
    assert.equal(matched.summary.selection?.fallbackUsed,true);assert.equal(matched.summary.selection?.feedExamined,6);assert.equal(matched.summary.selection?.mainExamined,2);assert.equal(matched.summary.node_limit,false);
    const samples=JSON.parse(readFileSync(join(matched.directory,'candidates.json'),'utf8')).samples;
    assert.equal(samples[0].boundary,'MAIN_ARTICLE_HEADER_TEMPORAL');assert.equal(samples[1].boundary,'MAIN_COLOCATED_HEADER_TEMPORAL');
    assert.ok(samples.every((sample:{text:string})=>sample.text==='BOUNDARY_PUBLIC_BODY'));assert.ok(matched.summary.rejection_shapes.length<=5);
    for(const secret of ['AUTHOR_PRIVATE','EMBED_PRIVATE','COMMENT_PRIVATE','AUX_PRIVATE','never-export'])assert.equal(JSON.stringify(samples).includes(secret),false);
    const split='<div><div><header><h3>HEADER_A_PRIVATE</h3><time>time</time></header></div><div><span aria-label="Public"></span><div data-ad-preview="message">CROSS_BODY_PRIVATE</div></div></div>';
    const deep=(value:string)=>'<div>'.repeat(7)+value+'</div>'.repeat(7);
    html='<!doctype html><main><div role="feed">'+deep(post('12349'))+deep(post('12347','div','Friends','OUTER_PRIVATE'))+split+'</div></main>';await wc.loadURL(url);
    const ambiguous=await tools.startCandidates(profile.id);assert.equal(ambiguous.summary.candidate_count,1);assert.equal(ambiguous.summary.rejected?.NO_HEADER_CLUSTER,1);assert.equal(ambiguous.summary.rejected?.RESTRICTED,1);
    const deepSamples=JSON.parse(readFileSync(join(ambiguous.directory,'candidates.json'),'utf8')).samples;
    assert.equal(deepSamples[0].boundary,'FEED_CHILD_HEADER_TEMPORAL');assert.equal(deepSamples[0].post_id,'12349');
    assert.equal(readFileSync(join(ambiguous.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main>'+aux+post('12348','article','Public','<span>PARTIAL_PRIVATE</span>'.repeat(2600))+'</main>';await wc.loadURL(url);
    const partial=await tools.startCandidates(profile.id);assert.equal(partial.summary.selection?.fallbackUsed,true);assert.equal(partial.summary.visited,2500);assert.equal(partial.summary.node_limit,true);assert.equal(partial.summary.candidate_count,0);
    assert.ok(partial.summary.rejection_shapes.some(shape=>shape.state==='PARTIAL'));assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_CANDIDATE_BOUNDARY',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[matched,ambiguous,partial].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,nodeLimit:value.summary.node_limit,selection:value.summary.selection,rejectionShapes:value.summary.rejection_shapes,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookDomLayoutFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic DOM layout fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const head='<div>'.repeat(10)+'<header style="display:contents"><h3>AUTHOR_PRIVATE</h3><time>time</time><span aria-label="Public">globe</span><a href="/owner/posts/123450001/">author</a></header>'+'</div>'.repeat(10);
  // The alias-positive chain has no hidden sibling/material: keep hidden-content coverage outside that chain.
  const pureAlias='<div data-ad-preview="message" style="display:contents"><div style="display:contents"><div data-ad-comet-preview="message" style="display:contents">LAYOUT_PUBLIC_BODY 0901234567</div></div></div>';
  const post=(body:string,extra='')=>'<article style="display:contents">'+head+body+extra+'</article>';
  const hiddenFeed='<div style="visibility:hidden"><div role="feed" style="visibility:visible">'+post('<div data-ad-preview="message">HIDDEN_FEED_PRIVATE</div>')+'</div></div>';
  let html='<!doctype html><main>'+hiddenFeed+'<div role="feed" style="display:contents"><div style="display:contents">'+post(pureAlias,'<div style="display:none"><span aria-label="Friends">HIDDEN_PRIVATE</span></div><div aria-hidden="true">ARIA_PRIVATE</div><div style="visibility:hidden"><span style="visibility:visible">VISIBILITY_PRIVATE</span></div><div style="opacity:0">OPACITY_PRIVATE</div><article>EMBED_PRIVATE</article><div role="comment">COMMENT_PRIVATE</div>')+'</div></div></main>';
  await isolated.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const matched=await tools.startCandidates(profile.id);assert.equal(matched.summary.status,'SAMPLES_READY');assert.equal(matched.summary.candidate_count,1);assert.equal(matched.summary.version,13);
    assert.ok((matched.summary.diagnostics?.layout.contents||0)>0);assert.ok((matched.summary.diagnostics?.layout.textRanges||0)>0);
    assert.ok((matched.summary.diagnostics?.messages.nestedAliases||0)>0);assert.ok((matched.summary.diagnostics?.headers.deepHints||0)>0);
    const samples=JSON.parse(readFileSync(join(matched.directory,'candidates.json'),'utf8')).samples;
    assert.equal(samples[0].metadata.messageRegions,1);assert.equal(samples[0].text,'LAYOUT_PUBLIC_BODY [NUMBER]');
    for(const secret of ['AUTHOR_PRIVATE','HIDDEN_PRIVATE','HIDDEN_FEED_PRIVATE','VISIBILITY_PRIVATE','OPACITY_PRIVATE','ARIA_PRIVATE','EMBED_PRIVATE','COMMENT_PRIVATE'])assert.equal(JSON.stringify(samples).includes(secret),false);
    const sibling='<div data-ad-preview="message">DISTINCT_PRIVATE_A</div><div data-ad-comet-preview="message">DISTINCT_PRIVATE_B</div>';
    const independent='<div data-ad-preview="message">OUTER_PRIVATE<div data-ad-comet-preview="message">INNER_PRIVATE</div></div>';
    const ownHeader='<div data-ad-preview="message"><div data-ad-comet-preview="message"><header><h3>INNER_AUTHOR_PRIVATE</h3><time>time</time><span aria-label="Public">globe</span></header>INNER_STORY_PRIVATE</div></div>';
    const disjoint='<div><div data-ad-preview="message">DISJOINT_PRIVATE_A</div></div><section><div data-ad-comet-preview="message">DISJOINT_PRIVATE_B</div></section>';
    const quote='<div data-ad-preview="message"><blockquote><div data-ad-comet-preview="message">QUOTE_PRIVATE</div></blockquote></div>';
    html='<!doctype html><main><div role="feed" style="display:contents">'+post(sibling)+post(independent)+post(ownHeader)+post(disjoint)+post(quote)+post(pureAlias,'<footer><span aria-label="Friends">private</span></footer>')+'</div></main>';await wc.loadURL(url);
    const negative=await tools.startCandidates(profile.id);assert.equal(negative.summary.candidate_count,0);assert.ok((negative.summary.rejected?.AMBIGUOUS_BOUNDARY||0)>=5);assert.ok((negative.summary.rejected?.CONFLICTING_PUBLIC||0)>=1);
    assert.ok((negative.summary.diagnostics?.messages.sibling||0)>0);assert.ok((negative.summary.diagnostics?.messages.nestedUnresolved||0)>0);
    assert.ok((negative.summary.diagnostics?.messages.disjoint||0)>0);
    assert.equal(readFileSync(join(negative.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);
    html='<!doctype html><main><div role="feed" style="display:contents">'+post('<div data-ad-preview="message" style="display:contents"><div data-ad-comet-preview="message" style="display:contents">'+'<span>PARTIAL_PRIVATE</span>'.repeat(2600)+'</div></div>')+'</div></main>';await wc.loadURL(url);
    const partial=await tools.startCandidates(profile.id);assert.equal(partial.summary.visited,2500);assert.equal(partial.summary.node_limit,true);assert.equal(partial.summary.candidate_count,0);
    assert.ok(partial.summary.rejection_shapes.some(shape=>shape.state==='PARTIAL'&&!shape.messages.groupingComplete));assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_DOM_LAYOUT',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[matched,negative,partial].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,nodeLimit:value.summary.node_limit,diagnostics:value.summary.diagnostics,rejectionShapes:value.summary.rejection_shapes,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}

export async function runFacebookOverlayVisibilityFixture(host:BrowserHost,tools:ReturnType<typeof installFacebookDomDiagnosticMenu>){
  const profile=await host.create('Synthetic overlay visibility fixture'),isolated=session.fromPartition('persist:csd-v1-'+profile.id);
  const empty='<div role="alert" style="display:contents"></div><span role="alert" style="position:absolute;width:0;height:0"></span><div role="alert" style="width:100px;height:20px"></div><div style="display:none"><div role="alert" style="visibility:visible">HIDDEN_ALERT_PRIVATE</div></div>';
  const main='<main><div role="feed"><article><header><h3>AUTHOR_PRIVATE</h3><time>time</time><span aria-label="Public">globe</span><a href="/owner/posts/12345679/">author</a></header><div data-ad-preview="message">OVERLAY_PUBLIC_BODY</div></article></div></main>';
  let html='<!doctype html>'+empty+main;
  await isolated.protocol.handle('https',request=>new Response(request.url.includes('google.com')?'<!doctype html><p>synthetic frame</p>':html,{headers:{'content-type':'text/html; charset=utf-8'}}));
  try{
    await host.open(profile.id);const wc=host.ownedContents(profile.id)!;const url='https://www.facebook.com/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i';await wc.loadURL(url);await tools.refresh();
    const clear=await tools.startCandidates(profile.id);assert.equal(clear.summary.version,13);assert.equal(clear.summary.status,'SAMPLES_READY');assert.equal(clear.summary.candidate_count,1);assert.equal(clear.summary.barriers?.state,'CLEAR');
    assert.ok((clear.summary.barriers?.empty||0)>=3);assert.ok((clear.summary.barriers?.hidden||0)>=1);
    const payload=JSON.parse(readFileSync(join(clear.directory,'candidates.json'),'utf8'));assert.equal(payload.samples[0].text,'OVERLAY_PUBLIC_BODY');assert.equal(JSON.stringify(payload).includes('HIDDEN_ALERT_PRIVATE'),false);
    html='<!doctype html>'+empty+'<div role="dialog" style="display:contents"><div>VISIBLE_BLOCKER_PRIVATE</div></div>'+main;await wc.loadURL(url);
    const visible=await tools.startCandidates(profile.id);assert.equal(visible.summary.status,'UNSUPPORTED_OVERLAY');assert.equal(visible.summary.candidate_count,0);assert.equal(visible.summary.barriers?.state,'VISIBLE');assert.equal(visible.summary.barriers?.evidence,'VISIBLE_TEXT');
    assert.ok((visible.summary.barriers?.hidden||0)>=1);assert.ok((visible.summary.barriers?.empty||0)>=3);
    html='<!doctype html><form style="visibility:hidden"><input type="password" style="visibility:visible" value="PASSWORD_PRIVATE"></form><div style="display:contents"><iframe src="https://www.google.com/recaptcha/synthetic"></iframe></div>'+main;await wc.loadURL(url);
    const challenge=await tools.startCandidates(profile.id);assert.equal(challenge.summary.status,'CHALLENGE');assert.equal(challenge.summary.candidate_count,0);assert.ok((challenge.summary.barriers?.hidden||0)>=1);assert.equal(challenge.summary.barriers?.evidence,'CHALLENGE_FRAME');
    for(const value of [visible,challenge]){assert.equal(readFileSync(join(value.directory,'candidates.json'),'utf8').includes('PRIVATE'),false);assert.equal(JSON.stringify(value.summary).includes('OVERLAY_PUBLIC_BODY'),false);}
    assert.equal(wc.debugger.isAttached(),false);
    return{task:'P02_OVERLAY_VISIBILITY',result:'PASS',mode:'FIXTURE',schemaVersion:13,cases:[clear,visible,challenge].map(value=>({status:value.summary.status,candidateCount:value.summary.candidate_count,visited:value.summary.visited,barriers:value.summary.barriers,summarySha256:value.sha256})),externalNetworkRequests:0,verifiedValidCount:0,observerAttached:false};
  }finally{isolated.protocol.unhandle('https');}
}
