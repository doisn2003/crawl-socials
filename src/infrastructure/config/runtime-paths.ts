import { isAbsolute, join, relative, resolve, sep, dirname, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

export function runtimePaths(appDataRoot: string, smokeRoot?: string) {
  let root = join(resolve(appDataRoot), 'csd-desktop');
  if (smokeRoot !== undefined) {
    // Test roots must already exist as direct, resolved children of the OS temp dir.
    const resolvedTemp = realpathSync(tmpdir());
    const canonical = realpathSync(smokeRoot);
    if (dirname(canonical) !== resolvedTemp || !basename(canonical).startsWith('csd-bootstrap-')) throw new Error('SMOKE_ROOT_DENIED');
    root = join(canonical, 'user-data');
  }
  return {
    userData: root, sessionData: join(root, 'browser'), logs: join(root, 'logs'), crashDumps: join(root, 'crash-dumps'),
  };
}
