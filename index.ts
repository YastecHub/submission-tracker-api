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

const app = express();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a strong secret of at least 32 characters');
}

// Render forwards the original client IP through one trusted proxy.
app.set('trust proxy', 1);

app.use(
  cors({
    origin(origin, callback) {
      const configuredOrigins = (process.env.CLIENT_URL ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const allowedOrigins = configuredOrigins.length
        ? configuredOrigins
        : process.env.NODE_ENV === 'production'
          ? []
          : ['http://localhost:5173', 'http://127.0.0.1:5173'];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
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
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use('/api', apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
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
app.use('/api/events', eventRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/payment-events', paymentEventRoutes);
app.use('/api/payment-receipts', paymentReceiptRoutes);
app.use('/api', transactionRoutes);

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
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = app.listen(PORT, HOST);

server.on('error', (error) => {
  console.error(`Failed to bind API server on ${HOST}:${PORT}`, error);
  process.exitCode = 1;
});

server.on('listening', async () => {
  // Use Render's public URL in production, otherwise localhost
  const base = process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`;

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
  } catch (err: unknown) {
    console.log('  \x1b[1mDB:      \x1b[0m\x1b[31m● Connection failed\x1b[0m');
    console.error('  ─────────────────────────────────────────');
    console.error('  \x1b[31mDiagnostics:\x1b[0m');
    console.error(`  DATABASE_URL: ${process.env.DATABASE_URL ? '✓ Set' : '✗ Not set'}`);
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
