import { Request, RequestHandler, Response } from 'express';
import { sendError } from './sendError';

type Handler<T> = (req: Request, res: Response) => Promise<T> | T;

function json(statusCode: number, handler: Handler<unknown>): RequestHandler {
  return async (req, res) => {
    try {
      const body = await handler(req, res);
      if (!res.headersSent) {
        res.status(statusCode).json(body);
      }
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function ok(handler: Handler<unknown>): RequestHandler {
  return json(200, handler);
}

export function created(handler: Handler<unknown>): RequestHandler {
  return json(201, handler);
}

export function file(handler: Handler<{ buffer: Buffer; filename: string; contentType: string }>): RequestHandler {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Content-Type', result.contentType);
      res.send(result.buffer);
    } catch (error) {
      sendError(res, error);
    }
  };
}
