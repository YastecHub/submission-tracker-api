import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'cr@university.edu' },
    update: {},
    create: {
      email: 'cr@university.edu',
      passwordHash,
      name: 'Course Representative',
    },
  });

  console.log('Seeded CR account:', user.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
