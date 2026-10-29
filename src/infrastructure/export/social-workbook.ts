import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

type Post = Record<string, unknown>;
type Column = { header: string; field: string; width: number; kind?: 'id' | 'number' | 'link' };

const facebookColumns: Column[] = [
  { header: 'post_id', field: 'post_id', width: 24, kind: 'id' },
  { header: 'published_at', field: 'published_at', width: 25 },
  { header: 'từ khóa', field: 'query', width: 30 },
  { header: 'source_type', field: 'source_type', width: 18 },
  { header: 'source_name', field: 'source_name', width: 30 },
  { header: 'text', field: 'text', width: 60 },
  { header: 'link', field: 'observed_post_url', width: 44, kind: 'link' },
  { header: 'reactions_total', field: 'reactions_total', width: 18, kind: 'number' },
  { header: 'love_count', field: 'love_count', width: 18, kind: 'number' },
  { header: 'comments_count', field: 'comments_count', width: 19, kind: 'number' },
  { header: 'shares_count', field: 'shares_count', width: 18, kind: 'number' },
  { header: 'author_name', field: 'author_name', width: 30 },
  { header: 'author_url', field: 'author_url', width: 44, kind: 'link' },
  { header: 'source_url', field: 'source_url', width: 44, kind: 'link' },
  { header: 'collected_at', field: 'collected_at', width: 25 },
];

const threadsColumns: Column[] = [
  { header: 'post_id', field: 'post_id', width: 24, kind: 'id' },
  { header: 'published_at', field: 'published_at', width: 25 },
  { header: 'từ khóa', field: 'query', width: 30 },
  { header: 'author_username', field: 'author_username', width: 26 },
  { header: 'author_name', field: 'author_name', width: 30 },
  { header: 'text', field: 'text', width: 60 },
  { header: 'link', field: 'post_url', width: 44, kind: 'link' },
  { header: 'likes', field: 'likes', width: 18, kind: 'number' },
  { header: 'replies', field: 'replies', width: 18, kind: 'number' },
  { header: 'reposts', field: 'reposts', width: 18, kind: 'number' },
  { header: 'quotes', field: 'quotes', width: 18, kind: 'number' },
  { header: 'shares', field: 'shares', width: 18, kind: 'number' },
  { header: 'collected_at', field: 'collected_at', width: 25 },
  { header: 'visibility', field: 'visibility', width: 22 },
  { header: 'search_mode', field: 'search_mode', width: 18 },
];

function cellValue(post: Post, column: Column, sheetName: string, rowNumber: number): ExcelJS.CellValue {
  const value = post[column.field];
  const location = `${sheetName}!${column.header}:${rowNumber}`;
  if (column.kind === 'id' && (typeof value !== 'string' || !value)) {
    throw new Error(`XLSX_POST_ID_MUST_BE_TEXT: ${location}`);
  }
  if (value === undefined || value === null) return null;
  if (column.kind === 'number') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`XLSX_INVALID_COUNT: ${location}`);
    }
    return value;
  }
  if (typeof value !== 'string') throw new Error(`XLSX_INVALID_TEXT: ${location}`);
  // Excel limits a cell to 32,767 UTF-16 code units. Never silently truncate a post.
  // The complete JSON remains available when a record cannot be represented in XLSX.
  if (value.length > 32767) throw new Error(`XLSX_CELL_TEXT_TOO_LONG: ${location}`);
  if (column.kind === 'link' && value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' || url.protocol === 'http:') return { text: value, hyperlink: value };
    } catch { /* Preserve malformed source URLs as literal text. */ }
  }
  // Assign strings, never formula objects. Values starting with =, +, - or @ stay literal.
  return value;
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], posts: Post[]): void {
  if (posts.length > 1048575) throw new Error(`XLSX_ROW_LIMIT: ${name}`);
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', showGridLines: true }],
    properties: { defaultRowHeight: 15 },
  });
  sheet.columns = columns.map(column => ({ header: column.header, key: column.field, width: column.width }));
  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
  });
  for (const [index, post] of posts.entries()) {
    const row = sheet.addRow(columns.map(column => cellValue(post, column, name, index + 2)));
    row.height = 15;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const column = columns[columnNumber - 1]!;
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'middle', horizontal: column.kind === 'number' ? 'right' : 'left', wrapText: false };
      cell.numFmt = column.kind === 'number' ? '0' : '@';
      if (cell.type === ExcelJS.ValueType.Hyperlink) {
        cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF0563C1' }, underline: true };
      }
    });
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, posts.length + 1), column: columns.length } };
}

/** Export one combined workbook from the two collectors' posts.json arrays. */
export async function exportSocialWorkbook(path: string, facebook: Post[], threads: Post[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CSD';
  workbook.title = 'CSD — Crawl Socials Data';
  addSheet(workbook, 'Facebook Posts', facebookColumns, facebook);
  addSheet(workbook, 'Thread Posts', threadsColumns, threads);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.next-${randomUUID()}.xlsx`;
  try {
    await workbook.xlsx.writeFile(temporary);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
