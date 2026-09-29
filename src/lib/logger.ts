import winston from 'winston';
import path from 'node:path';
import fs from 'node:fs';
import { Request, Response, NextFunction } from 'express';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');
const logDir = path.resolve(process.cwd(), 'logs');

// Ensure log directory exists if writing to file
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // Ignore if directory creation fails in restricted environments (e.g. read-only container)
  }
}

// Custom format for terminal development
const devConsoleFormat = winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const stackString = stack ? `\n${stack}` : '';
  return `${timestamp} [${level}]: ${message}${metaString}${stackString}`;
});

// Transports configuration
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize({ all: true }),
            devConsoleFormat
          )
    ),
  }),
];

// In non-restricted or file-logging-enabled environments, log to files as well
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
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
      })
    );
  } catch (err) {
    // Fall back to console only if file transport setup fails
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
 * Logs method, URL, status code, response time, and user info.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Log on response completion
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const user = (req as Request & { user?: { id: string; role?: string }; student?: { id: string } }).user
      ?? (req as Request & { user?: { id: string }; student?: { id: string } }).student;

    const logData = {
      method,
      url: originalUrl,
      status: statusCode,
      durationMs: duration,
      ip: req.ip || ip,
      userId: user?.id,
    };

    // Quiet health checks unless they fail
    if (originalUrl === '/api/health' || originalUrl === '/api/warmup') {
      if (statusCode >= 400) {
        logger.warn(`[HTTP] ${method} ${originalUrl} ${statusCode} - ${duration}ms`, logData);
      } else {
        logger.debug(`[HTTP] ${method} ${originalUrl} ${statusCode} - ${duration}ms`, logData);
      }
      return;
    }

    const message = `[HTTP] ${method} ${originalUrl} ${statusCode} ${duration}ms`;

    if (statusCode >= 500) {
      logger.error(message, logData);
    } else if (statusCode >= 400) {
      logger.warn(message, logData);
    } else {
      logger.http ? logger.http(message, logData) : logger.info(message, logData);
    }
  });

  next();
}

export default logger;
