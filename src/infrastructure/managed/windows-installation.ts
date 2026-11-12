import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function installationTagFromRegistry(output: string): string | undefined {
  const value = /^[ \t]*MachineGuid[ \t]+REG_SZ[ \t]+([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})[ \t]*\r?$/im.exec(output)?.[1];
  if (!value) return undefined;
  return createHash('sha256').update('findlink:trial-windows-installation:v1\0').update(value.toLowerCase()).digest('hex');
}

export async function windowsInstallationTag(): Promise<string | undefined> {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || !systemRoot) return undefined;
  try {
    const { stdout } = await execute(join(systemRoot, 'System32', 'reg.exe'),
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      { windowsHide: true, timeout: 2000, maxBuffer: 4096, encoding: 'utf8' });
    return installationTagFromRegistry(stdout);
  } catch {
    return undefined;
  }
}
