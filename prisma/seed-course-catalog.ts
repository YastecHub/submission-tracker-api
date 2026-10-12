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
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { planCatalogSync, readCatalogCsv } from '../src/modules/gpa/domain/catalogCsv';
import { defaultCatalogFile } from '../src/modules/gpa/infrastructure/catalogSync';

export { readCatalogCsv };

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
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
    const { toCreate, toUpdate, toDeactivate } = planCatalogSync(existing, rows, deactivateMissing);

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
