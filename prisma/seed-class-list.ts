/**
 * Seeds the student list and every not-yet-closed election's voter list from
 * prisma/data/class-list.csv. The server also does this on every start, so this script
 * is only needed to apply a change without restarting or deploying.
 *
 *   npm run db:seed:class-list
 *
 * Header: matricNumber,fullName,email. Students without a matric number (e.g. JUPEB) leave
 * matricNumber empty and give the email they will register with. Nothing is ever removed.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { syncClassList } from '../src/modules/elections/infrastructure/classList';

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
  try {
    const result = await syncClassList(prisma);
    console.log(`Class list: ${result.students} students in the file`);
    console.log(`  student list entries added or updated: ${result.rosterUpdated}`);
    console.log(`  account names updated:                 ${result.accountsRenamed}`);
    console.log(`  added to open voter lists:             ${result.votersAdded}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
