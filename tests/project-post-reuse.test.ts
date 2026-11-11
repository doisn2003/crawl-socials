import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { withFilterPolicy, unassessedGateway } from '../src/application/filter-policy.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';
import type { FilterMode } from '../src/shared/filter-policy.js';
import { compactProjectPostIndex, ProjectPostStore } from '../src/infrastructure/storage/project-post-store.js';
import { exportOpportunityWorkbook, selectOpportunityExport } from '../src/infrastructure/export/opportunity-workbook.js';
import { exportSocialWorkbook } from '../src/infrastructure/export/social-workbook.js';

test('project reuses QUALITY assessment in CONSISTENT with durable run flags and one canonical post', async () => {
  const projectDirectory = mkdtempSync(join(tmpdir(), 'csd-project-reuse-'));
  let calls = 0;
  const gateway: ModelGateway = { ...unassessedGateway, async generateJson(request) {
    calls++;
    const posts = (request.input as { posts: { i: number }[] }).posts;
    return { value: posts.map(post => ({ i: post.i, topic: 'RELATED', promotion: 'NO', actor: 'CONSUMER',
      opportunities: ['DIRECT_NEED'], usefulness: 'CONCRETE', goal_fit: 'EXACT', hard: 'PASS', time: 'UNBOUNDED',
      ev: [0], why: 'Tìm lớp học piano', flags: [] })), invocation_id: 'mock', request_hash: 'mock', model: 'mock', model_version: null,
      usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
      price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'mock', source: 'mock' } };
  } };
  const campaigns = new Map<string, ReturnType<typeof literalCampaign>>();
  const create = (id: string, mode: FilterMode) => {
    const campaign = campaigns.get(id) ?? withFilterPolicy(literalCampaign({ campaign_id: id, prompt: 'Tìm người muốn học piano', seed_queries: ['học piano'], suitable_target: 1, raw_cap: 10 }), mode);
    campaigns.set(id, campaign);
    return createOpportunityPipeline({ projectDirectory, compactProjectIndex: id !== 'first', directory: join(projectDirectory, 'collections', id), runId: id, campaign, gateway,
      excludedRootKeys: ['facebook:post-a'], platforms: ['facebook'], collectConversation: async () => {},
      config: { enabled: true, prompt: campaign.prompt, brandContext: '', filterMode: mode, totalTarget: 1, rawCap: 10, budgetUsd: 3, commentsEnabled: false } });
  };
  let pipeline: Awaited<ReturnType<typeof create>> | null = null;
  try {
    const row = { post_id: 'post-a', text: 'Tôi muốn tìm lớp học đàn piano cho người mới bắt đầu', post_url: 'https://facebook.com/posts/post-a' };
    pipeline = await create('first', 'QUALITY');
    await pipeline.ingestRows('facebook', [row, row], {}); await pipeline.drain();
    const first = await pipeline.results();
    assert.equal(first.progress.targetCount, 1); assert.ok(calls > 0);
    assert.equal(first.snapshots[0]!.previouslyCollected, false);
    await pipeline.close(); pipeline = null;
    compactProjectPostIndex(join(projectDirectory, 'project-posts.sqlite'));
    const firstCalls = calls;
    pipeline = await create('second', 'CONSISTENT');
    await pipeline.ingestRows('facebook', [row, row], {}); await pipeline.drain();
    const second = await pipeline.results();
    assert.equal(calls, firstCalls, 'same project reuses completed verdict without another model request');
    assert.equal(second.progress.targetCount, 1, 'a prior collection is still part of the new target');
    assert.equal(second.snapshots.length, 1); assert.equal(second.snapshots[0]!.previouslyCollected, true);
    assert.equal(second.progress.preview[0]!.previouslyCollected, true);
    assert.equal(second.conversations[0]!.decision.attributes!.project_source_filter_mode, 'QUALITY');
    assert.equal(selectOpportunityExport(second, 'SUITABLE').snapshots.length, 1);
    const file = join(projectDirectory, 'result.xlsx'); await exportOpportunityWorkbook(file, second);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet('Conversations')!;
    const headers = sheet.getRow(1).values as string[];
    assert.equal(sheet.getRow(2).getCell(headers.indexOf('previouslyCollected')).value, true);
    assert.equal(sheet.getRow(2).getCell(headers.indexOf('assessmentReused')).value, true);
    await pipeline.close(); pipeline = await create('second', 'CONSISTENT');
    await pipeline.ingestRows('facebook', [row], {}); await pipeline.drain();
    assert.equal((await pipeline.results()).snapshots[0]!.previouslyCollected, true);
    assert.equal(calls, firstCalls);
    await pipeline.close(); pipeline = await create('third', 'OFF');
    await pipeline.ingestRows('facebook', [row], {}); await pipeline.drain();
    assert.equal((await pipeline.results()).snapshots[0]!.previouslyCollected, true);
    assert.equal(calls, firstCalls);
    await pipeline.close(); pipeline = await create('fourth', 'CONSISTENT');
    await pipeline.ingestRows('facebook', [{ ...row, text: 'Tôi muốn tìm lớp học đàn piano buổi tối tại nhà' }], {});
    await pipeline.drain();
    assert.ok(calls > firstCalls, 'changed post evidence receives a fresh assessment');
    assert.equal((await pipeline.results()).snapshots[0]!.previouslyCollected, true);
    await pipeline.close(); pipeline = null;
    const posts = new ProjectPostStore(projectDirectory);
    try { assert.equal(posts.count(), 1); assert.equal(posts.previouslyCollected('first', 'facebook', 'post-a'), false); }
    finally { posts.close(); }
  } finally { await pipeline?.close(); rmSync(projectDirectory, { recursive: true, force: true }); }
});

test('project membership is isolated and social workbook keeps boolean flags', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-project-identity-'));
  try {
    for (const project of ['a', 'b']) {
      const posts = new ProjectPostStore(join(directory, project));
      try {
        assert.equal(posts.observe('first', 'facebook', '1', {}, '2026-11-09T00:00:00Z'), false);
        assert.equal(posts.observe('first', 'facebook', '1', {}, '2026-11-09T00:01:00Z'), false);
        assert.equal(posts.observe('second', 'facebook', '1', {}, '2026-11-10T00:00:00Z'), true);
        assert.equal(posts.observe('second', 'threads', '1', {}, '2026-11-10T00:00:00Z'), false);
        assert.equal(posts.count(), 2);
      } finally { posts.close(); }
    }
    const file = join(directory, 'raw.xlsx');
    await exportSocialWorkbook(file, [{ post_id: '1', previouslyCollected: true }], [{ post_id: '2', previouslyCollected: false }]);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
    for (const [name, expected] of [['Facebook Posts', true], ['Thread Posts', false]] as const) {
      const sheet = workbook.getWorksheet(name)!, headers = sheet.getRow(1).values as string[];
      assert.equal(sheet.getRow(2).getCell(headers.indexOf('previouslyCollected')).value, expected);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('legacy raw collections import chronologically and retain flags after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-project-legacy-'));
  try {
    for (const [id, startedAt] of [['z-first', '2026-11-01T00:00:00Z'], ['a-second', '2026-11-02T00:00:00Z']]) {
      const run = join(directory, 'collections', id!); mkdirSync(run, { recursive: true });
      writeFileSync(join(run, 'run-state.json'), JSON.stringify({ startedAt }));
      writeFileSync(join(run, 'results.json'), JSON.stringify({ facebook: [{ post_id: '1', text: 'Tôi muốn học piano', collected_at: startedAt }] }));
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const posts = new ProjectPostStore(directory);
      try {
        assert.equal(posts.count(), 1);
        assert.equal(posts.previouslyCollected('z-first', 'facebook', '1'), false);
        assert.equal(posts.previouslyCollected('a-second', 'facebook', '1'), true);
        assert.equal(posts.observe('new', 'facebook', '1', {}, '2026-11-09T00:00:00Z'), true);
      } finally { posts.close(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
