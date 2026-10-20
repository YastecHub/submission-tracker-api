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
  const [crHash, acrHash, devHash, finSecHash] = await Promise.all([
    bcrypt.hash('Ayomide098', 10),
    bcrypt.hash('Supremeleader', 10),
    bcrypt.hash('Yastec01!', 10),
    bcrypt.hash('Esther123', 10),
  ]);

  // Course Representative (CR) - Ayomide Amisu (Election Winner)
  const cr = await prisma.user.upsert({
    where: { email: 'ayomideamisu622@gmail.com' },
    update: { name: 'Ayomide Amisu', role: 'cr', passwordHash: crHash },
    create: {
      email: 'ayomideamisu622@gmail.com',
      passwordHash: crHash,
      name: 'Ayomide Amisu',
      role: 'cr',
    },
  });

  // Assistant Course Representative (ACR) - Victoria Eniolorunda (Election Winner)
  const acr = await prisma.user.upsert({
    where: { email: 'victoriaeniolorunda2008@gmail.com' },
    update: { name: 'Victoria Eniolorunda', role: 'acr', passwordHash: acrHash },
    create: {
      email: 'victoriaeniolorunda2008@gmail.com',
      passwordHash: acrHash,
      name: 'Victoria Eniolorunda',
      role: 'acr',
    },
  });

  // Developer / test account - always correct name + role + password
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

  // Financial Secretary / Treasurer - Esther Olusegun (Election Winner)
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
  console.log('Seeded Dev     :', dev.email, '→', dev.name);
  console.log('Seeded Fin Sec :', finSec.email, '→', finSec.name);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
