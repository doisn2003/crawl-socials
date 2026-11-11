import { parentPort, workerData } from 'node:worker_threads';
import { Pool } from 'pg';
import { writeProjectBackup, type ProjectUpload } from './postgres.js';
import { readSnapshotFile, type ProjectSnapshot } from './snapshot.js';

export interface BackupWorkerData { databaseUrl: string; input: ProjectUpload; snapshot: ProjectSnapshot; }
export type BackupWorkerResult = { revision: number } | { error: string };

async function upload({ databaseUrl, input, snapshot }: BackupWorkerData): Promise<BackupWorkerResult> {
  const controller = new AbortController();
  const signal = controller.signal;
  parentPort!.once('message', () => controller.abort(Error('PROJECT_BACKUP_CANCELLED')));
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 15000,
    statement_timeout: 60000, idle_in_transaction_session_timeout: 120000 });
  pool.on('error', () => {});
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      signal.throwIfAborted();
      const revision = await writeProjectBackup(client, input, snapshot.files, file => readSnapshotFile(snapshot, file, signal), signal);
      signal.throwIfAborted();
      await client.query('COMMIT');
      return { revision };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  } catch (error) {
    const code = error instanceof Error && /^PROJECT_[A-Z_]+$/.test(error.message) ? error.message : 'PROJECT_DATABASE_UNAVAILABLE';
    return { error: signal.aborted ? 'PROJECT_BACKUP_CANCELLED' : code };
  } finally { await pool.end(); }
}

if (parentPort) {
  const port = parentPort;
  void upload(workerData as BackupWorkerData).then(result => { port.postMessage(result); port.close(); });
}
