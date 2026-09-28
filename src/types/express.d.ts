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
    student?: {
      scope: 'student';
      id: string;
      matricNumber: string;
      email: string;
      fullName: string;
      iat?: number;
      exp?: number;
    };
  }
}
