import winston from 'winston';
import path from 'node:path';
import fs from 'node:fs';
import { Request, Response, NextFunction } from 'express';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');
const logDir = path.resolve(process.cwd(), 'logs');

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // Ignore restricted environment errors
  }
}

/**
 * Filter out internal Winston keys and standard HTTP fields from custom metadata
 */
function extractCustomMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  const ignoredKeys = new Set([
    'durationMs',
    'method',
    'url',
    'status',
    'ip',
    'userId',
    'splat',
    'timestamp',
    'level',
    'message',
    'stack',
    'error',
  ]);

  for (const [key, value] of Object.entries(meta)) {
    if (!ignoredKeys.has(key) && value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Structured, human-readable file formatter.
 * Produces clean, readable log entries instead of minified JSON blobs.
 */
const structuredFileFormat = winston.format.printf((info) => {
  const { timestamp, level, message, stack, error, ...rest } = info;
  const upperLevel = level.toUpperCase().padEnd(5);
  let output = `[${timestamp}] [${upperLevel}] ${message}`;

  // Error details
  if (error) {
    if (error instanceof Error) {
      output += `\n  Exception: ${error.name}: ${error.message}`;
      if (error.stack) {
        output += `\n  Stack:\n    ${error.stack.trim().replace(/\n/g, '\n    ')}`;
      }
    } else if (typeof error === 'object' && error !== null) {
      const errObj = error as Record<string, unknown>;
      const stackStr = typeof errObj.stack === 'string' ? errObj.stack : undefined;
      const cleanErr = { ...errObj };
      delete cleanErr.stack;

      if (Object.keys(cleanErr).length > 0) {
        output += `\n  Error Details: ${JSON.stringify(cleanErr, null, 2).replace(/\n/g, '\n  ')}`;
      }
      if (stackStr) {
        output += `\n  Stack:\n    ${stackStr.trim().replace(/\n/g, '\n    ')}`;
      }
    }
  }

  // Standalone stack trace (if not already printed from error)
  if (stack && (!error || typeof error !== 'object' || !(error as Record<string, unknown>).stack)) {
    output += `\n  Stack:\n    ${String(stack).trim().replace(/\n/g, '\n    ')}`;
  }

  // Additional context / metadata
  const meta = extractCustomMetadata(rest as Record<string, unknown>);
  if (Object.keys(meta).length > 0) {
    output += `\n  Context: ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}`;
  }

  return output;
});

/**
 * Clean terminal console formatter with colorized levels
 */
const consoleFormat = winston.format.printf((info) => {
  const { timestamp, level, message, stack, error, ...rest } = info;
  let line = `${timestamp} [${level}] ${message}`;

  const meta = extractCustomMetadata(rest as Record<string, unknown>);
  if (Object.keys(meta).length > 0) {
    line += ` ${JSON.stringify(meta)}`;
  }

  if (stack) {
    line += `\n  ${String(stack).trim().replace(/\n/g, '\n  ')}`;
  } else if (error && typeof error === 'object' && error !== null && 'stack' in error) {
    line += `\n  ${String((error as { stack?: unknown }).stack).trim().replace(/\n/g, '\n  ')}`;
  }

  return line;
});

// Transports configuration
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      isProduction && process.env.LOG_FORMAT === 'json'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize({ all: true }),
            consoleFormat
          )
    ),
  }),
];

// File transports with structured, readable formatting
const enableFileLogging = process.env.ENABLE_FILE_LOGGING !== 'false';
if (enableFileLogging) {
  try {
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          process.env.LOG_FORMAT === 'json' ? winston.format.json() : structuredFileFormat
        ),
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          process.env.LOG_FORMAT === 'json' ? winston.format.json() : structuredFileFormat
        ),
      })
    );
  } catch (err) {
    console.warn('[logger] Could not initialize file transports, falling back to console:', err);
  }
}

export const logger = winston.createLogger({
  level: logLevel,
  levels: winston.config.npm.levels,
  transports,
  exitOnError: false,
});

/**
 * Express middleware for HTTP request & response logging.
 * Logs method, URL, status code, response time, IP, and user identity.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const user = (req as Request & { user?: { id: string; role?: string }; student?: { id: string } }).user
      ?? (req as Request & { user?: { id: string }; student?: { id: string } }).student;

    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const userPart = user?.id ? ` | User: ${user.id}` : '';
    const ipPart = ` | IP: ${ip}`;
    const message = `${method} ${originalUrl} ${statusCode} (${duration}ms)${ipPart}${userPart}`;

    const logData = {
      method,
      url: originalUrl,
      status: statusCode,
      durationMs: duration,
      ip,
      userId: user?.id,
    };

    // Quiet health checks unless they encounter an error
    if (originalUrl === '/api/health' || originalUrl === '/api/warmup') {
      if (statusCode >= 400) {
        logger.warn(message, logData);
      } else {
        logger.debug(message, logData);
      }
      return;
    }

    if (statusCode >= 500) {
      // If error middleware already logged the unhandled exception, record request at warn to avoid duplicate in error.log
      if (res.locals?.__unhandledErrorLogged) {
        logger.warn(message, logData);
      } else {
        logger.error(message, logData);
      }
    } else if (statusCode >= 400) {
      logger.warn(message, logData);
    } else {
      logger.http ? logger.http(message, logData) : logger.info(message, logData);
    }
  });

  next();
}

export default logger;
