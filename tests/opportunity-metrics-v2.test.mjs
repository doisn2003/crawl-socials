import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpportunitySample, wilson } from '../scripts/benchmark/evaluate-opportunity-v2.mjs';

test('missing output counts as FN and unresolved accepted rows stay in precision bounds', () => {
  const reference = [
    { snapshot_id: 'a', final_label: 'SUITABLE' }, { snapshot_id: 'b', final_label: 'SUITABLE' },
    { snapshot_id: 'c', final_label: 'NOT_YET' }, { snapshot_id: 'd', final_label: 'REFERENCE_UNRESOLVED' },
    { snapshot_id: 'e', final_label: 'REFERENCE_UNRESOLVED' },
  ];
  const predictions = ['a', 'c', 'd'].map(snapshot_id => ({ snapshot_id, classification: 'SUITABLE', assessment_status: 'ASSESSED' }));
  const metrics = evaluateOpportunitySample(reference, predictions, () => 'threads').threads;
  assert.equal(metrics.tp, 1); assert.equal(metrics.fp, 1); assert.equal(metrics.fn, 1);
  assert.equal(metrics.precision_known_reference, .5);
  assert.deepEqual(metrics.precision_bounds_including_unresolved, { lower: 1 / 3, upper: 2 / 3 });
  assert.deepEqual(metrics.recall_bounds_including_unresolved, { lower: 1 / 3, upper: 2 / 3 });
  assert.equal(metrics.release_gate, 'NOT_EVALUATED_CALIBRATION_SET_NOT_FRESH_HOLDOUT');
});

test('zero denominators remain unknown and Wilson never turns no data into success', () => {
  assert.equal(wilson(0, 0), null);
  const empty = evaluateOpportunitySample([], [], () => 'facebook').facebook;
  assert.equal(empty.precision_known_reference, null); assert.equal(empty.recall_known_reference, null);
  assert.equal(empty.precision_bounds_including_unresolved, null);
});
