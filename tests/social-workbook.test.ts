import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { exportSocialWorkbook } from '../src/infrastructure/export/social-workbook.js';

async function temporary(work: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'csd-workbook-'));
  try { await work(join(directory, 'posts.xlsx')); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('csd-workbook-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('XLSX round trip preserves raw social fields, string identifiers, missing counts and literal text', async () => temporary(async path => {
  const facebook = [{
    post_id: '900719925474099312345', published_at: '2026-10-29T04:00:00.000Z', query: 'cà phê Hà Nội',
    source_type: 'GROUP', source_name: 'Cà phê & bạn bè', text: '=HYPERLINK("https://example.com", "☕ Hà Nội")',
    observed_post_url: 'https://www.facebook.com/groups/example/posts/900719925474099312345/',
    reactions_total: 0, love_count: null, comments_count: 12, shares_count: 1,
    author_name: '@tên tác giả', author_url: null, source_url: 'https://www.facebook.com/groups/example/',
    collected_at: '2026-10-29T05:00:00.000Z',
  }];
  const threads = [{
    post_id: '900719925474099399999', published_at: null, query: 'cà phê Hà Nội', author_username: 'coffee',
    author_name: 'Quán nhỏ', text: '+SUM(1,2)\nDòng thứ hai ☕', post_url: 'https://www.threads.com/@coffee/post/Example',
    likes: 3, replies: 0, reposts: null, quotes: 2, shares: 5, collected_at: '2026-10-29T05:00:00.000Z',
    visibility: 'PUBLIC_PROFILE', search_mode: 'recent',
  }];
  await exportSocialWorkbook(path, facebook, threads);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Facebook Posts', 'Thread Posts']);
  const fb = workbook.getWorksheet('Facebook Posts')!, thread = workbook.getWorksheet('Thread Posts')!;
  assert.deepEqual((fb.getRow(1).values as string[]).slice(1, 12), [
    'post_id', 'published_at', 'từ khóa', 'source_type', 'source_name', 'text', 'link',
    'reactions_total', 'love_count', 'comments_count', 'shares_count',
  ]);
  assert.equal(fb.getCell('A2').value, facebook[0]!.post_id);
  assert.equal(fb.getCell('A2').type, ExcelJS.ValueType.String);
  assert.equal(fb.getCell('A2').numFmt, '@');
  assert.equal(fb.getCell('B2').value, facebook[0]!.published_at);
  assert.equal(fb.getCell('C2').value, 'cà phê Hà Nội');
  assert.equal(fb.getCell('F2').value, facebook[0]!.text);
  assert.equal(fb.getCell('F2').type, ExcelJS.ValueType.String);
  assert.equal(fb.getCell('G2').hyperlink, facebook[0]!.observed_post_url);
  assert.equal(fb.getCell('H2').value, 0);
  assert.equal(fb.getCell('I2').value, null);
  assert.equal(fb.getCell('J2').value, 12);
  assert.equal(thread.getCell('A2').value, threads[0]!.post_id);
  assert.equal(thread.getCell('B2').value, null);
  assert.equal(thread.getCell('F2').value, threads[0]!.text);
  assert.equal(thread.getCell('H1').value, 'likes');
  assert.equal(thread.getCell('H2').value, 3);
  assert.equal(thread.getCell('I2').value, 0);
  assert.equal(thread.getCell('J2').value, null);
  assert.equal(thread.getCell('K2').value, 2);
  assert.equal(thread.getCell('L2').value, 5);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.autoFilter, 'A1:P2');
    assert.equal(sheet.views[0]!.state, 'frozen');
    assert.equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).ySplit, 1);
    assert.equal(sheet.views[0]!.showGridLines, true);
    assert.equal(sheet.getCell('A1').font.name, 'Calibri');
    assert.equal(sheet.getCell('A1').font.bold, true);
    assert.equal(sheet.getCell('A1').font.color!.argb, 'FFFFFFFF');
    assert.deepEqual(sheet.getCell('A1').fill, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } });
    assert.equal(sheet.getRow(1).height, 22);
    assert.equal(sheet.getRow(2).height, 15);
    assert.equal(Boolean(sheet.getCell('F2').alignment.wrapText), false);
    assert.equal(sheet.getColumn('F').width, 60);
  }
}));

test('empty exports still include both named sheets with filter and header', async () => temporary(async path => {
  await exportSocialWorkbook(path, [], []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  assert.equal(workbook.worksheets.length, 2);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.rowCount, 1);
    assert.equal(sheet.autoFilter, 'A1:P1');
    assert.equal(sheet.getCell('A1').value, 'post_id');
  }
}));

test('unsupported cell size, unsafe identifiers and counts fail without replacing an existing export', async () => temporary(async path => {
  await writeFile(path, 'existing file');
  await assert.rejects(exportSocialWorkbook(path, [{ post_id: '1', text: 'a'.repeat(32768) }], []), /XLSX_CELL_TEXT_TOO_LONG/);
  await assert.rejects(exportSocialWorkbook(path, [{ post_id: 9007199254740992 }], []), /XLSX_POST_ID_MUST_BE_TEXT/);
  await assert.rejects(exportSocialWorkbook(path, [{ post_id: '1', reactions_total: -1 }], []), /XLSX_INVALID_COUNT/);
  assert.equal(await readFile(path, 'utf8'), 'existing file');
}));

test('non-web links remain literal cells and do not create active local-file links', async () => temporary(async path => {
  await exportSocialWorkbook(path, [{ post_id: '1', observed_post_url: 'file:///C:/private' }], []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const cell = workbook.getWorksheet('Facebook Posts')!.getCell('G2');
  assert.equal(cell.value, 'file:///C:/private');
  assert.equal(cell.type, ExcelJS.ValueType.String);
}));
