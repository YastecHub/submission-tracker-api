import { PrismaClient } from '@prisma/client';

function buildDatabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    // Ensure pgbouncer is set for port 6543 pooler
    if (url.port === '6543' && !url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
    // Set connection limit (default 10)
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '10');
    }
    // Set pool timeout to 20s so concurrent bursts do not immediately fail
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '20');
    }
    // Set connect timeout to 15s to tolerate remote latency
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', '15');
    }
    // Ensure SSL mode is enabled for Supabase
    if (!url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// Single shared instance — avoids multiple connection pools exhausting
// Supabase connection pooler.
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: buildDatabaseUrl(process.env.DATABASE_URL),
    },
  },
});

export default prisma;
