import { FIELDS, validateResult } from '../domain/semantic-keywords.mjs';
import type { IntentInput, IntentPlan } from '../shared/semantic-intent.js';

/** Recover only an explicit, unrestricted list of post-search keywords. No role inference. */
export function literalTopicPlan(intent: IntentInput): IntentPlan | null {
  if (intent.revision !== 1 || intent.context.trim() || intent.answers.length || intent.edits.length || intent.seeds.length) return null;
  const match = /^(?:hãy\s+)?(?:tìm|thu thập|lấy)\s+(?:các\s+)?bài\s+(?:viết|đăng)\s+(?:có\s+)?liên quan\s+(?:tới|đến|với)\s+(?:các\s+)?từ khóa\s*:?\s+([\s\S]+)$/iu.exec(intent.prompt);
  if (!match) return null;
  const terms = match[1]!.replace(/(?:\.{3,}|…+)\s*$/u, '').split(/[,;\n]/u).map(term => term.trim());
  // Conditional clauses and incomplete/large lists stay with the semantic planner.
  if (terms.length < 2 || terms.some(term => !term || term.length > 100 || term.split(/\s+/u).length > 10
    || !/^[\p{L}\p{M}\p{N} -]+$/u.test(term)
    || /(?:^|\s)(?:chỉ|không|trừ|ngoại trừ|ưu tiên|bắt buộc|người|trong vòng|gần đây)(?:\s|$)/iu.test(term))) return null;
  const seen = new Set<string>(), topics = terms.filter(term => {
    const key = term.normalize('NFC').toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
  });
  if (topics.length < 2 || topics.length > 16 || topics.join(', ').length > 600 || intent.prompt.length > 5000) return null;
  const raw = {
    state: 'READY', intent_revision: intent.revision, understanding: intent.prompt, target_roles: [], constraints: [],
    intent: Object.keys(FIELDS).map(field => ({ field,
      value: field === 'target_roles' ? 'Không giới hạn vai trò người đăng'
        : field === 'topics' ? topics.join(', ')
        : field === 'purpose' ? 'Tìm bài viết liên quan đến các từ khóa đã nhập' : 'Chưa đặt giới hạn',
      status: field === 'topics' || field === 'purpose' ? 'CONFIRMED' : 'UNSPECIFIED',
      evidence: field === 'topics' || field === 'purpose' ? [{ source: 'PROMPT', quote: intent.prompt }] : [] })),
    branches: topics.map((text, index) => ({ id: 'user-topic-' + index, label: text, anchor: text,
      source: 'PROMPT', quote: text, scope: 'CORE', reason: 'Từ khóa được nêu trực tiếp trong yêu cầu' })),
    queries: topics.map((text, index) => ({ text, branch_id: 'user-topic-' + index, kind: 'EXACT', anchor: text,
      rationale: 'Giữ nguyên từ khóa người dùng đã nhập', risk: 'MEDIUM' })),
    questions: [], unresolved_fields: [], unconfirmed_assumptions: [], improvements: [],
    caveats: ['Kế hoạch được khôi phục từ danh sách từ khóa bạn đã nhập; không thêm giới hạn vai trò người đăng.'],
  };
  return validateResult(raw, 'B', intent, {});
}
