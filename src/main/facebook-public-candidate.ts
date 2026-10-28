import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInside } from '../infrastructure/config/runtime-paths.js';
import { inspectDomRoute } from './facebook-dom-diagnostic.js';
import type { DomTarget } from './facebook-dom-diagnostic.js';
import { canonicalCandidateLink, redactCandidateText, inspectCurrentGroupPostRoute } from './facebook-public-candidate-fields.js';
import { FACEBOOK_PUBLIC_CANDIDATE_SCRIPT, FACEBOOK_CURRENT_POST_SCRIPT } from './facebook-public-candidate-script.js';

export const PUBLIC_CANDIDATE_LIMITS = Object.freeze({ nodes:2500, candidates:5, examined:12, textChars:800, totalTextChars:4000,
  scriptMs:1000, readMs:4000, runMs:300000, actions:1, bytes:32768, runsPerProcess:3, shapes:5, fallbackAncestors:8, feedWarmup:6, coLocationMisses:12, aliasAncestors:8, headerTreeNodes:2500, barrierCandidates:16, barrierDescendants:128, barrierAncestors:32,
  headerLinks:16,headerTextChars:96,headerTextNodes:96,headerControls:4,headerProbeNodes:64,textRects:8,textAncestors:32,geometryShapes:5,negativeTextChars:160,negativeTextNodes:96 });
const hash = (value:string|Uint8Array) => createHash('sha256').update(value).digest('hex');
export const PUBLIC_CANDIDATE_SCRIPT_SHA256 = hash(FACEBOOK_PUBLIC_CANDIDATE_SCRIPT);
// Main-only completion record. No renderer/CLI input or artifact import creates this record.
export interface CurrentPostObservation {
  profile_id:string;web_contents_id:number;view_generation:number;run_id:string;capture_mode:'LIVE'|'FIXTURE';
  candidate_file_sha256:string;summary_sha256:string;context_hint:NonNullable<ReturnType<typeof inspectCurrentGroupPostRoute>>;
  text:string;text_status:'VISIBLE_SNIPPET'|'TRUNCATED';
}
const reasonKeys = ['NO_FEED','NOT_RENDERED','NO_HEADER','NO_TEMPORAL','MISSING_PUBLIC','RESTRICTED','CONFLICTING_PUBLIC','AD_OR_SUGGESTION','AMBIGUOUS_BOUNDARY','INCOMPLETE_BOUNDARY','DUPLICATE_ID','NO_COLOCATED_BOUNDARY','NO_HEADER_CLUSTER'] as const;
const statusKeys = ['SAMPLES_READY','NO_PUBLIC_CANDIDATE','AUTH_REQUIRED','CHALLENGE','ACCESS_DENIED','UNSUPPORTED_OVERLAY','BARRIER_SCAN_INCOMPLETE','UNSUPPORTED_ROUTE','QUERY_MISMATCH','DOM_UNAVAILABLE'] as const;
const missingKeys = ['BOUNDARY_HEURISTIC','SOURCE_TYPE_UNVERIFIED','PUBLICITY_NOT_INDEPENDENTLY_VERIFIED','PERMALINK_NOT_IN_DOM','BODY_REGION_UNRECOGNIZED','BODY_TEXT_NOT_VISIBLE','TEMPORAL_NOT_OBSERVED','TEMPORAL_UNREADABLE','AUXILIARY_TEXT_OMITTED'] as const;
const linkKeys = ['post','group','profile','other','external'] as const;
type CandidateMetadata = { headings:number; temporal:number; publicLabels:number; restrictedLabels:0; messageRegions:number;
  links:Record<typeof linkKeys[number],number>; timeTag:boolean; abbr:boolean; ariaTemporal:boolean;temporalStatus:'OBSERVED'|'MISSING'|'UNREADABLE';headerProof:'HEADING_TEMPORAL_PUBLIC'|'HEADING_PUBLIC';auxiliaryTextOmitted:boolean };
export interface PublicCandidate {
  boundary:'POST_DIALOG_HEADER_TEMPORAL'|'POST_DIALOG_HEADER_PUBLIC_OPTIONAL_TIME'|'FEED_CHILD_HEADER_TEMPORAL'|'MAIN_ARTICLE_HEADER_TEMPORAL'|'MAIN_COLOCATED_HEADER_TEMPORAL'|'FEED_CHILD_HEADER_PUBLIC_OPTIONAL_TIME'|'MAIN_ARTICLE_HEADER_PUBLIC_OPTIONAL_TIME'|'MAIN_COLOCATED_HEADER_PUBLIC_OPTIONAL_TIME'; boundary_verified:false; public_signal:'DIRECT_PUBLIC_LABEL'; source_type:'UNKNOWN';
  post_id:string|null; permalink:string|null; published_at:null;text:string|null; text_status:'VISIBLE_SNIPPET'|'TRUNCATED'|'MISSING_BODY_MARKER'|'MISSING_BODY_TEXT';
  contacts_redacted:boolean; missing_fields:typeof missingKeys[number][]; metadata:CandidateMetadata;
}
type GeometryShape={scope:'TEMPORAL'|'BODY'|'OTHER'|'AUXILIARY';reason:'CLIP_PATH'|'LEGACY_CLIP'|'TRANSFORM'|'INVALID_GEOMETRY'|'BOUNDS';axis:'X'|'Y'|'BOTH'|'UNKNOWN';coverage:'UNSUPPORTED'|'PARTIAL'|'MIXED';excess:'UNKNOWN'|'SUBPIXEL'|'PX_1_4'|'PX_4_16'|'GT_16';rects:'ONE'|'MULTIPLE';count:number};
export interface PublicCandidateResult {
  version:13|14; context_hint?:ReturnType<typeof inspectCurrentGroupPostRoute>;context?:{visibleDialogs:number;wrapperDialogs:number;wrapperNodes:number;publicGroupSignals:number}; status:typeof statusKeys[number]; route:'SEARCH_POSTS'|'SEARCH_TOP_MIXED'|'SEARCH_OTHER'|'GROUP_SINGLE_POST'; root:'NONE'|'FEED_ROOT'|'FEED_IN_MAIN'|'MAIN_FALLBACK'|'POST_DIALOG';
  visited:number; examined:number; pruned:number; nodeLimit:boolean; timeLimit:boolean; candidateLimit:boolean; boundaryLimit:boolean;
  rejected:Record<typeof reasonKeys[number],number>; samples:PublicCandidate[];
  selection:{firstFeedFound:boolean;feedLandmarks:boolean;fallbackUsed:boolean;feedExamined:number;mainExamined:number;coLocationMisses:number;
    fallbackScan:'NOT_USED'|'COMPLETE'|'PARTIAL'|'CANDIDATE_CAP'|'BOUNDARY_CAP'|'BARRIER_STOP';discoveryHints:Record<typeof discoveryKeys[number],number>};
  rejectionShapes:{origin:'FEED_CHILD'|'MAIN_ARTICLE'|'MAIN_COLOCATION';reason:typeof reasonKeys[number];tag:'DIV'|'ARTICLE'|'SECTION'|'HEADER'|'MAIN'|'LI'|'UL'|'OTHER';
    role:'article'|'feed'|'main'|'group'|'region'|'listitem'|'OTHER';depth:'DIRECT'|'SHALLOW'|'DEEP'|'UNKNOWN';feedRelation:'INSIDE'|'OUTSIDE'|'NO_FEED'|'UNKNOWN_DEPTH';
    state:'COMPLETE'|'PRUNED'|'PARTIAL'|'NOT_SCANNED';hints:Record<typeof shapeHintKeys[number],number>;prunes:Record<typeof pruneKeys[number],number>;
    layout:Record<typeof layoutKeys[number],number>;messages:Record<typeof messageKeys[number],number>&{depthLimit:boolean;groupingComplete:boolean};header:{clusterFound:boolean;publicClusterFound:boolean;ancestorLimit:boolean;treeState:'COMPLETE'|'INCOMPLETE'|'NOT_SCANNED';publicDepth:'NONE'|'SHALLOW'|'DEEP';temporalDepth:'NONE'|'SHALLOW'|'DEEP';publicLabelsSeen:number;publicSignalsAccepted:number;publicControlsPruned:number};temporal:Record<typeof temporalKeys[number],number>}[];
  diagnostics:{layout:Record<typeof layoutKeys[number],number>;messages:Record<typeof diagnosticMessageKeys[number],number>;headers:Record<typeof headerKeys[number],number>;temporal:Record<typeof temporalKeys[number],number>};
  geometryShapes:GeometryShape[];
  barriers:{state:'NOT_STARTED'|'CLEAR'|'VISIBLE'|'INCOMPLETE';reason:'NONE'|'CANDIDATE_LIMIT'|'DESCENDANT_LIMIT'|'ANCESTOR_LIMIT'|'NODE_LIMIT'|'TIME_LIMIT'|'API_UNAVAILABLE';
    kind:'NONE'|'OVERLAY'|'AUTH'|'CHALLENGE'|'DENIED';evidence:'NONE'|'AUTH_FIELD'|'CHALLENGE_FRAME'|'MODAL_BOX'|'VISIBLE_TEXT'|'VISIBLE_CONTROL'|'CHALLENGE_TEXT'|'DENIED_TEXT';
    inspected:number;hidden:number;empty:number;visible:number;descendants:number;ancestors:number;overflow:boolean};
}
const discoveryKeys=['headings','temporal','publicLabels','restrictedLabels','messageRegions','articles','outsideFeed'] as const;
const shapeHintKeys=['headings','temporal','publicLabels','restrictedLabels','messageRegions','outsideHeaderDepth'] as const;
const pruneKeys=['article','hidden','control','navigation','comment'] as const;
const layoutKeys=['contents','boxless','hidden','textRanges','textRangeMisses','textParentBoxes','textRangePositive','textZeroArea','textClipped','textUnknown','textSeparators','textClipChecks','textUnknownApi','textUnknownRect','textUnknownAncestor','textUnknownClip','textUnknownPartial','clipCacheHits','clipAncestorSteps','clipAncestorMisses','clipPropagations','localIncomplete','clipFullX','clipFullY','clipPartialX','clipPartialY','clipMixed','clipEmptyLegacy','clipEmptyInset','clipLegacyInactive','auxiliaryOmitted','negativeScopes','negativeUnresolved','negativeVetoes'] as const;
const messageKeys=['markers','groups','nestedAliases','nestedUnresolved','sibling','disjoint','nestedDirect','nestedShallow','nestedDeep'] as const;
const diagnosticMessageKeys=[...messageKeys,'groupingIncomplete','depthLimits'] as const;
const headerKeys=['deepHints','clustersFound','ancestorLimits','publicClustersFound','treeNodes','treeEdges','ancestryCuts','treeIncomplete','publicLabelsSeen','publicSignalsAccepted','publicControlsPruned'] as const;
const temporalKeys=['links','roleLinks','controls','labelMatches','directMatches','nestedMatches','splitMatches','controlMatches','unmatched','textLimits','recordLimits','charLimits','textNodeLimits','probeLimits','scopeMisses','emptyText','classifierMisses','rangeSegments','rangeChars','zeroSegments','clippedSegments','unknownSegments','controlSkipped','probeNodes','date','relative','dayWord','abbreviated','quoteExcluded','headingExcluded','bodyExcluded','hiddenSkipped'] as const;
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_RESULT');return value as Record<string,unknown>;};
const keys=(o:Record<string,unknown>,expected:readonly string[])=>{if(Object.keys(o).sort().join()!==[...expected].sort().join())throw new Error('INVALID_RESULT');};
const number=(value:unknown,max=2500)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)throw new Error('INVALID_RESULT');return value;};
const bool=(value:unknown)=>{if(typeof value!=='boolean')throw new Error('INVALID_RESULT');return value;};
function enumeration<T extends string>(value:unknown,values:readonly T[]):T{if(typeof value!=='string'||!values.includes(value as T))throw new Error('INVALID_RESULT');return value as T;}
export function validatePublicCandidateResult(value:unknown,postContext=false):PublicCandidateResult {
  const o=object(value);keys(o,['version','status','route','root','visited','examined','pruned','nodeLimit','timeLimit','candidateLimit','boundaryLimit','rejected','samples','selection','rejectionShapes','geometryShapes','diagnostics','barriers',...(postContext?['context_hint','context']:[])]);
  if(o.version!==(postContext?14:13)||!Array.isArray(o.samples)||o.samples.length>5||!Array.isArray(o.rejectionShapes)||o.rejectionShapes.length>5||!Array.isArray(o.geometryShapes)||o.geometryShapes.length>5)throw new Error('INVALID_RESULT');
  const rejected=object(o.rejected);keys(rejected,reasonKeys);let totalText=0;const ids=new Set<string>();
  const s=object(o.selection);keys(s,['firstFeedFound','feedLandmarks','fallbackUsed','feedExamined','mainExamined','coLocationMisses','fallbackScan','discoveryHints']);
  const numericRecord=<T extends string>(value:unknown,expected:readonly T[]):Record<T,number>=>{const record=object(value);keys(record,expected);return Object.fromEntries(expected.map(key=>[key,number(record[key])])) as Record<T,number>;};
  const d=object(o.diagnostics);keys(d,['layout','messages','headers','temporal']);
  const b=object(o.barriers);keys(b,['state','reason','kind','evidence','inspected','hidden','empty','visible','descendants','ancestors','overflow']);
  const result:PublicCandidateResult={version:postContext?14:13,status:enumeration(o.status,statusKeys),route:enumeration(o.route,postContext?['GROUP_SINGLE_POST']:['SEARCH_POSTS','SEARCH_TOP_MIXED','SEARCH_OTHER']),root:enumeration(o.root,postContext?['NONE','POST_DIALOG']:['NONE','FEED_ROOT','FEED_IN_MAIN','MAIN_FALLBACK']),
    visited:number(o.visited),examined:number(o.examined,12),pruned:number(o.pruned),nodeLimit:bool(o.nodeLimit),timeLimit:bool(o.timeLimit),candidateLimit:bool(o.candidateLimit),boundaryLimit:bool(o.boundaryLimit),
    selection:{firstFeedFound:bool(s.firstFeedFound),feedLandmarks:bool(s.feedLandmarks),fallbackUsed:bool(s.fallbackUsed),feedExamined:number(s.feedExamined,12),mainExamined:number(s.mainExamined,12),coLocationMisses:number(s.coLocationMisses,12),fallbackScan:enumeration(s.fallbackScan,['NOT_USED','COMPLETE','PARTIAL','CANDIDATE_CAP','BOUNDARY_CAP','BARRIER_STOP']),discoveryHints:numericRecord(s.discoveryHints,discoveryKeys)},
    diagnostics:{layout:numericRecord(d.layout,layoutKeys),messages:numericRecord(d.messages,diagnosticMessageKeys),headers:numericRecord(d.headers,headerKeys),temporal:numericRecord(d.temporal,temporalKeys)},
    geometryShapes:o.geometryShapes.map(value=>{const sh=object(value);keys(sh,['scope','reason','axis','coverage','excess','rects','count']);const count=number(sh.count);if(count<1)throw new Error('INVALID_RESULT');return{scope:enumeration(sh.scope,['TEMPORAL','BODY','OTHER','AUXILIARY']),reason:enumeration(sh.reason,['CLIP_PATH','LEGACY_CLIP','TRANSFORM','INVALID_GEOMETRY','BOUNDS']),axis:enumeration(sh.axis,['X','Y','BOTH','UNKNOWN']),coverage:enumeration(sh.coverage,['UNSUPPORTED','PARTIAL','MIXED']),excess:enumeration(sh.excess,['UNKNOWN','SUBPIXEL','PX_1_4','PX_4_16','GT_16']),rects:enumeration(sh.rects,['ONE','MULTIPLE']),count};}),
    barriers:{state:enumeration(b.state,['NOT_STARTED','CLEAR','VISIBLE','INCOMPLETE']),reason:enumeration(b.reason,['NONE','CANDIDATE_LIMIT','DESCENDANT_LIMIT','ANCESTOR_LIMIT','NODE_LIMIT','TIME_LIMIT','API_UNAVAILABLE']),kind:enumeration(b.kind,['NONE','OVERLAY','AUTH','CHALLENGE','DENIED']),evidence:enumeration(b.evidence,['NONE','AUTH_FIELD','CHALLENGE_FRAME','MODAL_BOX','VISIBLE_TEXT','VISIBLE_CONTROL','CHALLENGE_TEXT','DENIED_TEXT']),inspected:number(b.inspected,16),hidden:number(b.hidden,16),empty:number(b.empty,16),visible:number(b.visible,1),descendants:number(b.descendants,128),ancestors:number(b.ancestors),overflow:bool(b.overflow)},
    rejectionShapes:o.rejectionShapes.map(value=>{const sh=object(value);keys(sh,['origin','reason','tag','role','depth','feedRelation','state','hints','prunes','layout','messages','header','temporal']);
      const msg=object(sh.messages);keys(msg,[...messageKeys,'depthLimit','groupingComplete']);
      const messages=Object.fromEntries(messageKeys.map(key=>[key,number(msg[key])])) as Record<typeof messageKeys[number],number>;
      const header=object(sh.header);keys(header,['clusterFound','publicClusterFound','ancestorLimit','treeState','publicDepth','temporalDepth','publicLabelsSeen','publicSignalsAccepted','publicControlsPruned']);
      if(messages.groups>messages.markers||messages.nestedAliases>messages.markers)throw new Error('INVALID_RESULT');
      return{origin:enumeration(sh.origin,['FEED_CHILD','MAIN_ARTICLE','MAIN_COLOCATION']),reason:enumeration(sh.reason,reasonKeys),tag:enumeration(sh.tag,['DIV','ARTICLE','SECTION','HEADER','MAIN','LI','UL','OTHER']),role:enumeration(sh.role,['article','feed','main','group','region','listitem','OTHER']),depth:enumeration(sh.depth,['DIRECT','SHALLOW','DEEP','UNKNOWN']),feedRelation:enumeration(sh.feedRelation,['INSIDE','OUTSIDE','NO_FEED','UNKNOWN_DEPTH']),state:enumeration(sh.state,['COMPLETE','PRUNED','PARTIAL','NOT_SCANNED']),hints:numericRecord(sh.hints,shapeHintKeys),prunes:numericRecord(sh.prunes,pruneKeys),layout:numericRecord(sh.layout,layoutKeys),messages:{...messages,depthLimit:bool(msg.depthLimit),groupingComplete:bool(msg.groupingComplete)},header:{clusterFound:bool(header.clusterFound),publicClusterFound:bool(header.publicClusterFound),ancestorLimit:bool(header.ancestorLimit),treeState:enumeration(header.treeState,['COMPLETE','INCOMPLETE','NOT_SCANNED']),publicDepth:enumeration(header.publicDepth,['NONE','SHALLOW','DEEP']),temporalDepth:enumeration(header.temporalDepth,['NONE','SHALLOW','DEEP']),publicLabelsSeen:number(header.publicLabelsSeen),publicSignalsAccepted:number(header.publicSignalsAccepted),publicControlsPruned:number(header.publicControlsPruned)},temporal:numericRecord(sh.temporal,temporalKeys)};
    }),rejected:Object.fromEntries(reasonKeys.map(key=>[key,number(rejected[key],12)])) as PublicCandidateResult['rejected'],samples:o.samples.map(value=>{
      const s=object(value);keys(s,['boundary','boundary_verified','public_signal','source_type','post_id','permalink','published_at','text','text_status','contacts_redacted','missing_fields','metadata']);
      const boundary=enumeration(s.boundary,postContext?['POST_DIALOG_HEADER_TEMPORAL','POST_DIALOG_HEADER_PUBLIC_OPTIONAL_TIME']:['FEED_CHILD_HEADER_TEMPORAL','MAIN_ARTICLE_HEADER_TEMPORAL','MAIN_COLOCATED_HEADER_TEMPORAL','FEED_CHILD_HEADER_PUBLIC_OPTIONAL_TIME','MAIN_ARTICLE_HEADER_PUBLIC_OPTIONAL_TIME','MAIN_COLOCATED_HEADER_PUBLIC_OPTIONAL_TIME']);
      if(s.boundary_verified!==false||s.public_signal!=='DIRECT_PUBLIC_LABEL'||s.source_type!=='UNKNOWN'||s.published_at!==null)throw new Error('INVALID_RESULT');
      let identity:null|ReturnType<typeof canonicalCandidateLink>=null;
      if(s.permalink!==null||s.post_id!==null){if(typeof s.permalink!=='string'||s.permalink.length>512||typeof s.post_id!=='string')throw new Error('INVALID_RESULT');
        identity=canonicalCandidateLink(s.permalink);if(!identity||identity.permalink!==s.permalink||identity.post_id!==s.post_id||ids.has(identity.post_id))throw new Error('INVALID_RESULT');ids.add(identity.post_id);}
      if(s.text!==null&&(typeof s.text!=='string'||s.text.length>800||redactCandidateText(s.text)!==s.text))throw new Error('INVALID_RESULT');
      const text=s.text as string|null;totalText+=text?.length||0;
      if(!Array.isArray(s.missing_fields)||s.missing_fields.length>6)throw new Error('INVALID_RESULT');
      const missing=s.missing_fields.map(value=>enumeration(value,missingKeys));
      if(new Set(missing).size!==missing.length||!['BOUNDARY_HEURISTIC','SOURCE_TYPE_UNVERIFIED','PUBLICITY_NOT_INDEPENDENTLY_VERIFIED'].every(key=>missing.includes(key as typeof missingKeys[number]))||(!identity&&!missing.includes('PERMALINK_NOT_IN_DOM')))throw new Error('INVALID_RESULT');
      const m=object(s.metadata);keys(m,['headings','temporal','publicLabels','restrictedLabels','messageRegions','links','timeTag','abbr','ariaTemporal','temporalStatus','headerProof','auxiliaryTextOmitted']);
      const l=object(m.links);keys(l,linkKeys);
      const metadata:CandidateMetadata={headings:number(m.headings,2),temporal:number(m.temporal),publicLabels:number(m.publicLabels),restrictedLabels:0,messageRegions:number(m.messageRegions,1),
        links:Object.fromEntries(linkKeys.map(key=>[key,number(l[key])])) as CandidateMetadata['links'],timeTag:bool(m.timeTag),abbr:bool(m.abbr),ariaTemporal:bool(m.ariaTemporal),temporalStatus:enumeration(m.temporalStatus,['OBSERVED','MISSING','UNREADABLE']),headerProof:enumeration(m.headerProof,['HEADING_TEMPORAL_PUBLIC','HEADING_PUBLIC']),auxiliaryTextOmitted:bool(m.auxiliaryTextOmitted)};
      const textStatus=enumeration(s.text_status,['VISIBLE_SNIPPET','TRUNCATED','MISSING_BODY_MARKER','MISSING_BODY_TEXT']);
      const optional=boundary.endsWith('_HEADER_PUBLIC_OPTIONAL_TIME');
      if(!metadata.headings||!metadata.publicLabels||m.restrictedLabels!==0||
        (metadata.auxiliaryTextOmitted!==missing.includes('AUXILIARY_TEXT_OMITTED'))||
        (metadata.auxiliaryTextOmitted&&((!postContext&&metadata.headings!==1)||metadata.messageRegions!==1||!text||missing.some(key=>key==='BODY_REGION_UNRECOGNIZED'||key==='BODY_TEXT_NOT_VISIBLE')))||
        (optional&&((!postContext&&metadata.headings!==1)||metadata.messageRegions!==1||!text||metadata.temporal!==0||metadata.timeTag||metadata.abbr||metadata.ariaTemporal||metadata.headerProof!=='HEADING_PUBLIC'||metadata.temporalStatus==='OBSERVED'||!missing.includes(metadata.temporalStatus==='UNREADABLE'?'TEMPORAL_UNREADABLE':'TEMPORAL_NOT_OBSERVED')||missing.includes(metadata.temporalStatus==='UNREADABLE'?'TEMPORAL_NOT_OBSERVED':'TEMPORAL_UNREADABLE')||missing.some(key=>key==='BODY_REGION_UNRECOGNIZED'||key==='BODY_TEXT_NOT_VISIBLE')))||
        (!optional&&(!metadata.temporal||metadata.headerProof!=='HEADING_TEMPORAL_PUBLIC'||metadata.temporalStatus!=='OBSERVED'||missing.some(key=>key==='TEMPORAL_NOT_OBSERVED'||key==='TEMPORAL_UNREADABLE')))||
        (text!==null&&(!text||metadata.messageRegions!==1||!['VISIBLE_SNIPPET','TRUNCATED'].includes(textStatus)))||
        (text===null&&!['MISSING_BODY_MARKER','MISSING_BODY_TEXT'].includes(textStatus))||
        (text===null&&!missing.some(key=>key==='BODY_REGION_UNRECOGNIZED'||key==='BODY_TEXT_NOT_VISIBLE')))throw new Error('INVALID_RESULT');
      return{boundary,boundary_verified:false,public_signal:'DIRECT_PUBLIC_LABEL',source_type:'UNKNOWN',post_id:identity?.post_id||null,permalink:identity?.permalink||null,published_at:null,text,text_status:textStatus,contacts_redacted:bool(s.contacts_redacted),missing_fields:missing,metadata};
    })};
  const barrierStatuses=['AUTH_REQUIRED','CHALLENGE','ACCESS_DENIED','UNSUPPORTED_OVERLAY'];
  const visibleEvidence:Record<string,readonly string[]>={AUTH_REQUIRED:['AUTH_FIELD'],CHALLENGE:['CHALLENGE_FRAME','CHALLENGE_TEXT'],ACCESS_DENIED:['DENIED_TEXT'],UNSUPPORTED_OVERLAY:['MODAL_BOX','VISIBLE_TEXT','VISIBLE_CONTROL']};
  const visibleKinds:Record<string,string>={AUTH_REQUIRED:'AUTH',CHALLENGE:'CHALLENGE',ACCESS_DENIED:'DENIED',UNSUPPORTED_OVERLAY:'OVERLAY'};
  if(totalText>4000||result.samples.length>result.examined||(result.status==='SAMPLES_READY')!==(result.samples.length>0)||
    (result.samples.length&&(result.root==='NONE'||result.route==='SEARCH_OTHER'))||result.pruned>result.visited||
    result.selection.feedExamined+result.selection.mainExamined!==result.examined||
    (result.selection.fallbackUsed!==(['MAIN_FALLBACK','POST_DIALOG'].includes(result.root)))||
    (!result.selection.fallbackUsed&&(result.selection.fallbackScan!=='NOT_USED'||result.selection.mainExamined>0))||
    result.barriers.hidden+result.barriers.empty+result.barriers.visible>result.barriers.inspected||
    (result.status==='BARRIER_SCAN_INCOMPLETE')!==(result.barriers.state==='INCOMPLETE')||
    (barrierStatuses.includes(result.status)!==(result.barriers.state==='VISIBLE'))||
    (result.barriers.state==='INCOMPLETE'&&(result.barriers.reason==='NONE'||result.barriers.visible!==0||result.barriers.kind!=='NONE'||result.barriers.evidence!=='NONE'||result.samples.length>0))||
    (result.barriers.state==='VISIBLE'&&(result.barriers.visible!==1||result.barriers.reason!=='NONE'||result.samples.length>0||result.barriers.kind!==visibleKinds[result.status]||!visibleEvidence[result.status]?.includes(result.barriers.evidence)))||
    (['CLEAR','NOT_STARTED'].includes(result.barriers.state)&&(result.barriers.visible!==0||result.barriers.kind!=='NONE'||result.barriers.evidence!=='NONE'||result.barriers.reason!=='NONE'||result.barriers.overflow))||
    (result.barriers.state==='NOT_STARTED'&&(result.barriers.inspected!==0||result.barriers.hidden!==0||result.barriers.empty!==0||result.barriers.descendants!==0||result.barriers.ancestors!==0))||
    (result.samples.length>0&&result.barriers.state!=='CLEAR')||
    (result.nodeLimit&&result.visited!==2500)||Buffer.byteLength(JSON.stringify(result))>24576)throw new Error('INVALID_RESULT');
  if(postContext){
    const context=object(o.context);keys(context,['visibleDialogs','wrapperDialogs','wrapperNodes','publicGroupSignals']);
    result.context={visibleDialogs:number(context.visibleDialogs,16),wrapperDialogs:number(context.wrapperDialogs,15),wrapperNodes:number(context.wrapperNodes,128),publicGroupSignals:number(context.publicGroupSignals)};
    result.context_hint=null;
    if(o.context_hint!==null){const hint=object(o.context_hint);keys(hint,['verification','provenance','group_id','post_id','observed_route']);const parsed=typeof hint.observed_route==='string'?inspectCurrentGroupPostRoute(hint.observed_route):null;
      if(!parsed||Object.entries(parsed).some(([key,value])=>hint[key]!==value))throw new Error('INVALID_RESULT');result.context_hint=parsed;}
    if(result.samples.length>1||result.examined>1||result.candidateLimit||result.boundaryLimit||
      (result.samples.length>0)!==(result.context_hint!==null)||
      (result.root==='POST_DIALOG'&&(result.context.visibleDialogs!==result.context.wrapperDialogs+1||result.examined!==1))||
      (result.samples.length&&(!result.context.publicGroupSignals||result.samples.some(s=>s.metadata.messageRegions!==1||!s.text||(s.post_id!==null&&s.post_id!==result.context_hint?.post_id))))||Buffer.byteLength(JSON.stringify(result))>24576)throw new Error('INVALID_RESULT');
  }
  return result;
}
export function createPublicCandidateSink(userData:string,workspace:string){
  const base=realpathSync(userData),repo=realpathSync(workspace),root=join(base,'public-candidate-diagnostics');
  if(isInside(repo,base)||isInside(base,repo))throw new Error('CANDIDATE_OUTPUT_DENIED');
  if(!existsSync(root))mkdirSync(root);
  const check=(path:string)=>{if(lstatSync(path).isSymbolicLink()||realpathSync(path)!==resolve(path)||!isInside(base,realpathSync(path)))throw new Error('CANDIDATE_OUTPUT_DENIED');};check(root);
  return(id:string)=>{if(!/^candidate-[0-9a-f-]{36}$/.test(id))throw new Error('CANDIDATE_RUN_ID_INVALID');check(root);const directory=join(root,id);mkdirSync(directory);check(directory);let bytes=0;
    return{directory,write(name:'started.json'|'candidates.json'|'summary.json',value:unknown){check(root);check(directory);const text=JSON.stringify(value)+'\n';bytes+=Buffer.byteLength(text);if(bytes>32768)throw new Error('CANDIDATE_OUTPUT_LIMIT');writeFileSync(join(directory,name),text,{encoding:'utf8',flag:'wx',flush:true});return hash(text);}};};
}
export function createFacebookPublicCandidateProbe(input:{resolve:(profileId:string)=>DomTarget|null;sink:ReturnType<typeof createPublicCandidateSink>;mode:'LIVE'|'FIXTURE';context?:'CURRENT_GROUP_POST';onCurrentPost?:(record:CurrentPostObservation)=>void;now?:()=>number;mono?:()=>number}){
  if(!['LIVE','FIXTURE'].includes(input.mode))throw new Error('CANDIDATE_MODE_INVALID');
  const postContext=input.context==='CURRENT_GROUP_POST',version=postContext?14:13,script=postContext?FACEBOOK_CURRENT_POST_SCRIPT:FACEBOOK_PUBLIC_CANDIDATE_SCRIPT;
  const now=input.now||Date.now,mono=input.mono||(()=>performance.now()),codeHash=hash(readFileSync(new URL('./facebook-public-candidate.js',import.meta.url)));
  let busy=false,nativePending=false,runs=0,cancel:((reason:string)=>void)|null=null;
  return{stop(){cancel?.('STOPPED');},async start(profileId:string){
    if(busy||nativePending)throw new Error('CANDIDATE_BUSY');if(runs>=3)throw new Error('CANDIDATE_PROCESS_LIMIT');busy=true;runs++;
    const started=now(),anchor=mono(),id='candidate-'+randomUUID();let timer:ReturnType<typeof setTimeout>|undefined,unwatch=()=>{},status='READ_FAILED',actions=0,data:PublicCandidateResult|null=null,readOwner:DomTarget|null=null;
    const meta={version,run_id:id,started_at:new Date(started).toISOString(),capture_mode:input.mode,diagnostic_only:true,benchmark_eligible:false,platform_permission:'UNKNOWN',verified_valid_count:0,
      query_id:postContext?'CURRENT_GROUP_POST':'CAFE_HA_NOI',batch:1,limits:postContext?{...PUBLIC_CANDIDATE_LIMITS,candidates:1,examined:1,totalTextChars:800}:PUBLIC_CANDIDATE_LIMITS,script_sha256:hash(script),code_sha256:codeHash,code_hash_scope:'PUBLIC_CANDIDATE_CONTROLLER_MODULE',public_filter_evidence:'NOT_USED_AS_PUBLICITY_PROOF',decision_ref:'ADR-010',field_contract_ref:postContext?'ADR-014':'ADR-013'};
    let store:ReturnType<ReturnType<typeof createPublicCandidateSink>>|undefined;
    try{
      store=input.sink(id);store.write('started.json',{...meta,state:'STARTED',actions:0});const target=input.resolve(profileId);if(!target)throw new Error('OWNER_CHANGED');readOwner=target;
      const inspect=(url:string)=>postContext?(inspectCurrentGroupPostRoute(url)?'OK':'UNSUPPORTED_ROUTE'):inspectDomRoute(url);const route=inspect(target.url());if(route!=='OK')status=route;else{
        const kind=(url:string)=>postContext?'GROUP_SINGLE_POST':/^\/search\/posts\/?$/.test(new URL(url).pathname)?'SEARCH_POSTS':'SEARCH_TOP_MIXED',expected=kind(target.url()),expectedHint=postContext?JSON.stringify(inspectCurrentGroupPostRoute(target.url())):null;
        const same=()=>{const current=input.resolve(profileId),url=current?.url();return current&&url&&current.webContentsId===target.webContentsId&&current.viewGeneration===target.viewGeneration&&inspect(url)==='OK'&&kind(url)===expected&&(!postContext||JSON.stringify(inspectCurrentGroupPostRoute(url))===expectedHint);};
        const timing=()=>{if(now()<started)throw new Error('CLOCK_UNCERTAIN');const elapsed=Math.max(now()-started,mono()-anchor);if(elapsed>=300000)throw new Error('DEADLINE');if(elapsed>=4000)throw new Error('READ_TIMEOUT');};
        let revoked:string|null=null;const aborted=new Promise<never>((_resolve,reject)=>{cancel=reason=>{revoked=reason;reject(new Error(reason));};});
        unwatch=target.watchLoss(()=>cancel?.('OWNER_CHANGED'));timer=setTimeout(()=>cancel?.('READ_TIMEOUT'),4000);
        if(!same())throw new Error('OWNER_CHANGED');timing();actions=1;nativePending=true;
        const native=Promise.resolve().then(()=>{if(revoked||!same())throw new Error(revoked||'OWNER_CHANGED');timing();return target.execute(script);});
        void native.then(()=>{nativePending=false;},()=>{nativePending=false;});
        const value=await Promise.race([native,aborted]);if(revoked)throw new Error(revoked);timing();if(!same())throw new Error('OWNER_CHANGED');
        data=validatePublicCandidateResult(value,postContext);if(data.route!==expected||(postContext&&data.context_hint&&JSON.stringify(data.context_hint)!==expectedHint))throw new Error('INVALID_RESULT');timing();if(!same())throw new Error('OWNER_CHANGED');status=data.status;
      }
    }catch(error){const reason=error instanceof Error?error.message:'';status=['STOPPED','OWNER_CHANGED','CLOCK_UNCERTAIN','DEADLINE','READ_TIMEOUT','INVALID_RESULT'].includes(reason)?reason:'READ_FAILED';data=null;}
    finally{if(timer)clearTimeout(timer);try{unwatch();}catch{status='READ_FAILED';data=null;}cancel=null;busy=false;}
    if(!store)throw new Error('CANDIDATE_OUTPUT_FAILED');
    const expires=new Date(now()+7*86400000).toISOString(),payloadHash=store.write('candidates.json',{version,run_id:id,capture_mode:input.mode,expires_at:expires,samples:data?.samples||[],...(postContext?{context_hint:data?.context_hint||null}:{})});
    const summary={...meta,finished_at:new Date(now()).toISOString(),status,actions,candidate_count:data?.samples.length||0,route:data?.route||null,root:data?.root||null,
      visited:data?.visited||0,examined:data?.examined||0,pruned:data?.pruned||0,node_limit:data?.nodeLimit||false,time_limit:data?.timeLimit||false,candidate_limit:data?.candidateLimit||false,boundary_limit:data?.boundaryLimit||false,
      rejected:data?.rejected||null,selection:data?.selection||null,rejection_shapes:data?.rejectionShapes||[],geometry_shapes:data?.geometryShapes||[],diagnostics:data?.diagnostics||null,barriers:data?.barriers||null,identity_missing_count:data?.samples.filter(sample=>!sample.post_id).length||0,text_missing_count:data?.samples.filter(sample=>!sample.text).length||0,
      ...(postContext?{context:data?.context||null,context_hint_count:data?.context_hint?1:0}:{}),candidate_file_sha256:payloadHash,retention_cleanup:'MANUAL_REQUIRED_NO_SCHEDULER',expires_at:expires};
    const sha256=store.write('summary.json',summary);
    const sample=data?.samples[0],current=postContext&&input.onCurrentPost?input.resolve(profileId):null;
    if(postContext&&input.onCurrentPost&&status==='SAMPLES_READY'&&data?.samples.length===1&&data.context_hint&&data.context?.publicGroupSignals===1&&data.root==='POST_DIALOG'&&data.barriers.state==='CLEAR'&&
      !data.nodeLimit&&!data.timeLimit&&!data.candidateLimit&&!data.boundaryLimit&&!data.diagnostics.layout.localIncomplete&&!data.diagnostics.messages.groupingIncomplete&&
      sample?.text&&['VISIBLE_SNIPPET','TRUNCATED'].includes(sample.text_status)&&current&&readOwner&&current.webContentsId===readOwner.webContentsId&&current.viewGeneration===readOwner.viewGeneration&&
      JSON.stringify(inspectCurrentGroupPostRoute(current.url()))===JSON.stringify(data.context_hint))input.onCurrentPost?.({profile_id:profileId,web_contents_id:readOwner.webContentsId,view_generation:readOwner.viewGeneration,run_id:id,capture_mode:input.mode,candidate_file_sha256:payloadHash,summary_sha256:sha256,context_hint:{...data.context_hint},text:sample.text,text_status:sample.text_status as 'VISIBLE_SNIPPET'|'TRUNCATED'});
    return{summary,directory:store.directory,sha256};
  }};
}
