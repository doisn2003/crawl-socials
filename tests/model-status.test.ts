import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPauseMessage } from '../src/shared/model-status.js';

test('AI transport failure explains the reserved credits and saved data', () => {
  assert.match(modelPauseMessage('MODEL_NETWORK_USAGE_UNKNOWN')!, /Kết nối AI.*giữ dự phòng/);
  assert.match(modelPauseMessage('MODEL_NETWORK_USAGE_UNKNOWN')!, /Dữ liệu đã thu vẫn được lưu/);
});

test('model stop explanations distinguish the retired call cap, CSD money and provider billing/quota', () => {
  assert.match(modelPauseMessage('MODEL_CALL_LIMIT_REACHED')!, /bản cũ.*Tiếp tục lượt này/);
  assert.match(modelPauseMessage('MODEL_GLOBAL_BUDGET_EXHAUSTED')!, /giới hạn chi tiêu AI.*vẫn được lưu/);
  assert.match(modelPauseMessage('MODEL_BUDGET_BUSY')!, /chưa kết luận đã hết tiền/);
  assert.match(modelPauseMessage('MODEL_BUDGET_EXHAUSTED')!, /giới hạn chi phí của lượt này/);
  assert.match(modelPauseMessage('MODEL_BILLING_EMPTY')!, /thanh toán hoặc số dư/);
  assert.match(modelPauseMessage('MODEL_HTTP_429')!, /Dịch vụ AI đang giới hạn/);
  assert.equal(modelPauseMessage('SOURCE_EXHAUSTED'), null);
});
