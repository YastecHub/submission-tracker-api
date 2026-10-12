import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv } from '../src/modules/gpa/domain/csv';
import { parseImportCsv, parseLevel } from '../src/modules/gpa/domain/gpaImport';
import { readCatalogCsv } from '../prisma/seed-course-catalog';

test('CSV reader handles quotes, commas and newlines in quotes, CRLF, BOM and comments', () => {
  const text = '﻿a,b\r\n# comment\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",z\n';
  const records = [...parseCsv(text)];
  assert.deepEqual(records.map((record) => record.values), [['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']]);
  assert.equal(records[1].line, 3);
  assert.equal(records[2].line, 5);
});

test('import accepts friendly values and the template header', () => {
  const { rows, issues } = parseImportCsv([
    'Level,Semester,Course Code,Title,Units,Grade,Carryover,Retake,Session',
    '200L,First,pct201,Intro,3,a,no,,2025-2026',
    '200,2nd semester,PCT 202,,,,yes,y,',
  ].join('\n'));
  assert.deepEqual(issues, []);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    line: 2, level: 200, semester: 1, code: 'PCT 201', title: 'Intro', units: 3, grade: 'A',
    isCarryover: false, isRetake: false, sessionLabel: '2025/2026',
  });
  assert.equal(rows[1].semester, 2);
  assert.equal(rows[1].grade, null);
  assert.equal(rows[1].units, null);
  assert.equal(rows[1].isCarryover, true);
});

test('import reports every bad row with its line and column', () => {
  const { rows, issues } = parseImportCsv([
    'level,semester,code,units,grade,carryover',
    '700,1,PCT 201,3,A,no',
    '200,3,PCT 202,0,Z,maybe',
    '200,1,PCT 203,3,B,no',
    '200,1,pct203,2,C,no',
  ].join('\n'));
  assert.equal(rows.length, 1);
  const messages = issues.map((issue) => `${issue.line}:${issue.column}`);
  assert.deepEqual(messages, ['2:level', '3:semester', '3:units', '3:grade', '3:carryover', '5:code']);
  assert.match(issues[5].message, /listed twice.*line 4/);
});

test('import rejects a file without the required columns or rows', () => {
  assert.match(parseImportCsv('code,grade\nPCT 201,A').issues[0].message, /Missing columns: level, semester/);
  assert.match(parseImportCsv('').issues[0].message, /empty/);
  assert.match(parseImportCsv('level,semester,code\n').issues[0].message, /no courses/);
});

test('import handles 500 rows quickly', () => {
  const lines = ['level,semester,code,units,grade'];
  for (let i = 0; i < 500; i++) lines.push(`${(i % 5 + 1) * 100},${i % 2 + 1},ABC ${String(i).padStart(4, '0')},3,B`);
  const started = Date.now();
  const { rows, issues } = parseImportCsv(lines.join('\n'));
  assert.equal(issues.length, 0);
  assert.equal(rows.length, 500);
  assert.ok(Date.now() - started < 500);
});

test('catalog seed file is validated before anything is written', () => {
  const ok = readCatalogCsv('# note\ncode,title,units,level,semester,elective,sort\nabc201,Example,3,200,1,no,1\n');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows[0], { code: 'ABC 201', title: 'Example', units: 3, level: 200, semester: 1, isElective: false, sortOrder: 1 });
  const bad = readCatalogCsv('code,title,units,level,semester\nABC 201,,0,700,3\nabc 201,Dup,2,200,1\n');
  assert.equal(bad.errors.length, 5);
});

test('levels run 100L to 600L (six-year Pharm. D.)', () => {
  assert.equal(parseLevel('600'), 600);
  assert.equal(parseLevel('600L'), 600);
  assert.equal(parseLevel('700'), null);
});
