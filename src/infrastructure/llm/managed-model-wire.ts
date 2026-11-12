import type { JsonModelRequest, ModelPrice } from '../../application/ports/model-gateway.js';
import type { ManagedModel } from '../../shared/managed.js';
import { geminiWireSchema, stableJson } from './gemini-gateway.js';

export function managedModelBody(model: ManagedModel, request: JsonModelRequest) {
  if (model === 'deepseek-flash') {
    return {
      model, stream: false, max_tokens: request.max_output_tokens, temperature: 0,
      thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${request.system}\nReturn a JSON object with exactly one key named "result". The value of "result" must conform to this schema:\n${stableJson(request.schema)}` },
        { role: 'user', content: stableJson(request.input) },
      ],
    };
  }
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: stableJson(request.input) }] }],
    generationConfig: {
      responseMimeType: 'application/json', responseJsonSchema: geminiWireSchema(request.schema),
      maxOutputTokens: request.max_output_tokens, temperature: 0,
      thinkingConfig: { thinkingLevel: request.thinking_level ?? 'minimal' },
    },
  };
}

export function managedModelBound(model: ManagedModel, request: JsonModelRequest, price: ModelPrice) {
  const bytes = Buffer.byteLength(JSON.stringify(managedModelBody(model, request)));
  return Math.ceil(((bytes + 1024) * price.input_per_million + request.max_output_tokens * price.output_per_million) * 1000);
}
