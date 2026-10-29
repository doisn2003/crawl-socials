import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
for (const name of ['index.html', 'styles.css']) {
  const target = new URL('dist/renderer/' + name, root);
  await mkdir(fileURLToPath(new URL('./', target)), { recursive: true });
  await copyFile(new URL('src/renderer/' + name, root), target);
}
await mkdir(new URL('dist/collectors/', root), { recursive: true });
for (const platform of ['facebook', 'threads']) {
  const text = await readFile(new URL('scripts/' + platform + '-collector.mjs', root), 'utf8');
  await writeFile(new URL('dist/collectors/' + platform + '-collector.mjs', root), text.replaceAll('../dist/', '../'));
}
console.log('Production assets and collectors copied.');
