/**
 * Seeds or updates the GPA tracker's course catalog from prisma/data/course-catalog.csv.
 *
 *   npm run db:seed:catalog -- --dry-run              preview the changes only
 *   npm run db:seed:catalog                           upsert every course in the file
 *   npm run db:seed:catalog -- --deactivate-missing   also hide courses no longer in the file
 *   npm run db:seed:catalog -- --file path/to.csv     use a different file
 *   npm run db:sync:catalog                           compiled version, run by Heroku's release phase
 *
 * Courses are matched by code. Students' saved courses are snapshots, so changing a
 * title or units here never rewrites anyone's history.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { parseCsv } from '../src/modules/gpa/domain/csv';
import { normalizeCourseCode } from '../src/modules/gpa/domain/grades';
import { parseFlag, parseLevel, parseSemester } from '../src/modules/gpa/domain/gpaImport';

interface CatalogRow {
  code: string;
  title: string;
  units: number;
  level: number;
  semester: number;
  isElective: boolean;
  sortOrder: number;
}

function defaultCatalogFile(): string {
  // tsx runs this from prisma/, the compiled copy runs from dist/prisma/.
  const candidates = [join(__dirname, 'data', 'course-catalog.csv'), join(process.cwd(), 'prisma', 'data', 'course-catalog.csv')];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function readCatalogCsv(text: string): { rows: CatalogRow[]; errors: string[] } {
  const rows: CatalogRow[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  let header: string[] | null = null;
  let position = 0;

  for (const record of parseCsv(text)) {
    if (!header) {
      header = record.values.map((value) => value.toLowerCase());
      for (const column of ['code', 'title', 'units', 'level', 'semester']) {
        if (!header.includes(column)) errors.push(`Header is missing "${column}"`);
      }
      if (errors.length) break;
      continue;
    }
    const cell = (column: string) => record.values[header!.indexOf(column)] ?? '';
    const where = `line ${record.line}`;
    const code = normalizeCourseCode(cell('code'));
    const title = cell('title').replace(/\s+/g, ' ');
    const units = Number(cell('units'));
    const level = parseLevel(cell('level'));
    const semester = parseSemester(cell('semester'));
    const isElective = header.includes('elective') ? parseFlag(cell('elective')) : false;
    const sortText = header.includes('sort') ? cell('sort') : '';
    const sortOrder = sortText ? Number(sortText) : position;

    if (!code) errors.push(`${where}: code is required`);
    if (!title) errors.push(`${where}: title is required`);
    if (title.length > 150) errors.push(`${where}: title is too long`);
    if (!Number.isInteger(units) || units < 1 || units > 12) errors.push(`${where}: units must be 1-12`);
    if (!level) errors.push(`${where}: level must be 100-600`);
    if (!semester) errors.push(`${where}: semester must be 1 or 2`);
    if (isElective === null) errors.push(`${where}: elective must be yes or no`);
    if (!Number.isInteger(sortOrder)) errors.push(`${where}: sort must be a whole number`);
    const key = code.replace(/\s/g, '');
    if (seen.has(key)) errors.push(`${where}: ${code} is already on line ${seen.get(key)}`);
    seen.set(key, record.line);

    rows.push({ code, title, units, level: level ?? 0, semester: semester ?? 0, isElective: !!isElective, sortOrder });
    position += 1;
  }
  if (!header) errors.push('The file has no header row');
  return { rows, errors };
}

async function main(): Promise<void> {
  const file = argValue('--file') ?? defaultCatalogFile();
  const dryRun = process.argv.includes('--dry-run');
  const deactivateMissing = process.argv.includes('--deactivate-missing');

  const { rows, errors } = readCatalogCsv(readFileSync(file, 'utf8'));
  if (errors.length) {
    console.error(`Found ${errors.length} problem(s) in ${file}:`);
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  if (rows.length === 0) {
    console.warn(`No courses in ${file}, so there is nothing to sync.`);
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
  try {
    const existing = await prisma.courseCatalog.findMany();
    const byCode = new Map(existing.map((course) => [course.code, course]));
    const toCreate = rows.filter((row) => !byCode.has(row.code));
    const toUpdate = rows.filter((row) => {
      const current = byCode.get(row.code);
      return current && (current.title !== row.title || current.units !== row.units || current.level !== row.level
        || current.semester !== row.semester || current.isElective !== row.isElective || current.sortOrder !== row.sortOrder || !current.isActive);
    });
    const fileCodes = new Set(rows.map((row) => row.code));
    const toDeactivate = deactivateMissing ? existing.filter((course) => course.isActive && !fileCodes.has(course.code)) : [];

    console.log(`Catalog file: ${rows.length} course(s)`);
    console.log(`  new:         ${toCreate.length}`);
    console.log(`  changed:     ${toUpdate.length}`);
    console.log(`  unchanged:   ${rows.length - toCreate.length - toUpdate.length}`);
    if (deactivateMissing) console.log(`  deactivate:  ${toDeactivate.length}${toDeactivate.length ? ` (${toDeactivate.map((c) => c.code).join(', ')})` : ''}`);
    if (dryRun) {
      console.log('\nDry run: nothing was written.');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const row of [...toCreate, ...toUpdate]) {
        await tx.courseCatalog.upsert({
          where: { code: row.code },
          create: { ...row, isActive: true },
          update: { ...row, isActive: true },
        });
      }
      if (toDeactivate.length) {
        await tx.courseCatalog.updateMany({ where: { id: { in: toDeactivate.map((course) => course.id) } }, data: { isActive: false } });
      }
    }, { maxWait: 15_000, timeout: 120_000 });
    console.log('\nCatalog updated. The API serves the new list within 5 minutes (cache).');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
