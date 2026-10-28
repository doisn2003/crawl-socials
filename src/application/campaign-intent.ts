import type { CampaignValidator } from './ports/campaign-validator.js';
import { INTENT_MODEL_VERSION, INTENT_NORMALIZATION_VERSION } from '../domain/campaign-intent.js';
import type { CampaignIntent, Immutable, IntentCondition, IntentErrorCode, IntentKeyword,
  IntentPlace, IntentText, KeywordDeclaration } from '../domain/campaign-intent.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const vietnameseAliasCharacters = new Map<string, string>([
  ['a', 'àáảãạăằắẳẵặâầấẩẫậ'], ['e', 'èéẻẽẹêềếểễệ'], ['i', 'ìíỉĩị'],
  ['o', 'òóỏõọôồốổỗộơờớởỡợ'], ['u', 'ùúủũụưừứửữự'], ['y', 'ỳýỷỹỵ'], ['d', 'đ'],
].flatMap(([base, characters]) => [...characters!].map(character => [character, base!] as const)));
function fail(code: IntentErrorCode): never { throw new Error(code); }
function immutable<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Literal normalization, never a query expander, entity resolver or post matcher. */
export function normalizeIntentText(value: unknown): Immutable<IntentText> {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value)) fail('INTENT_TEXT_INVALID');
  const nfc = value.normalize('NFC');
  const canonical = nfc.replace(/[\p{White_Space}\uFEFF]+/gu, ' ').trim();
  if (!canonical || /[\u0000-\u001f\u007f-\u009f]/u.test(canonical)) fail('INTENT_TEXT_INVALID');
  const caseKey = canonical.toLowerCase().normalize('NFC');
  // Replace only listed Vietnamese characters after NFC; shared combining marks in
  // Greek/Cyrillic and marks outside this table are never stripped globally.
  const alias = [...caseKey].map(character => vietnameseAliasCharacters.get(character) ?? character).join('');
  return immutable({ raw: value, nfc, canonical, case_key: caseKey,
    accent_alias: { value: alias, purpose: 'COMPARISON_ONLY', policy: 'VIETNAMESE_DIACRITICS_V1' },
    trace: { nfc_changed: value !== nfc, whitespace_changed: nfc !== canonical,
      case_changed: canonical !== caseKey, accent_alias_changed: caseKey !== alias } });
}

function declarations(value: unknown, keywordCount: number): Map<number, KeywordDeclaration> {
  if (!Array.isArray(value)) fail('INTENT_DECLARATION_INVALID');
  const result = new Map<number, KeywordDeclaration>();
  for (const item of value) {
    if (!object(item) || Object.keys(item).sort().join(',') !== 'declaration_ref,keyword_index,kind'
      || typeof item.keyword_index !== 'number' || !Number.isSafeInteger(item.keyword_index)
      || item.keyword_index < 0 || item.keyword_index >= keywordCount || result.has(item.keyword_index)
      || (item.kind !== 'EXACT_PHRASE' && item.kind !== 'BRAND')
      || typeof item.declaration_ref !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9_:/.\-]{0,255}$/.test(item.declaration_ref)) fail('INTENT_DECLARATION_INVALID');
    result.set(item.keyword_index, { keyword_index: item.keyword_index, kind: item.kind, declaration_ref: item.declaration_ref });
  }
  return result;
}

/** Validate once through the existing campaign port, then map a detached snapshot without altering policy. */
export function buildCampaignIntent(input: unknown, validator: CampaignValidator,
  explicitDeclarations: unknown = []): Immutable<CampaignIntent> {
  let campaign;
  try { campaign = structuredClone(validator.parse(input)); }
  catch { fail('INTENT_CAMPAIGN_INVALID'); }
  if (!campaign.workload.keywords.length) fail('INTENT_KEYWORDS_EMPTY');
  const declared = declarations(explicitDeclarations, campaign.workload.keywords.length);
  const seen = new Set<string>();
  const keywords: IntentKeyword[] = campaign.workload.keywords.map((raw, index) => {
    const text = normalizeIntentText(raw);
    if (seen.has(text.case_key)) fail('INTENT_DUPLICATE_KEYWORD');
    seen.add(text.case_key);
    const declaration = declared.get(index);
    const path = 'workload.keywords[' + index + ']';
    return { id: path, kind: declaration?.kind ?? 'KEYWORD', text,
      origin: { source_path: path, declaration_ref: declaration?.declaration_ref ?? null },
      declaration_status: declaration ? 'EXPLICIT_DECLARATION' : 'CAMPAIGN_KEYWORD', entity_verification: 'NOT_PERFORMED' };
  });
  const condition = (raw: string, kind: IntentCondition['kind'], path: string): IntentCondition => ({
    kind, text: normalizeIntentText(raw), origin: { source_path: path, declaration_ref: null }, evaluation: 'NOT_EVALUATED',
  });
  const places = (raw: string[], field: 'places' | 'preferred_places', role: IntentPlace['role']): IntentPlace[] =>
    raw.map((value, index) => ({ kind: 'PLACE', role, text: normalizeIntentText(value),
      origin: { source_path: 'workload.geography.' + field + '[' + index + ']', declaration_ref: null },
      entity_verification: 'NOT_PERFORMED' }));
  const aliasGroups = new Map<string, IntentKeyword[]>();
  for (const keyword of keywords) {
    const group = aliasGroups.get(keyword.text.accent_alias.value) ?? [];
    group.push(keyword); aliasGroups.set(keyword.text.accent_alias.value, group);
  }
  const model: CampaignIntent = {
    model_version: INTENT_MODEL_VERSION, normalization_version: INTENT_NORMALIZATION_VERSION,
    interpretation: 'EXPLICIT_STRUCTURE_ONLY',
    provenance: { kind: 'CAMPAIGN_SPEC', campaign_id: campaign.campaign_id,
      schema_version: campaign.schema_version, contract_version: campaign.contract_version },
    source_snapshot: campaign, keywords,
    intent: campaign.workload.intent === null ? null : condition(campaign.workload.intent, 'INTENT', 'workload.intent'),
    exclusions: campaign.workload.exclusions.map((raw, index) => condition(raw, 'EXCLUSION', 'workload.exclusions[' + index + ']')),
    geography: { mode: campaign.workload.geography.mode,
      required_places: places(campaign.workload.geography.places, 'places', 'REQUIRED_LOCATION'),
      preferred_places: places(campaign.workload.geography.preferred_places, 'preferred_places', 'PREFERRED_LOCATION'),
      evidence_rule: campaign.workload.geography.evidence_rule },
    accent_alias_collisions: [...aliasGroups].filter(([, group]) => group.length > 1).map(([alias, group]) => ({
      alias, keyword_ids: group.map(keyword => keyword.id), canonical_forms: group.map(keyword => keyword.text.canonical),
    })),
  };
  return immutable(model);
}
