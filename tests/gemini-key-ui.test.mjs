import test from 'node:test';
import assert from 'node:assert/strict';
import { bindGeminiKeySettings } from '../dist/renderer/gemini-key-settings.js';
test('credential UI clears input, reports only status, and locks changes while running', async () => {
  const previous = globalThis.document, elements = new Map(); let running = false, received = null;
  const node = id => { if (!elements.has(id)) elements.set(id, { value: '', disabled: true, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }); return elements.get(id); };
  globalThis.document = { getElementById: node };
  try {
    const ui = bindGeminiKeySettings({ status: async () => ({ source: 'NONE', readError: false }),
      save: async input => { received = input; return { source: 'SAVED', readError: false }; },
      remove: async () => ({ source: 'NONE', readError: false }) }, () => running);
    await new Promise(setImmediate);
    node('gemini-api-key').value = 'test-only-credential-value';
    node('save-gemini-key').listeners.click(); await new Promise(setImmediate);
    assert.equal(received.key, 'test-only-credential-value');
    assert.equal(node('gemini-api-key').value, ''); assert.match(node('gemini-key-status').textContent, /Đã lưu/);
    assert.ok(!node('gemini-key-status').textContent.includes(received.key));
    running = true; ui.refresh(); assert.equal(node('save-gemini-key').disabled, true); assert.equal(node('remove-gemini-key').disabled, true);
    running = false; ui.refresh(); node('remove-gemini-key').listeners.click(); await new Promise(setImmediate);
    assert.match(node('gemini-key-status').textContent, /Chưa có key/);
  } finally { globalThis.document = previous; }
});
