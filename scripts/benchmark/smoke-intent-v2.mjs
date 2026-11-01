#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleRoot = path.resolve(process.argv[2] ?? '.test-build/src');
const output = path.join(process.env.APPDATA, 'csd-desktop/data/benchmarks/opportunity-v2-smoke');
const load = relative => import(pathToFileURL(path.join(moduleRoot, relative)).href);
const { createGeminiGateway } = await load('infrastructure/llm/gemini-gateway.js');
const { compileCampaign } = await load('application/compile-campaign.js');
const { classifyConversations } = await load('application/classification-service.js');
const { contentHash, evidenceSpans } = await load('domain/conversation.js');
const gateway = createGeminiGateway({ directory: path.join(output, 'model'), budgetUsd: 0.15, minRequestIntervalMs: 4500 });
const now = new Date().toISOString();
function snapshot(id, text, comment = null) {
  const entity = (entity_id, body, parent_id) => ({ entity_id, entity_type: parent_id ? 'COMMENT' : 'POST', root_post_id: id,
    parent_id, text: body, observed_at: now, published_at: now, permalink: null, author: { role: 'UNKNOWN' },
    source: { kind: 'PROFILE' }, media: [], content_hash: contentHash(body) });
  const post = entity(id, text, null), comments = comment ? [entity(id + '-comment', comment, id)] : [];
  return { id: 'synthetic:' + id, platform: 'threads', root_post_id: id, revision: 1, content_hash: contentHash([post, comments]),
    observed_at: now, post, comments, coverage: { status: comment ? 'PARTIAL' : 'NOT_ATTEMPTED' }, spans: [post, ...comments].flatMap(e => evidenceSpans(e)) };
}
try {
  const { campaign } = await compileCampaign({ prompt: 'Tìm những cuộc thảo luận hỏi gợi ý quán cafe, review quán cafe và chỗ ngồi làm việc hoặc hẹn hò; quảng cáo ngành chỉ để nghiên cứu, check-in thì theo dõi tới khi có người hỏi.', suitable_target: 1000 }, gateway);
  const snapshots = [snapshot('request', 'Mọi người biết quán cafe nào yên tĩnh có ổ điện để ngồi làm việc không?'),
    snapshot('promotion', 'Quán cafe nhà mình khai trương, giảm 20%, mời mọi người ghé ủng hộ!'),
    snapshot('checkin', 'Check-in quán cafe Hoa hôm nay'),
    snapshot('checkin-question', 'Check-in quán cafe Hoa hôm nay', 'Đồ uống đắt không bạn? Quán có yên tĩnh để làm việc không?'),
    snapshot('unrelated', 'Máy giặt hỏng cần tìm thợ sửa điện lạnh, nhà ở gần quán cafe. Không tìm quán cafe.')];
  const result = await classifyConversations(campaign, snapshots, gateway);
  const actual = result.decisions.map(d => d.classification), expected = ['SUITABLE', 'NOT_YET', 'NOT_YET', 'SUITABLE', 'UNRELATED'];
  const report = { synthetic_only: true, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected), failures: result.failures,
    query_count: campaign.queries.length, ledger: gateway.summary(), observed_at: now };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'campaign.json'), JSON.stringify(campaign, null, 2));
  console.log(JSON.stringify(report));
  if (!report.pass) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ code: /^[A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'SMOKE_LOCAL_FAILURE', ledger: gateway.summary() }));
  process.exitCode = 1;
}
