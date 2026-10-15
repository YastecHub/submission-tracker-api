import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { readVoterList, type VoterRow } from '../domain/voterList';

/** Elections whose voter list still follows the class list (anything not yet closed). */
const ACTIVE_STATUSES = ['draft', 'ready', 'open', 'paused'] as const;

/** prisma/data/class-list.csv, whether running from source (tsx) or from dist/. */
export function defaultClassListFile(): string {
  const candidates = [
    join(process.cwd(), 'prisma', 'data', 'class-list.csv'),
    join(__dirname, '..', '..', '..', '..', 'prisma', 'data', 'class-list.csv'),
    join(__dirname, '..', '..', '..', '..', '..', 'prisma', 'data', 'class-list.csv'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/**
 * The class list: every student who can vote (matric number, full name, and an email for
 * students without a matric number, e.g. JUPEB). Throws if the file has problems.
 */
export function loadClassList(file = defaultClassListFile()): VoterRow[] {
  const { rows, errors } = readVoterList(readFileSync(file, 'utf8'));
  if (errors.length) throw new Error(`Class list file has problems: ${errors.join('; ')}`);
  return rows;
}

/**
 * Makes the database follow the class list. Runs on every server start (like the course
 * catalog), so adding a student to the file and deploying is all it takes:
 *  - the student list gets every row, with the names and seeded emails from the file;
 *  - existing accounts take the file's spelling of their name;
 *  - every election that hasn't closed gets any new students on its voter list.
 * Nothing is ever removed. Writes only what changed, so repeating it is cheap and safe.
 */
export async function syncClassList(db: PrismaClient, file = defaultClassListFile()) {
  const rows = loadClassList(file);
  const matrics = rows.map((row) => row.matricNumber);

  const emails = rows.filter((row) => row.email).map((row) => row.email!);
  const emailOwners = emails.length ? await db.studentRoster.findMany({ where: { email: { in: emails } }, select: { email: true, matricNumber: true } }) : [];
  const clashes = emailOwners.filter((owner) => rows.find((row) => row.email === owner.email)?.matricNumber !== owner.matricNumber);
  if (clashes.length) throw new Error(`Class list emails already belong to other students: ${clashes.map((clash) => `${clash.email} (${clash.matricNumber})`).join(', ')}`);

  const roster = new Map((await db.studentRoster.findMany({ where: { matricNumber: { in: matrics } }, select: { matricNumber: true, fullName: true, email: true } }))
    .map((entry) => [entry.matricNumber, entry]));
  const rosterChanges = rows.filter((row) => {
    const entry = roster.get(row.matricNumber);
    return !entry || entry.fullName !== row.fullName || (row.email !== null && entry.email !== row.email);
  });

  const accounts = await db.studentAccount.findMany({ where: { matricNumber: { in: matrics } }, select: { id: true, matricNumber: true, fullName: true } });
  const nameByMatric = new Map(rows.map((row) => [row.matricNumber, row.fullName]));
  const renamedAccounts = accounts.filter((account) => nameByMatric.get(account.matricNumber) !== account.fullName);

  const elections = await db.election.findMany({ where: { status: { in: [...ACTIVE_STATUSES] }, closesAt: { gt: new Date() } }, select: { id: true } });

  let votersAdded = 0;
  await db.$transaction(async (tx) => {
    for (const row of rosterChanges) {
      await tx.studentRoster.upsert({
        where: { matricNumber: row.matricNumber },
        create: { matricNumber: row.matricNumber, fullName: row.fullName, email: row.email },
        update: { fullName: row.fullName, ...(row.email ? { email: row.email } : {}) },
      });
    }
    for (const account of renamedAccounts) {
      await tx.studentAccount.update({ where: { id: account.id }, data: { fullName: nameByMatric.get(account.matricNumber)! } });
    }
    for (const election of elections) {
      const result = await tx.electionVoterRoll.createMany({
        data: rows.map((row) => ({ electionId: election.id, matricNumber: row.matricNumber, fullName: row.fullName })),
        skipDuplicates: true,
      });
      votersAdded += result.count;
      for (const row of rosterChanges.filter((change) => roster.has(change.matricNumber))) {
        await tx.electionVoterRoll.updateMany({ where: { electionId: election.id, matricNumber: row.matricNumber }, data: { fullName: row.fullName } });
      }
    }
  }, { maxWait: 15_000, timeout: 60_000 });

  return { students: rows.length, rosterUpdated: rosterChanges.length, accountsRenamed: renamedAccounts.length, votersAdded };
}
