import prisma from '../lib/prisma';

const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function toSlugPart(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 25);
}

function randomSuffix(length = 4): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SUFFIX_CHARS.charAt(Math.floor(Math.random() * SUFFIX_CHARS.length));
  }
  return result;
}

export async function uniqueSlug(courseCode: string, _title: string): Promise<string> {
  let slug: string;
  let exists = true;
  do {
    slug = `${toSlugPart(courseCode)}-${randomSuffix()}`;
    const found = await prisma.submissionEvent.findUnique({ where: { slug } });
    exists = !!found;
  } while (exists);
  return slug;
}
