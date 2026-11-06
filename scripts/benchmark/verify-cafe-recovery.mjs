// Offline delivery and cumulative-accounting checks for the authorized retest.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { selectOpportunityExport } from '../../dist/infrastructure/export/opportunity-workbook.js';

const directory = resolve('artifacts/cafe-consistent-recovery-20261106');
const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const status = read('status.json'), results = read('results.json'), task = read('task.json');
assert.equal(status.state, 'TARGET_REACHED');
const selected = selectOpportunityExport(results.opportunity, 'SUITABLE');
const key = snapshot => snapshot.platform + ':' + snapshot.root_post_id;
const raw = results.opportunity.snapshots.filter(s => s.post), rawKeys = new Set(raw.map(key));
const exported = new Set(selected.conversations.map(r => key(r.snapshot)));
const links = selected.conversations.map(r => r.snapshot.post?.permalink).filter(Boolean);
const canonicalLinks = links.map(link => {
  const url = new URL(link); url.hash = '';
  for (const name of [...url.searchParams.keys()]) if (!['story_fbid', 'id', 'fbid'].includes(name)) url.searchParams.delete(name);
  url.searchParams.sort(); return url.href.replace(/\/$/, '');
});
const retained = new Set(read('retained-A.json').map(key));
assert.equal(exported.size, 1000); assert.equal(selected.conversations.length, 1000);
assert.equal(new Set(canonicalLinks).size, canonicalLinks.length, 'duplicate permalink in customer export');
assert.equal(selected.snapshots.length, 1000); assert.equal(rawKeys.size, raw.length);
assert.ok([...retained].every(k => rawKeys.has(k)), 'retained raw roots must remain available');
assert.ok(raw.every(s => s.comments.length === 0));
assert.ok(selected.conversations.every(r => !r.stale && r.decision.assessment_status === 'ASSESSED'
  && r.decision.classification === 'SUITABLE' && r.decision.snapshot_id === r.snapshot.id));
const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(join(directory, 'A-CONSISTENT.xlsx'));
const sheet = workbook.getWorksheet('Conversations'); assert.equal(sheet.rowCount - 1, 1000);
const headers = sheet.getRow(1).values;
const workbookKeys = new Set();
sheet.eachRow((row, index) => {
  if (index === 1) return;
  const value = name => row.getCell(headers.indexOf(name)).value;
  assert.equal(value('classification'), 'SUITABLE'); assert.equal(value('assessment_status'), 'ASSESSED');
  assert.equal(value('selection_group'), 'TARGET');
  const k = value('platform') + ':' + value('root_post_id');
  assert.ok(exported.has(k)); assert.ok(!workbookKeys.has(k)); workbookKeys.add(k);
});
assert.equal(workbook.getWorksheet('Comments').rowCount, 1);
const closed = read('closed-spending.json');
assert.equal(closed.taskHeldUsd, 0); assert.ok(closed.taskUsd <= task.maxTaskUsd);
assert.ok(closed.taskCalls <= task.maxTaskCalls);
const ledger = readFileSync(join(directory, 'model/model-ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(ledger.filter(e => e.type === 'START').length, closed.taskCalls);
const measured = ledger.filter(e => e.type === 'FINISH').reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
assert.ok(Math.abs(measured - closed.taskUsd) < 1e-6);
const output = { passed: true, checkedAt: new Date().toISOString(), rawRoots: raw.length, retainedRoots: retained.size,
  newlyCollectedRoots: [...rawKeys].filter(k => !retained.has(k)).length, exportedRoots: exported.size,
  exportedRetainedRoots: [...exported].filter(k => retained.has(k)).length,
  exportedNewRoots: [...exported].filter(k => !retained.has(k)).length,
  exportedByPlatform: selected.conversations.reduce((counts, r) => {
    counts[r.snapshot.platform] = (counts[r.snapshot.platform] ?? 0) + 1; return counts;
  }, {}), comments: 0, duplicateRoots: 0, taskUsd: closed.taskUsd, taskCalls: closed.taskCalls,
  exportedMissingPermalinks: 1000 - links.length, duplicatePermalinks: canonicalLinks.length - new Set(canonicalLinks).size,
  heldUsd: closed.taskHeldUsd, measuredTokenLedgerUsd: measured };
writeFileSync(join(directory, 'verification.json'), JSON.stringify(output, null, 2), { flush: true });
console.log(JSON.stringify(output));
