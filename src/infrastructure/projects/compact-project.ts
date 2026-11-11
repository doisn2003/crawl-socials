import { lstat, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readSnapshotFile, restoreProject, safePath, sha256, withProjectSnapshot, type BackupFile, type ProjectSnapshot } from './snapshot.js';
import { compactProjectPostIndex } from '../storage/project-post-store.js';

const id = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const savedRun = /^crawl-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const workingFolders = /^(?:store|model(?:-gemini-[\d.a-z-]+)?|intent-attempts)$/u;

/** The caller has closed the run's SQLite writers and published its result JSON. */
export async function discardCompletedRunWork(projectDirectory: string, runId: string, assessed: boolean): Promise<void> {
  if (!savedRun.test(runId)) throw Error('PROJECT_COMPACT_PATH_INVALID');
  const root = await realpath(projectDirectory);
  const run = join(root, 'collections', runId);
  if (await realpath(run) !== resolve(run)) throw Error('PROJECT_COMPACT_PATH_INVALID');
  const result = await stat(join(run, 'results.json'));
  if (!result.isFile() || !result.size) throw Error('PROJECT_COMPACT_RESULTS_REQUIRED');
  if (assessed) {
    const opportunity = await stat(join(run, 'opportunity-results.json'));
    if (!opportunity.isFile() || !opportunity.size) throw Error('PROJECT_COMPACT_RESULTS_REQUIRED');
  }
  const folders = (await readdir(run, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink());
  const targets = folders.filter(entry => ['facebook', 'threads'].includes(entry.name)).map(entry => join(run, entry.name));
  const opportunity = join(run, 'opportunity');
  if (folders.some(entry => entry.name === 'opportunity') && await realpath(opportunity) === opportunity) {
    const entries = await readdir(opportunity, { withFileTypes: true });
    targets.push(...entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && workingFolders.test(entry.name))
      .map(entry => join(opportunity, entry.name)));
  }
  for (const target of targets) {
    if (await realpath(target) !== target) throw Error('PROJECT_COMPACT_PATH_INVALID');
    await rm(target, { recursive: true, force: true });
  }
}

/** An offline migration publishes only verified user data and keeps the original directory for recovery. */
export async function compactSavedProject(path: string) {
  if (!(await lstat(path)).isDirectory()) throw Error('PROJECT_COMPACT_PATH_INVALID');
  const directory = await realpath(path), project = dirname(directory);
  if (basename(directory) !== 'data' || !id.test(basename(project)) || basename(dirname(project)) !== 'projects') {
    throw Error('PROJECT_COMPACT_PATH_INVALID');
  }
  return withProjectSnapshot(directory, async snapshot => {
    const latest = snapshot.files.find(file => file.path === 'latest-run.json');
    if (!latest) throw Error('PROJECT_COMPACT_RESULTS_REQUIRED');
    const state = JSON.parse((await readSnapshotFile(snapshot, latest)).toString('utf8'));
    if (typeof state.id !== 'string' || !savedRun.test(state.id) || state.state !== 'COMPLETED'
      || state.opportunity?.watchActive || state.opportunity?.assessmentActive) throw Error('PROJECT_COMPACT_RESUME_REQUIRED');
    if (!snapshot.files.some(file => [`collections/${state.id}/results.json`, `collections/${state.id}/opportunity-results.json`].includes(file.path))) {
      throw Error('PROJECT_COMPACT_RESULTS_REQUIRED');
    }
    const metrics = { files: 0, bytes: 0 };
    const previous = await restoreProject(directory, directory, savedFiles(snapshot, metrics));
    return { ...metrics, previous };
  }, { keepDeliveryHistory: true });
}

async function* savedFiles(snapshot: ProjectSnapshot, metrics: { files: number; bytes: number }): AsyncGenerator<BackupFile> {
  for (const entry of snapshot.files) {
    let content: Buffer;
    if (entry.path === 'project-posts.sqlite') {
      const file = safePath(snapshot.scratch, entry.path);
      compactProjectPostIndex(file);
      content = await readFile(file);
    } else content = await readSnapshotFile(snapshot, entry);
    if (entry.path.endsWith('/results.json') || entry.path.endsWith('/opportunity-results.json')) {
      const value: unknown = JSON.parse(content.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('PROJECT_COMPACT_RESULTS_INVALID');
      content = Buffer.from(JSON.stringify(value));
    }
    metrics.files++;
    metrics.bytes += content.length;
    yield { path: entry.path, category: entry.category, sha256: sha256(content), content };
  }
}
