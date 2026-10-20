import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const p = new PrismaClient();

const expected: Record<string, string> = {
  'ayomideamisu622@gmail.com': 'Ayomide098',
  'victoriaeniolorunda2008@gmail.com': 'Supremeleader',
  'olusegunesther964@gmail.com': 'Esther123',
  'yasiroyebo@gmail.com': 'Yastec01!',
};

async function main(): Promise<void> {
  for (const [email, password] of Object.entries(expected)) {
    const user = await p.user.findUnique({ where: { email } });
    if (!user) {
      console.log(`${email.padEnd(40)} → NOT FOUND`);
      continue;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    console.log(
      `${email.padEnd(40)} role=${user.role.padEnd(6)} password match: ${ok ? 'YES' : 'NO'}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
