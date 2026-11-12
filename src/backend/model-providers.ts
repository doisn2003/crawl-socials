import type { ModelUsage } from '../application/ports/model-gateway.js';
import { parseGeminiUsage } from '../infrastructure/llm/gemini-gateway.js';
import type { ManagedModel } from '../shared/managed.js';
import type { BackendConfig } from './config.js';

export const MODEL_PRICE_SOURCES: Record<ManagedModel, string> = {
  'gemini-3.1-flash-lite': 'https://ai.google.dev/gemini-api/docs/pricing',
  'deepseek-flash': 'https://api-docs.deepseek.com/quick_start/pricing/',
};

export function modelCredential(config: BackendConfig, model: unknown) {
  if (model === 'gemini-3.1-flash-lite') return config.geminiKey;
  if (model === 'deepseek-flash') return config.deepseekKey ?? null;
  return null;
}

export function modelEndpoint(model: ManagedModel, credential: string): { url: string; headers: Record<string, string> } {
  if (model === 'deepseek-flash') {
    return { url: 'https://api.deepseek.com/chat/completions', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential } };
  }
  return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': credential } };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const first = (value: unknown) => Array.isArray(value) ? object(value[0]) : {};
const tokens = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseDeepSeekUsage(value: unknown): ModelUsage | null {
  const usage = object(value);
  const input = usage.prompt_tokens, output = usage.completion_tokens;
  const cached = usage.prompt_cache_hit_tokens, uncached = usage.prompt_cache_miss_tokens;
  const reasoning = object(usage.completion_tokens_details).reasoning_tokens ?? 0;
  if (!tokens(input) || !tokens(output) || !tokens(cached) || !tokens(uncached) || !tokens(reasoning)
    || cached + uncached !== input || reasoning > output) return null;
  return { input_tokens: input, output_tokens: output, cached_input_tokens: cached, thinking_tokens: reasoning };
}

export function parseModelResponse(model: ManagedModel, value: unknown) {
  const payload = object(value);
  if (model === 'deepseek-flash') {
    const choice = first(payload.choices), message = object(choice.message);
    return { usage: parseDeepSeekUsage(payload.usage), complete: choice.finish_reason === 'stop',
      generated: typeof message.content === 'string' ? message.content : '',
      version: typeof payload.model === 'string' && payload.model !== model ? payload.model : null };
  }
  const candidate = first(payload.candidates), parts = object(candidate.content).parts;
  const generated = Array.isArray(parts) ? parts.map(object).filter(part => !part.thought && typeof part.text === 'string')
    .map(part => part.text).join('') : '';
  return { usage: parseGeminiUsage(payload.usageMetadata), complete: candidate.finishReason === 'STOP', generated,
    version: typeof payload.modelVersion === 'string' ? payload.modelVersion : null };
}
