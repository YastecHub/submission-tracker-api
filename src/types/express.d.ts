declare namespace Express {
  interface Request {
    user?: {
      id: string;
      email: string;
      name: string;
      role: 'cr' | 'acr' | 'fin_sec' | 'dev';
      iat?: number;
      exp?: number;
    };
  }
}
