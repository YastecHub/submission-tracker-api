declare namespace Express {
  interface Request {
    user?: {
      id: string;
      email: string;
      name: string;
      role: 'cr' | 'acr' | 'dev';
      iat?: number;
      exp?: number;
    };
  }
}
