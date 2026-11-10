import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { PROJECT_SCHEMA_SQL } from '../dist/infrastructure/projects/schema.js';

const environmentFile = process.argv.find(argument => argument.startsWith('--env='))?.slice(6) ?? process.env.CSD_ENV_FILE ?? '.env';
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('csd_backup_schema',0))");
  await client.query(PROJECT_SCHEMA_SQL);
  await client.query('COMMIT');
  const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='csd_backup' ORDER BY table_name");
  console.log('FindLink PostgreSQL schema is ready.');
  console.log(result.rows.map(row => row.table_name).join(', '));
} catch {
  await client?.query('ROLLBACK').catch(() => {});
  console.error('PROJECT_DATABASE_SETUP_FAILED');
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
