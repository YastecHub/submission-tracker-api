// Augment Express Request to include the authenticated user set by authMiddleware
declare namespace Express {
  interface Request {
    user?: {
      id: string;
      email: string;
      name: string;
      iat?: number;
      exp?: number;
    };
  }
}
