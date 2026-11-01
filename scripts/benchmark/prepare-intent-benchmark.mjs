import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = text => text.normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/gu, ' ').trim();
const redact = text => text.normalize('NFC')
  .replace(/https?:\/\/[^\s<>]+/giu, '[URL]')
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[EMAIL]')
  .replace(/(?<!\d)(?:\+84|0)(?:[ .-]?\d){9,10}(?!\d)/gu, '[PHONE]');
const output = process.argv[2] || path.join(process.env.APPDATA, 'csd-desktop', 'data', 'benchmarks', 'coffee-intent-20261030');
fs.mkdirSync(output, { recursive: true });
if (fs.existsSync(path.join(output, 'manifest.json'))) throw new Error('Benchmark already prepared; preserve frozen inputs.');
const sources = [
  ['facebook', 'coffee-20261028'],
  ['threads', 'threads-coffee-20261029'],
];
const all = [], manifest = { benchmark_id: 'coffee-intent-20261030-v1', prepared_at: new Date().toISOString(), seed: 'csd-intent-20261030-v1', reference_status: 'AI_DOUBLE_ANNOTATION_PENDING_HUMAN_VALIDATION', unit: 'unique platform post id', evaluation_per_platform: 150, development_per_platform: 20, sources: [] };
for (const [platform, directory] of sources) {
  const source = path.join(process.env.APPDATA, 'csd-desktop', 'data', 'collections', directory, 'posts.json');
  const bytes = fs.readFileSync(source);
  const input = JSON.parse(bytes.toString('utf8'));
  const ids = new Set();
  const records = input.map((row, index) => {
    if (ids.has(row.post_id)) throw new Error('Duplicate platform post id');
    ids.add(row.post_id);
    const original = String(row.text ?? '');
    const text = redact(original);
    return { id: `${platform === 'facebook' ? 'FB' : 'TH'}-${String(index + 1).padStart(4, '0')}`, platform, post_id: row.post_id, text, text_original: original,
      url: row.observed_post_url ?? row.post_url, query: row.query, source_type: row.source_type ?? 'PROFILE',
      published_at: row.published_at, collected_at: row.collected_at, text_completeness: row.text_completeness,
      record_hash: hash(text), cluster_id: hash(normalize(original)), redacted_cluster_id: hash(normalize(text)), split: 'population' };
  });
  // Sample post IDs uniformly; duplicates remain in population. Hold ALL exact-content clusters of evaluation out of development.
  const ranked = [...records].sort((a, b) => hash(manifest.seed + a.platform + a.post_id).localeCompare(hash(manifest.seed + b.platform + b.post_id)));
  const test = ranked.slice(0, manifest.evaluation_per_platform);
  const testClusters = new Set(test.map(r => r.cluster_id));
  test.forEach(r => { r.split = 'evaluation'; });
  const dev = ranked.filter(r => r.split === 'population' && !testClusters.has(r.cluster_id)).slice(0, manifest.development_per_platform);
  dev.forEach(r => { r.split = 'development'; });
  const lengths = records.map(r => r.text_original.length).sort((a, b) => a - b);
  manifest.sources.push({ platform, path: source, sha256: hash(bytes), count: records.length, unique_ids: ids.size,
    normalized_text_unique: new Set(records.map(r => r.cluster_id)).size, redacted_text_unique: new Set(records.map(r => r.redacted_cluster_id)).size,
    empty_text: records.filter(r => !r.text.trim()).length, redacted_records: records.filter(r => r.text !== r.text_original.normalize('NFC')).length,
    median_characters: lengths[Math.floor(lengths.length * .5)], p90_characters: lengths[Math.floor(lengths.length * .9)], max_characters: lengths.at(-1),
    evaluation_ids: test.map(r => r.id), development_ids: dev.map(r => r.id) });
  all.push(...records);
}
const writeJsonl = (name, rows) => fs.writeFileSync(path.join(output, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
writeJsonl('records-private.jsonl', all);
writeJsonl('population.jsonl', all.map(({ id, platform, text, split, record_hash }) => ({ id, platform, text, split, record_hash })));
writeJsonl('reference-input.jsonl', all.filter(r => r.split === 'evaluation').map(({ id, platform, text }) => ({ id, platform, text })));
writeJsonl('development-input.jsonl', all.filter(r => r.split === 'development').map(({ id, platform, text }) => ({ id, platform, text })));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, sources: manifest.sources.map(({ platform, count, normalized_text_unique, empty_text, median_characters, p90_characters, max_characters }) => ({ platform, count, normalized_text_unique, empty_text, median_characters, p90_characters, max_characters })), reference_count: 300, development_count: 40 }));
