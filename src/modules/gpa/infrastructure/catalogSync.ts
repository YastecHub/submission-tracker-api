import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { cacheDelete } from '../../../utils/cache';
import { planCatalogSync, readCatalogCsv } from '../domain/catalogCsv';

export const CATALOG_CACHE_KEY = 'gpa:catalog';

/** prisma/data/course-catalog.csv, whether running from source (tsx) or from dist/. */
export function defaultCatalogFile(): string {
  const candidates = [
    join(process.cwd(), 'prisma', 'data', 'course-catalog.csv'),
    join(__dirname, '..', '..', '..', '..', 'prisma', 'data', 'course-catalog.csv'),
    join(__dirname, '..', '..', '..', '..', '..', 'prisma', 'data', 'course-catalog.csv'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/**
 * Makes the CourseCatalog table match the CSV (new and changed courses only; nothing is
 * removed). Runs on every server start, so any environment - local, staging, Heroku -
 * has the course list without a manual seed. Upserts by code, so it is safe to repeat.
 */
export async function syncCourseCatalog(db: PrismaClient, file = defaultCatalogFile()) {
  const { rows, errors } = readCatalogCsv(readFileSync(file, 'utf8'));
  if (errors.length) throw new Error(`Course catalog file has problems: ${errors.join('; ')}`);
  const existing = await db.courseCatalog.findMany();
  const plan = planCatalogSync(existing, rows);
  const changes = [...plan.toCreate, ...plan.toUpdate];
  if (changes.length) {
    await db.$transaction(async (tx) => {
      for (const row of changes) {
        await tx.courseCatalog.upsert({ where: { code: row.code }, create: { ...row, isActive: true }, update: { ...row, isActive: true } });
      }
    }, { maxWait: 15_000, timeout: 60_000 });
    cacheDelete(CATALOG_CACHE_KEY);
  }
  return { courses: rows.length, created: plan.toCreate.length, updated: plan.toUpdate.length };
}
