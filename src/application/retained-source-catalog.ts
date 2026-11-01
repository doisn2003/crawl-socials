import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isInside } from '../infrastructure/config/runtime-paths.js';
import { retainedRunDirectory } from '../infrastructure/storage/retained-observation-reader.js';
import type { RetainedSourceSummary } from '../shared/production-api.js';

/** Explicit catalog refresh; never scans journals during the two-second state poll. */
export async function listRetainedSources(dataDirectory: string): Promise<RetainedSourceSummary[]> {
  let folders; try { folders = await readdir(join(dataDirectory, 'collections'), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const eligible = folders.filter(folder => folder.isDirectory() && /^crawl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(folder.name));
  if (eligible.length > 2000) throw Error('RETAINED_CATALOG_LIMIT');
  const result: RetainedSourceSummary[] = [];
  for (const folder of eligible) {
    try {
      const directory = await retainedRunDirectory(dataDirectory, folder.name);
      let format: RetainedSourceSummary['format'] = 'OBSERVATION_JOURNAL', bytes = 0, updatedAt = '';
      let journalPresent = false;
      try {
        const journalPath = join(directory, 'opportunity', 'store', 'conversation-events.jsonl');
        await lstat(journalPath); journalPresent = true;
        const journal = await realpath(journalPath);
        if (!isInside(directory, journal)) continue;
        const info = await stat(journal); if (!info.isFile() || !info.size) continue;
        bytes = info.size; updatedAt = info.mtime.toISOString();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (journalPresent) continue;
        format = 'LEGACY_JSONL';
        for (const platform of ['facebook', 'threads']) {
          try {
            const file = await realpath(join(directory, platform, 'posts.jsonl'));
            if (!isInside(directory, file)) throw Error('RETAINED_PATH_OUTSIDE_DATA');
            const info = await stat(file);
            if (info.isFile() && info.size) { bytes += info.size; updatedAt = [updatedAt, info.mtime.toISOString()].sort().at(-1)!; }
          } catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError; }
        }
        if (!bytes) continue;
      }
      let prompt = '';
      try {
        const file = await realpath(join(directory, 'opportunity', 'campaign.json'));
        if (isInside(directory, file) && (await stat(file)).size <= 1_048_576) {
          const campaign = JSON.parse(await readFile(file, 'utf8')) as { prompt?: unknown };
          if (typeof campaign.prompt === 'string') prompt = campaign.prompt.slice(0, 300);
        }
      } catch { /* A raw-only interrupted run remains reusable without its display metadata. */ }
      result.push({ runId: folder.name, prompt, updatedAt, bytes, format });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error instanceof Error && error.message === 'RETAINED_PATH_OUTSIDE_DATA')) continue;
      throw error;
    }
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId));
}
