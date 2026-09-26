import { Response } from 'express';
import { AppError } from '../errors/AppError';

export function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  throw error;
}
