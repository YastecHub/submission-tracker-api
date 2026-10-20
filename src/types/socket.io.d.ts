declare module 'socket.io' {
  export class Server {
    constructor(srv?: any, opts?: any);
    use(fn: (socket: any, next: (err?: any) => void) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    to(room: string | string[]): any;
    emit(event: string, ...args: any[]): boolean;
    disconnectSockets(close?: boolean): void;
    close(fn?: () => void): this;
    engine: any;
  }
}
