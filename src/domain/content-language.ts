import { francAll } from 'franc-min';
import type { CampaignPlan } from './campaign-plan.js';
import type { ConversationSnapshot } from './conversation.js';
import { validateConversationDecision, type ConversationDecisionInput } from './conversation-decision.js';

export const CONTENT_LANGUAGE_POLICY = 'vietnamese-content-v1';
export type LanguageEvidence = { state: 'MATCH' | 'MISMATCH' | 'UNKNOWN'; detected: string; method: string };
const vietnameseNames = new Set(['vi', 'vie', 'vietnamese', 'tiếng việt']);
export const vietnameseOnly = (plan: Pick<CampaignPlan, 'languages'>) => plan.languages.length > 0
  && plan.languages.every(v => vietnameseNames.has(v.normalize('NFC').trim().toLowerCase()));
// Include common question/determiner words from colloquial short posts. These are
// prose cues; venue names, addresses and topical nouns alone still cannot prove language.
const accentedWords = new Set('tôi mình bạn muốn cần tìm học thích mê đàn người những đang được không với cho của này rồi quá các một là có hỏi cảm ơn nhiều bao nhiêu nhỉ nhé vậy thì chưa rất đam chuyện chia sẻ và mà đã để nhưng cũng vẫn sẽ chỉ mới vì đi lại nữa từ cùng thấy nên về sự mọi cả ấy đó biết phải được vừa lớp việc tiền giúp giáo viên nhận à ạ hả nào mấy đây đâu tụi nè ơi'.split(' '));
const asciiWords = new Set([...accentedWords].map(w => w.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd')));
const asciiPhrase = /\b(?:minh muon|toi muon|can tim|co ai|xin hoi|cho minh|cam on|duoc khong|bao nhieu|nha minh|moi nguoi|o dau|khong biet|rat thich|dang can|can hoc)\b/u;
function prose(text: string): string {
  // Handles, links, email addresses and tags are not evidence of the author's language.
  return text.normalize('NFC').replace(/<[^>]*>/gu, ' ').replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/giu, ' ')
    .replace(/(^|\s)[@#][\p{L}\p{N}_.]+/gu, '$1 ').replace(/[\p{N}_]/gu, ' ');
}
function segment(text: string): LanguageEvidence {
  const lower = text.toLowerCase(), words = lower.match(/\p{L}+/gu) ?? [], letters = words.join('');
  const unknown: LanguageEvidence = { state: 'UNKNOWN', detected: 'und', method: 'INSUFFICIENT_TEXT' };
  if (letters.length < 4) return unknown;
  const latin = letters.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (letters.length >= 6 && latin / letters.length < 0.5) return { state: 'MISMATCH', detected: 'non-Latin', method: 'SCRIPT' };
  const distinct = [...new Set(words)], viWords = distinct.filter(w => accentedWords.has(w) && /[^a-z]/u.test(w)).length;
  const plainWords = distinct.filter(w => asciiWords.has(w)).length;
  const vietnameseMarks = words.filter(w => /[đăơưạ-ỹ]/u.test(w)).length;
  // Colloquial Vietnamese plus borrowed words is poorly represented by UDHR
  // trigrams. Script-specific marks with prose cues preserve these real cases.
  if (viWords >= 1 && vietnameseMarks >= 2 && vietnameseMarks / words.length >= 0.2)
    return { state: 'MATCH', detected: 'vie', method: 'VIETNAMESE_MARKS_AND_PROSE' };
  if (asciiPhrase.test(lower) && plainWords >= 3 && plainWords / distinct.length >= 0.35)
    return { state: 'MATCH', detected: 'vie', method: 'VIETNAMESE_WITHOUT_DIACRITICS' };
  if (words.length >= 2 && words.length <= 4 && viWords >= 1)
    return { state: 'MATCH', detected: 'vie', method: 'SHORT_VIETNAMESE_PHRASE' };
  const candidates = francAll(text, { minLength: 10 }), first = candidates[0], second = candidates[1];
  if (!first || first[0] === 'und') return unknown;
  // Franc distances are ranking scores, not calibrated probabilities. Require
  // Vietnamese prose cues too; a person's name/address alone cannot admit a post.
  if (first[0] === 'vie' && viWords >= 1 && words.length >= 2)
    return { state: 'MATCH', detected: 'vie', method: 'TRIGRAM_AND_PROSE' };
  if (letters.length >= 30 && words.length >= 5 && first[0] !== 'vie' && (!second || first[1] - second[1] >= 0.05))
    return { state: 'MISMATCH', detected: first[0], method: 'TRIGRAM' };
  return { ...unknown, detected: first[0], method: 'AMBIGUOUS_TEXT' };
}
/** Content language only: never infer nationality or location from a name. */
export function vietnameseEvidence(text: string): LanguageEvidence {
  const cleaned = prose(text), whole = segment(cleaned);
  if (whole.state === 'MATCH') return whole;
  // A meaningful Vietnamese sentence can coexist with quoted foreign material.
  // Short names and isolated hashtags cannot rescue an otherwise foreign post.
  for (const line of cleaned.split(/[\n.!?。！？]+/u)) {
    if ((line.match(/\p{L}+/gu)?.length ?? 0) < 4) continue;
    const evidence = segment(line);
    if (evidence.state === 'MATCH') return { ...evidence, method: 'VIETNAMESE_PASSAGE:' + evidence.method };
  }
  return whole;
}
export function languageEntities(snapshot: ConversationSnapshot) {
  return [snapshot.post, ...snapshot.comments].filter(e => e !== null).map(entity => ({ entity, evidence: vietnameseEvidence(entity.text) }));
}
function localDecision(plan: CampaignPlan, snapshot: ConversationSnapshot, mismatch: boolean, reason: string): ConversationDecisionInput {
  return { campaign_id: plan.campaign_id, campaign_version: plan.version, filter_version: plan.filter_version, snapshot_id: snapshot.id,
    classification: mismatch ? 'NOT_SUITABLE' : null, assessment_status: mismatch ? 'ASSESSED' : 'PENDING',
    reason_code: reason, model: 'LOCAL_LANGUAGE_POLICY', action_target: null, evidence_ids: snapshot.spans.slice(0, 3).map(s => s.id),
    attributes: { language_policy: CONTENT_LANGUAGE_POLICY, required_language: 'vi', language_status: mismatch ? 'MISMATCH' : 'UNKNOWN',
      need_summary: mismatch ? 'Nội dung quan sát được không phải tiếng Việt.' : 'Chưa đủ nội dung để xác nhận tiếng Việt.' } };
}
export function beforeLanguageAssessment(plan: CampaignPlan, snapshot: ConversationSnapshot): ConversationDecisionInput | null {
  if (!vietnameseOnly(plan)) return null;
  const entities = languageEntities(snapshot);
  if (entities.some(e => e.evidence.state === 'MATCH')) return null;
  const mismatch = entities.length > 0 && entities.every(e => e.evidence.state === 'MISMATCH');
  return localDecision(plan, snapshot, mismatch, mismatch ? 'CONTENT_LANGUAGE_MISMATCH' : 'CONTENT_LANGUAGE_UNVERIFIED');
}
/** Also applies to cached decisions and offline revisions; the selected actor must match. */
export function enforceContentLanguage(plan: CampaignPlan, snapshot: ConversationSnapshot, decision: ConversationDecisionInput): ConversationDecisionInput {
  if (!vietnameseOnly(plan) || decision.classification !== 'SUITABLE') return decision;
  const entities = languageEntities(snapshot), candidate = entities.find(e => e.entity.entity_id === decision.action_target?.entity_id);
  const vietnameseProof = snapshot.spans.some(span => span.entity_id === candidate?.entity.entity_id && decision.evidence_ids.includes(span.id)
    && vietnameseEvidence(span.text).state === 'MATCH');
  if (candidate?.evidence.state === 'MATCH' && vietnameseProof) return { ...decision, attributes: { ...decision.attributes,
    language_policy: CONTENT_LANGUAGE_POLICY, required_language: 'vi', language_status: 'MATCH', language_method: candidate.evidence.method } };
  const noCandidate = beforeLanguageAssessment(plan, snapshot);
  const result = noCandidate ?? localDecision(plan, snapshot, false, candidate?.evidence.state === 'MATCH'
    ? 'CONTENT_LANGUAGE_EVIDENCE_UNVERIFIED' : 'CONTENT_LANGUAGE_CANDIDATE_UNVERIFIED');
  const next = { ...decision, ...result, model: decision.model, attributes: { ...decision.attributes, ...result.attributes,
    previous_classification: decision.classification, detected_language: candidate?.evidence.detected ?? 'und' } };
  validateConversationDecision(next, snapshot); return next;
}
