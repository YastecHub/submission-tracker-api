import { Request, Response, NextFunction } from 'express';

type Role = 'cr' | 'acr' | 'fin_sec' | 'dev';

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: 'You are not allowed to perform this action' });
      return;
    }
    next();
  };
}
