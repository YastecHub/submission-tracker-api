import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [crHash, acrHash, devHash] = await Promise.all([
    bcrypt.hash('Abdulbashit@12', 10),
    bcrypt.hash('TrendUni01!', 10),
    bcrypt.hash('Yastec01!', 10),
  ]);

  // Class Representative
  const cr = await prisma.user.upsert({
    where: { email: 'abdulbasitopeyemi299@gmail.com' },
    update: {},
    create: {
      email: 'abdulbasitopeyemi299@gmail.com',
      passwordHash: crHash,
      name: 'Abdulbasit Opeyemi',
      role: 'cr',
    },
  });

  // Assistant CR — Oreoluwa
  const acr = await prisma.user.upsert({
    where: { email: 'Chryxcreates@gmail.com' },
    update: {},
    create: {
      email: 'Chryxcreates@gmail.com',
      passwordHash: acrHash,
      name: 'Oreoluwa',
      role: 'acr',
    },
  });

  // Developer / test account
  const dev = await prisma.user.upsert({
    where: { email: 'yasiroyebo@gmail.com' },
    update: {},
    create: {
      email: 'yasiroyebo@gmail.com',
      passwordHash: devHash,
      name: 'Yasir (Dev)',
      role: 'cr',
    },
  });

  console.log('Seeded CR   :', cr.email);
  console.log('Seeded ACR  :', acr.email);
  console.log('Seeded Dev  :', dev.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
