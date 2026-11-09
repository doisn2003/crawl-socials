// Bounded read-only fixture probe. It opens supplied observed reply permalinks; no search/API/model calls.
import { app } from 'electron';
import { profilesByLabel } from '../dist/domain/browser-profile.js';
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimePaths } from '../dist/infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../dist/infrastructure/browser/profile-repository.js';
import { createElectronSecretStore } from '../dist/infrastructure/secrets/electron-secret-store.js';
import { createBrowserHost } from '../dist/infrastructure/browser/browser-host.js';
import { resolveThreadsReplyRoot } from './threads-reply-root-collector.mjs';

const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const sha = value => createHash('sha256').update(value).digest('hex');
const fields = new Set(['require', '__bbox', 'result', 'data', 'media', 'pk', 'id', 'code', 'caption', 'text', 'user', 'username', 'full_name', 'taken_at', 'text_post_app_info', 'is_reply', 'is_post_unavailable', 'root_post', 'root_post_id', 'reply_to_post', 'reply_to_post_id', 'replied_to', 'reply_to_author', 'reply_level', 'containing_thread', 'posts', 'post_ids', 'edges', 'node', 'page_info', 'has_next_page', 'direct_replies', 'inline_expansion', 'direct_reply_count', 'image_versions2', 'candidates', 'video_versions', 'url', 'media_type']);
function project(value, depth = 0) {
  if (depth > 60) return null;
  if (Array.isArray(value)) return value.slice(0, 400).map(child => project(child, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)).map(([key, child]) => [key, project(child, depth + 1)]));
  return typeof value === 'string' ? value.slice(0, 30000) : value;
}
async function main() {
  if (!argument('--config') || !argument('--output')) throw Error('CONFIG_AND_PRIVATE_OUTPUT_REQUIRED');
  const output = resolve(argument('--output')), rel = relative(resolve(process.cwd()), output);
  if (!isAbsolute(argument('--output')) || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) throw Error('PRIVATE_OUTPUT_REQUIRED');
  const candidates = JSON.parse(readFileSync(argument('--config'), 'utf8'));
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 3) throw Error('PROBE_REQUIRES_ONE_TO_THREE_CANDIDATES');
  mkdirSync(output, { recursive: true });
  if (existsSync(join(output, 'manifest.json'))) throw Error('PROBE_OUTPUT_ALREADY_USED');
  const paths = runtimePaths(app.getPath('appData'));
  for (const [name, path] of Object.entries(paths)) { mkdirSync(path, { recursive: true }); app.setPath(name, path); }
  app.setName('TrendLink');
  if (!app.requestSingleInstanceLock()) throw Error('CSD_ALREADY_RUNNING');
  app.on('window-all-closed', () => {}); await app.whenReady();
  const profiles = createBrowserProfiles(join(paths.userData, 'data'));
  const host = createBrowserHost({ profiles, secrets: createElectronSecretStore(join(paths.userData, 'secrets')), journalDirectory: join(paths.userData, 'data', 'session-snapshots'), manualLoginEnabled: true, backgroundThrottling: false, hidden: !process.argv.includes('--visible') });
  let stopping = false;
  const beforeQuit = event => { event.preventDefault(); stopping = true; };
  app.on('before-quit', beforeQuit);
  const components = Object.fromEntries(['./threads-reply-root-probe.mjs', './threads-reply-root-collector.mjs', '../dist/infrastructure/browser/threads-reply-root-parser.js'].map(path => [path, sha(readFileSync(new URL(path, import.meta.url)))]));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ started_at: new Date().toISOString(), candidates, components }, null, 2), { flush: true });
  try {
    const [profile] = profilesByLabel((await host.list()).filter(p => p.platform === 'threads'), 'TrendLink Threads');
    if (!profile) throw Error('THREADS_PROFILE_REQUIRED');
    for (const [index, candidate] of candidates.entries()) {
      if (stopping || existsSync(join(output, 'STOP'))) break;
      let sequence = 0;
      try {
        await host.open(profile.id); const window = host.observerTarget(profile.id)?.contents;
        if (!window) throw Error('PROFILE_UNAVAILABLE'); window.setBackgroundThrottling(false);
        const receipt = await resolveThreadsReplyRoot({ window, candidate, runId: 'reply-root-probe', maxMs: 25000,
          shouldStop: () => stopping || existsSync(join(output, 'STOP')),
          onPayload: (objects, meta) => writeFileSync(join(output, `${index}-payload-${++sequence}.json`), JSON.stringify({ ...meta, objects: project(objects) }), { flush: true }),
          onObservations: async observations => appendFileSync(join(output, 'observations.jsonl'), observations.map(observation => JSON.stringify(observation)).join('\n') + '\n', { flush: true }) });
        appendFileSync(join(output, 'receipts.jsonl'), JSON.stringify({ index, ...receipt }) + '\n', { flush: true });
        console.log(JSON.stringify({ index, status: receipt.status, proof: receipt.proof, stop_reason: receipt.stop_reason, observed_count: receipt.observed_count, payloads: sequence }));
        if (receipt.status === 'INACCESSIBLE') break;
      } finally { await host.close(profile.id); }
    }
  } finally { await host.shutdown(); app.removeListener('before-quit', beforeQuit); app.exit(0); }
}
main().catch(error => { console.error('REPLY_ROOT_PROBE_FAILED:' + error.message); app.exit(1); });
