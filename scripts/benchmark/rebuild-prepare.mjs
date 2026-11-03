// $0, read-only source audit and isolated parser/dedup replay. No model or browser imports.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createConversationStore } from '../../dist/infrastructure/storage/conversation-store.js';
import { literalCampaign } from '../../dist/application/compile-campaign.js';
import { withFilterPolicy } from '../../dist/application/filter-policy.js';
import { validateObservation } from '../../dist/domain/conversation.js';

const out = resolve(process.argv[2] ?? 'artifacts/csd-rebuild-20261103');
mkdirSync(out, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const write = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2));
const inventory = JSON.parse(readFileSync('artifacts/goal-filter-v3-appdata-20261102/inventory.json', 'utf8')).sources;
const base = join(process.env.APPDATA, 'csd-desktop/data/collections');
const sources = [...inventory, ...['crawl-6b59136f-a4e7-4219-9c13-559d90077c15', 'crawl-9a6373d3-414d-4e3a-9172-076fd0e38220']
  .map((id, i) => ({ id, name: 'piano-' + (i + 1), file: join(base, id, 'opportunity-results.json') }))];
const report = [], piano = new Map();
for (const source of sources) {
  const bytes = readFileSync(source.file), data = JSON.parse(bytes), digest = hash(bytes), start = performance.now();
  if (source.source_sha256) assert.equal(digest, source.source_sha256, 'Prior source changed: ' + source.name);
  const directory = join(out, 'offline-replay', source.name);
  // Re-running this audit is intentionally idempotent: duplicate observations cannot add roots.
  const store = createConversationStore(directory);
  const context = { campaign_id: 'replay-' + source.name, campaign_version: 'offline-1', filter_version: 'unassessed-v1' };
  let observations = 0, spans = 0;
  try {
    for (const snapshot of data.snapshots) {
      for (const span of snapshot.spans) {
        const entity = [snapshot.post, ...snapshot.comments].find(e => e?.entity_id === span.entity_id);
        assert.ok(entity, 'Missing evidence entity'); assert.equal(entity.text.slice(span.start, span.end), span.text);
        spans++;
      }
      for (const entity of [snapshot.post, ...snapshot.comments].filter(Boolean)) {
        const observation = { ...entity, platform: snapshot.platform, coverage: snapshot.coverage,
          provenance: { run_id: context.campaign_id, method: 'READ_ONLY_REPLAY', query: 'offline-source' } };
        validateObservation(observation); store.ingest(observation, context); observations++;
        if (entity === snapshot.post) store.ingest(observation, context); // exact duplicate must be harmless
      }
      if (source.name.startsWith('piano')) {
        const key = snapshot.platform + ':' + snapshot.root_post_id, previous = piano.get(key);
        const row = { key, snapshot, source: source.id };
        if (!previous || previous.snapshot.observed_at < snapshot.observed_at) piano.set(key, row);
      }
    }
    const roots = new Set(data.snapshots.map(s => s.platform + ':' + s.root_post_id));
    assert.equal(store.snapshots().length, roots.size);
    const selection = store.selectTarget(context, 1000, true), stats = store.stats(context);
    assert.equal(selection.target.length + selection.extra.length, data.snapshots.filter(s => s.post).length);
    assert.equal(store.decisionHistory(context).length, 0);
    assert.equal(hash(readFileSync(source.file)), digest, 'Source was modified');
    const row = { name: source.name, id: source.id, sha256: digest, snapshots: data.snapshots.length, uniqueRoots: roots.size,
      observations, evidenceSpansValidated: spans, replayRoots: stats.raw_unique_posts, offTarget: selection.target.length,
      extra: selection.extra.length, modelCalls: 0, seconds: Number(((performance.now() - start) / 1000).toFixed(2)), sourceUnchanged: true };
    report.push(row); console.log(JSON.stringify(row));
  } finally { store.close(); }
}
const frozenFile = join(out, 'piano-holdout.json'), seed = 'ADR025-blind-piano-20261103-v1';
const excluded = new Set(['2757252234746951']); // known regression is not part of the holdout
const sample = [...piano.values()].filter(row => !excluded.has(row.snapshot.root_post_id))
  .sort((a, b) => hash(seed + a.key).localeCompare(hash(seed + b.key))).slice(0, 100)
  .map((row, i) => ({ index: i + 1, ...row }));
const plan = withFilterPolicy(literalCampaign({ prompt: 'Tìm người có nhu cầu học đàn piano hoặc mua/mượn đàn piano. Bao gồm phụ huynh tìm giáo viên cho con và tín hiệu gián tiếp hợp lý; không tìm bên quảng cáo bán đàn hoặc bán khóa học.',
  seed_queries: ['học piano', 'mua đàn piano', 'mượn đàn piano'], suitable_target: 1000, raw_cap: 3000, model_usd: .1 }), 'STANDARD');
const frozen = { schema: 1, seed, asOf: '2026-11-03T23:59:00+07:00', goal: plan, population: piano.size, excludedKnownRegressions: [...excluded],
  sampling: 'Deterministic uniform hash order over distinct (platform, root). Latest snapshot retained. No candidate or old label used to select.', sample };
if (existsSync(frozenFile)) {
  const existing = JSON.parse(readFileSync(frozenFile, 'utf8'));
  assert.deepEqual(existing.sample, sample, 'Frozen sample changed; do not overwrite holdout');
} else write('piano-holdout.json', frozen);
const blind = sample.map(({ index, snapshot: s }) => ({ index, platform: s.platform, publishedAt: s.post?.published_at,
  post: s.post?.text ?? '', comments: s.comments.map(c => ({ text: c.text, parent: c.parent_id === s.root_post_id ? 'post' : c.parent_id })) }));
write('piano-blind-text.json', blind);
write('offline-report.json', { createdAt: new Date().toISOString(), modelCalls: 0, apiUsd: 0, sources: report,
  holdout: { population: piano.size, sampled: sample.length, sha256: hash(readFileSync(frozenFile)), labelStatus: 'PENDING_BLIND_REVIEW',
    qualityMeasured: false, note: 'Offline replay validates data mechanics, not semantic model quality.' } });
