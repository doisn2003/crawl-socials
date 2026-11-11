import { COVERAGE_WAVE_SYSTEM, coverageWaveSchema } from '../application/coverage-portfolio.js';
import { POST_EVIDENCE_VERSION, postEvidenceWireSchema, postEvidenceWireSystem } from '../application/opportunity-post-classifier.js';
import { DISCOVERY_WIRE_EVIDENCE } from '../application/semantic-campaign.js';
import { EXPERIMENT_SYSTEM as discoverySystem, EXPERIMENT_SCHEMA as discoverySchema } from '../domain/opportunity-keywords.mjs';
import { EXPERIMENT_SYSTEM as semanticSystem, EXPERIMENT_SCHEMA as semanticSchema } from '../domain/semantic-keywords.mjs';
import { CAMPAIGN_MODEL_SCHEMA, GROUNDED_CAMPAIGN_MODEL_SCHEMA, GROUNDED_PLANNER_SYSTEM, PLANNER_SYSTEM } from '../application/compile-campaign.js';
import { COVERAGE_RECIPE, QUALITY_RECIPE } from '../application/coverage-classifier.js';
import { VERIFIER_SCHEMA, VERIFIER_SYSTEM } from '../application/opportunity-verifier.js';
import type { JsonModelRequest } from '../application/ports/model-gateway.js';
import type { ManagedScope } from '../shared/managed.js';
import { stableJson } from '../infrastructure/llm/gemini-gateway.js';
import { bad, integer, record, string } from './core.js';

function limitTree(value: unknown) {
  let nodes = 0;
  function visit(v: unknown, depth: number) {
    if (++nodes > 20_000 || depth > 24) throw bad('MODEL_REQUEST_INVALID');
    if (v && typeof v === 'object') for (const item of Object.values(v)) visit(item, depth + 1);
  }
  visit(value, 0);
}

function list(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw bad('MODEL_REQUEST_INVALID');
  return value as unknown[];
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw bad('MODEL_REQUEST_INVALID');
}

export function validateModelRequest(value: unknown, scope: ManagedScope): JsonModelRequest {
  limitTree(value);
  const req = record(value), input = record(req.input), purpose = string(req.purpose, 80);
  keys(req, ['purpose','system','input','schema','max_output_tokens','cache_namespace','thinking_level']);
  const output = integer(req.max_output_tokens, 1, 24_000);
  if (req.thinking_level && req.thinking_level !== 'minimal') throw bad('MODEL_REQUEST_INVALID');
  const isPlanner = purpose.startsWith('campaign-planner-');
  const isExpansion = purpose === 'coverage-query-expansion-v4';
  if (scope === 'COLLECT' || (scope === 'PLAN' && !isPlanner) || (scope === 'ASSESS' && isExpansion)) throw bad('MODEL_SCOPE_INVALID');
  let system: string;
  let schema: Record<string, unknown>;
  let limit: number;
  switch (purpose) {
    case 'campaign-planner-v3.0.0-opportunity-coverage':
      keys(input, ['INTENT_FIELD_CATALOG','PROMPT','CONTEXT','SEEDS','ORIGINAL_FACETS','FAMILY_CATALOG','SEARCH_EFFORT',
        'ACTIVE_ANSWERS','ACTIVE_EDITS','ANSWER_HISTORY','EDIT_HISTORY','VALIDATION_REPAIR','FEEDBACK','PREVIOUS_CANDIDATE','revision']);
      string(input.PROMPT, 20_000);
      system = discoverySystem + DISCOVERY_WIRE_EVIDENCE;
      schema = { ...discoverySchema, properties: { ...discoverySchema.properties,
        intent_revision: { type: 'integer', enum: [integer(input.revision, 1, 10000)] } } };
      limit = 24_000;
      break;
    case 'campaign-planner-v2.0.0-semantic-dialogue':
      string(input.PROMPT ?? input.prompt, 20_000);
      system = semanticSystem;
      schema = semanticSchema;
      limit = 12_000;
      break;
    case 'campaign-planner-v1.1-grounded-short':
      system = PLANNER_SYSTEM;
      schema = CAMPAIGN_MODEL_SCHEMA;
      limit = 6_000;
      break;
    case 'campaign-planner-v1.2.1-grounded-constraints':
      system = GROUNDED_PLANNER_SYSTEM;
      schema = GROUNDED_CAMPAIGN_MODEL_SCHEMA;
      limit = 9_000;
      break;
    case 'coverage-query-expansion-v4': {
      const slots = list(input.slot_registry, 120).map(item => string(record(item).slot_id, 4));
      if (new Set(slots).size !== slots.length || slots.some(id => !/^q\d{2,3}$/.test(id))) throw bad('MODEL_REQUEST_INVALID');
      system = COVERAGE_WAVE_SYSTEM;
      schema = coverageWaveSchema(slots);
      limit = 12_000;
      break;
    }
    case POST_EVIDENCE_VERSION:
    case POST_EVIDENCE_VERSION + '-review': {
      keys(input, ['goal','as_of','posts','repair']);
      const posts = list(input.posts, 16);
      const counts = posts.map((item, i) => {
        const post = record(item);
        keys(post, ['i','evidence_scope','published_at','spans']);
        if (post.i !== i || post.evidence_scope !== 'POST_ONLY_V1') throw bad('MODEL_REQUEST_INVALID');
        return list(post.spans, 500).map((span, e) => {
          const evidence = record(span);
          keys(evidence, ['e','text']);
          if (evidence.e !== e) throw bad('MODEL_REQUEST_INVALID');
          return string(evidence.text, 40_000);
        }).length;
      });
      system = postEvidenceWireSystem(purpose.endsWith('-review'), input.repair !== undefined);
      schema = postEvidenceWireSchema(counts);
      limit = 128 + posts.length * 480;
      break;
    }
    case COVERAGE_RECIPE.filter_version:
    case QUALITY_RECIPE.filter_version: {
      const recipe = purpose === COVERAGE_RECIPE.filter_version ? COVERAGE_RECIPE : QUALITY_RECIPE;
      system = recipe.system;
      schema = recipe.schema;
      limit = 128 + list(input.conversations, 32).length * (purpose === COVERAGE_RECIPE.filter_version ? 200 : 220);
      break;
    }
    case 'conversation-opportunity-verifier-v1':
    case 'conversation-opportunity-verifier-v1.1-intent':
      system = VERIFIER_SYSTEM;
      schema = VERIFIER_SCHEMA;
      limit = 400 * list(input.conversations, 32).length + 256;
      break;
    default: throw bad('MODEL_PURPOSE_INVALID');
  }
  if (req.system !== system || output > limit || stableJson(req.schema) !== stableJson(schema)) throw bad('MODEL_REQUEST_INVALID');
  if (Buffer.byteLength(stableJson(input)) > 96 * 1024) throw bad('MODEL_INPUT_TOO_LARGE');
  return { purpose, system, input, schema, max_output_tokens: output, ...(req.cache_namespace ? { cache_namespace: string(req.cache_namespace, 180) } : {}) };
}
