import type { JsonModelRequest, ModelPrice } from '../../application/ports/model-gateway.js';
import { geminiWireSchema, stableJson } from './gemini-gateway.js';

export function managedGeminiBody(request: JsonModelRequest) {
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

export function managedGeminiBound(request: JsonModelRequest, price: ModelPrice) {
  const bytes = Buffer.byteLength(JSON.stringify(managedGeminiBody(request)));
  return Math.ceil(((bytes + 1024) * price.input_per_million + request.max_output_tokens * price.output_per_million) * 1000);
}
