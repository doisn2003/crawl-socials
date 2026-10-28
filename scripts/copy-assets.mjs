import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const assets = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/styles.css', 'dist/renderer/styles.css'],
  ['.brain/specs/campaign.schema.json', 'dist/resources/campaign.schema.json'],
  ['.brain/specs/campaign.coffee.json', 'dist/resources/campaign.coffee.json'],
  ['tests/fixtures/campaign.offline.json', 'dist/resources/campaign.offline.json'],
];
for (const [source, destination] of assets) {
  const target = new URL(destination, root);
  await mkdir(fileURLToPath(new URL('./', target)), { recursive: true });
  await copyFile(new URL(source, root), target);
}
console.log(`Copied ${assets.length} local assets.`);
