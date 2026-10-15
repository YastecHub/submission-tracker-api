import type { Server } from 'socket.io';

/**
 * The one place the rest of the app talks to connected browsers. When sockets are not
 * running (tests, scripts) every emit is a no-op, and pages fall back to polling.
 */
let io: Server | null = null;

export function setRealtimeServer(server: Server | null): void {
  io = server;
}

export function emitToSignedIn(event: string, payload: unknown): void {
  io?.to('signed-in').emit(event, payload);
}

export function emitToStaff(event: string, payload: unknown): void {
  io?.to('staff').emit(event, payload);
}

export function emitToStudent(studentId: string, event: string, payload: unknown): void {
  io?.to(`student:${studentId}`).emit(event, payload);
}
