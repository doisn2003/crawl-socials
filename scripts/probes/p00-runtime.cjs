// Architecture probe only: no product bootstrap, browser navigation or live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sqliteProbe(directory) {
  const { DatabaseSync } = require('node:sqlite');
  const filename = path.join(directory, 'synthetic.sqlite');
  const postId = '900719925474099312345';
  const text = 'CSD — tiếng Việt: cà phê, Đà Nẵng';
  let db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE posts (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;');
  db.exec('BEGIN IMMEDIATE;');
  db.prepare('INSERT INTO posts VALUES (?, ?)').run(postId, text);
  db.exec('ROLLBACK;');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 0);
  db.exec('BEGIN IMMEDIATE;');
  const insert = db.prepare('INSERT INTO posts VALUES (?, ?) ON CONFLICT(id) DO NOTHING');
  insert.run(postId, text);
  insert.run(postId, text);
  db.exec('COMMIT;');
  const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  db.close();
  db = new DatabaseSync(filename);
  const rows = db.prepare('SELECT id, body FROM posts').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, postId);
  assert.equal(rows[0].body, text);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  return { sqliteVersion, wal: true, foreignKeys: true, rollback: true,
    idempotentInsert: true, unicodeAndStringIdAfterReopen: true, integrityCheck: 'ok' };
}

if (process.versions.electron && process.type === 'browser') {
  const { app, BaseWindow, WebContentsView, safeStorage } = require('electron');
  const root = process.env.CSD_P00_PROBE_ROOT;
  assert.ok(root && path.isAbsolute(root));
  fs.mkdirSync(path.join(root, 'user-data'), { recursive: true });
  app.setName('CSD-P00-Probe');
  app.setPath('userData', path.join(root, 'user-data'));
  app.setPath('sessionData', path.join(root, 'user-data'));
  app.setPath('logs', path.join(root, 'logs'));
  app.setPath('crashDumps', path.join(root, 'crash-dumps'));
  app.whenReady().then(() => {
    const sqlite = sqliteProbe(root);
    assert.equal(typeof BaseWindow, 'function');
    assert.equal(typeof WebContentsView, 'function');
    const encryptionAvailable = safeStorage.isEncryptionAvailable();
    if (encryptionAvailable) {
      assert.equal(safeStorage.decryptString(safeStorage.encryptString('synthetic-only')), 'synthetic-only');
    }
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({
      runtime: 'electron-main', electron: process.versions.electron, node: process.versions.node,
      chromium: process.versions.chrome, modulesAbi: process.versions.modules,
      platform: process.platform, arch: process.arch, sqlite,
      browserClassesAvailable: true, safeStorageSyntheticRoundTrip: encryptionAvailable,
      isolatedUserData: true, windowsCreated: 0, networkRequests: 0,
    }, null, 2));
    app.exit(0);
  }).catch(error => {
    console.error(error);
    app.exit(1);
  });
} else {
  const { spawnSync } = require('node:child_process');
  const electronPath = process.argv[2];
  assert.ok(electronPath && path.isAbsolute(electronPath), 'Usage: node scripts/probes/p00-runtime.cjs <absolute electron.exe>');
  const tempBase = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempBase, 'csd-p00-probe-'));
  try {
    const nodeDirectory = path.join(root, 'node');
    fs.mkdirSync(nodeDirectory);
    const node = { node: process.versions.node, modulesAbi: process.versions.modules,
      platform: process.platform, arch: process.arch, sqlite: sqliteProbe(nodeDirectory) };
    const env = { ...process.env, CSD_P00_PROBE_ROOT: root };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(electronPath, [__filename], {
      env, windowsHide: true, encoding: 'utf8', timeout: 30000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout || 'Electron probe failed');
    const electron = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
    const output = JSON.stringify({ probe: 'P00.03', node, electron,
      limitations: ['No packaged executable tested', 'No browser session or Facebook access tested',
        'No throughput, crash recovery or product persistence implementation tested'] }, null, 2) + '\n';
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), output);
    else process.stdout.write(output);
  } finally {
    const target = path.resolve(root);
    assert.ok(path.dirname(target) === tempBase && path.basename(target).startsWith('csd-p00-probe-'));
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
