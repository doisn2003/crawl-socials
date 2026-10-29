import { existsSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const target = resolve(root, 'dist');
if (existsSync(target)) {
  if (realpathSync(target) !== target) throw Error('BUILD_DIRECTORY_MUST_NOT_BE_LINK');
  rmSync(target, { recursive: true });
}
