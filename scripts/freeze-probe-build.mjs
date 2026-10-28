import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
async function list(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const paths = await Promise.all(entries.map(entry => entry.isDirectory() ? list(join(directory, entry.name)) : join(directory, entry.name)));
  return paths.flat().filter(path => path !== join('dist', 'resources', 'probe-build.json')).sort();
}
const evidence = ['.brain/decisions/ADR-009-source-probe-operational-limits.md', '.brain/specs/benchmark_protocol.md',
  '.brain/specs/source_access_matrix.md', '.brain/evidence/facebook-browser-route-assessment-2026-10-27.md'];
const paths = [...await list('src'), ...await list('dist'), 'package.json', 'package-lock.json', 'scripts/copy-assets.mjs', 'scripts/freeze-probe-build.mjs', 'scripts/probe-fixture.mjs', ...evidence];
const entries = [];
for (const path of paths) entries.push({ path: path.replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') });
await writeFile(join(root, 'dist/resources/probe-build.json'), JSON.stringify({ version: 1, semantics: 'EXACT_BUILD_AND_SOURCE_BYTES_NOT_LIVE_PERMISSION', entries }, null, 2) + '\n');
console.log(`Frozen probe build: ${entries.length} artifact/input hashes.`);
