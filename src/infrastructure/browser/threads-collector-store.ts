import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ThreadsPost } from './threads-search-parser.js';
export interface ThreadsProvenance {
  run_id: string; batch_id: string; query_index: number; scroll_index: number;
  method: ThreadsPost['extraction_method']; response_sha256: string; operation: string | null; request_id: string | null;
}
export type CollectedThreadsPost = ThreadsPost & { first_observation: ThreadsProvenance };
export function createThreadsCollectorStore(directory: string) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'posts.jsonl'), posts = new Map<string, CollectedThreadsPost>(), codes = new Set<string>();
  if (existsSync(file)) {
    const bytes = readFileSync(file), text = bytes.toString('utf8'), lines = text.split('\n'); let validBytes = 0;
    for (const [i, line] of lines.entries()) {
      if (!line.trim()) { validBytes += Buffer.byteLength(line) + (i < lines.length - 1 ? 1 : 0); continue; }
      let row: CollectedThreadsPost;
      try { row = JSON.parse(line); }
      catch {
        if (i !== lines.length - 1 || text.endsWith('\n')) throw Error('THREADS_DATA_CORRUPT');
        renameSync(file, file + '.incomplete-' + Date.now()); writeFileSync(file, bytes.subarray(0, validBytes), { flush: true }); break;
      }
      if (row.platform !== 'threads' || typeof row.post_id !== 'string' || typeof row.shortcode !== 'string' || !row.first_observation) throw Error('THREADS_RECORD_INVALID');
      if (posts.has(row.post_id) || codes.has(row.shortcode)) throw Error('THREADS_DUPLICATE_ON_DISK');
      posts.set(row.post_id, row); codes.add(row.shortcode); validBytes += Buffer.byteLength(line) + 1;
    }
    const current = readFileSync(file, 'utf8'); if (current && !current.endsWith('\n')) appendFileSync(file, '\n', { flush: true });
  }
  const atomic = (path: string, value: unknown) => { writeFileSync(path + '.next', JSON.stringify(value, null, 2), { flush: true }); renameSync(path + '.next', path); };
  return {
    get count() { return posts.size; }, records: () => [...posts.values()],
    persist(records: ThreadsPost[], provenance: ThreadsProvenance) {
      const fresh: CollectedThreadsPost[] = [], ids = new Set<string>(), batchCodes = new Set<string>(); let duplicates = 0;
      for (const r of records) {
        if (posts.has(r.post_id) || codes.has(r.shortcode) || ids.has(r.post_id) || batchCodes.has(r.shortcode)) { duplicates++; continue; }
        fresh.push({ ...r, first_observation: provenance }); ids.add(r.post_id); batchCodes.add(r.shortcode);
      }
      if (fresh.length) appendFileSync(file, fresh.map(r => JSON.stringify(r)).join('\n') + '\n', { flush: true });
      fresh.forEach(r => { posts.set(r.post_id, r); codes.add(r.shortcode); });
      appendFileSync(join(directory, 'batches.jsonl'), JSON.stringify({ ...provenance, parsed: records.length, new_records: fresh.length, duplicates, total: posts.size, new_ids: [...ids] }) + '\n', { flush: true });
      return { new_records: fresh.length, duplicates, total: posts.size };
    },
    checkpoint(dir: string, value: unknown) { atomic(join(dir, 'checkpoint.json'), value); },
    export() {
      const rows = [...posts.values()]; atomic(join(directory, 'posts.json'), rows);
      const summary = { platform: 'threads', unique: rows.length,
        queries: Object.fromEntries([...new Set(rows.map(r => r.query))].map(q => [q, rows.filter(r => r.query === q).length])),
        methods: Object.fromEntries(['BROWSER_RESPONSE', 'EMBEDDED_DOCUMENT_JSON'].map(m => [m, rows.filter(r => r.extraction_method === m).length])),
        missing: Object.fromEntries(['published_at', 'likes', 'replies', 'reposts', 'quotes', 'shares'].map(k => [k, rows.filter(r => r[k as keyof ThreadsPost] === null).length])),
        content_review: 'NOT_REQUESTED', sha256: existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null };
      atomic(join(directory, 'summary.json'), summary); return summary;
    },
  };
}
