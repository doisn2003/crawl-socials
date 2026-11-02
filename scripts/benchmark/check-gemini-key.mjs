// Small live preflight before resuming AppData replays. Never logs credentials.
import { writeFileSync } from 'node:fs';
import { resolveGeminiApiKey } from '../../dist/infrastructure/llm/gemini-gateway.js';

let credential = resolveGeminiApiKey();
if (!credential) throw Error('GEMINI_KEY_REQUIRED');
const clean = value => String(value ?? '').replaceAll(credential, '[REDACTED]')
  .replace(/AIza[\w-]+|AQ\.[\w-]+/gu, '[REDACTED]').slice(0, 1500);
const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': credential },
  body: JSON.stringify({ contents: [{ parts: [{ text: 'Return only OK.' }] }],
    generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'LOW' } } }),
  signal: AbortSignal.timeout(45000),
});
const body = await response.json().catch(() => null);
const reply = body?.candidates?.[0]?.content?.parts?.filter(p => p.text && !p.thought).map(p => p.text).join('') ?? '';
const result = { checked_at: new Date().toISOString(), model: 'gemini-3.5-flash-lite',
  http_status: response.status, provider_status: body?.error?.status ?? null,
  message: clean(body?.error?.message), reply: clean(reply), usage: body?.usageMetadata ?? null,
  reasons: (body?.error?.details ?? []).filter(d => d.reason).map(d => ({
    reason: clean(d.reason), service: clean(d.metadata?.service),
  })), success: response.ok && reply.trim() === 'OK',
};
credential = '';
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.success) process.exitCode = 1;
