import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './copy-semantic-assets.mjs';
const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/backend/', root), { recursive: true });
for (const name of ['admin.html','admin-console.css','admin-console.js']) {
  await copyFile(new URL('src/backend/' + name, root), new URL('dist/backend/' + name, root));
}
for (const name of ['index.html', 'styles.css', 'opportunity.css', 'light-theme.css', 'settings.css', 'findlink-mark.png']) {
  const target = new URL('dist/renderer/' + name, root);
  await mkdir(fileURLToPath(new URL('./', target)), { recursive: true });
  await copyFile(new URL('src/renderer/' + name, root), target);
}
await mkdir(new URL('dist/collectors/', root), { recursive: true });
for (const collector of ['facebook-collector', 'threads-collector', 'conversation-collector', 'threads-reply-root-collector', 'discovery-frontier']) {
  const text = await readFile(new URL('scripts/' + collector + '.mjs', root), 'utf8');
  await writeFile(new URL('dist/collectors/' + collector + '.mjs', root), text.replaceAll('../dist/', '../'));
}
console.log('Production assets and collectors copied.');
