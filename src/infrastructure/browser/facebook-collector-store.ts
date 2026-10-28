import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { EmbeddedSearchRecord } from './facebook-search-embedded-parser.js';
import { classifyObservedFacebookSource, type SourceAudit } from './facebook-source-audit.js';

export interface CollectorProvenance {
  run_id: string; batch_id: string; query_index: number; scroll_index: number;
  method: 'EMBEDDED_DOCUMENT_JSON' | 'BROWSER_RESPONSE';
  response_sha256: string; operation: string | null; transport_request_id: string | null;
}
export type CollectedPost = EmbeddedSearchRecord & { first_observation: CollectorProvenance };
export function createFacebookCollectorStore(directory: string) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'posts.jsonl');
  const posts = new Map<string, CollectedPost>(), urls = new Map<string, string>();
  let repairedTail = false;
  if (existsSync(file)) {
    const bytes = readFileSync(file), text = bytes.toString('utf8'), lines = text.split('\n');
    let validBytes = 0;
    for (const [i, line] of lines.entries()) {
      if (!line.trim()) { validBytes += Buffer.byteLength(line) + (i < lines.length - 1 ? 1 : 0); continue; }
      let record: CollectedPost;
      try { record = JSON.parse(line) as CollectedPost; }
      catch {
        if (i !== lines.length - 1 || text.endsWith('\n')) throw new Error('COLLECTOR_DATA_CORRUPT');
        const backup = file + '.incomplete-' + Date.now(); renameSync(file, backup);
        writeFileSync(file, bytes.subarray(0, validBytes), { flush: true }); repairedTail = true; break;
      }
      if (typeof record.post_id !== 'string' || typeof record.observed_post_url !== 'string') throw new Error('COLLECTOR_RECORD_INVALID');
      if (posts.has(record.post_id) || urls.has(record.observed_post_url)) throw new Error('COLLECTOR_DUPLICATE_ON_DISK');
      posts.set(record.post_id, record); urls.set(record.observed_post_url, record.post_id);
      validBytes += Buffer.byteLength(line) + (i < lines.length - 1 ? 1 : 0);
    }
    if (!repairedTail && text && !text.endsWith('\n')) appendFileSync(file, '\n', { flush: true });
  }
  return {
    get count() { return posts.size; }, repairedTail,
    records: () => [...posts.values()],
    has: (id: string) => posts.has(id),
    persist(records: EmbeddedSearchRecord[], provenance: CollectorProvenance) {
      const fresh: CollectedPost[] = [], duplicates: string[] = [];
      const batchIds = new Set<string>(), batchUrls = new Set<string>();
      for (const record of records) {
        if (posts.has(record.post_id) || urls.has(record.observed_post_url) || batchIds.has(record.post_id) || batchUrls.has(record.observed_post_url)) { duplicates.push(record.post_id); continue; }
        fresh.push({ ...record, first_observation: provenance }); batchIds.add(record.post_id); batchUrls.add(record.observed_post_url);
      }
      if (fresh.length) {
        const handle = openSync(file, 'a');
        try { writeFileSync(handle, fresh.map(r => JSON.stringify(r)).join('\n') + '\n'); fsyncSync(handle); }
        finally { closeSync(handle); }
        for (const record of fresh) { posts.set(record.post_id, record); urls.set(record.observed_post_url, record.post_id); }
      }
      // Receipt/checkpoint follows the durable data, never precedes it.
      appendFileSync(join(directory, 'batches.jsonl'), JSON.stringify({ ...provenance, persisted_at: new Date().toISOString(),
        parsed: records.length, new_records: fresh.length, duplicates: duplicates.length, total: posts.size,
        new_ids: fresh.map(r => r.post_id) }) + '\n', { flush: true });
      return { new_records: fresh.length, duplicates: duplicates.length, total: posts.size };
    },
    checkpoint(runDirectory: string, value: unknown) {
      mkdirSync(runDirectory, { recursive: true });
      const temp = join(runDirectory, 'checkpoint.next.json'); writeFileSync(temp, JSON.stringify(value, null, 2), { flush: true });
      renameSync(temp, join(runDirectory, 'checkpoint.json'));
    },
    export() {
      // Early pilot records used the parser's embedded label for both transports.
      // Preserve the append-only observations; export the recorded batch transport.
      const sourceAudits = new Map<string, SourceAudit>();
      const auditFile = join(directory, 'source-audits.jsonl');
      if (existsSync(auditFile)) for (const line of readFileSync(auditFile,'utf8').split('\n').filter(Boolean)) {
        const audit = JSON.parse(line) as SourceAudit;
        // Latest observation wins, including one that no longer supports classification.
        sourceAudits.set(audit.source_url, audit);
      }
      const records = [...posts.values()].map(r => {
        const audit = r.source_url ? sourceAudits.get(r.source_url) : undefined;
        const resolved = r.source_type === 'UNKNOWN' && audit && classifyObservedFacebookSource(audit) === 'PROFILE';
        const missing = { ...r.missing_reasons };
        if (resolved) { delete missing.source_type; delete missing.source_name; }
        return { ...r, extraction_method: r.first_observation.method,
          source_type: resolved ? 'PROFILE' : r.source_type,
          source_name: resolved ? audit.source_name : r.source_name,
          source_evidence: resolved ? 'observed_source_header_name_friend_count_add_friend' : r.source_evidence,
          source_audit_ref: resolved ? { file: 'source-audits.jsonl', at: audit.at, document_json_sha256: audit.document_json_sha256 } : null,
          missing_reasons: missing };
      });
      writeFileSync(join(directory, 'posts.json'), JSON.stringify(records, null, 2), { flush: true });
      const summary = { unique: records.length, public: records.filter(r => r.visibility === 'PUBLIC').length,
        sources: Object.fromEntries(['PAGE', 'GROUP', 'PROFILE', 'UNKNOWN'].map(type => [type, records.filter(r => r.source_type === type).length])),
        export_method_normalizations: [...posts.values()].filter(r => r.extraction_method !== r.first_observation.method).length,
        missing: Object.fromEntries(['published_at', 'reactions_total', 'love_count', 'comments_count', 'shares_count'].map(k =>
          [k, records.filter(r => r[k as keyof CollectedPost] === null).length])),
        sha256: existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null };
      writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2), { flush: true }); return summary;
    },
  };
}
