// Fixed, read-only heuristic schema inspection. No network, clicks, scrolling or raw content return.
export const FACEBOOK_DOM_SCRIPT = String.raw`(() => {
  const limit = 2500, maxCards = 5, maxAncestors = 8, end = performance.now() + 1000;
  const emptyLinks = () => ({post:0,group:0,page:0,profile:0,facebookOther:0,external:0,unsupported:0});
  const out = {version:2,status:'NO_MATCH',route:'SEARCH_OTHER',queryMatched:false,
    visited:0,elementCount:0,textNodes:0,articleRoots:0,feedRoots:0,mainRoots:0,pageletMarkers:0,
    nodeLimit:false,timeLimit:false,links:emptyLinks(),cards:[],
    root:{kind:'NONE',probes:0,candidates:0,cap:3,enumeration:'FIRST_PER_SELECTOR',verified:false},
    scan:'NOT_SCANNED',pruned:0,barrierProbes:0,postLinkSamples:[],ancestorSteps:0};
  const norm = s => s.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
  const family = (host, root) => host===root||host.endsWith('.'+root);
  let current;
  try {current=new URL(location.href);} catch {out.status='UNSUPPORTED_ROUTE';return out;}
  if(current.protocol!=='https:'||current.username||current.password||current.port||!family(current.hostname,'facebook.com')) {out.status='UNSUPPORTED_ROUTE';return out;}
  if(/^\/(?:login(?:\.php)?|checkpoint|two_step_verification|challenge|recover)(?:\/|$)/.test(current.pathname)) {out.status='AUTH_REQUIRED';return out;}
  if(!/^\/search\/(?:posts|top)\/?$/.test(current.pathname)) {out.status='UNSUPPORTED_ROUTE';return out;}
  out.route=/^\/search\/posts\/?$/.test(current.pathname)?'SEARCH_POSTS':'SEARCH_TOP_MIXED';
  const q=current.searchParams.get('q');
  if(current.searchParams.getAll('q').length!==1||q===null||q.length>128||norm(q)!=='cafe hà nội') {out.status='QUERY_MISMATCH';return out;}
  out.queryMatched=true;
  if(!document.body) {out.status='DOM_UNAVAILABLE';return out;}
  const roots=new WeakMap(),barrierContexts=new WeakSet();
  function cardFor(node) {let p=node.nodeType===1?node:node.parentElement;for(let i=0;p&&i<24;i++,p=p.parentElement){if(roots.has(p))return roots.get(p);}return null;}
  function attr(node,name,max=80) {const value=node.getAttribute(name);return typeof value==='string'&&value.length<=max?value:'';}
  function expired() {if(performance.now()>=end){out.timeLimit=true;return true;}return false;}
  function barrier(node) {
    const tag=node.tagName;
    if(tag==='INPUT'&&(attr(node,'type')==='password'||attr(node,'autocomplete')==='one-time-code'||attr(node,'name')==='approvals_code')&&!node.hidden&&node.getClientRects().length>0)return 'AUTH_REQUIRED';
    if(tag==='IFRAME'){try{const u=new URL(attr(node,'src',2048),current.origin);
      if(['www.google.com','recaptcha.google.com'].includes(u.hostname)&&u.pathname.startsWith('/recaptcha/')&&node.getClientRects().length>0)return 'CHALLENGE';}catch{}}
    return null;
  }
  // Three bounded native lookups: no NodeList/full DOM materialization. Native selector time is cooperative only.
  for(const selector of ['input[type="password"]','input[autocomplete="one-time-code"],input[name="approvals_code"]','iframe[src*="/recaptcha/"]']){
    if(expired())return out;out.barrierProbes++;const node=document.querySelector(selector),status=node&&barrier(node);
    if(status){out.status=status;return out;}
  }
  const excluded=':not(nav):not(aside):not(nav *):not(aside *):not(dialog *):not([role="navigation"] *):not([role="dialog"] *):not([role="complementary"] *):not([hidden] *):not([aria-hidden="true"] *):not([hidden]):not([aria-hidden="true"]):not(dialog):not([role="dialog"]):not([role="navigation"]):not([role="complementary"])';
  const candidates=[];
  for(const [selector,kind] of [['main','MAIN_TAG'],['[role="main"]','ROLE_MAIN'],['[role="feed"]','ROLE_FEED']]){
    if(expired())return out;out.root.probes++;const node=document.querySelector(selector+excluded);
    if(node&&!node.hidden&&attr(node,'aria-hidden')!=='true'&&!['NAV','ASIDE','DIALOG'].includes(node.tagName)&&
      !['navigation','complementary','dialog'].includes(attr(node,'role'))&&!candidates.some(candidate=>candidate.node===node))candidates.push({node,kind});
  }
  out.root.candidates=candidates.length;
  const selected=candidates[0],root=selected?selected.node:document.body;out.root.kind=selected?selected.kind:'BODY_FALLBACK';
  const tags=['DIV','ARTICLE','SECTION','MAIN','A','SPAN','HEADER','FOOTER','TIME','ABBR','BODY','UL','LI'];
  const roles=['article','main','feed','group','region','list','listitem','link','button','heading'];
  function ancestors(link){
    const sample={kind:'POST_LIKE_LINK',ancestors:[],depthLimit:false};let p=link.parentElement;
    for(let i=0;p&&i<maxAncestors&&out.ancestorSteps<40;i++){
      if(expired()){sample.depthLimit=true;break;}
      const role=attr(p,'role');out.ancestorSteps++;
      sample.ancestors.push({tag:tags.includes(p.tagName)?p.tagName:'OTHER',role:role?(roles.includes(role)?role:'OTHER'):'NONE',
        children:p.childElementCount===0?'ZERO':p.childElementCount===1?'ONE':p.childElementCount<=5?'FEW':'MANY',
        pagelet:p.hasAttribute('data-pagelet'),label:p.hasAttribute('aria-label'),atRoot:p===root});
      if(p===root){p=null;break;}p=p.parentElement;
    }
    if(p)sample.depthLimit=true;return sample;
  }
  function linkKind(value) {
    if(!value||value.length>2048)return 'unsupported';
    try {const u=new URL(value,current.origin);if(u.protocol!=='https:'||u.username||u.password)return 'unsupported';
      if(!family(u.hostname,'facebook.com'))return 'external';
      if(/\/(?:posts|permalink)\//.test(u.pathname)||/^\/(?:permalink|story)\.php$/.test(u.pathname))return 'post';
      if(/^\/groups\//.test(u.pathname))return 'group';if(/^\/pages\//.test(u.pathname))return 'page';
      if(u.pathname==='/profile.php')return 'profile';return 'facebookOther';
    }catch{return 'unsupported';}
  }
  // Pruned subtrees never consume a new per-card/link budget. All accepted/rejected nodes share this counter.
  const stop={},walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(out.visited>=limit){out.nodeLimit=true;throw stop;}if(expired())throw stop;
    out.visited++;
    if(node.nodeType===1&&(node.hidden||attr(node,'aria-hidden')==='true'||['NAV','ASIDE'].includes(node.tagName)||['navigation','complementary'].includes(attr(node,'role')))){out.pruned++;return NodeFilter.FILTER_REJECT;}
    return NodeFilter.FILTER_ACCEPT;
  }});
  let node=root;
  // TreeWalker does not visit its root; count that one explicitly.
  out.visited++;
  try {do {
    if(expired())break;
    if(node.nodeType===1){
      out.elementCount++;const tag=node.tagName,role=attr(node,'role');
      const blocked=barrier(node);if(blocked){out.status=blocked;out.scan='BARRIER_STOP';out.cards=[];out.postLinkSamples=[];out.ancestorSteps=0;return out;}
      if(tag==='DIALOG'||['dialog','alert'].includes(role)||barrierContexts.has(node.parentElement)){barrierContexts.add(node);continue;}
      if(role==='feed')out.feedRoots++;if(role==='main'||tag==='MAIN')out.mainRoots++;
      const pagelet=attr(node,'data-pagelet',120);if(pagelet)out.pageletMarkers++;
      if((tag==='ARTICLE'||role==='article')&&attr(node,'aria-hidden')!=='true'&&!node.hidden){
        out.articleRoots++;
        if(out.cards.length<maxCards){const card={kind:tag==='ARTICLE'?'ARTICLE_TAG':'ROLE_ARTICLE',textNodes:0,textSize:'EMPTY',
          timeHint:false,publicLabelHints:0,restrictedLabelHints:0,seeMoreHint:false,links:emptyLinks()};
          roots.set(node,card);out.cards.push(card);}
      }
      const card=cardFor(node);
      if(tag==='A'){const kind=linkKind(attr(node,'href',2048));out.links[kind]++;if(card)card.links[kind]++;
        if(kind==='post'&&out.postLinkSamples.length<5)out.postLinkSamples.push(ancestors(node));}
      if(card){if(tag==='TIME'||tag==='ABBR')card.timeHint=true;
        const label=norm(attr(node,'aria-label')||attr(node,'title'));
        if(['public','công khai','shared with public','đã chia sẻ với công khai'].includes(label))card.publicLabelHints++;
        if(['friends','bạn bè','only me','chỉ mình tôi','private group','nhóm riêng tư'].includes(label))card.restrictedLabelHints++;
      }
    } else {
      const value=node.nodeValue||'';if(!value.slice(0,160).trim())continue;out.textNodes++;
      const sample=norm(value.slice(0,160));
      let p=node.parentElement,sensitive=false;for(let i=0;p&&i<12;i++,p=p.parentElement){if(['FORM','DIALOG'].includes(p.tagName)||['dialog','alert'].includes(attr(p,'role'))){sensitive=true;break;}}
      if(sensitive&&['security check','kiểm tra bảo mật','xác minh bạn là người','confirm your identity'].includes(sample)){out.status='CHALLENGE';out.scan='BARRIER_STOP';out.cards=[];out.postLinkSamples=[];out.ancestorSteps=0;return out;}
      if(sensitive&&['access denied','you do not have permission','bạn không có quyền truy cập'].includes(sample)){out.status='ACCESS_DENIED';out.scan='BARRIER_STOP';out.cards=[];out.postLinkSamples=[];out.ancestorSteps=0;return out;}
      if(barrierContexts.has(node.parentElement))continue;
      const card=cardFor(node);if(card){card.textNodes++;const size=value.length;
        if(size>300)card.textSize='LARGE';else if(size>80&&card.textSize!=='LARGE')card.textSize='MEDIUM';else if(card.textSize==='EMPTY')card.textSize='SHORT';
        if(sample==='xem thêm'||sample==='see more')card.seeMoreHint=true;
      }
    }
  }while((node=walker.nextNode()));}catch(error){if(error!==stop)throw error;}
  out.scan=out.nodeLimit||out.timeLimit?'PARTIAL':'COMPLETE';
  out.status=out.cards.length?'HEURISTIC_MATCH':out.postLinkSamples.length?'POST_LINK_STRUCTURE':'NO_MATCH';return out;
})()`;
