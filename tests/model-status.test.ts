import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPauseMessage } from '../src/shared/model-status.js';

test('Gemini transport failure is identified without telling the user to reset app data', () => {
  assert.match(modelPauseMessage('MODEL_NETWORK_USAGE_UNKNOWN')!, /Kết nối tới Gemini/);
  assert.match(modelPauseMessage('MODEL_NETWORK_USAGE_UNKNOWN')!, /không cần xóa dữ liệu/);
});

test('model stop explanations distinguish the retired call cap, CSD money and provider billing/quota', () => {
  assert.match(modelPauseMessage('MODEL_CALL_LIMIT_REACHED')!, /bản cũ.*Tiếp tục lượt này/);
  assert.match(modelPauseMessage('MODEL_GLOBAL_BUDGET_EXHAUSTED')!, /giới hạn chi phí đã đặt trên máy này.*những lượt trước/);
  assert.match(modelPauseMessage('MODEL_BUDGET_BUSY')!, /chưa kết luận đã hết tiền/);
  assert.match(modelPauseMessage('MODEL_BUDGET_EXHAUSTED')!, /giới hạn chi phí của lượt này/);
  assert.match(modelPauseMessage('MODEL_BILLING_EMPTY')!, /Google báo/);
  assert.match(modelPauseMessage('MODEL_HTTP_429')!, /Google đang giới hạn/);
  assert.equal(modelPauseMessage('SOURCE_EXHAUSTED'), null);
});
