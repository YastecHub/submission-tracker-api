import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    },
  },
});

async function main(): Promise<void> {
  const [crHash, acrHash, acr2Hash, devHash, finSecHash] = await Promise.all([
    bcrypt.hash('Abdulbashit@12', 10),
    bcrypt.hash('Chryx@18', 10),
    bcrypt.hash('itswell622', 10),
    bcrypt.hash('Yastec01!', 10),
    bcrypt.hash('esther01!', 10),
  ]);

  // Class Representative
  const cr = await prisma.user.upsert({
    where: { email: 'abdulbasitopeyemi299@gmail.com' },
    update: { name: 'Abdulbasit Opeyemi', role: 'cr', passwordHash: crHash },
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
    update: { name: 'Oreoluwa', role: 'acr', passwordHash: acrHash },
    create: {
      email: 'Chryxcreates@gmail.com',
      passwordHash: acrHash,
      name: 'Oreoluwa',
      role: 'acr',
    },
  });

  // Assistant CR 2
  const acr2 = await prisma.user.upsert({
    where: { email: 'ayomideamisu622@gmail.com' },
    update: { name: 'ACR2', role: 'acr', passwordHash: acr2Hash },
    create: {
      email: 'ayomideamisu622@gmail.com',
      passwordHash: acr2Hash,
      name: 'ACR2',
      role: 'acr',
    },
  });

  // Developer / test account — always correct name + role + password
  const dev = await prisma.user.upsert({
    where: { email: 'yasiroyebo@gmail.com' },
    update: { name: 'Yasir (Dev)', role: 'dev', passwordHash: devHash },
    create: {
      email: 'yasiroyebo@gmail.com',
      passwordHash: devHash,
      name: 'Yasir (Dev)',
      role: 'dev',
    },
  });

  // Financial Secretary / Treasurer — Esther
  const finSec = await prisma.user.upsert({
    where: { email: 'olusegunesther964@gmail.com' },
    update: { name: 'Esther Olusegun', role: 'fin_sec', passwordHash: finSecHash },
    create: {
      email: 'olusegunesther964@gmail.com',
      passwordHash: finSecHash,
      name: 'Esther Olusegun',
      role: 'fin_sec',
    },
  });

  console.log('Seeded CR      :', cr.email, '→', cr.name);
  console.log('Seeded ACR     :', acr.email, '→', acr.name);
  console.log('Seeded ACR2    :', acr2.email, '→', acr2.name);
  console.log('Seeded Dev     :', dev.email, '→', dev.name);
  console.log('Seeded Fin Sec :', finSec.email, '→', finSec.name);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
