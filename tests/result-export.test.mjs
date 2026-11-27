import test from 'node:test';
import assert from 'node:assert/strict';
import writeExcelFile from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { buildWorkbookSheets } from '../public/result-export.js';

test('XLSX contains typed counts, dates and midnight intervals, duplicate names and empty responses without formulas or private fields', async () => {
  const data = { meeting: { title: '=SUM(1,2)', start_date: '2026-11-28', end_date: '2026-11-29', start_hour: 23, end_hour: 24 }, participants: [{ name: '민준', slots: ['2026-11-28|1380', '2026-11-28|1410'] }, { name: '민준', slots: [] }, { name: '=HYPERLINK("x")', slots: ['2026-11-28|1410'] }], mine: { password_hash: 'never-export' }, fixed: [{ name: 'private-do-not-export' }] };
  const sheets = buildWorkbookSheets(data, 'best');
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].data[3][1].value, 1);
  assert.equal(sheets[0].data[4][1].value, 2);
  assert.equal(sheets[0].data[4][1].type, Number);
  assert.ok(sheets[0].data[2][1].value instanceof Date);
  assert.equal(sheets[1].data[1][0].value, '민준 (1)');
  assert.equal(sheets[1].data[1][3].value, 1);
  assert.equal(sheets[1].data[1][3].format, '[h]:mm');
  assert.equal(sheets[1].data[2][0].value, '민준 (2)');
  const zip = unzipSync(new Uint8Array(await writeExcelFile(sheets).toBuffer()));
  const xml = Object.values(zip).map(bytes => strFromU8(bytes)).join('\n');
  assert.doesNotMatch(xml, /never-export|private-do-not-export|<f[ >]/);
  assert.match(xml, /SUM\(1,2\)/); assert.match(xml, /HYPERLINK/); assert.match(xml, /\[h\]:mm/);
  const parser = new XMLParser({ ignoreAttributes: false });
  const workbook = parser.parse(strFromU8(zip['xl/workbook.xml']));
  assert.equal(workbook.workbook.sheets.sheet.length, 2);
  const main = parser.parse(strFromU8(zip['xl/worksheets/sheet1.xml']));
  assert.ok(main.worksheet.sheetViews.sheetView.pane);
  assert.match(strFromU8(zip['xl/styles.xml']), /yyyy-mm-dd/);
});

test('An empty meeting exports zero counts without claiming unanimity', () => {
  const sheets = buildWorkbookSheets({ meeting: { title: '아직 응답 없음', start_date: '2026-11-28', end_date: '2026-11-28', start_hour: 9, end_hour: 10 }, participants: [] }, 'best');
  assert.equal(sheets[0].data[3][1].value, 0);
  assert.equal(sheets[1].data.length, 1);
});
