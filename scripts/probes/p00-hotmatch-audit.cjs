// Read source/config metadata only; never inspect userData, cookies or datasets.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/probes/p00-hotmatch-audit.cjs <HotMatch source root> [output.json]');
const files = ['package.json', 'package-lock.json', 'README.md', 'main/index.js',
  'main/profiles.js', 'main/manager.js', 'main/browser-tabs.js', 'main/browser-navigation.js',
  'main/platform.js', 'main/proxy-bridge.js', 'main/proxies.js', 'main/proxy-health.js',
  'main/health-scheduler.js', 'main/lite.js', 'main/page-account-observer.js',
  'main/session-cookies.js', 'main/store.js', 'main/coordinator.js', 'main/util.js',
  'main/load-queue.js'];
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const locked = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const installed = {};
for (const name of ['electron', 'electron-builder', 'proxy-chain', 'ajv']) {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  installed[name] = { version: p.version, license: p.license, engines: p.engines || null };
}
const report = {
  audit: 'P00.03', date: '2026-10-27', timezone: 'Asia/Bangkok', sourceRoot: root,
  headCommit: git(['rev-parse', 'HEAD']), workingTreeDirty: !!git(['status', '--porcelain']),
  sourceVersion: manifest.version, packageLicenseField: manifest.license, private: manifest.private,
  rootLicenseFiles: fs.readdirSync(root).filter(name => /^(license|copying|notice)(\.|$)/i.test(name)),
  reuseDecision: 'Reimplement infrastructure patterns; no verbatim HotMatch source or session data copied',
  declaredDependencies: { ...manifest.dependencies, ...manifest.devDependencies },
  installed, lockedVersions: Object.fromEntries(Object.keys(installed).map(name => [name, locked.packages['node_modules/' + name]?.version || null])),
  sources: files.map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    return { path: file, sha256: createHash('sha256').update(bytes).digest('hex'),
      gitStatus: git(['status', '--porcelain', '--', file]) || 'CLEAN',
      imports: file.endsWith('.js') ? [...bytes.toString('utf8').matchAll(/^import .*? from ['"]([^'"]+)['"]/gm)].map(m => m[1]) : [] };
  }),
};
const output = JSON.stringify(report, null, 2) + '\n';
if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), output);
else process.stdout.write(output);
