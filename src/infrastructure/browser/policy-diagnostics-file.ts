import { existsSync, lstatSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPolicyDiagnostics } from './policy-diagnostics.js';
export function createPolicyDiagnosticFile(logsDirectory: string) {
  const root = realpathSync(logsDirectory);
  if (root !== resolve(logsDirectory) || lstatSync(logsDirectory).isSymbolicLink()) throw new Error('DIAGNOSTICS_DIRECTORY_DENIED');
  const file = join(root, 'browser-policy-diagnostics-v2.json'), temporary = file + '.tmp';
  return createPolicyDiagnostics({ publish(snapshot) {
    const text = JSON.stringify({ ...snapshot, expiresAt: new Date(Date.parse(snapshot.startedAt) + 7 * 86400000).toISOString(),
      retentionCleanup: 'MANUAL_REQUIRED_NO_SCHEDULER' }, null, 2) + '\n';
    if (Buffer.byteLength(text) > 128 * 1024 || realpathSync(logsDirectory) !== root) throw new Error('DIAGNOSTICS_FILE_DENIED');
    for (const path of [file, temporary]) if (existsSync(path) && (lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1)) throw new Error('DIAGNOSTICS_FILE_DENIED');
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'w' }); renameSync(temporary, file);
  } });
}
