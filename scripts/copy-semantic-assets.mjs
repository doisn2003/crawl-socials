import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve(process.argv[2] || 'dist/domain');
await mkdir(destination, { recursive: true });
await copyFile(new URL('../src/domain/semantic-keywords.mjs', import.meta.url), resolve(destination, 'semantic-keywords.mjs'));
