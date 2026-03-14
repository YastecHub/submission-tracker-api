import { PrismaClient } from '@prisma/client';

// Single shared instance — avoids multiple connection pools exhausting
// Supabase free tier's connection limit (~15 total).
// connection_limit=5 is enough for one server process with pgbouncer pooling.
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=5`
        : undefined,
    },
  },
});

export default prisma;
