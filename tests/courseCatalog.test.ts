import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCatalogCsv } from '../prisma/seed-course-catalog';

test('the shipped course catalog is valid and holds both 100L semesters', () => {
  const { rows, errors } = readCatalogCsv(readFileSync(join(__dirname, '..', 'prisma', 'data', 'course-catalog.csv'), 'utf8'));
  assert.deepEqual(errors, []);
  const first = rows.filter((row) => row.level === 100 && row.semester === 1);
  const second = rows.filter((row) => row.level === 100 && row.semester === 2);
  assert.equal(first.length, 12);
  assert.equal(second.length, 10);
  // Totals printed on the official course forms.
  assert.equal(first.reduce((sum, row) => sum + row.units, 0), 21);
  assert.equal(second.reduce((sum, row) => sum + row.units, 0), 17);
  assert.ok(rows.some((row) => row.code === 'CHM-CM 101'));
  assert.ok(rows.some((row) => row.code === 'PCY 101'));
});

test('catalog validation rejects duplicates and bad units', () => {
  const { errors } = readCatalogCsv('code,title,units,level,semester\nBIO 101,A,2,100,1\nbio101,B,0,100,1\n');
  assert.equal(errors.length, 2);
});
