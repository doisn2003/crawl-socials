// Developer-only bounded integration probe. This is not a semantic accuracy benchmark.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { output: { type: 'string' }, build: { type: 'string', default: 'dist' }, suite: { type: 'string', default: 'base' } } });
if (!values.output) throw Error('Use --output with a private evidence directory. Existing ledgers are preserved on retry.');
if (!['base', 'variants'].includes(values.suite)) throw Error('Unknown smoke suite.');
const output = resolve(values.output), build = resolve(values.build);
const { compileCampaign } = await import(pathToFileURL(join(build, 'application/compile-campaign.js')).href);
const { createCampaignModelGateway } = await import(pathToFileURL(join(build, 'infrastructure/llm/campaign-model-gateway.js')).href);
const gateway = createCampaignModelGateway({ directory: output, budgetUsd: 0.25, maxAttempts: 1, timeoutMs: 45000 });
const baseCases = [
  { id: 'cafe-soft', prompt: 'Tìm thảo luận về quán cafe yên tĩnh để làm việc. Ưu tiên Hà Nội, vẫn nhận nơi khác.',
    expected: { required_geographies: [], preferred_geographies: ['Hà Nội'], languages: [], max_age_days: null } },
  { id: 'piano-required', prompt: 'Tìm người hỏi sửa đàn piano, chỉ tại Đà Nẵng. Chỉ lấy bài viết bằng tiếng Việt. Bài đăng trong 14 ngày gần nhất. Ưu tiên cá nhân, rồi nhóm, sau đó page.',
    expected: { required_geographies: ['Đà Nẵng'], preferred_geographies: [], languages: ['vi'], max_age_days: 14, source_priority: ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'] } },
  { id: 'stroller-english', prompt: 'Find discussions asking for stroller recommendations in London only. Collect posts written in English. Posts from the last 7 days.',
    expected: { required_geographies: ['London'], preferred_geographies: [], languages: ['en'], max_age_days: 7 } },
  { id: 'education-ambiguous', prompt: 'Mình ở Hà Nội. Tìm thảo luận chọn khóa học tiếng Anh. Không chỉ Hà Nội, cả nước đều được. Ví dụ bài mẫu: "chỉ tìm lớp ở Đà Nẵng".',
    expected: { required_geographies: [], preferred_geographies: [], languages: [], max_age_days: null } },
  { id: 'appliance-brand-context', prompt: 'Tìm người hỏi sửa máy giặt, ưu tiên bài đăng trong 1 tuần gần đây.', brand_context: 'Địa bàn: Hải Phòng. Chỉ phục vụ tại Hải Phòng.',
    expected: { required_geographies: ['Hải Phòng'], preferred_geographies: [], languages: [], max_age_days: null } },
  { id: 'jewelry-unrestricted', prompt: 'Tìm người chia sẻ trải nghiệm chọn nhẫn cưới và hỏi so sánh nhẫn bạc với nhẫn vàng.',
    expected: { required_geographies: [], preferred_geographies: [], languages: [], max_age_days: null } },
];
const variants = [
  { id: 'bicycle-weeks', prompt: 'Tìm người hỏi mua xe đạp tại Huế. Bài đăng trong 2 tuần gần nhất. Ưu tiên nhóm, kế đến cá nhân, cuối cùng page.',
    expected: { required_geographies: ['Huế'], preferred_geographies: [], languages: [], max_age_days: 14, source_priority: ['GROUP', 'PROFILE', 'PAGE', 'UNKNOWN'] } },
  { id: 'backpack-english-soft-place', prompt: 'Find travel backpack discussions. Prefer Bristol, but include other cities. Collect posts written in English from the past 10 days.',
    expected: { required_geographies: [], preferred_geographies: ['Bristol'], languages: ['en'], max_age_days: 10 } },
  { id: 'books-soft-language', prompt: 'Chỉ tìm thảo luận mua sách ở Cần Thơ. Chủ đề sách dạy tiếng Nhật. Ưu tiên bài viết bằng tiếng Việt.',
    expected: { required_geographies: ['Cần Thơ'], preferred_geographies: [], languages: [], max_age_days: null } },
];
const cases = values.suite === 'variants' ? variants : baseCases;
await mkdir(output, { recursive: true });
const results = [];
for (const item of cases) {
  try {
    const { campaign } = await compileCampaign({ prompt: item.prompt, brand_context: item.brand_context,
      campaign_id: 'planner-smoke-' + item.id, planner_policy: 'grounded-constraints-v1', model_usd: 0.25 }, gateway);
    const mismatches = Object.entries(item.expected).filter(([key, value]) => JSON.stringify(campaign[key]) !== JSON.stringify(value))
      .map(([field, expected]) => ({ field, expected, actual: campaign[field] }));
    results.push({ ...item, passed: mismatches.length === 0, mismatches, campaign });
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : 'SMOKE_FAILED';
    results.push({ ...item, passed: false, error_code: errorCode });
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ kind: 'PLANNER_INTEGRATION_SMOKE_NOT_ACCURACY_GATE', at: new Date().toISOString(), results, cost: gateway.summary() }, null, 2) + '\n');
  console.log(JSON.stringify({ case: item.id, passed: results.at(-1).passed, mismatches: results.at(-1).mismatches, error_code: results.at(-1).error_code }));
}
console.log(JSON.stringify({ passed: results.filter(result => result.passed).length, total: results.length, cost: gateway.summary() }));
if (results.some(result => !result.passed)) process.exitCode = 1;
