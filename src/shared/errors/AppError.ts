export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string): AppError {
  return new AppError(400, message);
}

export function forbidden(message: string): AppError {
  return new AppError(403, message);
}

export function notFound(message: string): AppError {
  return new AppError(404, message);
}
