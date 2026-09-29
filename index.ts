import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './src/swagger';




import prisma from './src/lib/prisma';
import authRoutes from './src/routes/auth';
import eventRoutes from './src/routes/events';
import submissionRoutes from './src/routes/submissions';
import paymentEventRoutes from './src/routes/paymentEvents';
import paymentReceiptRoutes from './src/routes/paymentReceipts';
import transactionRoutes from './src/routes/transactions';
import studentAuthRoutes from './src/routes/studentAuth';
import announcementRoutes from './src/routes/announcements';
import { startNotificationDeliveryWorker } from './src/modules/announcements/application/notificationDeliveryWorker';
import logger, { requestLogger } from './src/lib/logger';

const app = express();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a strong secret of at least 32 characters');
}

// Render forwards the original client IP through one trusted proxy.
app.set('trust proxy', 1);

// HTTP request logger using winston
app.use(requestLogger);

function getAllowedOrigins(): string[] {
  const configured = [process.env.CLIENT_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .flatMap((value) => value!.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults =
    process.env.NODE_ENV === 'production'
      ? ['https://nexium31.vercel.app']
      : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  return Array.from(new Set([...configured, ...defaults]));
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (getAllowedOrigins().includes(origin)) return true;

  // Optional for Vercel preview deployments. Keep disabled unless needed.
  if (process.env.ALLOW_VERCEL_PREVIEWS === 'true') {
    try {
      const { hostname, protocol } = new URL(origin);
      return protocol === 'https:' && hostname.endsWith('.vercel.app');
    } catch {
      return false;
    }
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      logger.warn(`[cors] blocked origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  })
);

// Gzip all responses — cuts payload size by ~70%
app.use(compression());

app.use(express.json());

// Rate limiting: 200 req/min per IP for general API
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  skip: (req) => req.method === 'OPTIONS',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use('/api', apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  skip: (req) => req.method === 'OPTIONS',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

app.use('/api/auth/login', loginLimiter);

// Swagger UI — available at /api/docs
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'NEXIUM API',
    customCss: '.swagger-ui .topbar { display: none }',
  })
);

// Raw OpenAPI JSON — for Postman / code generation
app.get('/api/docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/api/auth', authRoutes);
app.use('/api/student-auth', studentAuthRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/payment-events', paymentEventRoutes);
app.use('/api/payment-receipts', paymentReceiptRoutes);
app.use('/api/bulletin', announcementRoutes);
app.use('/api', transactionRoutes);

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'NEXIUM API',
    health: '/api/health',
    docs: '/api/docs',
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/api/warmup', async (req: Request, res: Response) => {
  const warmupToken = process.env.WARMUP_TOKEN;
  if (warmupToken && req.get('x-warmup-token') !== warmupToken) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const startedAt = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'warm', db: 'ok', elapsedMs: Date.now() - startedAt });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`[Unhandled Error] ${req.method} ${req.originalUrl}: ${err.message}`, {
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Uncaught exception and unhandled rejection logging
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason instanceof Error ? reason.message : String(reason)}`, {
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = app.listen(PORT, HOST);
let stopNotificationWorker = () => {};
server.on('close', () => stopNotificationWorker());

server.on('error', (error) => {
  logger.error(`Failed to bind API server on ${HOST}:${PORT}`, { error });
  process.exitCode = 1;
});

server.on('listening', async () => {
  const base = process.env.PUBLIC_API_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`;

  console.log('\n');
  console.log('  \x1b[1m\x1b[35mNEXIUM API\x1b[0m');
  console.log('  ─────────────────────────────────────────');
  console.log(`  \x1b[1mServer:  \x1b[0m\x1b[36m\x1b]8;;${base}\x07${base}\x1b]8;;\x07\x1b[0m`);
  console.log(`  \x1b[1mDocs:    \x1b[0m\x1b[36m\x1b]8;;${base}/api/docs\x07${base}/api/docs\x1b]8;;\x07\x1b[0m`);
  console.log(`  \x1b[1mHealth:  \x1b[0m\x1b[36m\x1b]8;;${base}/api/health\x07${base}/api/health\x1b]8;;\x07\x1b[0m`);
  console.log('  ─────────────────────────────────────────');

  // Check database connection with a real query
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('  \x1b[1mDB:      \x1b[0m\x1b[32m● Connected\x1b[0m');
    logger.info(`NEXIUM API server listening on ${base} [DB Connected]`);
    stopNotificationWorker = startNotificationDeliveryWorker();
  } catch (err: unknown) {
    console.log('  \x1b[1mDB:      \x1b[0m\x1b[31m● Connection failed\x1b[0m');
    console.error('  ─────────────────────────────────────────');
    console.error('  \x1b[31mDiagnostics:\x1b[0m');
    console.error(`  DATABASE_URL: ${process.env.DATABASE_URL ? '✓ Set' : '✗ Not set'}`);
    logger.error('Database connection failed on startup', { error: err });
    if (err instanceof Error) {
      const lines = err.message.split('\n');
      lines.forEach(line => console.error(`  \x1b[31m${line.trim()}\x1b[0m`));
    } else {
      console.error(`  \x1b[31m${String(err)}\x1b[0m`);
    }
    console.error('  ─────────────────────────────────────────');
  }

  console.log('  ─────────────────────────────────────────\n');
});
