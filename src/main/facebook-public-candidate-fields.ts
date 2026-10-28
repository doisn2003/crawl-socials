// These self-contained functions are embedded verbatim into the fixed isolated-world script.
export function classifySearchTargetKind(value:string|null):'ABSENT'|'EMPTY'|'SELF'|'BLANK'|'TOP'|'PARENT'|'NAMED'|'INVALID' {
  if(value===null)return'ABSENT';if(typeof value!=='string'||value.length>160)return'INVALID';if(value==='')return'EMPTY';
  const keyword:{[key:string]:'SELF'|'BLANK'|'TOP'|'PARENT'}={_self:'SELF',_blank:'BLANK',_top:'TOP',_parent:'PARENT'};
  const key=value.toLowerCase();return Object.hasOwn(keyword,key)?keyword[key]!: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)?'NAMED':'INVALID';
}
export function classifySearchTimestampHref(value:string,search:string):'SEARCH_PLACEHOLDER'|'OBSERVED_POST'|null {
  if(typeof value!=='string'||!value||value.length>2048||value!==value.trim())return null;
  try{
    const base=new URL(search),u=new URL(value,base);if(u.protocol!=='https:'||u.port||u.username||u.password||!(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com')))return null;
    const entries=[...u.searchParams.entries()],seen=new Set<string>();if(entries.length>8)return null;
    for(const [key,val] of entries){if(seen.has(key)||val.length>1024||!['q','__cft__[0]','__tn__','ref','refid','mibextid','multi_permalinks','hoisted_section_header_type'].includes(key))return null;seen.add(key);}
    if(u.origin===base.origin&&/^\/search\/(posts|top)\/?$/.test(u.pathname)&&u.pathname.replace(/\/$/,'')===base.pathname.replace(/\/$/,'')&&!seen.has('multi_permalinks')){
      if(u.hash&&!/^#\?[a-z]{3}$/.test(u.hash))return null;
      const q=u.searchParams.get('q');return q!==null&&q.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase()!=='cafe hà nội'?null:'SEARCH_PLACEHOLDER';}
    if(u.hash)return null;
    if(/^\/groups\/[0-9]{1,32}\/(posts|permalink)\/(?:[0-9]{1,32}|pfbid[A-Za-z0-9]{16,128})\/?$/.test(u.pathname))return'OBSERVED_POST';
    if(/^\/groups\/[0-9]{1,32}\/?$/.test(u.pathname)&&/^(?:[0-9]{1,32}|pfbid[A-Za-z0-9]{16,128})$/.test(u.searchParams.get('multi_permalinks')||''))return'OBSERVED_POST';
    return null;
  }catch{return null;}
}
export function inspectCurrentGroupPostRoute(value:string): {verification:'UNVERIFIED';provenance:'OBSERVED_CURRENT_URL';group_id:string;post_id:string;observed_route:string}|null {
  if(typeof value!=='string'||value.length>2048)return null;
  try {
    const u=new URL(value),group=u.pathname.match(/^\/groups\/([0-9]{1,32})\/?$/),raw=value.match(/^https:\/\/([^/?#]+)(\/[^?#]*)\?[^#]*$/);
    if(u.protocol!=='https:'||u.port||u.username||u.password||!(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))||!group||u.hash||!raw||raw[1]!==u.hostname||raw[2]!==u.pathname)return null;
    const parts=u.search.slice(1).split('&');if(parts.length>8)return null;
    const allowed=['multi_permalinks','hoisted_section_header_type','ref','refid','mibextid','__tn__','__cft__[0]'],seen=new Set<string>();let post:string|null=null;
    for(const part of parts){const equal=part.indexOf('=');if(equal<1)return null;const rawKey=part.slice(0,equal),key=/^__cft__%5[bB]0%5[dD]$/.test(rawKey)?'__cft__[0]':rawKey,raw=part.slice(equal+1);
      if(!allowed.includes(key)||seen.has(key)||raw.length>512)return null;seen.add(key);
      if(key==='multi_permalinks'){if(!/^(?:[0-9]{1,32}|pfbid[A-Za-z0-9]{16,128})$/.test(raw))return null;post=raw;}}
    if(!post)return null;
    return{verification:'UNVERIFIED',provenance:'OBSERVED_CURRENT_URL',group_id:group[1]!,post_id:post,observed_route:u.origin+'/groups/'+group[1]+'/?multi_permalinks='+post};
  }catch{return null;}
}
export function resolveObservedGroupQueryHref(value:string,search:string,inspect:(url:string)=>{observed_route:string}|null):string|null {
  if(typeof value!=='string'||!value||value.length>2048||/[\s\\]/.test(value))return null;
  try{const base=new URL(search);if(base.protocol!=='https:'||!(base.hostname==='facebook.com'||base.hostname.endsWith('.facebook.com')))return null;
    if(!value.startsWith('https://')&&!/^\/groups\/[0-9]{1,32}\/?\?/.test(value))return null;
    const absolute=value.startsWith('https://')?value:new URL(value,base).href,u=new URL(absolute);
    return u.origin===base.origin&&u.href===absolute&&inspect(absolute)?absolute:null;
  }catch{return null;}
}
export function canonicalCandidateLink(value: string): { post_id: string; permalink: string } | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value, 'https://www.facebook.com');
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !(u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com'))) return null;
    const id = (v: string | null): v is string => !!v && /^(?:[0-9]{1,32}|pfbid[A-Za-z0-9]{16,128})$/.test(v);
    const part = (v: string) => /^[A-Za-z0-9._-]{1,100}$/.test(v) && !['search','pages','groups','photo','photos','reel','videos'].includes(v);
    const group = u.pathname.match(/^\/groups\/([A-Za-z0-9._-]{1,100})\/(?:posts|permalink)\/([^/]+)\/?$/);
    if (group && id(group[2]!)) return { post_id: group[2]!, permalink: 'https://www.facebook.com/groups/' + group[1] + '/posts/' + group[2] + '/' };
    const post = u.pathname.match(/^\/([A-Za-z0-9._-]{1,100})\/posts\/([^/]+)\/?$/);
    if (post && part(post[1]!) && id(post[2]!)) return { post_id: post[2]!, permalink: 'https://www.facebook.com/' + post[1] + '/posts/' + post[2] + '/' };
    const plain = u.pathname.match(/^\/posts\/([^/]+)\/?$/);
    if (plain && id(plain[1]!)) return { post_id: plain[1]!, permalink: 'https://www.facebook.com/posts/' + plain[1] + '/' };
    if (/^\/(?:permalink|story)\.php$/.test(u.pathname) && u.searchParams.getAll('story_fbid').length === 1 && u.searchParams.getAll('id').length === 1) {
      const pid = u.searchParams.get('story_fbid'), owner = u.searchParams.get('id');
      if (id(pid) && owner && /^[0-9]{1,32}$/.test(owner)) return { post_id: pid, permalink: 'https://www.facebook.com/permalink.php?story_fbid=' + pid + '&id=' + owner };
    }
    return null;
  } catch { return null; }
}
export function redactCandidateText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[LINK]')
    .replace(/[\w.+-]+@[\w.-]+(?:\.[A-Za-z]{2,})?/g, '[EMAIL]')
    .replace(/@[^\s@]+/g, '[MENTION]')
    .replace(/\+?\d[\d\s().-]{4,}\d/g, '[NUMBER]')
    .replace(/\b(?:access_token|token|password|cookie)\s*[:=]\s*\S+/gi, '[REDACTED]')
    .replace(/[ \t]+/g, ' ').trim();
}
export function classifyHeaderTemporal(value: string): 'DATE'|'RELATIVE'|'DAY_WORD'|'ABBREVIATED'|'NONE' {
  if(typeof value!=='string'||value.length>96)return 'NONE';
  const text=value.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
  const date=text.match(/^(?:ngày\s*)?(\d{1,2})\s*(?:tháng|[/\.\-])\s*(\d{1,2})(?:\s*(?:năm|,|[/\.\-])\s*(\d{4}))?(?:\s*(?:lúc|at)\s*(\d{1,2}):(\d{2}))?$/);
  if(date){const d=Number(date[1]),m=Number(date[2]),h=date[4]===undefined?0:Number(date[4]),min=date[5]===undefined?0:Number(date[5]);return d>=1&&d<=31&&m>=1&&m<=12&&h<=23&&min<=59?'DATE':'NONE';}
  if(/^\d{1,5}\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm|seconds?|minutes?|hours?|days?|weeks?|months?|years?)(?:\s*(?:trước|ago))?$/.test(text))return 'RELATIVE';
  const day=text.match(/^(?:hôm qua|hôm nay|yesterday|today)(?:\s*(?:lúc|at)\s*(\d{1,2}):(\d{2}))?$/);
  if(day)return (day[1]===undefined||Number(day[1])<=23)&&(day[2]===undefined||Number(day[2])<=59)?'DAY_WORD':'NONE';
  return /^\d{1,5}\s*[smhdwy]$/.test(text)?'ABBREVIATED':'NONE';
}
