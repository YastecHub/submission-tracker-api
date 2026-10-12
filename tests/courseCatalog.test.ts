import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCatalogCsv } from '../src/modules/gpa/domain/catalogCsv';
import { syncCourseCatalog } from '../src/modules/gpa/infrastructure/catalogSync';

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

test('server start loads the course list into an empty database, then changes nothing', async () => {
  const table: Array<Record<string, unknown>> = [];
  const db = {
    courseCatalog: { findMany: async () => table.map((row) => ({ ...row })) },
    $transaction: async (work: (tx: unknown) => Promise<void>) => work({
      courseCatalog: {
        upsert: async ({ where, create, update }: { where: { code: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const found = table.find((row) => row.code === where.code);
          if (found) Object.assign(found, update); else table.push({ id: `c${table.length}`, ...create });
        },
      },
    }),
  };
  const first = await syncCourseCatalog(db as never);
  assert.deepEqual(first, { courses: 22, created: 22, updated: 0 });
  assert.equal(table.length, 22);
  const second = await syncCourseCatalog(db as never);
  assert.deepEqual(second, { courses: 22, created: 0, updated: 0 });
  table.find((row) => row.code === 'COS 101')!.units = 2;
  assert.equal((await syncCourseCatalog(db as never)).updated, 1);
  assert.equal(table.find((row) => row.code === 'COS 101')!.units, 3);
});

test('no course can carry more than 6 units', () => {
  const { errors } = readCatalogCsv('code,title,units,level,semester\nPCT 501,Big Course,7,500,1\nPCT 502,Six Units,6,500,1\n');
  assert.deepEqual(errors, ['line 2: units must be 1-6']);
});
