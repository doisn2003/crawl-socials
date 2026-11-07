import type { CampaignPlan } from './campaign-plan.js';
import type { ConversationObservation, SocialPlatform } from './conversation.js';
import { vietnameseEvidence, vietnameseOnly } from './content-language.js';

export const KEYWORD_COMMENT_LIMIT = 20;
export type KeywordComment = {
  comment_id: string; parent_id: string | null; text: string; likes: number | null;
  keyword: string; language: 'MATCH' | 'UNKNOWN' | 'UNRESTRICTED'; author_name: string | null; permalink: string | null; observed_at: string;
};
export type KeywordCommentCapture = {
  platform: SocialPlatform; root_post_id: string; post_url: string; comments: KeywordComment[];
};

const words = (value: string) => value.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '').replaceAll('đ', 'd')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function commentMatcher(campaign: CampaignPlan) {
  const intent = campaign.intent_resolution?.plan;
  const phrases = [...campaign.queries.map(q => q.text), ...campaign.inclusions,
    ...(intent?.branches.map(branch => branch.anchor) ?? []),
    ...(intent?.intent.filter(f => f.field === 'topics' && f.status === 'CONFIRMED').map(f => f.value) ?? [])];
  const terms = [...new Map(phrases.flatMap(phrase => phrase.split(/[,;\n]/u)).map(phrase => [words(phrase), phrase.trim()] as const))]
    .filter(([normalized]) => normalized.length >= 3).sort((a, b) => b[0].length - a[0].length);
  const vi = vietnameseOnly(campaign);
  return (observation: ConversationObservation): KeywordComment | null => {
    if (observation.entity_type !== 'COMMENT' || !observation.entity_id) return null;
    const content = ' ' + words(observation.text.replace(/https?:\/\/\S+/giu, ' ')) + ' ';
    const match = terms.find(([term]) => content.includes(' ' + term + ' '));
    if (!match) return null;
    const language = vi ? vietnameseEvidence(observation.text).state : 'UNRESTRICTED';
    if (language === 'MISMATCH') return null;
    return { comment_id: observation.entity_id, parent_id: observation.parent_id, text: observation.text,
      likes: observation.like_count ?? null, keyword: match[1], language, author_name: observation.author?.name ?? null,
      permalink: observation.permalink ?? null, observed_at: observation.observed_at };
  };
}
