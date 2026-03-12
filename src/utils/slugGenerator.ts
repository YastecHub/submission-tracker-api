import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateSlug(length = 7): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return result;
}

export async function uniqueSlug(): Promise<string> {
  let slug: string;
  let exists = true;
  do {
    slug = generateSlug();
    const found = await prisma.submissionEvent.findUnique({ where: { slug } });
    exists = !!found;
  } while (exists);
  return slug;
}
