import { existsSync } from 'node:fs';
import { backendConfig } from './config.js';
import { database, migrate } from './database.js';
import { createBackend } from './server.js';

async function main() {
  const envFile = process.env.FINDLINK_ENV_FILE || '.env';
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (process.argv.includes('--migrate')) {
    if (!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
    const pool = database(process.env.DATABASE_URL);
    try {
      await migrate(pool);
      console.log('FINDLINK_SCHEMA_READY');
    } finally { await pool.end(); }
    return;
  }
  const config = backendConfig(process.env);
  const pool = database(config.databaseUrl);
  try {
    const ready = await pool.query('SELECT version FROM findlink_control.migrations WHERE version=1');
    if (!ready.rowCount) throw Error('BACKEND_MIGRATION_REQUIRED');
    const backend = createBackend(pool, config);
    await new Promise<void>((resolve, reject) => {
      backend.server.once('error', reject);
      backend.server.listen(config.port, config.host, resolve);
    });
    console.log('FINDLINK_BACKEND_READY');
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      try { await backend.close(); await pool.end(); } catch { process.exitCode = 1; }
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
  } catch (error) {
    await pool.end();
    throw error;
  }
}
void main().catch(error => {
  const message = error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'BACKEND_STARTUP_FAILED';
  console.error(message);
  process.exitCode = 1;
});
