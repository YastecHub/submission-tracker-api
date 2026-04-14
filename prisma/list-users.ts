import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main(): Promise<void> {
  const users = await p.user.findMany({
    select: { email: true, name: true, role: true, passwordHash: true },
  });
  console.log('Users in DB:');
  for (const u of users) {
    console.log(
      ' -',
      u.role.padEnd(8),
      u.email.padEnd(40),
      '→',
      u.name,
      '| hash prefix:',
      u.passwordHash.slice(0, 7),
    );
  }
  console.log('Total:', users.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
