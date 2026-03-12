import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './src/swagger';

import authRoutes from './src/routes/auth';
import eventRoutes from './src/routes/events';
import submissionRoutes from './src/routes/submissions';

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? '*',
    credentials: true,
  })
);

app.use(express.json());

// Swagger UI — available at /api/docs
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Submission Tracker API',
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

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log('\n');
  console.log('  \x1b[1m\x1b[36mSubmission Tracker API\x1b[0m');
  console.log('  ─────────────────────────────────────────');
  console.log(`  \x1b[1mServer:  \x1b[0m\x1b[36m\x1b]8;;${base}\x07${base}\x1b]8;;\x07\x1b[0m`);
  console.log(`  \x1b[1mDocs:    \x1b[0m\x1b[36m\x1b]8;;${base}/api/docs\x07${base}/api/docs\x1b]8;;\x07\x1b[0m`);
  console.log(`  \x1b[1mHealth:  \x1b[0m\x1b[36m\x1b]8;;${base}/api/health\x07${base}/api/health\x1b]8;;\x07\x1b[0m`);
  console.log('  ─────────────────────────────────────────\n');
});
