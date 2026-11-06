import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve(process.argv[2] || 'dist/domain');
await mkdir(destination, { recursive: true });
for (const name of ['semantic-keywords.mjs', 'opportunity-keywords.mjs'])
  await copyFile(new URL('../src/domain/' + name, import.meta.url), resolve(destination, name));
