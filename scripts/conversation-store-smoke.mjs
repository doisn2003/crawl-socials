import { app } from 'electron';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'csd-sqlite-electron-'));
const session = join(directory, 'session'); mkdirSync(session);
app.setPath('userData', session); app.setPath('sessionData', session);
let store;
async function main() { try {
  const moduleIndex = process.argv.indexOf('--module');
  if (moduleIndex >= 0 && (process.argv.lastIndexOf('--module') !== moduleIndex || !process.argv[moduleIndex + 1]
    || !isAbsolute(process.argv[moduleIndex + 1]))) throw Error('STORE_MODULE_PATH_INVALID');
  const modulePath = moduleIndex >= 0 ? resolve(process.argv[moduleIndex + 1])
    : fileURLToPath(new URL('../dist/infrastructure/storage/async-conversation-store.js', import.meta.url));
  if (basename(modulePath) !== 'async-conversation-store.js') throw Error('STORE_MODULE_PATH_INVALID');
  if (!statSync(modulePath, { throwIfNoEntry: false })?.isFile()) throw Error('STORE_MODULE_NOT_FOUND');
  // Load the exact selected file so its worker resolves relative to the same ASAR.
  // A default-dist fallback would conceal missing packaged worker dependencies.
  await app.whenReady();
  const { createAsyncConversationStore } = await import(pathToFileURL(modulePath).href);
  if (typeof createAsyncConversationStore !== 'function') throw Error('STORE_MODULE_EXPORT_INVALID');
  store = await createAsyncConversationStore(join(directory, 'data'));
  const context = { campaign_id: 'smoke', campaign_version: 'v1', filter_version: 'v2' };
  const saved = await store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: '1', root_post_id: '1', parent_id: null,
    text: 'Synthetic storage smoke', observed_at: new Date().toISOString(), provenance: { run_id: 'smoke', method: 'FIXTURE' } }, context);
  const stats = await store.stats(context);
  if (!saved.snapshot || stats.raw_unique_posts !== 1) throw Error('STORE_SMOKE_FAILED');
  await store.close(); store = null;
  console.log(JSON.stringify({ status: 'PASS', runtime: { electron: process.versions.electron, node: process.versions.node },
    module_path: modulePath, packaged_module: modulePath.split(/[\\/]/).some(segment => segment.endsWith('.asar')),
    worker_sqlite: true, raw: stats.raw_unique_posts }));
} catch (error) {
  console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'ELECTRON_STORE_SMOKE_FAILED');
  process.exitCode = 1;
} finally {
  await store?.close().catch(() => {});
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('csd-sqlite-electron-')) throw Error('TEMP_PATH_INVALID');
  // Chromium still owns its temporary session until app.exit; only the closed worker data can be removed here.
  rmSync(join(directory, 'data'), { recursive: true, force: true });
  app.exit(process.exitCode || 0);
} }
void main().catch(() => { console.error('ELECTRON_STORE_SMOKE_FAILED'); app.exit(1); });
