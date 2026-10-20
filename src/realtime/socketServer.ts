import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import logger from '../lib/logger';
import { studentSessionIsCurrent } from '../modules/studentAuth/application/studentSessions';
import { setRealtimeServer } from './hub';

const STAFF_ROLES = new Set(['dev', 'electoral_committee']);

interface TokenPayload {
  scope?: string;
  id?: string;
  role?: string;
  iat?: number;
}

/**
 * Live updates (elections). Every connection must carry a valid student or staff token;
 * the server only ever pushes status and turnout numbers, never anyone's vote.
 * Rooms: "signed-in" (everyone), "staff" (developer + committee), "student:<id>".
 */
export function startSocketServer(httpServer: HttpServer, isAllowedOrigin: (origin: string | undefined) => boolean): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => callback(null, isAllowedOrigin(origin)), credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    serveClient: false,
  });

  io.use(async (socket: any, next: (err?: any) => void) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
      if (!payload.id) return next(new Error('unauthorized'));
      if (payload.scope === 'student') {
        if (!(await studentSessionIsCurrent(payload.id, payload.iat))) return next(new Error('unauthorized'));
        socket.data.studentId = payload.id;
      } else if (payload.role && STAFF_ROLES.has(payload.role)) {
        socket.data.staffId = payload.id;
      } else {
        return next(new Error('unauthorized'));
      }
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: any) => {
    void socket.join('signed-in');
    if (socket.data.studentId) void socket.join(`student:${socket.data.studentId}`);
    if (socket.data.staffId) void socket.join('staff');
  });

  io.engine.on('connection_error', (error: { code: number; message: string }) => {
    logger.debug?.(`[socket] connection error ${error.code}: ${error.message}`);
  });

  setRealtimeServer(io);
  return io;
}
